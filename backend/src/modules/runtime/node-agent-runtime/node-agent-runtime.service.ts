import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  LocalInteractionEngineClient,
  type LocalRuntimePreflightInput,
  type LocalRuntimePreflightResult,
} from '../../local-engine/local-interaction-engine.client';
import {
  PlatformInteractionExecutor,
  type PlatformDispatchResult,
} from '../../local-engine/platform-interaction-executor.service';
import {
  NODE_AGENT_RUNTIME_CONTRACT_VERSION,
  type NodeAgentRuntimeApprovalDecisionInput,
  type NodeAgentRuntimeArtifact,
  type NodeAgentRuntimeCreateSessionInput,
  type NodeAgentRuntimeEvent,
  type NodeAgentRuntimeHealth,
  type NodeAgentRuntimeRunTaskInput,
  type NodeAgentRuntimeSession,
} from './node-agent-runtime.contract';

type SupportedPlatform = LocalRuntimePreflightInput['platform'];
type InteractionTaskKind = NonNullable<LocalRuntimePreflightInput['taskType']>;
type RuntimeAction = 'preflight' | 'read' | 'draft' | 'send';

type StoredSession = NodeAgentRuntimeSession & {
  events: NodeAgentRuntimeEvent[];
  artifacts: NodeAgentRuntimeArtifact[];
  artifactContents: Map<string, string>;
  pendingRun?: {
    runId: string;
    input: NodeAgentRuntimeRunTaskInput;
    instruction: string;
  } | null;
};

type RuntimeContext =
  | {
      ok: true;
      platform: SupportedPlatform;
      accountId: string | number;
      taskType: InteractionTaskKind;
      action: RuntimeAction;
      targetText?: string;
      replyText?: string;
      limit?: number;
    }
  | {
      ok: false;
      blockers: string[];
      nextAction: string;
      platform?: string;
      accountId?: string | number | null;
      taskType?: string | null;
      action?: string | null;
    };

type RuntimeExecution = {
  ok: boolean;
  status: 'completed' | 'failed';
  userMessage: string;
  technicalMessage?: string;
  browserExecution: boolean;
  context?: Record<string, unknown>;
  preflight?: LocalRuntimePreflightResult;
  result?: Record<string, unknown>;
  blockers: string[];
  nextAction?: string;
};

@Injectable()
export class NodeAgentRuntimeService {
  private readonly logger = new Logger(NodeAgentRuntimeService.name);
  private readonly sessions = new Map<string, StoredSession>();
  private readonly startedAt = Date.now();

  constructor(
    @Optional()
    private readonly interactionEngine?: LocalInteractionEngineClient,
    @Optional()
    private readonly interactionExecutor?: PlatformInteractionExecutor,
  ) {}

  async getStatus() {
    const health = await this.health();
    return {
      phase: health.ok
        ? 'ready'
        : health.status === 'blocked'
          ? 'error'
          : health.status,
      baseUrl: 'in-process://node-agent-runtime',
      connected: health.ok,
      canSpawn: false,
      spawnImplemented: false,
      lastSeenAt: new Date().toISOString(),
      lastError: health.ok
        ? undefined
        : health.reasons?.[0] || health.blockers?.[0] || health.nextAction,
      required: true,
      nextAction: health.nextAction,
      sidecar: {
        health,
        status: {
          state: health.status,
          version: health.version,
          pid: health.pid,
          runner_mode: health.runner_mode,
          session_count: this.sessions.size,
          uptime_ms: Date.now() - this.startedAt,
          running_session_count: Array.from(this.sessions.values()).filter(
            (session) => session.status === 'running',
          ).length,
          artifact_root: 'app-data://evidence',
        },
      },
    };
  }

  ensureRunning() {
    return this.getStatus();
  }

  async stop() {
    return {
      ...(await this.getStatus()),
      phase: 'stopped',
      connected: false,
    };
  }

