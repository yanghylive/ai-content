import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  AiBrowserActionService,
  AiBrowserAction,
} from './ai-browser-action.service';
import type { AgentBrowserSession } from './agent-browser.types';
import { AgentBrowserSessionService } from './agent-browser-session.service';
import { AgentBrowserPolicyService } from './agent-browser-policy.service';
import { PlaywrightMcpService } from './playwright-mcp.service';
import { AgentBrowserExecutor } from './agent-browser-executor.service';
import {
  isPanelConfirmation,
  panelMethodForAction,
  PanelBridgeActor,
} from './agent-panel-bridge.service';
import { PrismaService } from '../../prisma/prisma.service';
import { detectPromptInjection } from '../ai-gateway/ai-gateway.service';

/** P4-1：按动作类型判断写操作（allowWrite 门禁用，不依赖自然语言） */
function isWriteAction(action: AiBrowserAction): boolean {
  switch (action.action) {
    case 'type':
    case 'click':
      return true;
    case 'press_key':
      return action.key === 'Enter' || action.key === 'Tab';
    case 'tabs':
      return action.operation === 'new' || action.operation === 'close';
    default:
      return false;
  }
}

export interface AgentBrowserStepEvent {
  type: 'step' | 'snapshot' | 'done' | 'error' | 'needs-human';
  stepIndex?: number;
  action?: string;
  ok?: boolean;
  message?: string;
  url?: string;
  extractText?: string;
  error?: string;
  // P4-3（审计 2026-08-22）：三态结果（success/partial_success/failed）
  status?: 'success' | 'partial_success' | 'failed' | 'needs-human';
  reasonCode?: string;
  // P0-2（审计 2026-08-22）：确认单 id + 真实 selector，供前端精确批准
  confirmationId?: string;
  selector?: string;
  // 阶段 6 决策 ②：本步的批准权已交给**桌面浏览器面板审批 UI**（不是后端待批列表）。
  // 证据链要能回答"这一步是谁批的、在哪批的"，所以钉进事件里。
  panelApproval?: boolean;
}

/**
 * P4 AgentBrowserLoopService（文档 §7.4）：
 * Observe-Act-Verify 循环。
 * - Observe：snapshot 当前页（提取可交互文本 + 当前 URL）
 * - Act：NL 指令 → AiBrowserActionService（AI 解析动作序列 → 执行，含证据截图）
 * - Verify：每步结果 + 最终状态校验
 * 每步动作前过 PolicyService 审计（域名/工具白名单/风险确认）。
 * 对齐 MAI-UI 动作模型：动作 schema 与通用 GUI agent 一致（navigate/click/fill 等）。
 */
@Injectable()
export class AgentBrowserLoopService {
  private readonly logger = new Logger(AgentBrowserLoopService.name);
  // P4（审计 2026-08-22）：Playwright MCP sidecar 是单例（一个 child/profile）。
  // 并发会话同时 ensureProfile 会互相切换 profile 导致串读——用全局互斥锁
  // 串行化 MCP 观察（观察串行，隔离正确）。真实执行路径（executeSingle 走
  // LocalBrowserEngine 的 platform-accountId 独立会话）不受影响。
  private static mcpLock: Promise<void> = Promise.resolve();

  constructor(
    private readonly sessions: AgentBrowserSessionService,
    private readonly actions: AiBrowserActionService,
    private readonly policy: AgentBrowserPolicyService,
    private readonly playwrightMcp?: PlaywrightMcpService,
    private readonly prisma?: PrismaService,
    /** §7.4 统一执行器路由（可选；注入时经 AgentBrowserExecutor 执行） */
    private readonly executor?: AgentBrowserExecutor,
  ) {}

