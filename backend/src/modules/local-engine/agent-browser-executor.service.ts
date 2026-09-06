import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  AiBrowserActionService,
  AiBrowserAction,
} from './ai-browser-action.service';
import {
  AgentPanelBridgeService,
  PanelBridgeActor,
  PanelBridgeError,
  PanelActionState,
  readPanelModeRegistry,
} from './agent-panel-bridge.service';
import { LocalBrowserEngine } from './local-browser-engine.service';
import { resolvePlatformLoginState } from './platform-login-rules';

/**
 * §7.4 AgentBrowserExecutor：接入统一执行器路由。
 * 文档服务边界要求独立 Executor——封装真实浏览器动作执行（LocalBrowserEngine
 * 会话）+ 引擎探活，供 AgentBrowserLoopService 调用。执行语义与错误码
 * （BrowserActionError）由 AiBrowserActionService.executeSingle 承载。
 *
 * ── 阶段 5：面板模式（KAYPAL_AGENT_PANEL_MODE，默认 off）──────────────────
 * on = 浏览器动作改走**用户右侧那个面板页面**（3011 ⇄ desktop 上行桥），
 * 即"用户看的页面 / Agent 读的页面 / 执行的页面 / 截图证据的页面"四合一。
 *
 * 三条硬规矩（AGENTS.md + 工作流文档 §9）：
 *  1. **默认 off**——不改任何现有执行路径，未开启时本类是纯透传；
 *  2. **不静默降级**——面板不可用 / 身份缺失 / 动作暂不支持，一律 `ok:false`
 *     并写明原因，**绝不悄悄回退到无头浏览器**（那会让"以为在操作登录态"
 *     变成假证据）；
 *  3. **批准权不在后端**——写动作（goto）必须先在桌面端签确认单、由用户点批；
 *     后端只认 `approved` 状态的确认单，pending 就停在"需用户确认"。
 */

export type AgentPanelMode = 'off' | 'on';

export type AgentBrowserExecuteInput = {
  action: AiBrowserAction;
  accountId?: string;
  timeoutMs?: number;
  /** 面板模式必填：调用方身份（用于面板 actor 断言，防跨会话/跨租户） */
  actor?: PanelBridgeActor;
  /**
   * 阶段 6 决策 ②：所属 AgentBrowser 会话 id。面板确认单落进 AgentConfirmation
   * 时写进 sessionId —— loop 的 resolveConfirmation 靠它把单绑到会话上
   * （防跨会话复用）。不传 = 孤儿单，永远匹配不上，动作会被闸门拦住（fail-closed）。
   */
  sessionId?: string;
  /**
   * 触达审计：本步动作归属的线索 id（获客跟进执行时透传）。面板确认单落库时
   * 写进 confirmationJson.leadId —— 线索详情页「触达历史」按它反查。不传 = 通用
   * agent 任务动作（与具体客户无关），只进会话审计不进线索时间线。
   */
  leadId?: string | null;
  /**
   * 阶段 7：loop 锁定的面板确认单 id（resolveConfirmation → lockedConfirmationId）。
   * 之前断链：loop 锁了单却从未传给 executor，重试时 executor 会再签新单死循环。
   * executor 侧优先级：input.actionId（loop 锁定的）> action.actionId（AI 自带）。
   */
  actionId?: string;
};

export type AgentBrowserExecuteResult = {
  index: number;
  action: string;
  ok: boolean;
  message?: string;
  evidenceUrl?: string;
  extractText?: string;
  /** 阶段 7 round12：面板截图（Page.captureScreenshot）的 PNG base64。
   *  readonly 观察类免单（同 extract）；message/日志只报字节数不携带数据。 */
  screenshotBase64?: string;
  /** P1（复查 2026-08-22）：动作执行后的真实页面 URL（导航回写用） */
  url?: string;
  /** 面板模式：待用户批准的面板确认单 id（与 AgentConfirmation 是两套，见交底） */
  confirmationId?: string;
  /** 面板模式：动作落在哪个 webContents 上（同页证据，钉进步骤事件） */
  panelWebContentsId?: number | null;
  panelSessionId?: string | null;
};

const PANEL_MODE_ENV = 'KAYPAL_AGENT_PANEL_MODE';

/**
 * 读面板模式开关（阶段 6 决策 ③）。两个来源，优先级从高到低：
 *  1. **env 显式设置**（KAYPAL_AGENT_PANEL_MODE）——运维/开发一锤定音，
 *     'off' 是管理员一票否决，非法值返回 'invalid'（显式报错，不猜配置）；
 *  2. **用户级开关文件**（desktop 面板按钮 → userData 下 0600 文件，
 *     由 readPanelModeRegistry 读取，null=文件缺失/不合规=未开启）；
 *  3. 默认 off（铁律不变）。
 *
 * @param modeFile 测试注入用；生产走默认参数（带 1s 缓存的文件读取）。
 */
export function readAgentPanelMode(
  env: NodeJS.ProcessEnv = process.env,
  modeFile: 'on' | 'off' | null = readPanelModeRegistry(),
): AgentPanelMode | 'invalid' {
  const raw = (env[PANEL_MODE_ENV] ?? '').trim().toLowerCase();
  if (raw === 'on') return 'on';
  if (raw === 'off') return 'off';
  if (raw !== '') return 'invalid'; // 非法值不猜，也不吃掉文件开关
  if (modeFile === 'on') return 'on';
  return 'off';
}

/**
 * 阶段 7：把 selector 解析成页面坐标的只读探测表达式（Runtime.evaluate 执行）。
 *
 * 语义（对齐 ai-browser-action 的 click selector 约定）：
 *  - `text=文本`：先精确匹配后包含匹配，只认**可见元素**（getClientRects 非空）；
 *    候选限定可交互/文本标签，避免扫全树慢且命中脚本类节点；
 *  - 其余按 CSS selector 走 document.querySelector；
 *  - 返回元素外接矩形中心坐标（Input.dispatchMouseEvent 打的就是这个点）。
 *
 * 注意：selector 用 JSON.stringify 嵌入（防表达式注入）；只支持主 frame
 * （跨 iframe 元素探测不到，探测结果 found:false，交底为不支持）。
 */
