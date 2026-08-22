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
    } = {},
  ): Promise<{ ok: boolean; steps: AgentBrowserStepEvent[] }> {
    const { onStep, confirmationIds } = options;
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

    // §14.2 feature flag：mode 门禁（legacy=继续现有执行器；dom-agent=本循环灰度）
    const cfg = this.readAgentBrowserConfig();
    if (cfg.mode === 'legacy') {
      throw new BadRequestException(
        'AGENT_BROWSER_MODE=legacy：Agent Browser 循环未开启（灰度开关关闭），请使用现有动作执行',
      );
    }
    // §14.2 allowWrite 门禁（P4-1 审计 2026-08-22）：不再按自然语言中文关键词判断
    // （英文指令可绕过），改为循环内按解析后动作类型判断（isWriteAction）。

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
    let actions: AiBrowserAction[] = [];
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
    // §6.3 元素引用只在当前快照版本内有效：记录每个动作生成时的页面 URL，
    // 导航后旧快照的 selector 引用拒绝执行（等待重新决策）
    let actionOriginUrls: string[] = actions.map(() => session.url ?? '');

    // 3. 逐步 Observe→策略→单动作执行→验证（§7.4 DOM Agent 循环）
    // P0-2：当前步被确认闸门拦截时的确认单信息（供 blocked 事件带出真实 selector）
    let blockedConfirmation: { id?: string; selector?: string } | undefined;
    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      // P1（复查 2026-08-22）：每步执行前检查会话状态——paused/stopped/
      // needs-human 时立即中断循环（否则 pause/stop 只改状态不中断执行）
      const stepStatus = this.sessions.get(sessionId).status;
      if (stepStatus !== 'running') {
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
        const audit = this.policy.audit(
          tool,
          { url: 'url' in action ? (action.url ?? session.url) : session.url },
          { url: session.url, allowDomains: session.allowDomains },
        );
        if (audit.requiresConfirmation) {
          // P0-2：服务端确认校验——confirmationIds 查 AgentConfirmation 表（绑定
          // sessionId/tenantId/userId + fingerprint 一致）才放行；不信任客户端裸确认。
          const matched = await this.resolveConfirmation(
            session,
            action,
            confirmationIds,
          );
          if (!matched) {
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
      const r = allowed
        ? await this.executeWithRetry(
            action,
            session.accountId,
            cfg.timeoutMs,
            cfg.maxRetries,
          )
        : {
            index: i,
            action: action.action,
            ok: false,
            message: gateMessage ?? '策略阻断',
            evidenceUrl: undefined,
            extractText: undefined,
            blocked: true,
            ...(blockedConfirmation?.id
              ? { confirmationId: blockedConfirmation.id }
              : {}),
            ...(blockedConfirmation?.selector
              ? { selector: blockedConfirmation.selector }
              : {}),
          };

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
      };
      steps.push(stepEvent);
      onStep?.(stepEvent);
      this.sessions.bumpStep(sessionId);
      this.sessions.appendEvent(sessionId, stepEvent);

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
    let status: NonNullable<AgentBrowserStepEvent['status']> = 'failed';
    if (actions.length === 0) {
      status = 'failed';
    } else if (failCount === 0) {
      status = 'success';
    } else if (okCount > 0) {
      status = 'partial_success';
    }
    const done: AgentBrowserStepEvent = {
      type: 'done',
      ok: status === 'success' || status === 'partial_success',
      status,
      message: {
        success: `全部动作成功（${okCount}/${stepResults.length} 步）`,
        partial_success: `部分成功（${okCount} 成功 / ${failCount} 失败 / ${stepResults.length} 步）`,
        failed: `全部失败或未执行（${failCount} 失败 / ${stepResults.length} 步）`,
      }[status],
    };
    steps.push(done);
    onStep?.(done);
    this.sessions.appendEvent(sessionId, done);
    // P1（复查）：执行完成后置终态 succeeded（文档 running -> succeeded），
    // 避免成功会话停留 running 被误判"重复执行"
    if (status === 'success' || status === 'partial_success') {
      this.sessions.updateStatus(sessionId, 'succeeded');
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
  ): Promise<{
    index: number;
    action: string;
    ok: boolean;
    message?: string;
    evidenceUrl?: string;
    extractText?: string;
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
      });
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
   */
  private async resolveConfirmation(
    session: AgentBrowserSession,
    action: AiBrowserAction,
    confirmationIds: string[] | undefined,
  ): Promise<boolean> {
    // P0（复查 2026-08-22）：高风险动作必须服务端确认记录放行——
    // 未传 confirmationIds / 查库失败 / 查不到匹配 / prisma 不可用，一律拒绝，
    // 绝不回退客户端传入的 confirmedTools（客户端可伪造）。
    if (!confirmationIds?.length) return false;
    if (!this.prisma) return false;
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
              }>
            >;
            updateMany?: (args: {
              where: { id: string; status: string };
              data: { status: string; decidedAt: Date };
            }) => Promise<{ count: number }>;
          };
        }
      )?.agentConfirmation;
      if (!delegate?.findMany) return false;
      const records = await delegate.findMany({
        where: { id: { in: confirmationIds } },
      });
      const matched = records.find((rec) => {
        if (rec.status !== 'pending') return false;
        if (rec.sessionId !== session.id) return false;
        if (rec.tenantId !== (session.lease?.tenantId ?? rec.tenantId))
          return false;
        if (rec.userId !== (session.lease?.ownerId ?? rec.userId)) return false;
        if (rec.action !== action.action) return false;
        if ('selector' in action && rec.target !== action.selector)
          return false;
        if ('url' in action && rec.content !== action.url) return false;
        return true;
      });
      if (!matched) return false;
      // P1（复查）：原子消费——pending → consumed，防止同一确认单重复执行
      // 产生外部副作用（并发时 updateMany 匹配 0 条 = 已被消费 → 拒绝）
      if (delegate.updateMany) {
        const res = await delegate.updateMany({
          where: { id: matched.id, status: 'pending' },
          data: { status: 'consumed', decidedAt: new Date() },
        });
        return res.count === 1;
      }
      return true;
    } catch (error) {
      this.logger.warn(
        `AgentConfirmation 校验查询失败（fail-closed 拒绝）：${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
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
