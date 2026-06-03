/**
 * AgentSExecutorAdapter · Agent-S 路径执行器（薄壳适配）
 *
 * 详见：
 *  - docs/adr/001-executor-router-capability-interface.md §3.5
 *  - docs/adr/002-copy-first-migration-strategy.md §5 D4
 *
 * 设计原则：
 *  1. 不复制 AgentSService 实现——它是 Agent-S 的事实控制器，
 *     本 Adapter 只做"ExecutorTask ↔ AgentSSidecar*Input/Output"的翻译。
 *  2. AgentSService 通过 LocalEngineModule.exports 注入（已经 export，
 *     不存在循环依赖）。
 *  3. P2 D4 阶段实现：基本翻译 + 简单轮询 + 错误捕获，覆盖 ExecutorRouter 路由所需接口。
 *     轮询超时、证据精细化收集等留 P2 D5+ 强化。
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  AgentSService,
  type AgentSSidecarEvent,
  type AgentSSidecarSessionSummary,
} from '../local-engine/agent-s.service';
import {
  type ExecutorCapability,
  type ExecutorContext,
  type ExecutorEvidence,
  type ExecutorTask,
  type RuntimeExecutionResult,
  type TaskExecutor,
  rejectResult,
} from './executor.interface';

/**
 * Agent-S 路径轮询配置。
 * 默认 60s 超时（桌面任务通常 ≤ 30s 完成；超时即视为 failed）。
 * 轮询参数为公共字段，测试可直接赋值覆盖。
 */
const DEFAULT_POLL_TIMEOUT_MS = 60_000;
const DEFAULT_POLL_INTERVAL_MS = 1_000;

type AgentSTerminalStatus = AgentSSidecarSessionSummary['status'];

@Injectable()
export class AgentSExecutorAdapter implements TaskExecutor {
  readonly id = 'agent-s' as const;

  private readonly logger = new Logger(AgentSExecutorAdapter.name);

  /** 轮询总超时 ms（公共字段，便于测试覆盖） */
  pollTimeoutMs: number = DEFAULT_POLL_TIMEOUT_MS;

  /** 轮询间隔 ms（公共字段，便于测试覆盖） */
  pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS;

  constructor(private readonly agentS: AgentSService) {}

  // =========================================================================
  // canHandle: 判断 Adapter 是否处理本任务
  // =========================================================================

  canHandle(task: ExecutorTask): ExecutorCapability {
    // 桌面主战场：微信桌面
    if (task.platform === 'wechat-desktop') {
      return { ok: true, priority: 90 };
    }

    // 浏览器 CDP 任务：Agent-S 明确不处理
    if (task.platform === 'douyin' || task.platform === 'wechat-channel') {
      return {
        ok: false,
        priority: 0,
        reason: 'agent-s 不处理浏览器 CDP 任务（应命中 local-runtime）',
      };
    }

    // mixed 平台兜底（中等优先级，可被更具体的 executor 抢）
    if (task.platform === 'mixed') {
      return {
        ok: true,
        priority: 50,
        reason: 'mixed 平台可由 agent-s 桌面路径兜底',
      };
    }

    return {
      ok: false,
      priority: 0,
      reason: `agent-s 不识别 platform=${String(task.platform)}`,
    };
  }

  // =========================================================================
  // execute: 翻译 + 委派 + 轮询 + 结果映射
  // =========================================================================

  async execute(
    task: ExecutorTask,
    ctx: ExecutorContext,
  ): Promise<RuntimeExecutionResult> {
    // Step 1: 建会话
    let session: AgentSSidecarSessionSummary;
    try {
      const created = await this.agentS.createSession({
        session_name: `executor-router-${task.relatedId}`,
        task_type: task.type,
        metadata: {
          source: 'executor-router',
          relatedId: task.relatedId,
          relatedType: task.relatedType,
          platform: task.platform,
          accountId: task.accountId ?? null,
        },
        labels: ['executor-router', task.platform],
      });
      session = created.session;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Agent-S createSession failed for task ${task.relatedId}: ${msg}`,
      );
      return rejectResult(
        'agent_s_unavailable',
        'Agent-S 会话创建失败',
        `createSession threw: ${msg}`,
      );
    }

    // Step 2: 翻译 ExecutorTask → AgentSSidecarRunTaskInput 并触发
    try {
      await this.agentS.runTask(session.session_id, {
        instruction: this.buildInstruction(task, ctx),
        task_type: task.type,
        metadata: {
          ...task.payload,
          sendMode: ctx.sendMode,
          approvalDecision: ctx.approvalDecision ?? null,
        },
        risk_level: 'medium',
        requires_approval: ctx.sendMode === 'draft-only',
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Agent-S runTask failed for session ${session.session_id}: ${msg}`,
      );
      return this.buildResult({
        sessionId: session.session_id,
        terminalStatus: 'failed',
        userMessage: 'Agent-S 任务下发失败',
        technicalMessage: `runTask threw: ${msg}`,
        evidence: [],
      });
    }

    // Step 3: 轮询直到 terminal 或超时
    const finalState = await this.pollUntilTerminal(session.session_id, ctx);