  async health(): Promise<NodeAgentRuntimeHealth> {
    const disabled = false;
    if (!this.interactionEngine || !this.interactionExecutor) {
      const blockers = [
        !this.interactionEngine
          ? 'LocalInteractionEngineClient 未注入，包内 Agent-S 无法操作浏览器。'
          : '',
        !this.interactionExecutor
          ? 'PlatformInteractionExecutor 未注入，包内 Agent-S 无法执行真实读取、填入、发送和回读。'
          : '',
      ].filter(Boolean);
      return {
        ok: disabled,
        status: 'blocked',
        service: 'node-agent-runtime',
        version: NODE_AGENT_RUNTIME_CONTRACT_VERSION,
        pid: process.pid,
        runner_mode: 'node-playwright',
        checkedAt: new Date().toISOString(),
        capabilities: {
          browserControl: disabled,
          persistentProfiles: disabled,
          localQueue: true,
          evidenceStore: true,
          approvalGate: true,
        },
        blockers,
        reasons: blockers,
        nextAction:
          '检查 RuntimeModule/LocalEngineModule 注入，确保 NodeAgentRuntimeService 能访问 LocalBrowserEngine 和 PlatformInteractionExecutor。',
      };
    }

    try {
      const [engine, executor] = await Promise.all([
        this.interactionEngine.getHealth(),
        this.interactionExecutor.getStatus(),
      ]);
      if (engine.online === true) {
        const executorReady = executor.online === true;
        if (!executorReady) {
          const blockers = [
            executor.status || executor.service || '真实互动执行器未就绪',
          ];
          return {
            ok: disabled,
            status: 'blocked',
            service: 'node-agent-runtime',
            version: NODE_AGENT_RUNTIME_CONTRACT_VERSION,
            pid: process.pid,
            runner_mode: 'node-playwright',
            engineUrl: engine.engineUrl,
            checkedAt: new Date().toISOString(),
            capabilities: {
              browserControl: disabled,
              persistentProfiles: disabled,
              localQueue: true,
              evidenceStore: true,
              approvalGate: true,
            },
            blockers,
            reasons: blockers,
            warnings: [],
            nextAction:
              '检查包内 Playwright Chromium、@playwright/mcp、平台 profile 和真实互动执行器状态。',
          };
        }
        return {
          ok: true,
          status: 'ready',
          service: 'node-agent-runtime',
          version: NODE_AGENT_RUNTIME_CONTRACT_VERSION,
          pid: process.pid,
          runner_mode: 'node-playwright',
          engineUrl: engine.engineUrl,
          checkedAt: new Date().toISOString(),
          capabilities: {
            browserControl: true,
            persistentProfiles: true,
            localQueue: true,
            evidenceStore: true,
            approvalGate: true,
          },
          blockers: [],
          reasons: [],
          warnings: [
            'Agent-S 走包内 Node Runtime/CDP/Playwright；外部 17777 Python sidecar 不是必需实现。',
          ],
          nextAction: '',
        };
      }

      const blockers = [engine.status || engine.service || '本地浏览器引擎未就绪'];
      return {
        ok: disabled,
        status: 'blocked',
        service: 'node-agent-runtime',
        version: NODE_AGENT_RUNTIME_CONTRACT_VERSION,
        pid: process.pid,
        runner_mode: 'node-playwright',
        engineUrl: engine.engineUrl,
        checkedAt: new Date().toISOString(),
        capabilities: {
          browserControl: disabled,
          persistentProfiles: disabled,
          localQueue: true,
          evidenceStore: true,
          approvalGate: true,
        },
        blockers,
        reasons: blockers,
        warnings: [],
        nextAction: '检查包内 Playwright Chromium、profile 目录和 3011 本地 Runtime 日志。',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Node Agent Runtime health failed: ${message}`);
      return {
        ok: disabled,
        status: 'blocked',
        service: 'node-agent-runtime',
        version: NODE_AGENT_RUNTIME_CONTRACT_VERSION,
        pid: process.pid,
        runner_mode: 'node-playwright',
        checkedAt: new Date().toISOString(),
        capabilities: {
          browserControl: disabled,
          persistentProfiles: disabled,
          localQueue: true,
          evidenceStore: true,
          approvalGate: true,
        },
        blockers: [message],
        reasons: [message],
        nextAction: '检查包内 Playwright Chromium、profile 目录和 3011 本地 Runtime 日志。',
      };
    }
  }

  createSession(input: NodeAgentRuntimeCreateSessionInput): {
    session: NodeAgentRuntimeSession;
  } {
    const now = new Date().toISOString();
    const session: StoredSession = {
      session_id: `node-runtime-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      session_name: input.session_name || null,
      task_type: input.task_type || 'ops-workbench.task',
      status: 'idle',
      created_at: now,
      updated_at: now,
      completed_at: null,
      metadata: input.metadata || {},
      labels: ['node-agent-runtime', ...(input.labels || [])],
      run_count: 0,
      active_run_id: null,
      cancellation_requested: false,
      last_error: null,
      last_event_seq: 0,
      artifact_count: 0,
      events: [],
      artifacts: [],
      artifactContents: new Map<string, string>(),
      pendingRun: null,
    };

    this.pushEvent(session, {
      event_type: 'session_created',
      status: 'idle',
      message: 'Node Agent Runtime session created',
      payload: {
        contractVersion: NODE_AGENT_RUNTIME_CONTRACT_VERSION,
        mode: 'node-playwright',
      },
    });
    this.sessions.set(session.session_id, session);
    return { session: this.toPublicSession(session) };
  }

  async runTask(
    sessionId: string,
    input: NodeAgentRuntimeRunTaskInput,
  ): Promise<{
    accepted: boolean;
    session_id: string;
    run_id: string;
    status: string;
  }> {
    const session = this.requireSession(sessionId);
    const instruction =
      typeof input.instruction === 'string' && input.instruction.trim()
        ? input.instruction
        : '(empty instruction)';
    const now = new Date().toISOString();
    const runId = `node-runtime-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    session.status = input.requires_approval ? 'waiting_approval' : 'running';
    session.updated_at = now;
    session.completed_at = null;
    session.run_count += 1;
    session.active_run_id = runId;

    this.pushEvent(session, {
      event_type: 'task_started',
      status: session.status,
      run_id: runId,
      message: 'Node Agent Runtime accepted task',
      payload: {
        task_type: input.task_type || session.task_type,
        risk_level: input.risk_level || 'medium',
        requires_approval: input.requires_approval === true,
      },
    });

    if (input.requires_approval) {
      session.pendingRun = { runId, input, instruction };
      this.pushEvent(session, {
        event_type: 'approval_required',
        status: 'waiting_approval',
        run_id: runId,
        message: 'Task requires approval before browser execution',
        payload: { instructionPreview: instruction.slice(0, 240) },
      });
      return {
        accepted: true,
        session_id: sessionId,
        run_id: runId,
        status: session.status,
      };
    }

    await this.executeRun(session, runId, input, instruction);
    return {
      accepted: true,
      session_id: sessionId,
      run_id: runId,
      status: session.status,
    };
  }

  getEvents(sessionId: string, afterSeq?: number) {
    const session = this.requireSession(sessionId);
    const fromSeq = Number.isFinite(afterSeq) ? Number(afterSeq) : 0;
    const events = session.events.filter((event) => event.seq > fromSeq);
    return {
      session_id: sessionId,
      after_seq: fromSeq,
      next_seq: session.last_event_seq,
      events,
    };
  }

  cancelSession(sessionId: string) {
    const session = this.requireSession(sessionId);
    session.status = 'cancelled';
    session.cancellation_requested = true;
    session.pendingRun = null;
    session.updated_at = new Date().toISOString();
    session.completed_at = session.updated_at;
    this.pushEvent(session, {
      event_type: 'task_cancelled',
      status: 'cancelled',
      run_id: session.active_run_id,
      message: 'Node Agent Runtime session cancelled',
      payload: {},
    });
    return {
      session_id: sessionId,
      status: session.status,
      cancellation_requested: true,
    };
  }

  async approveSession(
    sessionId: string,
    input: NodeAgentRuntimeApprovalDecisionInput,
  ): Promise<{ session_id: string; status: string; decision: string }> {
    const session = this.requireSession(sessionId);
    const approved = input.decision === 'approved';
    session.updated_at = new Date().toISOString();

    if (!approved) {
      session.status = 'failed';
      session.completed_at = session.updated_at;
      session.last_error = input.comment || 'approval rejected';
      session.pendingRun = null;
      this.pushEvent(session, {
        event_type: 'task_failed',
        status: session.status,
        run_id: session.active_run_id,
        message: 'Node Agent Runtime task rejected',
        payload: { decision: input.decision, comment: input.comment || null },
      });
      return {
        session_id: sessionId,
        status: session.status,
        decision: input.decision,
      };
    }

    const pendingRun = session.pendingRun;
    if (!pendingRun) {
      session.status = 'failed';
      session.completed_at = new Date().toISOString();
      session.last_error = 'approval accepted but no pending browser task exists';
      this.pushEvent(session, {
        event_type: 'task_failed',
        status: session.status,
        run_id: session.active_run_id,
        message: 'Approved task cannot continue because pending run is missing',
        payload: { decision: input.decision, comment: input.comment || null },
      });
      return {
        session_id: sessionId,
        status: session.status,
        decision: input.decision,
      };
    }

    session.pendingRun = null;
    session.status = 'running';
    this.pushEvent(session, {
      event_type: 'tool_call_started',
      status: 'running',
      run_id: pendingRun.runId,
      message: 'Approval accepted; starting browser execution',
      payload: { decision: input.decision, comment: input.comment || null },
    });
    await this.executeRun(
      session,
      pendingRun.runId,
      pendingRun.input,
      pendingRun.instruction,
    );
    return {
      session_id: sessionId,
      status: session.status,
      decision: input.decision,
    };
  }

  getArtifacts(sessionId: string): {
    session_id: string;
    artifacts: NodeAgentRuntimeArtifact[];
  } {
    const session = this.requireSession(sessionId);
    return {
      session_id: sessionId,
      artifacts: session.artifacts,
    };
  }

  getArtifact(sessionId: string, artifactId: string): {
    artifact: NodeAgentRuntimeArtifact;
    content: string;
  } {
    const session = this.requireSession(sessionId);
    const artifact = session.artifacts.find(
      (item) => item.artifact_id === artifactId,
    );
    if (!artifact) {
      throw new Error(`Node Agent Runtime artifact not found: ${artifactId}`);
    }
    return {
      artifact,
      content:
        session.artifactContents.get(artifactId) ||
        JSON.stringify({ artifact }, null, 2),
    };
  }

  private async executeRun(
    session: StoredSession,
    runId: string,
    input: NodeAgentRuntimeRunTaskInput,
    instruction: string,
  ) {
    session.status = 'running';
    session.updated_at = new Date().toISOString();
    this.pushEvent(session, {
      event_type: 'tool_call_started',
      status: 'running',
      run_id: runId,
      message: 'Node Agent Runtime browser execution started',
      payload: {
        task_type: input.task_type || session.task_type,
        action: input.action || this.readRecord(input.metadata).action || null,
      },
    });

    const result = await this.performBrowserExecution(session, input);
    const artifact = this.createExecutionArtifact(
      session,
      runId,
      input,
      instruction,
      result,
    );
    session.artifacts.push(artifact);
    session.artifact_count = session.artifacts.length;
    session.artifactContents.set(
      artifact.artifact_id,
      JSON.stringify(
        {
          contractVersion: NODE_AGENT_RUNTIME_CONTRACT_VERSION,
          runId,
          instruction,
          ...result,
        },
        null,
        2,
      ),
    );

    this.pushEvent(session, {
      event_type: 'artifact_created',
      status: 'running',
      run_id: runId,
      artifact_id: artifact.artifact_id,
      message: 'Node Agent Runtime execution evidence created',
      payload: {
        artifactKind: artifact.kind,
        filename: artifact.filename,
        browserExecution: result.browserExecution,
      },
    });

    session.status = result.status;
    session.updated_at = new Date().toISOString();
    session.completed_at = session.updated_at;
    session.last_error = result.ok ? null : result.userMessage;
    this.pushEvent(session, {
      event_type: result.ok ? 'task_completed' : 'task_failed',
      status: session.status,
      run_id: runId,
      message: result.userMessage,
      payload: {
        technicalMessage: result.technicalMessage || null,
        blockers: result.blockers,
        nextAction: result.nextAction || null,
        browserExecution: result.browserExecution,
      },
    });
  }

  private async performBrowserExecution(
    session: StoredSession,
    input: NodeAgentRuntimeRunTaskInput,
  ): Promise<RuntimeExecution> {
    if (!this.interactionEngine) {
      return this.failedExecution(
        'LocalInteractionEngineClient 未注入，包内 Agent-S 无法操作浏览器。',
        '检查 RuntimeModule/LocalEngineModule 注入。',
        [],
      );
    }

    const context = this.resolveRuntimeContext(session, input);
    if (!context.ok) {
      return this.failedExecution(
        context.blockers[0] || '缺少平台执行上下文。',
        context.nextAction,
        context.blockers,
        {
          platform: context.platform || null,
          accountId: context.accountId || null,
          taskType: context.taskType || null,
          action: context.action || null,
        },
      );
    }

    const preflight = await this.interactionEngine.preflightCheck({
      platform: context.platform,
      accountId: context.accountId,
      taskType: context.taskType,
    });
    const baseContext = {
      platform: context.platform,
      accountId: context.accountId,
      taskType: context.taskType,
      action: context.action,
    };
    if (!preflight.ok) {
      return {
        ok: false,
        status: 'failed',
        userMessage: preflight.message || '平台浏览器预检未通过。',
        technicalMessage: preflight.blockers.join('; '),
        browserExecution: true,
        context: baseContext,
        preflight,
        blockers: preflight.blockers,
        nextAction: preflight.nextAction,
      };
    }

    if (context.action === 'preflight') {
      return {
        ok: true,
        status: 'completed',
        userMessage: 'Node Agent Runtime 已完成真实浏览器预检。',
        browserExecution: true,
        context: baseContext,
        preflight,
        blockers: [],
        nextAction: preflight.nextAction,
      };
    }

    if (!this.interactionExecutor) {
      return {
        ok: false,
        status: 'failed',
        userMessage: 'PlatformInteractionExecutor 未注入，不能执行读取或发送。',
        technicalMessage: 'NodeAgentRuntimeService 缺少 PlatformInteractionExecutor provider。',
        browserExecution: true,
        context: baseContext,
        preflight,
        blockers: ['PlatformInteractionExecutor 未注入。'],
        nextAction: '检查 LocalEngineModule exports 和 RuntimeModule imports。',
      };
    }

    if (context.action === 'read') {
      const readResult = await this.interactionExecutor.read({
        platform: context.platform,
        accountId: context.accountId,
        taskType: context.taskType,
        limit: context.limit,
      });
      const readStatus = String(readResult.status || '');
      const readOk =
        !['failed', 'account_not_logged_in', 'comment_page_not_ready'].includes(
          readStatus,
        );
      return {
        ok: readOk,
        status: readOk ? 'completed' : 'failed',
        userMessage: readOk
          ? 'Node Agent Runtime 已完成真实读取。'
          : String(readResult.message || '真实读取失败。'),
        technicalMessage: readOk ? undefined : JSON.stringify(readResult).slice(0, 2000),
        browserExecution: true,
        context: baseContext,
        preflight,
        result: readResult,
        blockers: readOk ? [] : [String(readResult.message || readStatus)],
        nextAction: readOk
          ? undefined
          : String(readResult.nextAction || '检查平台登录态、页面入口和浏览器执行日志。'),
      };
    }

    if (!context.targetText || !context.replyText) {
      return {
        ok: false,
        status: 'failed',
        userMessage: '发送/草稿任务缺少目标文本或回复文本，已阻断。',
        technicalMessage: 'targetText/replyText is required for draft/send.',
        browserExecution: true,
        context: baseContext,
        preflight,
        blockers: ['缺少 targetText 或 replyText。'],
        nextAction: '从互动任务 payload 传入目标评论/会话文本和要发送的回复文本。',
      };
    }

    const dispatchResult = await this.interactionExecutor.dispatch({
      platform: context.platform,
      accountId: context.accountId,
      taskType: context.taskType,
      action: context.action,
      targetText: context.targetText,
      replyText: context.replyText,
    });
    return this.mapDispatchResult(baseContext, preflight, dispatchResult);
  }

  private mapDispatchResult(
    context: Record<string, unknown>,
    preflight: LocalRuntimePreflightResult,
    result: PlatformDispatchResult,
  ): RuntimeExecution {
    const ok =
      result.status === 'sent' ||
      result.status === 'draft_filled';
    return {
      ok,
      status: ok ? 'completed' : 'failed',
      userMessage: ok
        ? result.message || 'Node Agent Runtime 已完成真实互动执行。'
        : result.message || 'Node Agent Runtime 真实互动执行失败。',
      technicalMessage: ok ? undefined : result.status,
      browserExecution: true,
      context,
      preflight,
      result: {
        status: result.status,
        message: result.message,
        evidencePath: result.evidencePath,
        evidenceUrl: result.evidenceUrl,
        readbackText: result.readbackText,
        replyVisible: result.replyVisible,
        profileKey: result.profileKey,
        profileDir: result.profileDir,
        visibleWindow: result.visibleWindow,
      },
      blockers: ok ? [] : [result.message || result.status],
      nextAction: result.nextAction,
    };
  }

  private failedExecution(
    message: string,
    nextAction: string,
    blockers: string[],
    context?: Record<string, unknown>,
  ): RuntimeExecution {
    return {
      ok: false,
      status: 'failed',
      userMessage: message,
      browserExecution: Boolean(context?.executionStarted),
      context,
      blockers: blockers.length ? blockers : [message],
      nextAction,
    };
  }

  private resolveRuntimeContext(
    session: StoredSession,
    input: NodeAgentRuntimeRunTaskInput,
  ): RuntimeContext {
    const sessionMetadata = this.readRecord(session.metadata);
    const inputMetadata = this.readRecord(input.metadata);
    const platformRaw = this.firstString(
      input.platform,
      inputMetadata.platform,
      inputMetadata.targetPlatform,
      sessionMetadata.platform,
      sessionMetadata.targetPlatform,
    );
    const platform = this.normalizePlatform(platformRaw);
    const accountId = this.firstPresent(
      input.accountId,
      inputMetadata.accountId,
      inputMetadata.platformAccountId,
      sessionMetadata.accountId,
      sessionMetadata.platformAccountId,
    );
    const taskType = this.normalizeTaskType(
      this.firstString(
        input.taskType,
        input.task_type,
        inputMetadata.taskType,
        inputMetadata.task_type,
        inputMetadata.interactionTaskType,
        session.task_type,
      ),
    );
    const action = this.normalizeAction(
      this.firstString(
        input.action,
        inputMetadata.action,
        inputMetadata.sendMode,
        inputMetadata.mode,
      ),
    );
    const targetText = this.firstString(
      inputMetadata.targetText,
      inputMetadata.target_text,
      inputMetadata.commentText,
      inputMetadata.messageText,
      inputMetadata.sourceText,
      inputMetadata.target,
    );
    const replyText = this.firstString(
      inputMetadata.replyText,
      inputMetadata.reply_text,
      inputMetadata.responseText,
      inputMetadata.content,
      inputMetadata.text,
    );
    const limit = this.normalizeLimit(inputMetadata.limit);

    const blockers: string[] = [];
    if (!platform) {
      blockers.push(
        platformRaw
          ? `平台 ${platformRaw} 尚未接入 Node Agent Runtime 真实互动执行。`
          : '缺少平台参数 platform。',
      );
    }
    if (accountId === undefined || accountId === null || accountId === '') {
      blockers.push('缺少平台账号 accountId。');
    }
    if (!taskType) {
      blockers.push('缺少互动任务类型 taskType/comment-message。');
    }

    if (blockers.length) {
      return {
        ok: false,
        blockers,
        nextAction:
          '调用 /api/agent-s/sessions/:id/run 时传入 platform、accountId、taskType；发送类动作还要传 targetText/replyText。',
        platform: platformRaw,
        accountId: accountId as string | number | null,
        taskType,
        action,
      };
    }

    const supportedPlatform = platform as SupportedPlatform;
    const supportedTaskType = taskType as InteractionTaskKind;

    return {
      ok: true,
      platform: supportedPlatform,
      accountId: accountId as string | number,
      taskType: supportedTaskType,
      action,
      targetText,
      replyText,
      limit,
    };
  }

  private normalizePlatform(value?: string): SupportedPlatform | null {
    const normalized = (value || '').trim().toLowerCase();
    if (!normalized) return null;
    if (['douyin', '抖音'].includes(normalized)) return 'douyin';
    if (
      [
        'wechat-channel',
        'wechat_channel',
        'wechat-channel-platform',
        'channels',
        'video-channel',
        '视频号',
      ].includes(normalized)
    ) {
      return 'wechat-channel';
    }
    return null;
  }

  private normalizeTaskType(value?: string | null): InteractionTaskKind | null {
    const normalized = (value || '').trim().toLowerCase();
    if (!normalized) return null;
    if (
      normalized.includes('message') ||
      normalized.includes('private') ||
      normalized.includes('dm') ||
      normalized.includes('私信')
    ) {
      return 'direct-message-reply';
    }
    if (normalized.includes('comment') || normalized.includes('评论') || normalized.includes('留言')) {
      return 'comment-reply';
    }
    return null;
  }

  private normalizeAction(value?: string | null): RuntimeAction {
    const normalized = (value || '').trim().toLowerCase();
    if (['read', '读取', 'scan'].includes(normalized)) return 'read';
    if (['draft', 'draft-only', '草稿'].includes(normalized)) return 'draft';
    if (['send', 'auto-send', '发送'].includes(normalized)) return 'send';
    return 'preflight';
  }

  private normalizeLimit(value: unknown): number | undefined {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return undefined;
    return Math.max(1, Math.min(50, Math.floor(numeric)));
  }

  private readRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private firstString(...values: unknown[]): string | undefined {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) return value.trim();
      if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    }
    return undefined;
  }

  private firstPresent(...values: unknown[]): unknown {
    return values.find(
      (value) => value !== undefined && value !== null && value !== '',
    );
  }

  private requireSession(sessionId: string): StoredSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Node Agent Runtime session not found: ${sessionId}`);
    }
    return session;
  }

  private pushEvent(
    session: StoredSession,
    event: Omit<NodeAgentRuntimeEvent, 'seq' | 'session_id' | 'created_at'>,
  ) {
    const nextSeq = session.last_event_seq + 1;
    session.last_event_seq = nextSeq;
    session.events.push({
      seq: nextSeq,
      session_id: session.session_id,
      created_at: new Date().toISOString(),
      step_index: null,
      artifact_id: null,
      ...event,
    });
  }

  private createExecutionArtifact(
    session: StoredSession,
    runId: string,
    input: NodeAgentRuntimeRunTaskInput,
    instruction: string,
    result: RuntimeExecution,
  ): NodeAgentRuntimeArtifact {
    const now = new Date().toISOString();
    const sizeBytes = Buffer.byteLength(
      JSON.stringify({ input, instruction, result }),
      'utf8',
    );
    return {
      artifact_id: `node-runtime-artifact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      session_id: session.session_id,
      run_id: runId,
      kind: 'json',
      filename: `${session.session_id}-${runId}-execution.json`,
      path: `memory://${session.session_id}/${runId}-execution.json`,
      created_at: now,
      size_bytes: sizeBytes,
      metadata: {
        contractVersion: NODE_AGENT_RUNTIME_CONTRACT_VERSION,
        task_type: input.task_type || session.task_type,
        status: result.status,
        ok: result.ok,
        browserExecution: result.browserExecution,
        platform: result.context?.platform || null,
        accountId: result.context?.accountId || null,
        action: result.context?.action || null,
      },
    };
  }

  private toPublicSession(session: StoredSession): NodeAgentRuntimeSession {
    const { events, artifacts, artifactContents, pendingRun, ...publicSession } =
      session;
    void events;
    void artifacts;
    void artifactContents;
    void pendingRun;
    return publicSession;
  }
}