export function buildSelectorProbeExpression(selector: string): string {
  const selJson = JSON.stringify(String(selector ?? '').trim());
  return (
    '(function probeSelector() {' +
    '  function visible(el) {' +
    '    if (!el || typeof el.getClientRects !== "function" || el.getClientRects().length === 0) return false;' +
    '    var style = window.getComputedStyle(el);' +
    '    return !!style && style.visibility !== "hidden" && style.display !== "none";' +
    '  }' +
    '  function center(el) {' +
    '    var r = el.getBoundingClientRect();' +
    '    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),' +
    '      text: (el.textContent || "").trim().slice(0, 80) };' +
    '  }' +
    '  function pick(candidates) {' +
    '    for (var i = 0; i < candidates.length; i++) {' +
    '      var el = candidates[i];' +
    '      if (el && visible(el)) return center(el);' +
    '    }' +
    '    return null;' +
    '  }' +
    '  var sel = ' +
    selJson +
    ';' +
    '  var hit = null;' +
    '  if (sel.indexOf("text=") === 0) {' +
    '    var text = sel.slice(5).trim();' +
    '    var nodes = Array.prototype.slice.call(document.querySelectorAll(' +
    '      "a,button,input,select,textarea,label,summary,[role=button],[onclick],h1,h2,h3,h4,span,div,p,li"' +
    '    ));' +
    '    var exact = nodes.filter(function (el) { return (el.textContent || "").trim() === text; });' +
    '    var partial = nodes.filter(function (el) {' +
    '      if (exact.indexOf(el) !== -1) return false;' +
    '      var t = (el.textContent || "").trim();' +
    '      return t.length > 0 && t.indexOf(text) !== -1;' +
    '    });' +
    '    hit = pick(exact) || pick(partial);' +
    '  } else {' +
    '    try { hit = pick([document.querySelector(sel)]); } catch (e) { hit = null; }' +
    '  }' +
    '  if (!hit) return { found: false };' +
    '  return { found: true, x: hit.x, y: hit.y, text: hit.text };' +
    '})()'
  );
}

/**
 * 阶段 7 续（第十轮）：selector 定向文本提取表达式（Runtime.evaluate 执行）。
 *
 * 对齐旧无头路径语义（locator(selector).first().textContent() → trim → 截 2000）：
 *  - `text=文本`：与 probe 同构（先精确后包含，可见元素过滤）；
 *  - 其余按 CSS selector 走 document.querySelector（first 语义）；
 *  - 命中返回 `{found:true, text}`（textContent trim 后页面内截断 2000 字符），
 *    未命中 `{found:false}` → executor 显式失败（对齐旧文案"提取失败"）。
 *
 * 与旧路径语义差异交底：候选带**可见性过滤**（probe 同构）——完全不可见元素的
 * 文本提取不到（found:false）；旧 locator 不要求可见。
 */
export function buildTextExtractExpression(selector: string): string {
  const selJson = JSON.stringify(String(selector ?? '').trim());
  return (
    '(function extractText() {' +
    '  function visible(el) {' +
    '    if (!el || typeof el.getClientRects !== "function" || el.getClientRects().length === 0) return false;' +
    '    var style = window.getComputedStyle(el);' +
    '    return !!style && style.visibility !== "hidden" && style.display !== "none";' +
    '  }' +
    '  function pick(candidates) {' +
    '    for (var i = 0; i < candidates.length; i++) {' +
    '      var el = candidates[i];' +
    '      if (el && visible(el)) return el;' +
    '    }' +
    '    return null;' +
    '  }' +
    '  var sel = ' +
    selJson +
    ';' +
    '  var hit = null;' +
    '  if (sel.indexOf("text=") === 0) {' +
    '    var text = sel.slice(5).trim();' +
    '    var nodes = Array.prototype.slice.call(document.querySelectorAll(' +
    '      "a,button,input,select,textarea,label,summary,[role=button],[onclick],h1,h2,h3,h4,span,div,p,li"' +
    '    ));' +
    '    var exact = nodes.filter(function (el) { return (el.textContent || "").trim() === text; });' +
    '    var partial = nodes.filter(function (el) {' +
    '      if (exact.indexOf(el) !== -1) return false;' +
    '      var t = (el.textContent || "").trim();' +
    '      return t.length > 0 && t.indexOf(text) !== -1;' +
    '    });' +
    '    hit = pick(exact) || pick(partial);' +
    '  } else {' +
    '    try { hit = pick([document.querySelector(sel)]); } catch (e) { hit = null; }' +
    '  }' +
    '  if (!hit) return { found: false };' +
    '  return { found: true, text: ((hit.textContent || "") + "").trim().slice(0, 2000) };' +
    '})()'
  );
}

/** 面板 wait 上限（对齐旧无头执行层 min(ms, 30_000)） */
export const PANEL_WAIT_MAX_MS = 30_000;

/**
 * 阶段 5 第一站（2026-09-04）：登录态快照只读表达式（Runtime.evaluate 执行）。
 *
 * 返回 `JSON.stringify({url, text})`：url = location.href，text = body.innerText
 * 截 20000 字符（登录提示词/账号工具栏判定够用，20k 防超大页面拖垮桥回传）。
 * 只读免单：不点不填不导航，与 extract/probe 同级（READONLY_METHODS 白名单内）。
 */
export function buildLoginStateExpression(): string {
  return (
    '(function loginStateSnapshot() {' +
    '  return JSON.stringify({' +
    '    url: location.href,' +
    '    text: (document.body ? document.body.innerText : "").slice(0, 20000)' +
    '  });' +
    '})()'
  );
}

/**
 * 阶段 5 第一站：登录态查询结果（面板模式专属，controller GET sessions/:id/login-state）。
 * ok:false 一律带 reason（不静默降级）；state 为启发式三态，仅 UI 引导用，
 * 不作为任何写动作放行依据（写动作仍走确认单审批链）。
 */
export type AgentPanelLoginStateResult =
  | {
      ok: true;
      platform: string;
      state: 'logged_in' | 'login_prompt' | 'unknown';
      url: string;
      panelWebContentsId: number | null;
    }
  | { ok: false; reason: string };

/**
 * 面板 wait 时长收敛（纯函数，测试可直调）：
 * floor + 非法/负数/0 → 0（立即返回）+ 上限 30s。
 * wait 无 CDP 副作用，无需审批——但大值必须截断，防 AI 传天文数字卡死会话状态机
 * （等待期间 paused/stopped 不会被响应）。
 */
export function clampPanelWaitMs(ms: unknown): number {
  const n = Math.floor(Number(ms));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, PANEL_WAIT_MAX_MS);
}

@Injectable()
export class AgentBrowserExecutor {
  private readonly logger = new Logger(AgentBrowserExecutor.name);

  constructor(
    private readonly actions: AiBrowserActionService,
    /** 可选注入：未注册面板桥时（老测试/未开启面板模式）保持纯透传语义 */
    @Optional() private readonly panelBridge?: AgentPanelBridgeService,
    /** 可选注入（2026-09-04 round17）：面板截图证据落盘走同一条 evidence 链 */
    @Optional() private readonly localBrowserEngine?: LocalBrowserEngine,
  ) {}

