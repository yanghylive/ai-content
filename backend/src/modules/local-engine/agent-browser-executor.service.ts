import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  AiBrowserActionService,
  AiBrowserAction,
} from './ai-browser-action.service';
import {
  AgentPanelBridgeService,
  PanelBridgeActor,
  PanelBridgeError,
} from './agent-panel-bridge.service';

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
};

export type AgentBrowserExecuteResult = {
  index: number;
  action: string;
  ok: boolean;
  message?: string;
  evidenceUrl?: string;
  extractText?: string;
  /** P1（复查 2026-08-22）：动作执行后的真实页面 URL（导航回写用） */
  url?: string;
  /** 面板模式：待用户批准的面板确认单 id（与 AgentConfirmation 是两套，见交底） */
  confirmationId?: string;
  /** 面板模式：动作落在哪个 webContents 上（同页证据，钉进步骤事件） */
  panelWebContentsId?: number | null;
  panelSessionId?: string | null;
};

const PANEL_MODE_ENV = 'KAYPAL_AGENT_PANEL_MODE';

/** 读面板模式开关；非法值返回 'invalid'（调用方显式报错，不猜配置） */
export function readAgentPanelMode(
  env: NodeJS.ProcessEnv = process.env,
): AgentPanelMode | 'invalid' {
  const raw = (env[PANEL_MODE_ENV] ?? 'off').trim().toLowerCase();
  if (raw === '' || raw === 'off') return 'off';
  if (raw === 'on') return 'on';
  return 'invalid';
}

@Injectable()
export class AgentBrowserExecutor {
  private readonly logger = new Logger(AgentBrowserExecutor.name);

  constructor(
    private readonly actions: AiBrowserActionService,
    /** 可选注入：未注册面板桥时（老测试/未开启面板模式）保持纯透传语义 */
    @Optional() private readonly panelBridge?: AgentPanelBridgeService,
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
      // 3) 只读观察：extract → 面板 observe（文本快照，带 webContentsId 证据）
      if (kind === 'extract') {
        const obs = await this.panelBridge!.observe(actor);
        return {
          index: 0,
          action: kind,
          ok: true,
          extractText: obs.textSample ?? undefined,
          url: obs.binding.url ?? undefined,
          panelWebContentsId: obs.binding.webContentsId,
          panelSessionId: obs.binding.sessionId,
          message:
            `面板观察成功（webContents=${obs.binding.webContentsId}，` +
            `session=${obs.binding.sessionId}）`,
        };
      }
      // 4) 导航：写动作——签单 → 等桌面端用户批准 → 带单执行
      if (kind === 'goto') {
        return this.gotoViaPanel(action, actor);
      }
      // 5) 其余动作：面板桥还没开通，明确不支持（不许假装成功，也不许偷偷走老路径）
      return this.failed(
        kind,
        `面板模式暂不支持动作 ${kind}（当前仅支持 extract / goto）；` +
          `未执行、未回退（阶段 5 按 navigate→click→fill_form→press_key/wait_for/tabs 顺序开通）`,
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

  /** 面板导航：批准权在用户手上，后端只认 approved 的确认单 */
  private async gotoViaPanel(
    action: Extract<AiBrowserAction, { action: 'goto' }>,
    actor: PanelBridgeActor,
  ): Promise<AgentBrowserExecuteResult> {
    const carried = (action as { actionId?: string }).actionId;
    if (carried) {
      const state = await this.panelBridge!.actionState(actor, carried);
      if (state.state === 'approved') {
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
    });
    return this.failed(
      'goto',
      `需用户确认后执行（面板导航确认单 ${ticket.actionId}，请在右侧浏览器面板批准后携带该 id 重试）`,
      ticket.actionId,
    );
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
