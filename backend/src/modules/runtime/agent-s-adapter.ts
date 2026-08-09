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

import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  AgentSService,
  type AgentSSidecarEvent,
  type AgentSSidecarSessionSummary,
} from '../agent-s/agent-s.service';
import { NodeAgentRuntimeService } from './node-agent-runtime/node-agent-runtime.service';
import type { NodeAgentRuntimeEvent } from './node-agent-runtime/node-agent-runtime.contract';
import {
  type ExecutorCapability,
  type ExecutorContext,
  type ExecutorEvidence,
  type ExecutorReasonCode,
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

  constructor(
    private readonly agentS: AgentSService,
    @Optional()
    private readonly nodeAgentRuntime?: NodeAgentRuntimeService,
  ) {}

  // =========================================================================
  // canHandle: 判断 Adapter 是否处理本任务
  // =========================================================================

  canHandle(task: ExecutorTask): ExecutorCapability {
    // 桌面主战场：微信桌面
    if (task.platform === 'wechat-desktop') {
      return { ok: true, priority: 90 };
    }

    // 浏览器 CDP 任务：Agent-S 明确不处理
    if (
      task.platform === 'douyin' ||
      task.platform === 'wechat-channel' ||
      task.platform === 'xiaohongshu' ||
      task.platform === 'kuaishou'
    ) {
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
    // Desktop WeChat must stay on the Agent-S desktop controller.  The
    // in-process Node runtime owns browser/CDP execution; routing WeChat into
    // it bypasses the packaged native runner on Windows.
    if (this.nodeAgentRuntime && task.platform !== 'wechat-desktop') {
      return this.executeViaNodeAgentRuntime(task, ctx);
    }

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
        evidence: [
          {
            type: 'text',
            label: `Agent-S session ${session.session_id} 已建，但任务下发失败`,
            value: msg,
            createdAt: new Date().toISOString(),
            raw: {
              sessionId: session.session_id,
              failurePhase: 'runTask',
              errorMessage: msg,
            },
          },
        ],
      });
    }

    // Step 3: 轮询直到 terminal 或超时
    const finalState = await this.pollUntilTerminal(session.session_id, ctx);
    const terminalResult = this.readRecord(finalState.terminalEvent?.payload);

    return this.buildResult({
      sessionId: session.session_id,
      terminalStatus: finalState.status,
      reasonCode: this.resolveNodeRuntimeReasonCode(finalState.terminalEvent),
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
      blockers: this.extractNodeRuntimeBlockers(
        finalState.terminalEvent,
        terminalResult,
      ),
      readback: this.extractRuntimeReadback(terminalResult),
      result: terminalResult,
    });
  }

  private async executeViaNodeAgentRuntime(
    task: ExecutorTask,
    ctx: ExecutorContext,
  ): Promise<RuntimeExecutionResult> {
    let session: AgentSSidecarSessionSummary;
    try {
      const created = this.nodeAgentRuntime!.createSession({
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
        `Node Agent Runtime createSession failed for task ${task.relatedId}: ${msg}`,
      );
      return rejectResult(
        'agent_s_unavailable',
        'Node Agent Runtime 会话创建失败',
        `createSession threw: ${msg}`,
      );
    }

    try {
      await this.nodeAgentRuntime!.runTask(session.session_id, {
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
        `Node Agent Runtime runTask failed for session ${session.session_id}: ${msg}`,
      );
      return this.buildResult({
        sessionId: session.session_id,
        terminalStatus: 'failed',
        userMessage: 'Node Agent Runtime 任务下发失败',
        technicalMessage: `runTask threw: ${msg}`,
        evidence: [
          {
            type: 'text',
            label: `Node Agent Runtime session ${session.session_id} 已建，但任务下发失败`,
            value: msg,
            createdAt: new Date().toISOString(),
            raw: {
              sessionId: session.session_id,
              failurePhase: 'runTask',
              errorMessage: msg,
            },
          },
        ],
      });
    }

    const page = this.nodeAgentRuntime!.getEvents(session.session_id);
    const events = page.events as unknown as AgentSSidecarEvent[];
    const terminalEvent = this.findLatestTerminalEvent(events);
    const nodeRuntimeResult = this.readNodeRuntimeArtifactResult(
      session.session_id,
    );
    const runtimeFields =
      this.extractRuntimeInteractionFields(nodeRuntimeResult);
    const blockers = this.extractNodeRuntimeBlockers(
      terminalEvent,
      nodeRuntimeResult,
    );
    const reasonCode = this.resolveNodeRuntimeReasonCode(
      terminalEvent,
      nodeRuntimeResult,
    );
    return this.buildResult({
      sessionId: session.session_id,
      terminalStatus: terminalEvent?.status || session.status,
      reasonCode,
      userMessage:
        terminalEvent?.status === 'completed'
          ? terminalEvent.message || 'Node Agent Runtime 任务执行完成'
          : terminalEvent?.status === 'cancelled'
            ? terminalEvent.message || 'Node Agent Runtime 任务被取消'
            : terminalEvent?.status === 'waiting_approval'
              ? terminalEvent.message || 'Node Agent Runtime 任务等待审批'
              : terminalEvent?.message || 'Node Agent Runtime 任务未完成',
      technicalMessage: terminalEvent?.message || undefined,
      blockers,
      evidence: this.collectNodeRuntimeEvidence(session.session_id, events),
      readback: this.extractRuntimeReadback(nodeRuntimeResult),
      result: nodeRuntimeResult,
      ...runtimeFields,
    });
  }

  // =========================================================================
  // isHealthy: 透传 Agent-S 健康检查
  // =========================================================================

  async isHealthy(): Promise<{ ok: boolean; details?: string }> {
    if (this.nodeAgentRuntime) {
      try {
        const health = await this.nodeAgentRuntime.health();
        const blockers = health.blockers || health.reasons || [];
        return {
          ok: health.ok === true,
          details: health.ok
            ? `node-agent-runtime status=${health.status} runner=${health.runner_mode} browserControl=${health.capabilities.browserControl}`
            : `node-agent-runtime blocked: ${blockers[0] || health.status}`,
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          details: `Node Agent Runtime health check threw: ${msg}`,
        };
      }
    }

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
    terminalEvent?: AgentSSidecarEvent;
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

          // 防御性：扫整个 batch 找 seq 最大的 terminal 事件
          // （不只看末位，事件可能不严格按 seq 单调或末位非 terminal）
          let terminalEvent: AgentSSidecarEvent | null = null;
          for (const event of page.events) {
            if (this.isTerminalStatus(event.status)) {
              if (
                !terminalEvent ||
                (event.seq ?? 0) > (terminalEvent.seq ?? 0)
              ) {
                terminalEvent = event;
              }
            }
          }
          if (terminalEvent) {
            return {
              status: terminalEvent.status,
              message: terminalEvent.message ?? undefined,
              evidence: this.collectEvidence(sessionId, collectedEvents),
              terminalEvent,
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
      status === 'blocked' ||
      status === 'cancelled' ||
      status === 'waiting_approval'
    );
  }

  private findLatestTerminalEvent(
    events: Array<AgentSSidecarEvent | NodeAgentRuntimeEvent>,
  ) {
    let terminalEvent: AgentSSidecarEvent | NodeAgentRuntimeEvent | null = null;
    for (const event of events) {
      if (this.isTerminalStatus(event.status)) {
        if (!terminalEvent || (event.seq ?? 0) > (terminalEvent.seq ?? 0)) {
          terminalEvent = event;
        }
      }
    }
    return terminalEvent;
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

  private collectNodeRuntimeEvidence(
    sessionId: string,
    events: AgentSSidecarEvent[],
  ): ExecutorEvidence[] {
    const evidence: ExecutorEvidence[] = [];
    try {
      const artifacts =
        this.nodeAgentRuntime!.getArtifacts(sessionId).artifacts;
      for (const artifact of artifacts) {
        const content = this.nodeAgentRuntime!.getArtifact(
          sessionId,
          artifact.artifact_id,
        ).content;
        const parsed = JSON.parse(content) as Record<string, unknown>;
        const screenshotPath = this.extractRuntimeScreenshotPath(parsed);
        if (screenshotPath) {
          evidence.push({
            type: 'screenshot',
            label: `Node Runtime 微信执行截图 ${artifact.artifact_id}`,
            path: screenshotPath,
            value: screenshotPath,
            createdAt: artifact.created_at,
            raw: {
              sessionId,
              artifactId: artifact.artifact_id,
              source: 'node-agent-runtime-artifact',
            },
          });
        }
      }
    } catch (error) {
      evidence.push({
        type: 'text',
        label: `Node Runtime session ${sessionId} artifact 读取失败`,
        value: error instanceof Error ? error.message : String(error),
        createdAt: new Date().toISOString(),
        raw: { sessionId, failurePhase: 'artifact-read' },
      });
    }
    return [...evidence, ...this.collectEvidence(sessionId, events)];
  }

  private readNodeRuntimeArtifactResult(sessionId: string) {
    try {
      const artifacts =
        this.nodeAgentRuntime!.getArtifacts(sessionId).artifacts;
      for (const artifact of artifacts) {
        const content = this.nodeAgentRuntime!.getArtifact(
          sessionId,
          artifact.artifact_id,
        ).content;
        const parsed = JSON.parse(content) as Record<string, unknown>;
        const result = this.readRecord(parsed.result);
        if (Object.keys(result).length) {
          return result;
        }
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  private extractRuntimeReadback(result?: Record<string, unknown>) {
    if (!result) return undefined;
    const nestedReadback = this.readRecord(result.readback);
    const readbackText = this.firstString(
      nestedReadback.actualText,
      nestedReadback.actual_text,
      result.readbackText,
      result.readback_text,
      result.readText,
      result.reply,
    );
    if (!readbackText) return undefined;
    return {
      expectedText:
        this.firstString(
          nestedReadback.expectedText,
          nestedReadback.expected_text,
          result.reply,
        ) || readbackText,
      actualText: readbackText,
      matched:
        typeof nestedReadback.matched === 'boolean'
          ? nestedReadback.matched
          : result.replyVisible === false
            ? false
            : true,
    };
  }

  private extractRuntimeInteractionFields(result?: Record<string, unknown>) {
    if (!result) return {};
    const sourceText = this.firstString(
      result.sourceText,
      result.source_text,
      result.targetText,
      result.target_text,
      result.readText,
      result.read_text,
    );
    const replyText = this.firstString(
      result.replyText,
      result.reply_text,
      result.reply,
    );
    const replyGeneratedBy = this.normalizeReplyGeneratedBy(
      result.replyGeneratedBy,
      result.generatedBy,
      result.generated_by,
    );
    return {
      sourceText,
      targetText: sourceText,
      replyText,
      replyGeneratedBy,
    };
  }

  private extractNodeRuntimeBlockers(
    terminalEvent?: AgentSSidecarEvent | NodeAgentRuntimeEvent | null,
    result?: Record<string, unknown>,
  ): string[] {
    const payload = this.readRecord(terminalEvent?.payload);
    return this.normalizeStringList(payload.blockers, result?.blockers);
  }

  private resolveNodeRuntimeReasonCode(
    terminalEvent?: AgentSSidecarEvent | NodeAgentRuntimeEvent | null,
    result?: Record<string, unknown>,
  ): ExecutorReasonCode | undefined {
    const payloadReason = this.firstString(
      this.readRecord(terminalEvent?.payload).reasonCode,
      result?.reasonCode,
      result?.reason_code,
    );
    return this.normalizeReasonCode(payloadReason);
  }

  private normalizeReasonCode(
    value: string | undefined,
  ): ExecutorReasonCode | undefined {
    const allowed: ExecutorReasonCode[] = [
      'success',
      'runtime_unavailable',
      'agent_s_unavailable',
      'account_not_logged_in',
      'captcha_required',
      'permission_missing',
      'review_required',
      'target_not_found',
      'send_failed',
      'readback_failed',
      'not_integrated',
      'platform_changed',
    ];
    return value && allowed.includes(value as ExecutorReasonCode)
      ? (value as ExecutorReasonCode)
      : undefined;
  }

  private normalizeReplyGeneratedBy(
    ...values: unknown[]
  ): RuntimeExecutionResult['replyGeneratedBy'] {
    const value = this.firstString(...values);
    return value === 'ai' || value === 'fallback' ? value : undefined;
  }

  private extractRuntimeScreenshotPath(content: Record<string, unknown>) {
    const result = this.readRecord(content.result);
    const direct = this.firstString(
      result.screenshotPath,
      result.screenshot_path,
    );
    if (direct) return direct;
    const results = Array.isArray(result.results) ? result.results : [];
    for (const item of results) {
      const targetResult = this.readRecord(item);
      const screenshotPath = this.firstString(
        targetResult.screenshotPath,
        targetResult.screenshot_path,
      );
      if (screenshotPath) return screenshotPath;
    }
    return undefined;
  }

  private readRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private firstString(...values: unknown[]) {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return undefined;
  }

  private normalizeStringList(...values: unknown[]) {
    return values.flatMap((value) => {
      if (Array.isArray(value)) {
        return value
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter(Boolean);
      }
      return typeof value === 'string' && value.trim() ? [value.trim()] : [];
    });
  }

  // =========================================================================
  // 私有：结果映射
  // =========================================================================

  private buildResult(opts: {
    sessionId: string;
    terminalStatus: AgentSTerminalStatus | 'blocked' | 'failed';
    reasonCode?: ExecutorReasonCode;
    userMessage: string;
    technicalMessage?: string;
    evidence: ExecutorEvidence[];
    blockers?: string[];
    readback?: RuntimeExecutionResult['readback'];
    sourceText?: string;
    targetText?: string;
    replyText?: string;
    replyGeneratedBy?: RuntimeExecutionResult['replyGeneratedBy'];
    result?: Record<string, unknown>;
  }): RuntimeExecutionResult {
    const isSuccess = opts.terminalStatus === 'completed';
    const isApprovalBlocked = opts.terminalStatus === 'waiting_approval';
    const isBlocked = isApprovalBlocked || opts.terminalStatus === 'blocked';

    return {
      ok: isSuccess,
      status: isSuccess ? 'success' : isBlocked ? 'blocked' : 'failed',
      reasonCode:
        opts.reasonCode ||
        (isSuccess
          ? 'success'
          : isApprovalBlocked
            ? 'review_required'
            : isBlocked
              ? 'runtime_unavailable'
              : 'send_failed'),
      userMessage: opts.userMessage,
      technicalMessage: opts.technicalMessage,
      runtime: {
        mode: 'agent-s',
        executor: 'desktop-agent-s',
        agentSSessionId: opts.sessionId,
      },
      evidence: opts.evidence,
      blockers: opts.blockers,
      readback: opts.readback,
      sourceText: opts.sourceText,
      targetText: opts.targetText,
      replyText: opts.replyText,
      replyGeneratedBy: opts.replyGeneratedBy,
      result: opts.result,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