  /** 当前面板模式（对外暴露，供状态接口/排障查询） */
  panelMode(): AgentPanelMode | 'invalid' {
    return readAgentPanelMode();
  }

  /** 执行单个浏览器动作（含证据），失败返回 ok:false + message（不抛） */
  async execute(
    input: AgentBrowserExecuteInput,
  ): Promise<AgentBrowserExecuteResult> {
    const mode = this.panelMode();
    if (mode === 'off') {
      return this.actions.executeSingle(input);
    }
    if (mode === 'invalid') {
      return this.failed(
        input.action.action,
        `非法的 ${PANEL_MODE_ENV}=${process.env[PANEL_MODE_ENV]}（仅允许 off/on），` +
          `动作未执行（不猜配置、不回退）`,
      );
    }
    if (!this.panelBridge) {
      return this.failed(
        input.action.action,
        `面板模式已开启但面板桥服务未注入（模块注册缺失），动作未执行（不回退）`,
      );
    }
    return this.executeViaPanel(input);
  }

  /** §9.2 引擎探活：浏览器/sidecar 是否存活 */
  async isAlive(accountId: string): Promise<boolean> {
    const mode = this.panelMode();
    if (mode === 'on' && this.panelBridge) {
      // 面板模式下"引擎存活"= 面板桥活着（否则动作根本落不到用户看的那个页面）
      return this.panelBridge.health();
    }
    return this.actions.isEngineAlive(accountId);
  }

  /**
   * 阶段 5 第一站（2026-09-04）：平台登录态查询（面板模式专属，小红书先行）。
   *
   * 链路：Runtime.evaluate 免单只读快照 {url, text} → resolvePlatformLoginState
   * 启发式三态（logged_in / login_prompt / unknown）。判定规则收敛在
   * platform-login-rules 共享模块——与引擎 page 版共用同一份（防双端漂移）。
   *
   * 不静默降级三条：面板模式未开启 / 面板不可用 / 快照无效，一律 ok:false
   * 带 reason，绝不回退到无头引擎查询（登录态错了会误导用户以为已登录）。
   * 扫码登录本身是**用户人工接管点**：本查询只负责报告状态引导用户去扫码。
   */
  async loginStateViaPanel(
    actor: PanelBridgeActor,
    platform: string,
  ): Promise<AgentPanelLoginStateResult> {
    if (!actor?.ownerId || !actor?.tenantId) {
      return {
        ok: false,
        reason:
          '面板模式：缺少调用方身份（ownerId/tenantId），登录态未查询（不静默回退到无头浏览器）',
      };
    }
    const mode = this.panelMode();
    if (mode !== 'on' || !this.panelBridge) {
      return {
        ok: false,
        reason: '当前仅面板模式支持登录态查询（面板模式未开启），未查询',
      };
    }
    const status = this.panelBridge.status();
    if (!status.available) {
      return {
        ok: false,
        reason: `右侧浏览器面板不可用（${status.reason}），登录态未查询——请先打开右侧浏览器面板`,
      };
    }
    try {
      const out = await this.panelBridge.execute(actor, {
        method: 'Runtime.evaluate',
        params: {
          expression: buildLoginStateExpression(),
          returnByValue: true,
        },
      });
      // readonly 调用桥会回传 CDP 结果：{ result: { type, value } }
      const cdp = out.result as
        { result?: { value?: unknown } } | null | undefined;
      let parsed: { url?: unknown; text?: unknown } | null = null;
      try {
        const rawValue = cdp?.result?.value;
        parsed = JSON.parse(typeof rawValue === 'string' ? rawValue : '') as {
          url?: unknown;
          text?: unknown;
        } | null;
      } catch {
        parsed = null;
      }
      if (!parsed || typeof parsed.url !== 'string' || !parsed.url) {
        return {
          ok: false,
          reason:
            '面板页面状态读取失败（Runtime.evaluate 未返回有效 url），登录态未查询',
        };
      }
      const state = resolvePlatformLoginState(
        platform,
        parsed.url,
        typeof parsed.text === 'string' ? parsed.text : '',
      );
      return {
        ok: true,
        platform,
        state,
        url: parsed.url,
        panelWebContentsId: out.binding?.webContentsId ?? null,
      };
    } catch (err) {
      this.logger.warn(
        `loginStateViaPanel 失败：${err instanceof Error ? err.message : String(err)}`,
      );
      return {
        ok: false,
        reason: `登录态查询异常（${err instanceof Error ? err.message : String(err)}），未查询`,
      };
    }
  }

  // ── 面板模式 ────────────────────────────────────────────────────────────