  /**
   * 运行一轮 Observe-Act-Verify。
   * sessionId 必须已 acquireEngineSession（状态 running）。
   * instruction: 自然语言任务（如"搜索装修公司并截图"）。
   */
  async run(
    sessionId: string,
    instruction: string,
    options: {
      onStep?: (event: AgentBrowserStepEvent) => void;
      confirmedTools?: Array<{ action: string; target?: string; url?: string }>;
      confirmationIds?: string[];
      /** 触达审计：获客跟进执行时传入——本会话签的面板确认单都挂到这条线索 */
      leadId?: string | null;
      /** P1（复查 2026-08-22）：resume 续跑——从断点动作序列继续，不再从头解析 */
      resumeFrom?: {
        stepIndex: number;
        actions: AiBrowserAction[];
        /** P1（复查第三轮）：已成功动作索引——重试跳过（幂等，不重放副作用） */
        completedIndices?: number[];
        /** P1（复查第三轮）：每个动作生成时的页面来源 URL（§6.3 门禁依据） */
        actionOriginUrls?: string[];
      };
    } = {},
  ): Promise<{ ok: boolean; steps: AgentBrowserStepEvent[] }> {
    const { onStep, confirmationIds, resumeFrom } = options;
    const session = this.sessions.get(sessionId);
    if (session.status !== 'running') {
      throw new BadRequestException(
        `会话状态 ${session.status}，需先 run 进入运行态`,
      );
    }
    if (!session.engineKey) {
      throw new BadRequestException('会话引擎未就绪，请先 run');
    }
    if (!instruction?.trim()) {
      throw new BadRequestException('缺少任务指令（instruction）');
    }
    // P1（复查 2026-08-22）：持久化任务上下文——pause/resume 后从断点续跑
    // （resume 端点读取 pendingInstruction/pendingActions 继续，不再丢失任务）
    session.pendingInstruction = instruction;
    if (options.leadId) session.leadId = options.leadId;

    // §14.2 feature flag：mode 门禁（legacy=继续现有执行器；dom-agent=本循环灰度）
    const cfg = this.readAgentBrowserConfig();
    if (cfg.mode === 'legacy') {
      throw new BadRequestException(
        'AGENT_BROWSER_MODE=legacy：Agent Browser 循环未开启（灰度开关关闭），请使用现有动作执行',
      );
    }
    // §14.2 allowWrite 门禁（P4-1 审计 2026-08-22）：不再按自然语言中文关键词判断
    // （英文指令可绕过），改为循环内按解析后动作类型判断（isWriteAction）。

    // 阶段 6 决策 ②：面板模式——高风险动作的批准权归**桌面浏览器面板审批 UI**，
    // 后端不再为同一个动作建第二张 AgentConfirmation（否则两个审批入口 = 没合并）。
    // 每轮循环开始时读一次（开关是 env 驱动，运行期改了下一轮生效）。
    const panelMode = this.executor ? this.executor.panelMode() : 'off';

    const steps: AgentBrowserStepEvent[] = [];

    // §9.2 引擎探活：浏览器/sidecar 已退出 → 释放任务进入 needs-human（不伪造执行）
    // 执行器未提供探活（测试/mock）时默认存活
    if (session.engineKey) {
      const exec = this.executor ?? {
        execute: (
          input: Parameters<AiBrowserActionService['executeSingle']>[0],
        ) => this.actions.executeSingle(input),
        isAlive: async (accountId: string) =>
          typeof this.actions.isEngineAlive === 'function'
            ? this.actions.isEngineAlive(accountId).catch(() => false)
            : true,
      };
      const alive = await exec.isAlive(session.accountId);
      if (!alive) {
        this.sessions.updateStatus(sessionId, 'needs-human');
        const eh: AgentBrowserStepEvent = {
          type: 'needs-human',
          ok: false,
          status: 'needs-human',
          reasonCode: 'engine_unavailable',
          message: '浏览器引擎已断开，任务已暂停，等待人工接管后恢复',
          url: session.url,
        };
        steps.push(eh);
        onStep?.(eh);
        this.sessions.appendEvent(sessionId, eh);
        return { ok: false, steps };
      }
    }

    // 1. Observe：快照当前页
    const snapshot = await this.observe(sessionId);
    steps.push(snapshot);
    onStep?.(snapshot);
    this.sessions.appendEvent(sessionId, snapshot);

    // 2. Act：解析指令为动作序列（供逐步 re-observe 循环）
    // P1（复查 2026-08-22）：resume 续跑直接用保存的动作序列（不重新解析——
    // 恢复的指令与断点一致，避免 AI 解析漂移），仅首次 run 才走 parseActions
    let actions: AiBrowserAction[] = [];
    let startIndex = 0;
    // P1（复查第三轮）：已成功动作索引集合——重试/恢复时跳过（幂等重试，
    // 不重放已成功动作的外部副作用）
    const completedIndices = new Set<number>();
    if (resumeFrom?.actions?.length) {
      actions = resumeFrom.actions;
      startIndex = Math.max(0, resumeFrom.stepIndex ?? 0);
      resumeFrom.completedIndices?.forEach((i) => completedIndices.add(i));
      this.logger.log(
        `AgentBrowser ${sessionId} resume：从动作 ${startIndex}/${actions.length} 续跑（已成功 ${completedIndices.size} 个，跳过不重放）`,
      );
    } else {
      try {
        actions = await this.actions.parseActions(instruction);
      } catch (error) {
        // 解析失败直接抛（指令无法拆解为动作，阻断执行）
        throw new BadRequestException(
          `无法解析指令步骤：${error instanceof Error ? error.message : String(error)}`,
        );
      }
      // §14.2 maxSteps 截断
      actions = actions.slice(0, cfg.maxSteps);
    }
    // P1：记录当前动作序列到会话（resume 从断点续跑的凭据）
    session.pendingActions = actions;
    session.pendingStepIndex = startIndex;
    session.pendingCompletedIndices = [...completedIndices];
    // §6.3 元素引用只在当前快照版本内有效：记录每个动作生成时的页面 URL，
    // 导航后旧快照的 selector 引用拒绝执行（等待重新决策）
    // P1（复查第三轮）：恢复时沿用保存的来源——不重置为当前 URL，
    // 否则旧页面 selector 会在新页面通过门禁被错误执行
    let actionOriginUrls: string[] = resumeFrom?.actionOriginUrls?.length
      ? [...resumeFrom.actionOriginUrls].slice(0, actions.length)
      : actions.map(() => session.url ?? '');
    while (actionOriginUrls.length < actions.length) {
      actionOriginUrls.push(session.url ?? '');
    }
    session.pendingActionOriginUrls = actionOriginUrls;

    // 3. 逐步 Observe→策略→单动作执行→验证（§7.4 DOM Agent 循环）
    for (let i = startIndex; i < actions.length; i++) {
      const action = actions[i];
      // P2（复查 2026-08-22）：确认单信息每步独立——定义在循环内，
      // 防止上一动作的 confirmationId 串到后续非确认阻断动作（前端显示错配）
      let blockedConfirmation: { id?: string; selector?: string } | undefined;
      // P2（复查 2026-08-22）：本步锁定成功的确认单 id（动作成功→consumed；失败→释放回 pending）
      let lockedConfirmationId: string | undefined;
      // 阶段 6 决策 ②：面板模式下"本步的批准权已交给桌面审批 UI"（用于事件文案留痕，
      // 同时让读代码的人一眼看出这里**故意**没有建后端确认单，不是漏了）
      let panelApprovalDeferred = false;
      // P1（复查 2026-08-22）：每步执行前检查会话状态——paused/stopped/
      // needs-human 时立即中断循环（否则 pause/stop 只改状态不中断执行）
      const stepStatus = this.sessions.get(sessionId).status;
      if (stepStatus !== 'running') {
        // P1：记录断点（当前未执行的 stepIndex + 动作序列），resume 从此续跑
        session.pendingStepIndex = i;
        session.pendingActions = actions;
        session.pendingCompletedIndices = [...completedIndices];
        session.pendingActionOriginUrls = actionOriginUrls;
        const interrupt: AgentBrowserStepEvent = {
          type: 'error',
          ok: false,
          message: `执行已中断（会话状态 ${stepStatus}）`,
        };
        steps.push(interrupt);
        onStep?.(interrupt);
        this.sessions.appendEvent(sessionId, interrupt);
        return { ok: false, steps };
      }

      // P1（复查第三轮）：幂等重试——已完成动作直接跳过（不重放外部副作用）。
      // 例如 成功A/失败B/成功C 的 partial 重试：A、C 跳过，只补执行 B。
      if (completedIndices.has(i)) {
        const skipped: AgentBrowserStepEvent = {
          type: 'step',
          stepIndex: i,
          action: action.action,
          ok: true,
          message: '已成功动作（幂等重试跳过，不重放）',
        };
        steps.push(skipped);
        onStep?.(skipped);
        this.sessions.appendEvent(sessionId, skipped);
        continue;
      }

      // 3.1 每步 re-observe（页面可能已因上一步导航改变）
      const stepPrevUrl = session.url; // 记录执行前 URL（判断是否发生导航）
      const stepSnapshot = await this.observe(sessionId);
      steps.push(stepSnapshot);
      onStep?.(stepSnapshot);
      this.sessions.appendEvent(sessionId, stepSnapshot);
      // P4-3：检测到提示注入 → 暂停进入人工确认（不再继续循环）
      if (stepSnapshot.injected) {
        this.sessions.updateStatus(sessionId, 'needs-human');
        const nh: AgentBrowserStepEvent = {
          type: 'needs-human',
          ok: false,
          status: 'needs-human',
          reasonCode: 'prompt_injection',
          message: '页面内容疑似提示注入，已暂停循环，等待人工接管确认后恢复',
          url: stepSnapshot.url,
        };
        steps.push(nh);
        onStep?.(nh);
        this.sessions.appendEvent(sessionId, nh);
        return { ok: false, steps };
      }
      // 更新会话 url（导航后不再用旧 url）
      if (stepSnapshot.url && stepSnapshot.url !== session.url) {
        session.url = stepSnapshot.url;
      }

      // 3.2 执行前策略审计（工具映射 + allowWrite + 高风险确认闸门）
      const tool = this.mapTool(action.action);
      // 阶段 5：面板模式需要调用方身份做 actor 断言（会话租约里就有，
      // 拿不到就传空——面板模式会据此 fail-closed，不静默改走无头浏览器）
      const actor = session.lease?.ownerId
        ? { ownerId: session.lease.ownerId, tenantId: session.lease.tenantId ?? '' }
        : undefined;
      let allowed = true;
      let gateMessage: string | undefined;
      // P4-1：allowWrite=false 时写动作按类型阻断（type/click/press_key Enter/tabs new|close）
      if (!cfg.allowWrite && isWriteAction(action)) {
        allowed = false;
        gateMessage =
          'AGENT_BROWSER_ALLOW_WRITE=false：写操作未开启，仅允许导航/读取类任务';
      }
      // §6.3 元素引用只在当前快照版本内有效：导航后旧快照的 selector 引用拒绝执行
      if (
        allowed &&
        'selector' in action &&
        stepSnapshot.url &&
        actionOriginUrls[i] &&
        actionOriginUrls[i] !== stepSnapshot.url
      ) {
        allowed = false;
        gateMessage = `页面已导航至 ${stepSnapshot.url}，旧快照中的元素引用已失效（origin=${actionOriginUrls[i]}），等待基于当前快照重新决策`;
      }
      if (tool && allowed) {
        let audit = this.policy.audit(
          tool,
          { url: 'url' in action ? (action.url ?? session.url) : session.url },
          { url: session.url, allowDomains: session.allowDomains },
        );
        // 2026-09-04 修「批准后死锁」（最后一处）：policy 把 navigate 定为低风险
        // （confirm:false），loop 闸门对 goto 不生效 → 客户端重试带的
        // confirmationIds 在 loop 层根本不会被消费（resolveConfirmation 不触达），
        // executor 每次重试都签新单 → "批一张废一张"。面板模式下导航与
        // executor 侧闸门对齐：导航一律要求面板确认单（executor.gotoViaPanel
        // 本来就对每次导航签单/验单，这里只是让 loop 簿记同一步）。
        if (panelMode === 'on' && tool === 'navigate' && !audit.requiresConfirmation) {
          audit = {
            ...audit,
            requiresConfirmation: true,
            reason: '面板模式：导航需面板确认单（对齐 executor 闸门）',
          };
        }
        if (audit.requiresConfirmation) {
          // P0-2：服务端确认校验——confirmationIds 查 AgentConfirmation 表（绑定
          // sessionId/tenantId/userId + fingerprint 一致）才放行；不信任客户端裸确认。
          // P2（复查 2026-08-22）：两阶段——此处仅"锁定"（pending→in_use，原子防并发），
          // 动作成功后才消费（in_use→consumed）；失败释放（in_use→pending）可安全重试。
          // 阶段 6 决策 ②：面板确认单也走这条（同一张表、同一个 id、同一套锁定）。
          const conf = await this.resolveConfirmation(
            session,
            action,
            confirmationIds,
            actor,
          );
          if (conf.ok) {
            lockedConfirmationId = conf.confirmationId;
            // 2026-09-04：锁的是"桥上还没批"的面板单（pending 也放行锁定防签新单）
            // ——批准权仍在桌面审批 UI，本步终态语义同 defer（等待批准，非真失败）
            if (conf.viaBridgePending) panelApprovalDeferred = true;
          } else if (panelMode === 'on') {
            // ── 阶段 6 决策 ②：面板模式下，没有已批准的单 → 交给桌面面板签 ──
            // 写动作的批准权归**桌面浏览器面板审批 UI**，技术闸门由面板桥把持
            // （桥把确认单绑在当前 webContentsId 上，换页旧单作废）。
            //
            // 于是此处**不再建第二张 AgentConfirmation**：否则同一个动作两个
            // 审批入口（桌面一个、后端待批列表一个），那是两套并行而非合并。
            //
            // 放行给 executor 不会漏闸门：executor 只在确认单 approved 时才执行，
            // pending 时只签单并返回 ok:false + confirmationId（桥侧 fail-closed，
            // 且面板不可用/动作不支持一律 failed 不回退到无头浏览器）。
            panelApprovalDeferred = true;
          } else {
            const confirmationId = await this.persistPendingConfirmation(
              session,
              action,
              audit.riskLevel,
            );
            allowed = false;
            blockedConfirmation = {
              id: confirmationId,
              selector: 'selector' in action ? action.selector : undefined,
            };
            gateMessage = `需用户确认后执行（高风险动作${confirmationId ? `，确认单 ${confirmationId}` : ''}）`;
          }
        } else if (!audit.allowed) {
          allowed = false;
          gateMessage = `策略阻断：${audit.reason ?? '不在白名单'}`;
        }
      }

      // 3.3 单动作执行（allowed 才执行；否则记录 blocked）
      // P4-2：maxRetries 接入——可重试错误（导航/提取/按键等执行类失败）重试，
      // 门禁类（策略阻断/需确认/写操作未开启/mock）不重试
      // （actor 已在 3.2 构造，阶段 6 决策 ②：闸门和执行共用同一个身份）
      const r = allowed
        ? await this.executeWithRetry(
            action,
            session.accountId,
            cfg.timeoutMs,
            cfg.maxRetries,
            actor,
            // 阶段 6 决策 ②：面板确认单要按会话落库，会话 id 必须透到执行器
            session.id,
            // 阶段 7 修断链：resolveConfirmation 锁定的确认单必须透给 executor，
            // 否则重试时 executor 看不到已锁定的单，会再签新单（用户批一张废一张）
            lockedConfirmationId,
            // 触达审计：会话归属线索透给 executor（签单落库 leadId）
            session.leadId ?? null,
          )
        : {
            index: i,
            action: action.action,
            ok: false,
            message: gateMessage ?? '策略阻断',
            evidenceUrl: undefined,
            extractText: undefined,
            url: undefined, // P1：blocked 未执行，无真实页面 URL
            blocked: true,
            ...(blockedConfirmation?.id
              ? { confirmationId: blockedConfirmation.id }
              : {}),
            ...(blockedConfirmation?.selector
              ? { selector: blockedConfirmation.selector }
              : {}),
          };

      // 2026-09-04 修「批准后死锁」第三处：policy 把 navigate 定为低风险
      // （confirm:false），loop 闸门不拦 goto → 确认单由 **executor 自己**在桥上
      // 签（gotoViaPanel 无单路径）。这类失败步骤同样要按"等待面板批准"留痕，
      // 否则终态被推成 failed，重试通道被 400 堵死（真机实证）。
      // 拒绝是用户终态决定，不算待批（消息含"拒绝"）。
      if (
        !r.ok &&
        panelMode === 'on' &&
        'confirmationId' in r &&
        r.confirmationId &&
        !r.message?.includes('拒绝')
      ) {
        panelApprovalDeferred = true;
      }

      // 3.4 验证：生成步骤事件
      const stepEvent: AgentBrowserStepEvent = {
        type: 'step',
        stepIndex: i,
        action: r.action,
        ok: r.ok,
        message: r.message,
        url: r.evidenceUrl,
        extractText: r.extractText,
        ...('confirmationId' in r && r.confirmationId
          ? { confirmationId: r.confirmationId }
          : {}),
        ...('selector' in r && r.selector ? { selector: r.selector } : {}),
        // 阶段 6 决策 ②：留痕——这一步的批准发生在桌面面板审批 UI 上
        ...(panelApprovalDeferred ? { panelApproval: true } : {}),
      };
      steps.push(stepEvent);
      onStep?.(stepEvent);
      this.sessions.bumpStep(sessionId);
      this.sessions.appendEvent(sessionId, stepEvent);

      // P1（复查第三轮）：断点推进——成功动作记入完成集合（重试幂等跳过），
      // 失败动作不记录（重试起点由完成集合推导：第一个未完成动作）
      if (r.ok) {
        completedIndices.add(i);
        session.pendingCompletedIndices = [...completedIndices];
      }
      // 实时持久化断点凭据（进程崩溃后重启可从磁盘恢复续跑）
      session.pendingStepIndex = i + 1;
      session.pendingActionOriginUrls = actionOriginUrls;

      // P1（复查 2026-08-22）：导航闭环——动作执行后的真实页面 URL（executeStep 返回
      // page.url()）回写会话；observe/重决策基于新页面，不再停留在执行前旧 session.url。
      // 测试 mock 未返回 url 时跳过（不回写），不影响已有快照驱动路径。
      if (r.ok && r.url && r.url !== session.url) {
        session.url = r.url;
      }
      // P2（复查 2026-08-22）：确认单消费时机延后——动作成功才 consumed；
      // 执行失败/阻断释放回 pending，原确认可用于安全重试（不再提前烧掉）
      if (lockedConfirmationId) {
        if (r.ok) {
          await this.consumeConfirmation(lockedConfirmationId);
        } else {
          await this.releaseConfirmation(lockedConfirmationId);
        }
      }

      // P4 DOM 闭环（复查 2026-08-22）：导航判断必须用执行后的真实页面——
      // 执行前的 snapshot 与执行前 URL 相同，goto 后不会触发。改为执行后重新
      // observe 拿新 URL，与执行前 URL 比较，导航发生才基于新快照重新决策。
      if (r.ok && i + 1 < actions.length) {
        try {
          const afterSnapshot = await this.observe(sessionId);
          steps.push(afterSnapshot);
          onStep?.(afterSnapshot);
          this.sessions.appendEvent(sessionId, afterSnapshot);
          if (afterSnapshot.url && afterSnapshot.url !== stepPrevUrl) {
            const redecided = await this.actions.parseActions(instruction, {
              snapshot: afterSnapshot.snapshot,
              url: afterSnapshot.url,
            });
            if (!redecided.length) {
              return { ok: r.ok, steps };
            }
            const done = i + 1;
            actions = actions
              .slice(0, done)
              .concat(redecided.slice(0, Math.max(1, cfg.maxSteps - done)));
            // 新动作基于当前（导航后）快照生成
            const newOrigins: string[] = Array(redecided.length).fill(
              afterSnapshot.url ?? session.url,
            ) as string[];
            actionOriginUrls = [
              ...actionOriginUrls.slice(0, done),
              ...newOrigins,
            ].slice(0, actions.length);
            // P1：同步断点上下文（重决策后新动作未执行过，完成集合语义不变；
            // resume 从重决策后的序列续跑）
            session.pendingActions = actions;
            session.pendingActionOriginUrls = actionOriginUrls;
            session.pendingCompletedIndices = [...completedIndices];
            this.logger.log(
              `AgentBrowser ${sessionId} 导航至 ${afterSnapshot.url}，基于新快照重新决策（${redecided.length} 个新动作）`,
            );
          }
        } catch (error) {
          this.logger.warn(
            `AgentBrowser ${sessionId} 导航后重新决策失败（沿用原动作序列）：${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    const successCount = steps.filter((s) => s.type === 'step' && s.ok).length;
    this.logger.log(
      `AgentBrowser ${sessionId} 完成：${actions.length} 个动作，${successCount} 成功`,
    );

    // P4-3（审计 2026-08-22）：三态结果——全部成功=success / 部分=partial_success /
    // 全部失败或无动作=failed（不再"1 成功 4 失败也算成功"）
    const stepResults = steps.filter(
      (s): s is AgentBrowserStepEvent & { type: 'step' } => s.type === 'step',
    );
    const okCount = stepResults.filter((s) => s.ok).length;
    const failCount = stepResults.filter((s) => !s.ok).length;
    // 2026-09-04 修「批准后死锁」第二半：面板待批步骤（panelApproval 标注）
    // 是"等用户点头"，不是真失败。全部失败且失败步骤全是面板待批时，
    // 落 partial_success 断点（run 的 sanctioned 重试通道），而不是 failed 终态
    // ——failed 终态会把"批准后携带该 id 重试"的契约堵死（400 终态不可重跑）。
    const isPanelDeferredStep = (s: { panelApproval?: boolean }) =>
      s.panelApproval === true;
    const deferredFailCount = stepResults.filter(
      (s) => !s.ok && isPanelDeferredStep(s),
    ).length;
    const awaitingPanelApproval =
      okCount === 0 &&
      failCount > 0 &&
      deferredFailCount === failCount;
    let status: NonNullable<AgentBrowserStepEvent['status']> = 'failed';
    if (actions.length === 0) {
      status = 'failed';
    } else if (failCount === 0) {
      status = 'success';
    } else if (okCount > 0) {
      status = 'partial_success';
    } else if (awaitingPanelApproval) {
      status = 'partial_success';
    }
    const doneMessage =
      awaitingPanelApproval && status === 'partial_success'
        ? `等待面板批准（${deferredFailCount} 个动作已签确认单，请在右侧浏览器面板批准后重试续跑）`
        : {
            success: `全部动作成功（${okCount}/${stepResults.length} 步）`,
            partial_success: `部分成功（${okCount} 成功 / ${failCount} 失败 / ${stepResults.length} 步）`,
            failed: `全部失败或未执行（${failCount} 失败 / ${stepResults.length} 步）`,
          }[status];
    const done: AgentBrowserStepEvent = {
      type: 'done',
      ok: status === 'success' || status === 'partial_success',
      status,
      message: doneMessage,
    };
    steps.push(done);
    onStep?.(done);
    this.sessions.appendEvent(sessionId, done);
    // P1/P2（复查第二轮）：终态写入前重查会话状态——最后一步执行期间用户可能
    // 已 pause/stop（循环只在每步开始检查），用户意图优先，不被 succeeded/failed 覆盖。
    const finalStatus = this.sessions.get(sessionId).status;
    const clearPending = () => {
      session.pendingInstruction = undefined;
      session.pendingActions = undefined;
      session.pendingStepIndex = undefined;
      session.pendingCompletedIndices = undefined;
      session.pendingActionOriginUrls = undefined;
    };
    // P1（复查第三轮）：重试起点=第一个未完成动作（完成集合之外），
    // 重试循环中已完成动作被跳过——幂等重试，不重放任何已成功动作
    let retryFrom = actions.length;
    for (let i = 0; i < actions.length; i++) {
      if (!completedIndices.has(i)) {
        retryFrom = i;
        break;
      }
    }
    if (finalStatus === 'running') {
      // 正常完成：全部成功=succeeded（终态）；部分成功=partial_success（保留断点，
      // 重试只补失败动作）；全部失败=failed（终态）
      if (status === 'success') {
        clearPending();
        this.sessions.updateStatus(sessionId, 'succeeded');
      } else if (status === 'partial_success') {
        session.pendingActions = actions;
        session.pendingStepIndex = retryFrom;
        session.pendingCompletedIndices = [...completedIndices];
        session.pendingActionOriginUrls = actionOriginUrls;
        this.sessions.updateStatus(sessionId, 'partial_success');
      } else {
        clearPending();
        this.sessions.updateStatus(sessionId, 'failed');
      }
    } else if (finalStatus === 'stopped') {
      // 用户已停止（终态）：清除断点（放弃任务）
      clearPending();
    } else {
      // paused / needs-human（最后一步执行期间到达）：保留用户暂停态 + 断点，
      // resume 从断点续跑；重试同样只补失败动作
      session.pendingActions = actions;
      session.pendingStepIndex = retryFrom;
      session.pendingCompletedIndices = [...completedIndices];
      session.pendingActionOriginUrls = actionOriginUrls;
    }
    return { ok: status === 'success' || status === 'partial_success', steps };
  }

  /** 串行化 Playwright MCP 访问（单例 sidecar 并发安全） */
  private async withMcpLock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = AgentBrowserLoopService.mcpLock;
    let release!: () => void;
    AgentBrowserLoopService.mcpLock = new Promise<void>((r) => (release = r));
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /** Observe：真实 DOM/accessibility 快照（playwright-mcp browser_snapshot），失败回落 URL */
  async observe(sessionId: string): Promise<{
    type: 'snapshot';
    ok: boolean;
    url?: string;
    message?: string;
    snapshot?: string;
    injected?: boolean;
  }> {
    const session = this.sessions.get(sessionId);
    try {
      // 真实无障碍树快照（若 playwright-mcp 可用）
      if (this.playwrightMcp) {
        try {
          // P4（审计 2026-08-22）：MCP sidecar 单例——并发会话互斥，防 profile 串读
          const text = await this.withMcpLock(async () => {
            // §7.4 绑定当前 Agent 会话的 profile（确保 snapshot 与执行同页面，
            // 避免"动作在 A 页面、快照读 B 页面"）。
            // 8s 超时：sidecar 启动慢/失败时快速回落 URL 快照，不阻塞循环。
            await Promise.race([
              this.playwrightMcp!.ensureProfile({
                platform: 'general-web',
                accountId: session.accountId,
              }),
              new Promise((_, reject) =>
                setTimeout(
                  () => reject(new Error('ensureProfile timeout')),
                  8000,
                ),
              ),
            ]);
            const res = await this.playwrightMcp!.rpcCall(
              {
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/call',
                params: {
                  name: 'browser_snapshot',
                  arguments: {},
                },
              },
              15_000,
            );
            return this.extractSnapshotText(res);
          });
          if (text) {
            const injected = detectPromptInjection(text);
            return {
              type: 'snapshot',
              ok: true,
              url: session.url,
              snapshot: injected ? undefined : text.slice(0, 4000),
              injected,
              message: injected
                ? `快照（会话 ${sessionId}）— 检测到可疑注入内容，已隔离，不进入模型上下文`
                : `DOM 快照（会话 ${sessionId}，${text.length} 字符，可交互元素已提取）`,
            };
          }
        } catch {
          // playwright-mcp 不可用则回落 URL 快照
        }
      }
      const snapshotText = `快照（会话 ${sessionId}，当前页 ${session.url || '未导航'}）`;
      const injected = detectPromptInjection(
        [snapshotText, session.url ?? ''].join('\n'),
      );
      return {
        type: 'snapshot',
        ok: true,
        url: session.url,
        injected, // P2（复查 2026-08-22）：fallback 路径同样带注入标记，
        // 否则回落 URL 快照时无法触发 needs-human 暂停
        message: injected
          ? `快照（会话 ${sessionId}）— 检测到可疑注入内容，已隔离，不进入模型上下文`
          : snapshotText,
      };
    } catch (error) {
      return {
        type: 'snapshot',
        ok: false,
        message: `快照失败：${(error as Error).message}`,
      };
    }
  }

  /** 从 MCP tools/call 响应提取 snapshot 文本 */
  private extractSnapshotText(res: {
    result?: { content?: Array<{ type?: string; text?: string }> };
  }): string {
    const content = res?.result?.content;
    if (!Array.isArray(content)) return '';
    return content
      .map((item) => (typeof item.text === 'string' ? item.text : ''))
      .join('\n')
      .trim();
  }

  /** P4-2：带重试的单动作执行——只重试可重试执行类错误，门禁类失败不重试 */
  private async executeWithRetry(
    action: AiBrowserAction,
    accountId: string,
    timeoutMs: number,
    maxRetries: number,
    /** 阶段 5：调用方身份（面板模式下的 actor 断言需要 ownerId/tenantId） */
    actor?: { ownerId: string; tenantId: string },
    /** 阶段 6 决策 ②：会话 id（面板确认单按会话落库，供 resolveConfirmation 绑定） */
    sessionId?: string,
    /** 阶段 7：resolveConfirmation 锁定的面板确认单 id（透传 executor，防重复签单死循环） */
    panelActionId?: string,
    /** 触达审计：动作归属线索（透传 executor 签单） */
    leadId?: string | null,
  ): Promise<{
    index: number;
    action: string;
    ok: boolean;
    message?: string;
    evidenceUrl?: string;
    extractText?: string;
    /** P1（复查 2026-08-22）：动作执行后的真实页面 URL（导航回写用） */
    url?: string;
  }> {
    const exec = this.executor ?? {
      execute: (
        input: Parameters<AiBrowserActionService['executeSingle']>[0],
      ) => this.actions.executeSingle(input),
      isAlive: async (accountId: string) =>
        typeof this.actions.isEngineAlive === 'function'
          ? this.actions.isEngineAlive(accountId).catch(() => false)
          : true,
    };
    let lastResult: Awaited<
      ReturnType<AiBrowserActionService['executeSingle']>
    >;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const r = await exec.execute({
        action,
        accountId,
        timeoutMs,
        actor,
        sessionId,
        actionId: panelActionId,
        leadId: leadId ?? null,
      } as Parameters<typeof exec.execute>[0]);
      lastResult = r;
      if (r.ok) return r;
      // 门禁类失败不重试（策略阻断/需确认/写操作未开启/mock 阻断）
      if (
        r.message?.includes('需用户确认') ||
        r.message?.includes('策略阻断') ||
        r.message?.includes('写操作未开启') ||
        r.message?.includes('DISPATCH_MOCK')
      ) {
        return r;
      }
      if (attempt < maxRetries) {
        this.logger.warn(
          `AgentBrowser 动作 ${action.action} 第 ${attempt + 1} 次失败，重试：${r.message}`,
        );
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    }
    return lastResult!;
  }

  /**
   * P0-2 服务端确认校验：不信任客户端裸 confirmedTools。
   * 优先按 confirmationIds 查 AgentConfirmation 表——记录必须：
   * - status = pending
   * - sessionId / tenantId / userId 与会话绑定一致（防跨会话复用）
   * - action + target/url fingerprint 与当前动作完全一致（防模糊放行）
   * 全部匹配才放行。查库不可用时回落精确 confirmedTools（已收紧，缺失关键字段不放行）。
   * P2（复查 2026-08-22）：匹配后原子锁定 pending → in_use（并发只有一方锁定成功），
   * 不直接 consumed——动作成功后才消费（consumeConfirmation），失败释放回 pending 可重试。
   *
   * 阶段 6 决策 ②（合并两套确认机制）：**面板确认单也走这里**——
   * 它落在同一张 AgentConfirmation 表、用同一个 id（桥 actionId）、同一套
   * pending→in_use→consumed 两阶段锁定。区别只有两点：
   *  1. 指纹比对用 CDP method（面板单的 action 列存的是 `Page.navigate` 之类，
   *     而普通单存的是 `goto`）；
   *  2. 批准态在**桌面面板**上，所以要问桥（见 panelApprovalState），
   *     后端不替用户点头，也不认"只在数据库里写了个 approved"。
   */
  private async resolveConfirmation(
    session: AgentBrowserSession,
    action: AiBrowserAction,
    confirmationIds: string[] | undefined,
    actor?: PanelBridgeActor,
  ): Promise<{
    ok: boolean;
    confirmationId?: string;
    /** 2026-09-04：锁的是桥上仍 pending 的面板单（批准权在桌面，步骤按待批语义留痕） */
    viaBridgePending?: boolean;
  }> {
    // P0（复查 2026-08-22）：高风险动作必须服务端确认记录放行——
    // 未传 confirmationIds / 查库失败 / 查不到匹配 / prisma 不可用，一律拒绝，
    // 绝不回退客户端传入的 confirmedTools（客户端可伪造）。
    if (!confirmationIds?.length) return { ok: false };
    if (!this.prisma) return { ok: false };
    try {
      const delegate = (
        this.prisma as unknown as {
          agentConfirmation?: {
            findMany?: (args: { where: { id: { in: string[] } } }) => Promise<
              Array<{
                id: string;
                status: string;
                sessionId: string;
                tenantId: string;
                userId: string;
                action: string;
                target?: string | null;
                content?: string | null;
                /** 阶段 6 决策 ②：面板单靠 confirmationJson 里的 source 识别 */
                confirmationJson?: unknown;
              }>
            >;
            updateMany?: (args: {
              where: { id: string; status: string };
              data: { status: string; decidedAt: Date };
            }) => Promise<{ count: number }>;
          };
        }
      )?.agentConfirmation;
      if (!delegate?.findMany) return { ok: false };
      const records = await delegate.findMany({
        where: { id: { in: confirmationIds } },
      });
      // 阶段 6 决策 ②：面板单要问桥（异步），所以从 find 改成 for 循环
      let matched: (typeof records)[number] | undefined;
      let viaBridgePending = false;
      for (const rec of records) {
        if (rec.status !== 'pending') continue;
        if (rec.sessionId !== session.id) continue;
        if (rec.tenantId !== (session.lease?.tenantId ?? rec.tenantId))
          continue;
        if (rec.userId !== (session.lease?.ownerId ?? rec.userId)) continue;
        if (isPanelConfirmation(rec.confirmationJson)) {
          // 面板单：指纹按 CDP method 比（action 列存的是 Page.navigate 之类）。
          const expected = panelMethodForAction(action.action);
          if (!expected) continue;
          const json = rec.confirmationJson as
            | { method?: unknown; status?: unknown }
            | null;
          if ((json?.method ?? rec.action) !== expected) continue;
          // 批准态的源头在**桌面面板桥**（executor 带票执行路径同源同问）。
          // 2026-09-04 修「批准后死锁」：旧实现只认落库 json.status==='approved'，
          // 但该标记只有带票执行成功后才写——锁单要求标记、标记要求带票执行，
          // 用户点了批准也放不了行（真机实证）。现改为问桥（executor.
          // resolvePanelApproval）：approved → 放行；pending → 也放行锁定，
          // 由 executor 带票问桥返回"待批准"失败（**不签新单**，防批一张废一张
          // 的票风暴），循环释放回 pending，用户批准后重试走同一张单；
          // rejected / none / 桥不可用 → 不放行（fail-closed 不变）。
          if (json?.status !== 'approved') {
            const bridgeState = await this.executor?.resolvePanelApproval?.(
              actor,
              rec.id,
            );
            if (bridgeState !== 'approved' && bridgeState !== 'pending') {
              continue;
            }
            viaBridgePending = bridgeState === 'pending';
          }
        } else {
          if (rec.action !== action.action) continue;
          if ('selector' in action && rec.target !== action.selector) continue;
          if ('url' in action && rec.content !== action.url) continue;
        }
        matched = rec;
        break;
      }
      if (!matched) return { ok: false };
      // P1（复查 2026-08-22）：原子锁定——pending → in_use，并发时 updateMany 匹配
      // 0 条 = 已被其他请求锁定/消费 → 拒绝（同 id 不可并发复用）
      // P1（复查第二轮）：缺 updateMany 时同样 fail-closed 拒绝——
      // 没有原子锁定能力就不能安全放行（绕过锁定 = 确认单可被并发复用）
      if (!delegate.updateMany) return { ok: false };
      const res = await delegate.updateMany({
        where: { id: matched.id, status: 'pending' },
        data: { status: 'in_use', decidedAt: new Date() },
      });
      return res.count === 1
        ? { ok: true, confirmationId: matched.id, viaBridgePending }
        : { ok: false };
    } catch (error) {
      this.logger.warn(
        `AgentConfirmation 校验查询失败（fail-closed 拒绝）：${error instanceof Error ? error.message : String(error)}`,
      );
      return { ok: false };
    }
  }

  /**
   * P2（复查 2026-08-22）：确认单消费——动作执行成功后 in_use → consumed（一次性）。
   * P2（复查第二轮）：消费失败不再静默——内部重试 3 次，最终失败显式告警人工核对。
   * （确认单停留 in_use 不可被再次锁定，不会导致动作重放；仅审计态需人工收尾。）
   */
  private async consumeConfirmation(id: string | undefined): Promise<void> {
    if (!id || !this.prisma) return;
    const err = await this.updateConfirmationWithRetry(id, 'in_use', {
      status: 'consumed',
      decidedAt: new Date(),
    });
    if (err) {
      this.logger.warn(
        `AgentConfirmation ${id} 消费失败（已重试 3 次）：确认单停留 in_use（不可复用），请人工核对数据库 local_engine_agent_confirmations`,
      );
    }
  }

  /**
   * P2（复查 2026-08-22）：确认单释放——动作执行失败后 in_use → pending，
   * 原确认单可安全用于重试（不提前烧掉确认）。
   * P2（复查第二轮）：释放失败同样重试 3 次，最终失败显式告警
   * （停留 in_use 不可复用，安全；重试会走新确认单，仅原确认单作废需人工收尾）。
   */
  private async releaseConfirmation(id: string | undefined): Promise<void> {
    if (!id || !this.prisma) return;
    const err = await this.updateConfirmationWithRetry(id, 'in_use', {
      status: 'pending',
    });
    if (err) {
      this.logger.warn(
        `AgentConfirmation ${id} 释放失败（已重试 3 次）：确认单停留 in_use（不可复用，安全作废），请人工核对数据库 local_engine_agent_confirmations`,
      );
    }
  }

  /** 确认单状态更新（带 3 次重试的补偿），成功返回 null、失败返回最后一个错误 */
  private async updateConfirmationWithRetry(
    id: string,
    fromStatus: string,
    data: { status: string; decidedAt?: Date },
  ): Promise<unknown> {
    const delegate = (
      this.prisma as unknown as {
        agentConfirmation?: {
          updateMany?: (args: {
            where: { id: string; status: string };
            data: { status: string; decidedAt?: Date };
          }) => Promise<{ count: number }>;
        };
      }
    )?.agentConfirmation;
    if (!delegate?.updateMany) return new Error('updateMany unavailable');
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await delegate.updateMany({
          where: { id, status: fromStatus },
          data,
        });
        return null;
      } catch (error) {
        lastError = error;
        if (attempt < 2) await new Promise((r) => setTimeout(r, 200));
      }
    }
    return lastError;
  }

  /**
   * P1-3 确认持久化：高风险动作未确认时写 AgentConfirmation 表（pending）。
   * 返回确认单 id；prisma 不可用时仅内存提示（不落库）。
   */
  private async persistPendingConfirmation(
    session: AgentBrowserSession,
    action: AiBrowserAction,
    riskLevel: string,
  ): Promise<string | undefined> {
    try {
      const delegate = (
        this.prisma as unknown as {
          agentConfirmation?: {
            create?: (args: {
              data: {
                tenantId: string;
                userId: string;
                sessionId: string;
                action: string;
                status: string;
                riskLevel: string;
                target?: string | null;
                content?: string | null;
                confirmationJson: unknown;
              };
            }) => Promise<{ id: string }>;
          };
        }
      )?.agentConfirmation;
      if (!delegate?.create) return undefined;
      const created = await delegate.create({
        data: {
          tenantId: session.lease?.tenantId ?? 'legacy-local-desktop',
          userId: session.lease?.ownerId ?? 'legacy-local-user',
          sessionId: session.id,
          action: action.action,
          status: 'pending',
          riskLevel,
          target: 'selector' in action ? action.selector : null,
          content: 'url' in action ? action.url : null,
          confirmationJson: {
            sessionId: session.id,
            action: action.action,
            target: 'selector' in action ? action.selector : undefined,
            url: 'url' in action ? action.url : undefined,
            createdAt: new Date().toISOString(),
          },
        },
      });
      return created.id;
    } catch (error) {
      this.logger.warn(
        `AgentConfirmation 持久化失败（不阻断，仅内存提示）：${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }

  /** §14.2 读取 Agent Browser 灰度配置（环境变量，缺省=dom-agent 开启/读操作为主） */
  private readAgentBrowserConfig(): {
    mode: 'legacy' | 'dom-agent';
    allowedDomains: string[];
    maxSteps: number;
    maxRetries: number;
    timeoutMs: number;
    allowWrite: boolean;
  } {
    const rawMode = (process.env.AGENT_BROWSER_MODE ?? 'legacy').trim();
    if (rawMode !== 'legacy' && rawMode !== 'dom-agent') {
      throw new BadRequestException(
        `非法的 AGENT_BROWSER_MODE=${rawMode}，仅允许 legacy/dom-agent`,
      );
    }
    const mode = rawMode;
    // §14.2 安全校验（P4-4 审计 2026-08-22）：整数 + 安全范围边界，非法配置拒绝
    // （不允许静默采用危险值，如极大 timeout / 无限重试）
    const maxSteps = Number(process.env.AGENT_BROWSER_MAX_STEPS ?? 30);
    const maxRetries = Number(process.env.AGENT_BROWSER_MAX_RETRIES ?? 2);
    const timeoutMs = Number(process.env.AGENT_BROWSER_TIMEOUT_MS ?? 120000);
    if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 100) {
      throw new BadRequestException(
        `非法的 AGENT_BROWSER_MAX_STEPS=${process.env.AGENT_BROWSER_MAX_STEPS}，必须为 1-100 整数`,
      );
    }
    if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 5) {
      throw new BadRequestException(
        `非法的 AGENT_BROWSER_MAX_RETRIES=${process.env.AGENT_BROWSER_MAX_RETRIES}，必须为 0-5 整数`,
      );
    }
    if (
      !Number.isInteger(timeoutMs) ||
      timeoutMs < 1000 ||
      timeoutMs > 300000
    ) {
      throw new BadRequestException(
        `非法的 AGENT_BROWSER_TIMEOUT_MS=${process.env.AGENT_BROWSER_TIMEOUT_MS}，必须为 1000-300000 整数`,
      );
    }
    return {
      mode,
      allowedDomains: (process.env.AGENT_BROWSER_ALLOWED_DOMAINS ?? '')
        .split(',')
        .map((d) => d.trim())
        .filter(Boolean),
      maxSteps,
      maxRetries,
      timeoutMs,
      allowWrite: (process.env.AGENT_BROWSER_ALLOW_WRITE ?? 'false') === 'true',
    };
  }

  /** 执行器动作 → P4 工具白名单映射（用于逐步策略审计） */
  private mapTool(
    action: string,
  ):
    | 'navigate'
    | 'snapshot'
    | 'click'
    | 'fill_form'
    | 'press_key'
    | 'wait_for'
    | 'tabs'
    | 'extract_text'
    | null {
    switch (action) {
      case 'goto':
        return 'navigate';
      case 'type':
        return 'fill_form';
      case 'click':
        return 'click';
      case 'extract':
        return 'extract_text';
      case 'wait':
        return 'wait_for';
      case 'screenshot':
        return 'snapshot';
      case 'press_key':
        return 'press_key';
      case 'tabs':
        return 'tabs';
      default:
        return null;
    }
  }

  /** 策略审计单步动作（对外暴露，供前端预检） */
  auditStep(
    tool: string,
    args: Record<string, unknown>,
    allowDomains: string[],
  ) {
    this.policy.assertToolAllowed(tool);
    return this.policy.audit(tool, args, { allowDomains });
  }
}
