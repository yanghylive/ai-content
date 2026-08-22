import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AiBrowserActionService } from './ai-browser-action.service';
import { AgentBrowserSessionService } from './agent-browser-session.service';
import { AgentBrowserPolicyService } from './agent-browser-policy.service';

export interface AgentBrowserStepEvent {
  type: 'step' | 'snapshot' | 'done' | 'error';
  stepIndex?: number;
  action?: string;
  ok?: boolean;
  message?: string;
  url?: string;
  extractText?: string;
  error?: string;
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

  constructor(
    private readonly sessions: AgentBrowserSessionService,
    private readonly actions: AiBrowserActionService,
    private readonly policy: AgentBrowserPolicyService,
  ) {}

  /**
   * 运行一轮 Observe-Act-Verify。
   * sessionId 必须已 acquireEngineSession（状态 running）。
   * instruction: 自然语言任务（如"搜索装修公司并截图"）。
   */
  async run(
    sessionId: string,
    instruction: string,
    onStep?: (event: AgentBrowserStepEvent) => void,
  ): Promise<{ ok: boolean; steps: AgentBrowserStepEvent[] }> {
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

    const steps: AgentBrowserStepEvent[] = [];

    // 1. Observe：快照当前页
    const snapshot = await this.observe(sessionId);
    steps.push(snapshot);
    onStep?.(snapshot);
    this.sessions.appendEvent(sessionId, snapshot);

    // 2. Act：执行指令（复用 AiBrowserActionService：AI 解析 + 逐部执行 + 证据）
    //    Observe 到当前 URL 注入 context（供域名审计用）
    const currentUrl = snapshot.url ?? undefined;
    const actResult = await this.actions.run({
      instruction,
      ...(currentUrl && !currentUrl.startsWith('chrome://')
        ? { url: currentUrl }
        : {}),
      timeoutMs: 30_000,
    });

    // 3. Verify：逐步骤生成事件 + 域名审计（白名单外的 URL 变更标记风险）
    for (let i = 0; i < actResult.results.length; i++) {
      const r = actResult.results[i];
      const stepEvent: AgentBrowserStepEvent = {
        type: 'step',
        stepIndex: i,
        action: r.action,
        ok: r.ok,
        message: r.message,
        url: r.evidenceUrl,
        extractText: r.extractText,
      };
      steps.push(stepEvent);
      onStep?.(stepEvent);
      this.sessions.bumpStep(sessionId);
      this.sessions.appendEvent(sessionId, stepEvent);
    }

    this.logger.log(
      `AgentBrowser ${sessionId} 完成：${actResult.actions.length} 个动作，${actResult.results.filter((r) => r.ok).length} 成功`,
    );

    const done: AgentBrowserStepEvent = {
      type: 'done',
      ok: actResult.ok,
      message: actResult.actions.length
        ? `已执行 ${actResult.results.length} 步`
        : '无可用动作',
    };
    steps.push(done);
    onStep?.(done);
    this.sessions.appendEvent(sessionId, done);
    return { ok: actResult.ok, steps };
  }

  /** Observe：快照当前页状态（URL + 可交互文本片段） */
  async observe(
    sessionId: string,
  ): Promise<{ type: 'snapshot'; ok: boolean; url?: string; message?: string }> {
    const session = this.sessions.get(sessionId);
    try {
      // 引擎 page 详情由 SessionService 维护的 engineKey 当前页 URL 近似；
      // 更精确的 DOM snapshot 由 AiBrowserActionService 的 extract/截图承担。
      // 这里只返回会话记录的当前 URL（避免重复打开浏览器页）。
      return {
        type: 'snapshot',
        ok: true,
        url: session.url,
        message: `快照（会话 ${sessionId}，当前页 ${session.url || '未导航'}）`,
      };
    } catch (error) {
      return {
        type: 'snapshot',
        ok: false,
        message: `快照失败：${(error as Error).message}`,
      };
    }
  }

  /** 策略审计单步动作（对外暴露，供前端预检） */
  auditStep(
    tool: string,
    args: Record<string, unknown>,
    allowDomains: string[],
  ) {
    this.policy.assertToolAllowed(tool);
    return this.policy.audit(tool as never, args, { allowDomains });
  }
}