  private async executeViaPanel(
    input: AgentBrowserExecuteInput,
  ): Promise<AgentBrowserExecuteResult> {
    const { action, actor } = input;
    const kind = action.action;

    // 1) 身份：面板 actor 断言需要 ownerId/tenantId，拿不到就不能动面板
    if (!actor?.ownerId || !actor?.tenantId) {
      return this.failed(
        kind,
        '面板模式：缺少调用方身份（ownerId/tenantId），动作未执行（不静默回退到无头浏览器）',
      );
    }
    // 2) 面板可用性：不可用 = 用户没开面板/面板已隐藏，明确告知而不是偷偷换引擎
    const status = this.panelBridge!.status();
    if (!status.available) {
      return this.failed(
        kind,
        `面板模式：右侧浏览器面板不可用（${status.reason}），动作未执行——` +
          `请先打开右侧浏览器面板（不静默回退到无头浏览器）`,
      );
    }

    try {
      // 3) 只读提取：extract → selector 定向文本提取（对齐旧无头语义：
      //    locator.textContent → trim → 截 2000；readonly 不签单不落库）
      if (kind === 'extract') {
        return await this.extractViaPanel(action, actor);
      }
      // 4) 导航：写动作——签单 → 等桌面端用户批准 → 带单执行
      if (kind === 'goto') {
        return await this.gotoViaPanel(
          action,
          actor,
          input.sessionId,
          input.actionId,
          input.leadId,
        );
      }
      // 5) 点击：写动作——先解析坐标（元素不存在不签单）→ 签单 → 用户批准 →
      //    带单执行（pressed+released 一次逻辑点击，坐标执行时重新解析）
      if (kind === 'click') {
        return await this.clickViaPanel(
          action,
          actor,
          input.sessionId,
          input.actionId,
          input.leadId,
        );
      }
      // 5.5) 输入：写动作——先解析坐标（元素不存在不签单）→ 签单 → 用户批准 →
      //      带单执行（聚焦 pressed 消耗 insertText 单 + insertText 配对放行）
      if (kind === 'type') {
        return await this.typeViaPanel(
          action,
          actor,
          input.sessionId,
          input.actionId,
          input.leadId,
        );
      }
      // 5.75) 按键：写动作——签单 → 用户批准 → 带单执行（keyDown 消耗单 +
      //       keyUp 配对放行，一次逻辑按键）
      if (kind === 'press_key') {
        return await this.pressKeyViaPanel(
          action,
          actor,
          input.sessionId,
          input.actionId,
          input.leadId,
        );
      }
      // 5.8) 等待：无 CDP 副作用（不动页面、无白名单命令）——免确认单本地等待
      //      （签"等待 N 毫秒"的审批卡片是骚扰）；身份/面板可用校验仍走前置。
      if (kind === 'wait') {
        return await this.waitViaPanel(action);
      }
      // 5.85) 标签页：写动作——签单 → 用户批准 → 带单执行（主进程伪 method
      //       Panel.tabs，manager 原生 tab 台账；switch 也签单：切换会改变用户
      //       所见的页面，知情卡片合理）
      if (kind === 'tabs') {
        return await this.tabsViaPanel(
          action,
          actor,
          input.sessionId,
          input.actionId,
          input.leadId,
        );
      }
      // 5.9) 截图：readonly 观察类——免确认单直接执行（Page.captureScreenshot
      //      已在 desktop 白名单 READONLY_METHODS）。免单理由同 extract/wait：
      //      loop 观察循环高频截图，弹审批卡是纯骚扰；不改变页面、无写副作用。
      //      交底差异：截图是全页视觉（可能含用户没点名的内容），敏感度高于
      //      定向 extract——base64 只进 result 专用字段，message/日志不携带。
      if (kind === 'screenshot') {
        return await this.screenshotViaPanel(action, actor);
      }
      // 6) 其余动作：面板桥还没开通，明确不支持（不许假装成功，也不许偷偷走老路径）
      return this.failed(
        kind,
        `面板模式暂不支持动作 ${String(kind)}（当前仅支持 extract / goto / click / type / press_key / wait / tabs / screenshot）；` +
          `未执行、未回退（阶段 7 八个动作已全部接通，出现本提示说明解析层产出了未登记的动作类型）`,
      );
    } catch (error) {
      const code =
        error instanceof PanelBridgeError ? error.code : 'PANEL_ACTION_FAILED';
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(`面板模式动作 ${kind} 失败（${code}）：${detail}`);
      return this.failed(
        kind,
        `面板模式动作 ${kind} 失败（${code}）：${detail}（未回退到无头浏览器）`,
      );
    }
  }

  /**
   * 面板导航：批准权在用户手上，后端只认 approved 的确认单。
   *
   * @param sessionId 所属 AgentBrowser 会话 id——面板确认单落进 AgentConfirmation
   *   时写进 sessionId 列，loop 的 resolveConfirmation 靠它把单绑到会话上
   *   （防跨会话复用）。不传 = 孤儿单，永远匹配不上，动作会被闸门拦住。
   */
  private async gotoViaPanel(
    action: Extract<AiBrowserAction, { action: 'goto' }>,
    actor: PanelBridgeActor,
    sessionId?: string,
    lockedActionId?: string,
    /** 触达审计：动作归属线索（签单落库 confirmationJson.leadId，线索详情反查） */
    leadId?: string | null,
  ): Promise<AgentBrowserExecuteResult> {
    // 阶段 7 修断链：loop 锁定的确认单（lockedActionId）优先——否则重试时
    // executor 看不到已锁定的单，会再签新单，用户批一张废一张，死循环。
    const carried =
      lockedActionId ?? (action as { actionId?: string }).actionId;
    if (carried) {
      const state = await this.panelBridge!.actionState(actor, carried);
      if (state.state === 'approved') {
        // 阶段 6 决策 ② 接缝：用户在桌面面板点了「批准」——这一刻必须落到
        // 确认单行里，否则"谁批的、什么时候批的"只活在 desktop 内存里。
        // status 列继续留给两阶段锁定，审批态写在 confirmationJson.status。
        await this.markApprovalSafe('approved', carried);
        const out = await this.panelBridge!.execute(actor, {
          method: 'Page.navigate',
          params: { url: action.url },
          actionId: carried,
        });
        return {
          index: 0,
          action: 'goto',
          ok: true,
          url: out.binding.url ?? action.url,
          panelWebContentsId: out.binding.webContentsId,
          panelSessionId: out.binding.sessionId,
          confirmationId: carried,
          message:
            `面板导航已执行（webContents=${out.binding.webContentsId}，` +
            `确认单 ${carried}）`,
        };
      }
      if (state.state === 'rejected') {
        // 拒绝是终态：落库收口（不可翻案），动作不执行
        await this.markApprovalSafe('rejected', carried);
        return this.failed(
          'goto',
          `面板模式：该导航已被用户在面板中拒绝（确认单 ${carried}），未执行`,
          carried,
        );
      }
      return this.failed(
        'goto',
        `面板模式：导航需用户在桌面端批准（确认单 ${carried} 当前状态 ${state.state}）`,
        carried,
      );
    }
    // 没有确认单 → 先签一张，把票号交回上层（前端/调度器据此提示用户去面板点批）
    const ticket = await this.panelBridge!.requestAction(actor, {
      method: 'Page.navigate',
      params: { url: action.url },
      summary: { label: '导航', url: action.url },
      sessionId: sessionId ?? null,
      leadId: leadId ?? null,
    });
    if (ticket.autoApproved) {
      // TraeWork 控制权模型：系统控制（默认）下这张单已在桌面侧经 owner 通道
      // 自动批准——直接走带票执行分支，用户没点「接管」就不该看到"待批准"回执。
      return this.gotoViaPanel(
        action,
        actor,
        sessionId,
        ticket.actionId,
        leadId,
      );
    }
    return this.failed(
      'goto',
      `需用户确认后执行（面板导航确认单 ${ticket.actionId}，请在右侧浏览器面板批准后携带该 id 重试）`,
      ticket.actionId,
    );
  }