    return this.buildResult({
      sessionId: session.session_id,
      terminalStatus: finalState.status,
      userMessage:
        finalState.status === 'completed'
          ? 'Agent-S 任务执行完成'
          : finalState.status === 'cancelled'
            ? 'Agent-S 任务被取消'
            : finalState.status === 'waiting_approval'
              ? 'Agent-S 任务等待审批'
              : finalState.message || 'Agent-S 任务未完成',
      technicalMessage: finalState.message,
      evidence: finalState.evidence,
    });
  }

  // =========================================================================
  // isHealthy: 透传 Agent-S 健康检查
  // =========================================================================

  async isHealthy(): Promise<{ ok: boolean; details?: string }> {
    try {
      const health = await this.agentS.health();
      return {
        ok: health.ok === true,
        details: `agent-s status=${health.status ?? 'unknown'} version=${health.version ?? 'unknown'}`,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { ok: false, details: `Agent-S health check threw: ${msg}` };
    }
  }

  // =========================================================================
  // 私有：指令构造（P2 D5+ 按 platform 细化）
  // =========================================================================

  private buildInstruction(task: ExecutorTask, ctx: ExecutorContext): string {
    const payloadJson = JSON.stringify(task.payload ?? {}, null, 2);
    return [
      `[Agent-S Task]`,
      `Type: ${task.type}`,
      `Platform: ${task.platform}`,
      `AccountId: ${task.accountId ?? 'n/a'}`,
      `SendMode: ${ctx.sendMode}`,
      `RelatedId: ${task.relatedId} (${task.relatedType})`,
      ``,
      `Payload:`,
      payloadJson,
    ].join('\n');
  }

  // =========================================================================
  // 私有：轮询逻辑
  // =========================================================================

  private async pollUntilTerminal(
    sessionId: string,
    ctx: ExecutorContext,
  ): Promise<{
    status: AgentSTerminalStatus;
    message?: string;
    evidence: ExecutorEvidence[];
  }> {
    // ctx 留作 P2 D5+ 接入审批决策、超时配置等用
    void ctx;
    const deadline = Date.now() + this.pollTimeoutMs;
    let afterSeq: number | undefined = undefined;
    const collectedEvents: AgentSSidecarEvent[] = [];

    while (Date.now() < deadline) {
      try {
        const page = await this.agentS.getEvents(sessionId, afterSeq);
        if (page.events.length > 0) {
          collectedEvents.push(...page.events);
          afterSeq = page.next_seq;

          // 看最后一个事件的状态判定 terminal
          const last = page.events[page.events.length - 1];
          if (this.isTerminalStatus(last.status)) {
            return {
              status: last.status,
              message: last.message ?? undefined,
              evidence: this.collectEvidence(sessionId, collectedEvents),
            };
          }
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Agent-S getEvents failed during polling (will retry): ${msg}`,
        );
      }

      await this.sleep(this.pollIntervalMs);
    }

    return {
      status: 'failed',
      message: `Agent-S session ${sessionId} 轮询超时（${this.pollTimeoutMs}ms）未到达 terminal`,
      evidence: this.collectEvidence(sessionId, collectedEvents),
    };
  }

  private isTerminalStatus(status: string): boolean {
    return (
      status === 'completed' ||
      status === 'failed' ||
      status === 'cancelled' ||
      status === 'waiting_approval'
    );
  }

  private collectEvidence(
    sessionId: string,
    events: AgentSSidecarEvent[],
  ): ExecutorEvidence[] {
    if (events.length === 0) {
      return [];
    }

    // P2 D4 最小：把整个事件流当作 action log 证据
    const actionLog: ExecutorEvidence = {
      type: 'agent-s-action-log',
      label: `Agent-S session ${sessionId} 完整事件流`,
      value: JSON.stringify(
        events.map((e) => ({
          seq: e.seq,
          type: e.event_type,
          status: e.status,
          message: e.message,
          step: e.step_index,
        })),
      ),
      createdAt: new Date().toISOString(),
      raw: {
        sessionId,
        collectedCount: events.length,
        firstSeq: events[0]?.seq,
        lastSeq: events[events.length - 1]?.seq,
      },
    };

    return [actionLog];
  }

  // =========================================================================
  // 私有：结果映射
  // =========================================================================

  private buildResult(opts: {
    sessionId: string;
    terminalStatus: AgentSTerminalStatus | 'failed';
    userMessage: string;
    technicalMessage?: string;
    evidence: ExecutorEvidence[];
  }): RuntimeExecutionResult {
    const isSuccess = opts.terminalStatus === 'completed';
    const isBlocked = opts.terminalStatus === 'waiting_approval';

    return {
      ok: isSuccess,
      status: isSuccess ? 'success' : isBlocked ? 'blocked' : 'failed',
      reasonCode: isSuccess
        ? 'success'
        : isBlocked
          ? 'review_required'
          : 'send_failed',
      userMessage: opts.userMessage,
      technicalMessage: opts.technicalMessage,
      runtime: {
        mode: 'agent-s',
        executor: 'desktop-agent-s',
        agentSSessionId: opts.sessionId,
      },
      evidence: opts.evidence,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