  /**
   * 面板提取（extract）：selector 定向文本提取，对齐旧无头路径语义。
   *
   * 旧面板行为（observe textSample 整页快照）已替换——AI 传了 selector 就该拿到
   * **那个元素**的文本，整页快照会让它把别的页面的内容当成提取结果（假证据）。
   * 想要整页文本传 'body' 即可。readonly 调用，不签单不落库。
   * 未命中显式失败（对齐旧文案"提取失败"），不回退无头浏览器。
   */
  private async extractViaPanel(
    action: Extract<AiBrowserAction, { action: 'extract' }>,
    actor: PanelBridgeActor,
  ): Promise<AgentBrowserExecuteResult> {
    const out = await this.panelBridge!.execute(actor, {
      method: 'Runtime.evaluate',
      params: {
        expression: buildTextExtractExpression(action.selector),
        returnByValue: true,
      },
    });
    // readonly 调用桥会回传 CDP 结果：{ result: { type, value } }
    const cdp = out.result as
      | { result?: { value?: { found?: boolean; text?: string } } }
      | null
      | undefined;
    const value = cdp?.result?.value;
    if (
      !value ||
      typeof value !== 'object' ||
      value.found !== true ||
      typeof value.text !== 'string'
    ) {
      return this.failed(
        'extract',
        `面板模式：提取失败：选择器 ${action.selector} 无文本内容（不回退到无头浏览器）`,
      );
    }
    return {
      index: 0,
      action: 'extract',
      ok: true,
      extractText: value.text,
      url: out.binding.url ?? undefined,
      panelWebContentsId: out.binding.webContentsId,
      panelSessionId: out.binding.sessionId,
      message:
        `面板提取成功（selector "${action.selector}"，${value.text.length} 字符，` +
        `webContents=${out.binding.webContentsId}）`,
    };
  }

  /**
   * 面板等待（wait）：无 CDP 副作用，免确认单本地等待。
   *
   * 不签确认单的理由：wait 不碰页面、不进白名单、零副作用——签"等待 N 毫秒"
   * 的审批卡片是纯骚扰。但身份与面板可用校验仍走 executeViaPanel 前置
   * （面板关闭时不会假装等待成功），时长经 clampPanelWaitMs 收敛（≤30s）。
   */
  private async waitViaPanel(
    action: Extract<AiBrowserAction, { action: 'wait' }>,
  ): Promise<AgentBrowserExecuteResult> {
    const ms = clampPanelWaitMs(action.ms);
    await new Promise((resolve) => setTimeout(resolve, ms));
    const raw = Number(action.ms);
    const clampedNote =
      Number.isFinite(raw) && raw > ms
        ? `，原始请求 ${raw}ms 已按上限 ${PANEL_WAIT_MAX_MS}ms 截断`
        : '';
    return {
      index: 0,
      action: 'wait',
      ok: true,
      message: `面板等待完成（${ms}ms${clampedNote}）`,
    };
  }

  /** 只读探测：selector → 页面坐标（Runtime.evaluate，readonly 不签单不落库） */
  private async probeSelector(
    actor: PanelBridgeActor,
    selector: string,
  ): Promise<{ found: boolean; x?: number; y?: number; text?: string }> {
    const out = await this.panelBridge!.execute(actor, {
      method: 'Runtime.evaluate',
      params: {
        expression: buildSelectorProbeExpression(selector),
        returnByValue: true,
      },
    });
    // readonly 调用桥会回传 CDP 结果：{ result: { type, value } }
    const cdp = out.result as
      | {
          result?: {
            value?: { found?: boolean; x?: number; y?: number; text?: string };
          };
        }
      | null
      | undefined;
    const value = cdp?.result?.value;
    if (!value || typeof value !== 'object' || value.found !== true) {
      return { found: false };
    }
    return {
      found: true,
      x: typeof value.x === 'number' ? value.x : undefined,
      y: typeof value.y === 'number' ? value.y : undefined,
      text: typeof value.text === 'string' ? value.text : undefined,
    };
  }

  /**
   * 面板截图（screenshot）：readonly 观察类，免确认单（同 extract/probe）。
   *
   * 真机截图走 `Page.captureScreenshot`（desktop 白名单 READONLY_METHODS，
   * broker/server 零改动）。免单理由：不改变页面、无写副作用；loop 观察循环
   * 高频截图，弹审批卡是纯骚扰（wait 免单同理）。
   * 交底差异：截图是全页视觉，可能捕获用户没点名的内容（侧边聊天、自动填充），
   * 敏感度高于定向 extract——PNG base64 只进 result.screenshotBase64 专用字段，
   * message/日志/事件只报字节数，不携带数据。
   */
  private async screenshotViaPanel(
    action: Extract<AiBrowserAction, { action: 'screenshot' }>,
    actor: PanelBridgeActor,
  ): Promise<AgentBrowserExecuteResult> {
    const out = await this.panelBridge!.execute(actor, {
      method: 'Page.captureScreenshot',
      params: { format: 'png' },
    });
    // readonly 调用桥会回传 CDP 结果：{ data: <png base64> }
    const data = (out.result as { data?: unknown } | null | undefined)?.data;
    if (typeof data !== 'string' || data.length === 0) {
      return this.failed(
        'screenshot',
        '面板模式：截图失败：desktop 未返回图像数据（不回退到无头浏览器）',
      );
    }
    const nameNote = action.name ? `（${action.name}）` : '';
    // round17：证据落盘（同一条 evidence 链）——失败不阻断动作结果（evidenceUrl 留空交底）
    let evidenceUrl: string | undefined;
    try {
      const saved = await this.localBrowserEngine?.saveEvidencePngBase64({
        label: `panel-screenshot-${action.name ?? 'shot'}`,
        base64: data,
        sessionKey: out.binding.sessionId ?? undefined,
      });
      evidenceUrl = saved?.url;
    } catch (error) {
      this.logger.warn(
        `面板截图证据落盘失败（动作结果不受影响）：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return {
      index: 0,
      action: 'screenshot',
      ok: true,
      screenshotBase64: data,
      evidenceUrl,
      url: out.binding.url ?? undefined,
      panelWebContentsId: out.binding.webContentsId,
      panelSessionId: out.binding.sessionId,
      message:
        `面板截图成功${nameNote}（PNG base64 ${data.length} 字符，` +
        `webContents=${out.binding.webContentsId}${evidenceUrl ? '' : '，证据未落盘'}）`,
    };
  }

  /**
   * 面板点击：一次批准 = 一次逻辑点击。
   *
   *  - carried + approved → 落库审批态 → 执行时**重新解析坐标**（审批是语义级：
   *    selector+目标文本；页面可能已变化，坐标取最新防点偏）→ mousePressed（带单）
   *    → mouseReleased（配对通道放行，同单不同卡）。
   *  - carried + rejected → 终态收口，不执行。
   *  - 无单 → **先只读解析坐标**：元素不存在就不签单，用户不看到一张注定废掉的
   *    死卡片 → 签语义级确认单（summary 带 selector+目标文本，不带坐标）。
   */
  private async clickViaPanel(
    action: Extract<AiBrowserAction, { action: 'click' }>,
    actor: PanelBridgeActor,
    sessionId?: string,
    lockedActionId?: string,
    /** 触达审计：动作归属线索（签单落库 confirmationJson.leadId，线索详情反查） */
    leadId?: string | null,
  ): Promise<AgentBrowserExecuteResult> {
    const carried =
      lockedActionId ?? (action as { actionId?: string }).actionId;
    if (carried) {
      const state = await this.panelBridge!.actionState(actor, carried);
      if (state.state === 'approved') {
        await this.markApprovalSafe('approved', carried);
        // 审批后执行时重新解析坐标（防页面滚动/元素移动后点偏）
        const probe = await this.probeSelector(actor, action.selector);
        if (!probe.found || probe.x === undefined || probe.y === undefined) {
          return this.failed(
            'click',
            `面板模式：确认单 ${carried} 已批准，但执行时目标已不可见` +
              `（selector "${action.selector}" 解析不到可见元素），未执行——请重发该动作重新确认`,
            carried,
          );
        }
        const pressParams = {
          type: 'mousePressed' as const,
          x: probe.x,
          y: probe.y,
          button: 'left' as const,
          clickCount: 1,
        };
        const releaseParams = {
          type: 'mouseReleased' as const,
          x: probe.x,
          y: probe.y,
          button: 'left' as const,
          clickCount: 1,
        };
        await this.panelBridge!.execute(actor, {
          method: 'Input.dispatchMouseEvent',
          params: pressParams,
          actionId: carried,
        });
        // mouseReleased 不带审批（单已被 pressed 消耗），走 broker 配对通道
        await this.panelBridge!.execute(actor, {
          method: 'Input.dispatchMouseEvent',
          params: releaseParams,
          actionId: carried,
        });
        return {
          index: 0,
          action: 'click',
          ok: true,
          panelWebContentsId: null,
          confirmationId: carried,
          message:
            `面板点击已执行（selector "${action.selector}"${probe.text ? `，目标"${probe.text}"` : ''}，` +
            `坐标 ${probe.x},${probe.y}，确认单 ${carried}）`,
        };
      }
      if (state.state === 'rejected') {
        await this.markApprovalSafe('rejected', carried);
        return this.failed(
          'click',
          `面板模式：该点击已被用户在面板中拒绝（确认单 ${carried}），未执行`,
          carried,
        );
      }
      return this.failed(
        'click',
        `面板模式：点击需用户在桌面端批准（确认单 ${carried} 当前状态 ${state.state}）`,
        carried,
      );
    }
    // 无单：先只读解析坐标——元素不存在就不签单（用户不看到死卡片）
    const probe = await this.probeSelector(actor, action.selector);
    if (!probe.found) {
      return this.failed(
        'click',
        `面板模式：页面上找不到可见元素（selector "${action.selector}"），未签确认单、未执行`,
      );
    }
    const ticket = await this.panelBridge!.requestAction(actor, {
      method: 'Input.dispatchMouseEvent',
      summary: {
        label: '点击',
        selector: action.selector,
        targetText: probe.text ?? null,
      },
      sessionId: sessionId ?? null,
      leadId: leadId ?? null,
    });
    if (ticket.autoApproved) {
      // TraeWork 控制权模型：系统控制（默认）下这张单已在桌面侧经 owner 通道
      // 自动批准——直接走带票执行分支，用户没点「接管」就不该看到"待批准"回执。
      return this.clickViaPanel(
        action,
        actor,
        sessionId,
        ticket.actionId,
        leadId,
      );
    }
    return this.failed(
      'click',
      `需用户确认后执行（面板点击确认单 ${ticket.actionId}，目标"${probe.text ?? action.selector}"，请在右侧浏览器面板批准后携带该 id 重试）`,
      ticket.actionId,
    );
  }

  /**
   * 面板输入（type）：一次批准 = 一次逻辑输入。
   *
   * 语义对齐 `panelMethodForAction('type') = 'Input.insertText'`（loop 闸门按
   *这个 method 比对确认单指纹），但确认单覆盖两步 CDP：
   *  1. 聚焦 mousePressed（dispatchMouseEvent）——消耗 insertText 型确认单
   *     （broker _consumeApproval 的 method 组匹配放行）；
   *  2. Input.insertText——走 broker 配对通道放行（一次性，免坐标）。
   *
   * ⚠️ 语义（2026-09-04 round17 起替换式）：聚焦后先清空输入框
   *   （Runtime.evaluate + execCommand selectAll/delete，免单通道但隶属
   *   确认单语义），再 Input.insertText——对齐引擎模式 Playwright fill()
   *   的"清空后设值"，消除追加式语义漂移。
   */
  private async typeViaPanel(
    action: Extract<AiBrowserAction, { action: 'type' }>,
    actor: PanelBridgeActor,
    sessionId?: string,
    lockedActionId?: string,
    /** 触达审计：动作归属线索（签单落库 confirmationJson.leadId，线索详情反查） */
    leadId?: string | null,
  ): Promise<AgentBrowserExecuteResult> {
    const carried =
      lockedActionId ?? (action as { actionId?: string }).actionId;
    if (carried) {
      const state = await this.panelBridge!.actionState(actor, carried);
      if (state.state === 'approved') {
        await this.markApprovalSafe('approved', carried);
        // 批准后执行时重新解析聚焦坐标（防页面滚动/元素移动后聚焦错位）
        const probe = await this.probeSelector(actor, action.selector);
        if (!probe.found || probe.x === undefined || probe.y === undefined) {
          return this.failed(
            'type',
            `面板模式：确认单 ${carried} 已批准，但执行时目标已不可见` +
              `（selector "${action.selector}" 解析不到可见元素），未执行——请重发该动作重新确认`,
            carried,
          );
        }
        // 第一步：聚焦（消耗确认单）
        await this.panelBridge!.execute(actor, {
          method: 'Input.dispatchMouseEvent',
          params: {
            type: 'mousePressed',
            x: probe.x,
            y: probe.y,
            button: 'left',
            clickCount: 1,
          },
          actionId: carried,
        });
        // 第 1.5 步（2026-09-04 round17，对齐文档 fill_form 替换式语义）：
        //   清空输入框——旧实现是追加式（insertText 不清空），与引擎模式
        //   Playwright fill()（清空后设值）语义漂移。聚焦后 execCommand
        //   selectAll+delete 拟真清空（触发 input/onChange 事件链）；仅对
        //   输入类元素生效，非输入元素跳过（保持原行为）。
        //   交底：Runtime.evaluate 走免单 readonly 通道，但此调用逻辑上
        //   隶属于已批准的 type 确认单语义（清空是"输入"的一部分）。
        await this.panelBridge!.execute(actor, {
          method: 'Runtime.evaluate',
          params: {
            expression:
              "(() => { const el = document.activeElement; if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA' && !el.isContentEditable)) return false; el.focus(); document.execCommand('selectAll', false, null); document.execCommand('delete', false, null); return true; })()",
            returnByValue: true,
          },
        });
        // 第二步：插入文本（配对通道，不再签单）
        await this.panelBridge!.execute(actor, {
          method: 'Input.insertText',
          params: { text: action.text },
          actionId: carried,
        });
        return {
          index: 0,
          action: 'type',
          ok: true,
          panelWebContentsId: null,
          confirmationId: carried,
          message:
            `面板输入已执行（selector "${action.selector}"，` +
            `${action.text.length} 字符，确认单 ${carried}）`,
        };
      }
      if (state.state === 'rejected') {
        await this.markApprovalSafe('rejected', carried);
        return this.failed(
          'type',
          `面板模式：该输入已被用户在面板中拒绝（确认单 ${carried}），未执行`,
          carried,
        );
      }
      return this.failed(
        'type',
        `面板模式：输入需用户在桌面端批准（确认单 ${carried} 当前状态 ${state.state}）`,
        carried,
      );
    }
    // 无单：先只读解析坐标——元素不存在就不签单（用户不看到死卡片）
    const probe = await this.probeSelector(actor, action.selector);
    if (!probe.found) {
      return this.failed(
        'type',
        `面板模式：页面上找不到可见元素（selector "${action.selector}"），未签确认单、未执行`,
      );
    }
    // 摘要里给文本预览（截断）：用户批准时需要知道要输入什么；
    // 面板是本机 UI，展示给用户本人看，不属于凭据外泄面。
    const textPreview =
      action.text.length > 40
        ? `${action.text.slice(0, 40)}…（共 ${action.text.length} 字符）`
        : action.text;
    const ticket = await this.panelBridge!.requestAction(actor, {
      method: 'Input.insertText',
      summary: {
        label: '输入文本',
        selector: action.selector,
        text: textPreview,
      },
      sessionId: sessionId ?? null,
      leadId: leadId ?? null,
    });
    if (ticket.autoApproved) {
      // TraeWork 控制权模型：系统控制（默认）下这张单已在桌面侧经 owner 通道
      // 自动批准——直接走带票执行分支，用户没点「接管」就不该看到"待批准"回执。
      return this.typeViaPanel(
        action,
        actor,
        sessionId,
        ticket.actionId,
        leadId,
      );
    }
    return this.failed(
      'type',
      `需用户确认后执行（面板输入确认单 ${ticket.actionId}，目标"${probe.text ?? action.selector}"，请在右侧浏览器面板批准后携带该 id 重试）`,
      ticket.actionId,
    );
  }

  /**
   * 面板按键（press_key）：一次批准 = 一次逻辑按键。
   *
   * 语义对齐 `panelMethodForAction('press_key') = 'Input.dispatchKeyEvent'`
   * （loop 闸门按这个 method 比对确认单指纹），确认单覆盖两步 CDP：
   *  1. keyDown——消耗 dispatchKeyEvent 型确认单（method 严格相等）；
   *  2. keyUp——走 broker 配对通道放行（一次性、同面板、键位一致、10s 内）。
   *
   * press_key 无 selector，无单时不探测直接签语义级单（label + key）。
   *
   * ⚠️ 语义差异交底：CDP dispatchKeyEvent 需要显式 text 才会触发文本插入——
   * 可打印单字符补 text（对齐 Playwright keyboard.press 的拟真语义）；
   * 组合键/功能键只派发 keydown/keyup 事件链。windowsVirtualKeyCode 未合成
   * （个别依赖 keyCode 的页面逻辑可能收不到，后续轮次按需补 keymap）。
   */
  private async pressKeyViaPanel(
    action: Extract<AiBrowserAction, { action: 'press_key' }>,
    actor: PanelBridgeActor,
    sessionId?: string,
    lockedActionId?: string,
    /** 触达审计：动作归属线索（签单落库 confirmationJson.leadId，线索详情反查） */
    leadId?: string | null,
  ): Promise<AgentBrowserExecuteResult> {
    const carried =
      lockedActionId ?? (action as { actionId?: string }).actionId;
    const keyParams = (type: 'keyDown' | 'keyUp'): Record<string, unknown> => {
      const params: Record<string, unknown> = { type, key: action.key };
      if (type === 'keyDown' && action.key.length === 1) {
        params.text = action.key; // 可打印单字符：补 text 才有真实文本插入
      }
      return params;
    };
    if (carried) {
      const state = await this.panelBridge!.actionState(actor, carried);
      if (state.state === 'approved') {
        await this.markApprovalSafe('approved', carried);
        // 第一步：keyDown（消耗确认单）
        await this.panelBridge!.execute(actor, {
          method: 'Input.dispatchKeyEvent',
          params: keyParams('keyDown'),
          actionId: carried,
        });
        // 第二步：keyUp（配对通道，不再签单）
        await this.panelBridge!.execute(actor, {
          method: 'Input.dispatchKeyEvent',
          params: keyParams('keyUp'),
          actionId: carried,
        });
        return {
          index: 0,
          action: 'press_key',
          ok: true,
          panelWebContentsId: null,
          confirmationId: carried,
          message: `面板按键已执行（key "${action.key}"，确认单 ${carried}）`,
        };
      }
      if (state.state === 'rejected') {
        await this.markApprovalSafe('rejected', carried);
        return this.failed(
          'press_key',
          `面板模式：该按键已被用户在面板中拒绝（确认单 ${carried}），未执行`,
          carried,
        );
      }
      return this.failed(
        'press_key',
        `面板模式：按键需用户在桌面端批准（确认单 ${carried} 当前状态 ${state.state}）`,
        carried,
      );
    }
    // 没有确认单 → 先签一张语义级单（无 selector，无需探测）
    const ticket = await this.panelBridge!.requestAction(actor, {
      method: 'Input.dispatchKeyEvent',
      summary: { label: '按下按键', key: action.key },
      sessionId: sessionId ?? null,
      leadId: leadId ?? null,
    });
    if (ticket.autoApproved) {
      // TraeWork 控制权模型：系统控制（默认）下这张单已在桌面侧经 owner 通道
      // 自动批准——直接走带票执行分支，用户没点「接管」就不该看到"待批准"回执。
      return this.pressKeyViaPanel(
        action,
        actor,
        sessionId,
        ticket.actionId,
        leadId,
      );
    }
    return this.failed(
      'press_key',
      `需用户确认后执行（面板按键确认单 ${ticket.actionId}，key "${action.key}"，请在右侧浏览器面板批准后携带该 id 重试）`,
      ticket.actionId,
    );
  }

  /**
   * 面板标签页（tabs）：一次批准 = 一次标签页操作。
   *
   * 语义对齐 `panelMethodForAction('tabs') = 'Panel.tabs'`（loop 闸门按这个
   * method 比对确认单指纹）。Panel.tabs 是**主进程伪 method**——desktop 侧
   * broker 的 CDP 通道是 webContents.debugger（target 级 session），
   * Target.createTarget/closeTarget 等 browser 级命令发不出去，因此 tabs 走
   * broker 的 tabsHandler 回调 manager 原生 tab 台账（new/switch/close），
   * 审批闸门/事件流与 CDP 写动作完全同构。
   *
   * new/switch/close 三种都签单：switch 也改变用户所见的页面（页面突然切走
   * 该让用户知情），不算 wait 那类骚扰卡。
   *
   * ⚠️ 语义差异交底：switch 越界显式失败（旧无头 fallback pages[0] 是静默
   * 降级）；close 缺省关当前 active、最后一个 tab 不可关（多 tab 时允许关
   * 最早开的 tab[0]，旧无头 pages[0] 永不可关——保护动机相同、语义更一致）。
   */
  private async tabsViaPanel(
    action: Extract<AiBrowserAction, { action: 'tabs' }>,
    actor: PanelBridgeActor,
    sessionId?: string,
    lockedActionId?: string,
    /** 触达审计：动作归属线索（签单落库 confirmationJson.leadId，线索详情反查） */
    leadId?: string | null,
  ): Promise<AgentBrowserExecuteResult> {
    const carried =
      lockedActionId ?? (action as { actionId?: string }).actionId;
    const summary: Record<string, unknown> = {
      label: '标签页操作',
      operation: action.operation,
    };
    if (action.index != null) summary.index = action.index;
    if (carried) {
      const state = await this.panelBridge!.actionState(actor, carried);
      if (state.state === 'approved') {
        await this.markApprovalSafe('approved', carried);
        const out = await this.panelBridge!.execute(actor, {
          method: 'Panel.tabs',
          params: { operation: action.operation, index: action.index },
          actionId: carried,
        });
        // desktop 侧回传 tab 台账快照 {tabs, activeIndex, url}（Panel.tabs 是
        // server result 过滤的放行特例）；取不到时退化为不含台账数的 message
        const snap = out.result ?? null;
        const snapObj =
          snap && typeof snap === 'object'
            ? (snap as {
                tabs?: unknown;
                activeIndex?: unknown;
                url?: unknown;
              })
            : null;
        const s = (v: unknown) =>
          typeof v === 'string' || typeof v === 'number' ? String(v) : '';
        const snapNote = snapObj
          ? `（共 ${s(snapObj.tabs) || '?'} 个，active=${s(snapObj.activeIndex) || '?'}${snapObj.url ? `，${s(snapObj.url)}` : ''}）`
          : '';
        return {
          index: 0,
          action: 'tabs',
          ok: true,
          url: out.binding.url ?? undefined,
          panelWebContentsId: out.binding.webContentsId,
          panelSessionId: out.binding.sessionId,
          confirmationId: carried,
          message: `面板标签页操作已执行（${action.operation}${snapNote}，确认单 ${carried}）`,
        };
      }
      if (state.state === 'rejected') {
        await this.markApprovalSafe('rejected', carried);
        return this.failed(
          'tabs',
          `面板模式：该标签页操作已被用户在面板中拒绝（确认单 ${carried}），未执行`,
          carried,
        );
      }
      return this.failed(
        'tabs',
        `面板模式：标签页操作需用户在桌面端批准（确认单 ${carried} 当前状态 ${state.state}）`,
        carried,
      );
    }
    // 没有确认单 → 先签一张语义级单（无 selector，无需探测）
    const ticket = await this.panelBridge!.requestAction(actor, {
      method: 'Panel.tabs',
      summary,
      sessionId: sessionId ?? null,
      leadId: leadId ?? null,
    });
    if (ticket.autoApproved) {
      // TraeWork 控制权模型：系统控制（默认）下这张单已在桌面侧经 owner 通道
      // 自动批准——直接走带票执行分支，用户没点「接管」就不该看到"待批准"回执。
      return this.tabsViaPanel(
        action,
        actor,
        sessionId,
        ticket.actionId,
        leadId,
      );
    }
    return this.failed(
      'tabs',
      `需用户确认后执行（面板标签页确认单 ${ticket.actionId}，operation "${action.operation}"，请在右侧浏览器面板批准后携带该 id 重试）`,
      ticket.actionId,
    );
  }

  /**
   * 把"用户在桌面点了批准/拒绝"落到确认单行里——**审计旁路**。
   *
   * 为什么不能让它阻断执行：这是留痕动作，不是闸门。用户已经点了批准，
   * 桥也认了（state===approved），此时因为落库失败就拒绝执行 = 拿审计需求
   * 卡住正常业务，是本末倒置。失败只告警，动作照常执行/照常拒绝。
   */
  private async markApprovalSafe(
    decision: 'approved' | 'rejected',
    actionId: string,
  ): Promise<void> {
    try {
      if (decision === 'approved') {
        await this.panelBridge!.markApproved?.(actionId);
      } else {
        await this.panelBridge!.markRejected?.(actionId);
      }
    } catch (error) {
      this.logger.warn(
        `确认单 ${actionId} 审批态（${decision}）落库失败，动作不因此阻断：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * 桥上确认单审批态查询 + 审计落库（2026-09-04 修「批准后死锁」）。
   *
   * 背景（真机实证）：loop.resolveConfirmation 的面板单分支此前只认
   * confirmationJson.status === 'approved'，而这个标记只有 executor 带票执行
   * 成功后才会写（markApprovalSafe）——但带票又以锁单成功为前提，锁单又要求
   * 标记已写入 → 鸡生蛋死锁：用户在面板点了「批准」，重试依然放不了行。
   *
   * 修法（对齐 loop 注释里"批准态在桌面面板上，要问桥"的既定设计）：
   * 桥是批准的**源头**，本方法直接问桥；approved/rejected 时顺手写审计镜像。
   * pending / none / 桥不可用一律 fail-closed 返回，不放行。
   * 安全不变量不变：actor 断言、webContents 绑定、换页作废全在桥侧把守。
   */
  async resolvePanelApproval(
    actor: PanelBridgeActor | undefined,
    actionId: string,
  ): Promise<PanelActionState> {
    if (!actor || !this.panelBridge) return 'none';
    try {
      const state = await this.panelBridge.actionState(actor, actionId);
      if (state.state === 'approved') {
        await this.markApprovalSafe('approved', actionId);
      } else if (state.state === 'rejected') {
        await this.markApprovalSafe('rejected', actionId);
      }
      return state.state;
    } catch (error) {
      this.logger.warn(
        `确认单 ${actionId} 桥上审批态查询失败（fail-closed）：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return 'none';
    }
  }

  private failed(
    kind: string,
    message: string,
    confirmationId?: string,
  ): AgentBrowserExecuteResult {
    return {
      index: 0,
      action: kind,
      ok: false,
      message,
      ...(confirmationId ? { confirmationId } : {}),
    };
  }
}
