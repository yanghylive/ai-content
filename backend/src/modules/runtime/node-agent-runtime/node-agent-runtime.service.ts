import { Injectable, Logger, Optional } from '@nestjs/common';
import { spawn } from 'child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  LocalInteractionEngineClient,
  type LocalRuntimePreflightInput,
  type LocalRuntimePreflightResult,
} from '../../local-engine/local-interaction-engine.client';
import { AiClientService } from '../../ai-models/ai-client.service';
import { DefaultModelsService } from '../../ai-models/default-models.service';
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
  lastExecutionReasonCode?: RuntimeExecution['reasonCode'];
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
  status: 'completed' | 'failed' | 'blocked';
  reasonCode?:
    | 'runtime_unavailable'
    | 'target_not_found'
    | 'send_failed'
    | 'review_required'
    | 'not_integrated';
  userMessage: string;
  technicalMessage?: string;
  browserExecution: boolean;
  context?: Record<string, unknown>;
  preflight?: LocalRuntimePreflightResult;
  result?: Record<string, unknown>;
  blockers: string[];
  nextAction?: string;
};

type WechatCommandResult = {
  screenshotPath?: string;
  reply?: string;
  readText?: string;
  sourceText?: string;
  generatedBy?: 'ai' | 'fallback';
  message?: string;
  contact?: string;
  target?: string;
  mode?: string;
  status?: string;
  errorCode?: string;
  nextAction?: string;
  raw?: Record<string, unknown>;
};

class WechatCommandError extends Error {
  constructor(
    message: string,
    readonly result: WechatCommandResult = {},
  ) {
    super(message);
    this.name = 'WechatCommandError';
  }
}

@Injectable()
export class NodeAgentRuntimeService {
  private readonly logger = new Logger(NodeAgentRuntimeService.name);
  private readonly sessions = new Map<string, StoredSession>();
  private readonly startedAt = Date.now();
  private readonly evidenceRootPath: string;
  private readonly evidenceStoreReady: boolean;

  constructor(
    @Optional()
    private readonly interactionEngine?: LocalInteractionEngineClient,
    @Optional()
    private readonly interactionExecutor?: PlatformInteractionExecutor,
    @Optional()
    private readonly aiClient?: AiClientService,
    @Optional()
    private readonly defaultModels?: DefaultModelsService,
  ) {
    const configuredRoot = process.env.NODE_AGENT_RUNTIME_EVIDENCE_ROOT?.trim();
    const userDataRoot = process.env.KAYPAL_DESKTOP_USER_DATA_DIR?.trim();
    this.evidenceRootPath =
      configuredRoot ||
      join(
        userDataRoot || join(homedir(), '.workbuddy', 'ai-content-runtime'),
        'agent-s-evidence',
      );
    try {
      mkdirSync(join(this.evidenceRootPath, 'sessions'), {
        recursive: true,
        mode: 0o700,
      });
      mkdirSync(join(this.evidenceRootPath, 'artifacts'), {
        recursive: true,
        mode: 0o700,
      });
      const probePath = join(
        this.evidenceRootPath,
        `.write-probe-${process.pid}`,
      );
      writeFileSync(probePath, 'ok', { encoding: 'utf8', mode: 0o600 });
      rmSync(probePath, { force: true });
      this.evidenceStoreReady = true;
    } catch (error) {
      this.evidenceStoreReady = false;
      this.logger.warn(
        `Agent-S evidence store unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getStatus() {
    const health = await this.health();
    // The packaged runtime creates execution sessions in-process.  Keep the
    // legacy Agent-S field names for API compatibility, but report their
    // meaning from the real session implementation rather than claiming that
    // an external sidecar process was spawned.
    const runtimeImplemented = true;
    const runtimeReady = health.ok === true;
    return {
      phase: health.ok
        ? 'ready'
        : health.status === 'blocked'
          ? 'error'
          : health.status,
      baseUrl: 'in-process://node-agent-runtime',
      connected: health.ok,
      canSpawn: runtimeReady,
      spawnImplemented: runtimeImplemented,
      executionMode: 'in-process-node-playwright',
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
          artifact_root: this.evidenceRootPath,
        },
      },
    };
  }

  ensureRunning() {
    return this.getStatus();
  }

  async stop() {
    for (const session of this.sessions.values()) {
      if (!session.active_run_id && session.status !== 'waiting_approval')
        continue;
      const runId = session.active_run_id;
      session.cancellation_requested = true;
      session.pendingRun = null;
      session.status = 'cancelled';
      session.active_run_id = null;
      session.updated_at = new Date().toISOString();
      session.completed_at = session.updated_at;
      this.pushEvent(session, {
        event_type: 'task_cancelled',
        status: 'cancelled',
        run_id: runId,
        message: '3011 正在停止，未完成的 Agent-S 任务已取消。',
        payload: { reasonCode: 'runtime_unavailable' },
      });
    }
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
          evidenceStore: this.evidenceStoreReady,
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
              evidenceStore: this.evidenceStoreReady,
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
            evidenceStore: this.evidenceStoreReady,
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

      const blockers = [
        engine.status || engine.service || '本地浏览器引擎未就绪',
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
          evidenceStore: this.evidenceStoreReady,
          approvalGate: true,
        },
        blockers,
        reasons: blockers,
        warnings: [],
        nextAction:
          '检查包内 Playwright Chromium、profile 目录和 3011 本地 Runtime 日志。',
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
          evidenceStore: this.evidenceStoreReady,
          approvalGate: true,
        },
        blockers: [message],
        reasons: [message],
        nextAction:
          '检查包内 Playwright Chromium、profile 目录和 3011 本地 Runtime 日志。',
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

    this.sessions.set(session.session_id, session);
    this.pushEvent(session, {
      event_type: 'session_created',
      status: 'idle',
      message: 'Node Agent Runtime session created',
      payload: {
        contractVersion: NODE_AGENT_RUNTIME_CONTRACT_VERSION,
        mode: 'node-playwright',
      },
    });
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
    reasonCode?: RuntimeExecution['reasonCode'];
  }> {
    const session = this.requireSession(sessionId);
    if (session.active_run_id) {
      return {
        accepted: false,
        session_id: sessionId,
        run_id: session.active_run_id,
        status: session.status,
        reasonCode: 'review_required',
      };
    }
    const instruction =
      typeof input.instruction === 'string' && input.instruction.trim()
        ? input.instruction
        : '(empty instruction)';
    const now = new Date().toISOString();
    const runId = `node-runtime-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const localSkillId = this.resolveWechatSkillId(session, input);
    const waitForRuntimeApproval =
      input.requires_approval === true && !localSkillId;
    session.status = waitForRuntimeApproval ? 'waiting_approval' : 'running';
    session.updated_at = now;
    session.completed_at = null;
    session.run_count += 1;
    session.active_run_id = runId;
    session.cancellation_requested = false;

    this.pushEvent(session, {
      event_type: 'task_started',
      status: session.status,
      run_id: runId,
      message: 'Node Agent Runtime accepted task',
      payload: {
        task_type: input.task_type || session.task_type,
        risk_level: input.risk_level || 'medium',
        requires_approval: input.requires_approval === true,
        approval_handled_by_desktop_script:
          input.requires_approval === true && Boolean(localSkillId),
        skill_id: localSkillId,
      },
    });

    if (waitForRuntimeApproval) {
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
      reasonCode: session.lastExecutionReasonCode,
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
    const activeRunId = session.active_run_id;
    const waitingForApproval = session.status === 'waiting_approval';
    session.status = 'cancelled';
    session.cancellation_requested = true;
    session.pendingRun = null;
    session.updated_at = new Date().toISOString();
    session.completed_at = session.updated_at;
    if (waitingForApproval) session.active_run_id = null;
    this.pushEvent(session, {
      event_type: 'task_cancelled',
      status: 'cancelled',
      run_id: activeRunId,
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
      session.active_run_id = null;
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
      session.last_error =
        'approval accepted but no pending browser task exists';
      session.active_run_id = null;
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

  getArtifact(
    sessionId: string,
    artifactId: string,
  ): {
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
        this.readArtifactContent(artifact) ||
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
    const localSkillId = this.resolveWechatSkillId(session, input);
    this.pushEvent(session, {
      event_type: 'tool_call_started',
      status: 'running',
      run_id: runId,
      message: localSkillId
        ? 'Node Agent Runtime desktop WeChat execution started'
        : 'Node Agent Runtime browser execution started',
      payload: {
        task_type: input.task_type || session.task_type,
        skill_id: localSkillId,
        action: input.action || this.readRecord(input.metadata).action || null,
      },
    });

    let result: RuntimeExecution;
    try {
      result = session.cancellation_requested
        ? this.cancelledExecution()
        : localSkillId
          ? await this.performWechatDesktopExecution(
              session,
              input,
              localSkillId,
            )
          : await this.performBrowserExecution(session, input, runId);
    } catch (error) {
      const cancelled = session.cancellation_requested;
      session.status = cancelled ? 'cancelled' : 'failed';
      session.updated_at = new Date().toISOString();
      session.completed_at = session.updated_at;
      session.last_error = cancelled
        ? '任务已取消，浏览器执行被中止。'
        : error instanceof Error
          ? error.message
          : String(error);
      session.lastExecutionReasonCode = cancelled
        ? 'review_required'
        : 'runtime_unavailable';
      if (session.active_run_id === runId) session.active_run_id = null;
      this.pushEvent(session, {
        event_type: cancelled ? 'task_cancelled' : 'task_failed',
        status: session.status,
        run_id: runId,
        message: session.last_error,
        payload: {
          reasonCode: session.lastExecutionReasonCode,
          technicalMessage: cancelled ? undefined : session.last_error,
        },
      });
      if (!cancelled) throw error;
      return;
    }
    if (session.cancellation_requested && result.ok) {
      result = this.cancelledExecution();
    }
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
    artifact.path = this.persistArtifactContent(
      session,
      artifact,
      session.artifactContents.get(artifact.artifact_id) || '',
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

    const cancelled = session.cancellation_requested === true;
    session.status = cancelled ? 'cancelled' : result.status;
    session.updated_at = new Date().toISOString();
    session.completed_at = session.updated_at;
    session.last_error = result.ok ? null : result.userMessage;
    session.lastExecutionReasonCode = cancelled
      ? 'review_required'
      : result.reasonCode;
    if (session.active_run_id === runId) session.active_run_id = null;
    this.pushEvent(session, {
      event_type: cancelled
        ? 'task_cancelled'
        : result.ok
          ? 'task_completed'
          : 'task_failed',
      status: session.status,
      run_id: runId,
      message: result.userMessage,
      payload: {
        reasonCode: result.reasonCode || null,
        technicalMessage: result.technicalMessage || null,
        blockers: result.blockers,
        nextAction: result.nextAction || null,
        browserExecution: result.browserExecution,
      },
    });
  }

  private resolveWechatSkillId(
    session: StoredSession,
    input: NodeAgentRuntimeRunTaskInput,
  ): string | null {
    const sessionMetadata = this.readRecord(session.metadata);
    const inputMetadata = this.readRecord(input.metadata);
    const skillId = this.firstString(
      inputMetadata.skill_id,
      sessionMetadata.skill_id,
      input.task_type,
      session.task_type,
    );
    if (!skillId) return null;
    const normalized = this.normalizeWechatSkillId(skillId);
    return normalized && this.isWechatSkillId(normalized) ? normalized : null;
  }

  private normalizeWechatSkillId(skillId: string): string | null {
    const normalized = String(skillId || '').trim();
    const aliases: Record<string, string> = {
      'wechat-reply-draft': 'wechat.session.auto_reply',
      'wechat-friend-accept': 'wechat.friend.accept',
      'wechat-group-broadcast': 'wechat-group-broadcast',
      'wechat-contact-add': 'wechat-contact-add',
      'wechat-moments-publish': 'wechat-moments-publish',
      'wechat-moments-marketing': 'wechat-moments-marketing',
      'wechat-chat-sync': 'wechat-chat-sync',
      'wechat-chat-history': 'wechat-chat-sync',
      'chat-history': 'wechat-chat-sync',
      WECHAT_REPLY_DRAFT: 'wechat.session.auto_reply',
      WECHAT_FRIEND_ACCEPT: 'wechat.friend.accept',
      WECHAT_GROUP_BROADCAST: 'wechat-group-broadcast',
      WECHAT_CONTACT_ADD: 'wechat-contact-add',
      WECHAT_MOMENTS_PUBLISH: 'wechat-moments-publish',
      WECHAT_MOMENTS_MARKETING: 'wechat-moments-marketing',
      WECHAT_CHAT_SYNC: 'wechat-chat-sync',
      WECHAT_CHAT_HISTORY: 'wechat-chat-sync',
    };
    return aliases[normalized] || normalized || null;
  }

  private isWechatSkillId(skillId: string): boolean {
    return [
      'wechat.live.auto_reply',
      'wechat.session.auto_reply',
      'wechat.friend.accept',
      'wechat.group.broadcast',
      'wechat.moments.publish',
      'wechat.contact.add',
      'wechat.moments.marketing',
      'wechat-group-broadcast',
      'wechat-friend-accept',
      'wechat-moments-publish',
      'wechat-contact-add',
      'wechat-moments-marketing',
      'wechat-chat-sync',
    ].includes(skillId);
  }

  private resolveWindowsWechatNativeCommandBlocker(skillId: string): {
    command: string;
    message: string;
    nextAction: string;
  } | null {
    if (process.platform !== 'win32') {
      return null;
    }
    const blockedCommands: Record<string, string> = {
      'wechat.group.broadcast': 'group-broadcast',
      'wechat-group-broadcast': 'group-broadcast',
      'wechat.contact.add': 'contact-add',
      'wechat-contact-add': 'contact-add',
      'wechat.friend.accept': 'friend-accept',
      'wechat-friend-accept': 'friend-accept',
      'wechat.moments.publish': 'moments-publish',
      'wechat-moments-publish': 'moments-publish',
      'wechat.moments.marketing': 'moments-marketing',
      'wechat-moments-marketing': 'moments-marketing',
      'wechat-chat-sync': 'chat-history',
    };
    const command = blockedCommands[skillId];
    if (!command) {
      return null;
    }
    return {
      command,
      message: `当前 Windows 环境不支持这项微信操作（${command}），本次没有执行。`,
      nextAction: '请改用已支持的电脑环境，或由人工在微信中完成并核对结果。',
    };
  }

  private async performWechatDesktopExecution(
    session: StoredSession,
    input: NodeAgentRuntimeRunTaskInput,
    skillId: string,
  ): Promise<RuntimeExecution> {
    if (session.cancellation_requested) {
      return this.cancelledExecution();
    }
    const metadata = {
      ...this.readRecord(session.metadata),
      ...this.readRecord(input.metadata),
    };
    const mode =
      this.firstString(metadata.wechat_reply_mode) === 'auto-send'
        ? 'auto-send'
        : 'approval';
    const context = {
      platform: 'wechat-desktop',
      skillId,
      mode,
    };
    const windowsBlocker =
      this.resolveWindowsWechatNativeCommandBlocker(skillId);
    if (windowsBlocker) {
      return this.blockedExecution(
        windowsBlocker.message,
        windowsBlocker.nextAction,
        [windowsBlocker.message],
        {
          ...context,
          command: windowsBlocker.command,
          platform: process.platform,
        },
        {
          status: 'blocked',
          errorCode: 'not_integrated',
          nextAction: windowsBlocker.nextAction,
          message: windowsBlocker.message,
        },
        'not_integrated',
      );
    }

    if (
      skillId === 'wechat.friend.accept' ||
      skillId === 'wechat-friend-accept'
    ) {
      return this.blockedExecution(
        '通过好友计划已保存，当前不会操作微信。',
        '请在计划中核对筛选条件、备注和欢迎语，并由人工处理好友申请。',
        ['当前仅支持保存和审核通过好友计划。'],
        { ...context, executionStarted: false },
        {
          status: 'blocked',
          errorCode: 'not_integrated',
          registrationOnly: true,
        },
        'not_integrated',
      );
    }

    const customerServiceDecision = this.readRecord(
      metadata.customerServiceDecision,
    );
    if (
      metadata.customerServiceNoReply === true ||
      customerServiceDecision.action === 'no-reply'
    ) {
      return this.blockedExecution(
        '当前客服规则要求不自动回复，本次没有发送。',
        this.firstString(customerServiceDecision.reason) ||
          '请转人工处理当前客户问题。',
        ['客服规则命中不回复条件。'],
        context,
        { customerServiceDecision },
        'review_required',
      );
    }
    const customerServiceNotBefore = this.firstString(
      metadata.customerServiceNotBefore,
    );
    if (
      customerServiceNotBefore &&
      Date.parse(customerServiceNotBefore) > Date.now()
    ) {
      return this.blockedExecution(
        '当前回复仍在等待设定的回复时间，本次没有发送。',
        `请在 ${customerServiceNotBefore} 之后执行。`,
        ['客服回复延时尚未结束。'],
        context,
        { notBefore: customerServiceNotBefore },
        'review_required',
      );
    }

    try {
      if (skillId === 'wechat-chat-sync') {
        const sessionId =
          this.firstString(
            metadata.wechat_chat_session_id,
            metadata.sessionId,
          ) || '';
        const limit = this.normalizePositiveInteger(
          metadata.wechat_chat_history_limit,
          100,
          200,
        );
        const args = [
          ...(sessionId ? ['--session-id', sessionId] : []),
          '--limit',
          String(limit),
        ];
        const result = await this.runWechatCommandForSession(
          session,
          'wechat-chat-history',
          args,
          '微信聊天记录同步超时',
          180000,
        );
        const messages = Array.isArray(result.raw?.messages)
          ? result.raw.messages
          : [];
        const readText = messages
          .map((item) =>
            this.firstString(
              item && typeof item === 'object'
                ? (item as Record<string, unknown>).content
                : item,
            ),
          )
          .filter(Boolean)
          .slice(-20)
          .join('\n');
        return this.completedWechatExecution(
          `已同步当前微信会话 ${messages.length} 条可见消息。`,
          { ...context, sessionId: sessionId || undefined },
          {
            ...result,
            readText: readText || result.message,
          },
        );
      }

      if (skillId === 'wechat.live.auto_reply') {
        const contextNote =
          this.firstString(metadata.wechat_context_note) || '';
        this.pushEvent(session, {
          event_type: 'tool_call_started',
          status: 'running',
          run_id: session.active_run_id,
          message: '正在读取当前微信会话。',
          payload: { skill_id: skillId },
        });
        const readResult = await this.runWechatCommandForSession(
          session,
          'wechat-live-auto-reply',
          [contextNote, 'read-only'],
          'wechat-live-auto-reply 读取超时',
          90000,
        );
        const reply =
          this.firstString(metadata.wechat_reply_draft) ||
          this.buildWechatFallbackReply(readResult.readText || '', contextNote);
        const result = await this.runWechatCommandForSession(
          session,
          'wechat-live-auto-reply',
          [contextNote, 'auto-send', reply],
          'wechat-live-auto-reply 发送超时',
          90000,
        );
        return this.completedWechatExecution(
          '微信当前聊天已自动回复。',
          context,
          {
            reply: result.reply || reply,
            readText: readResult.readText || result.readText,
            screenshotPath: result.screenshotPath,
          },
        );
      }

      if (skillId === 'wechat.session.auto_reply') {
        const contact =
          this.firstString(
            metadata.wechat_contact_name,
            metadata.wechat_expected_contact_name,
          ) || '';
        if (!contact) {
          return this.failedExecution(
            '缺少微信联系人，不能执行微信回复。',
            '请传入 wechat_contact_name。',
            ['缺少联系人。'],
            context,
          );
        }
        this.pushEvent(session, {
          event_type: 'tool_call_started',
          status: 'running',
          run_id: session.active_run_id,
          message: `正在读取 ${contact} 的当前微信会话。`,
          payload: { skill_id: skillId, contact },
        });
        const readResult = await this.runWechatCommandForSession(
          session,
          'wechat-live-auto-reply',
          [contact, 'read-only'],
          `wechat-live-auto-reply 读取超时：${contact}`,
          90000,
        );
        const sourceText = this.firstString(readResult.readText) || '';
        if (!sourceText) {
          return this.failedExecution(
            '未读取到当前微信会话原文，不能生成商用回复。',
            '把桌面微信停在目标联系人会话，并确认屏幕录制/OCR 权限后重试。',
            ['未读取到微信会话原文。'],
            context,
            { ...readResult, contact },
          );
        }
        const existingReply =
          this.firstString(metadata.wechat_reply_draft) || '';
        const existingGeneratedBy = this.normalizeReplyGeneratedBy(
          metadata.replyGeneratedBy,
          metadata.reply_generated_by,
          metadata.wechat_reply_generated_by,
        );
        const isCustomerServiceReply = Boolean(
          Object.keys(customerServiceDecision).length,
        );
        const generatedReply =
          existingReply &&
          (existingGeneratedBy === 'ai' || isCustomerServiceReply)
            ? {
                reply: existingReply,
                generatedBy: existingGeneratedBy || ('fallback' as const),
              }
            : await this.generateWechatDesktopReply(sourceText, contact);
        const message = generatedReply.reply;
        const result = await this.runWechatCommandForSession(
          session,
          'wechat-auto-reply',
          [contact, message, mode],
          `wechat-auto-reply 执行超时：${contact}`,
          90000,
        );
        return this.completedWechatExecution(
          mode === 'auto-send'
            ? `微信消息已发送给 ${contact}。`
            : `微信消息已填入 ${contact}，停在发送前。`,
          { ...context, contact },
          {
            ...result,
            reply: message,
            readText: sourceText,
            sourceText,
            generatedBy: generatedReply.generatedBy,
          },
        );
      }

      if (
        skillId === 'wechat.group.broadcast' ||
        skillId === 'wechat-group-broadcast'
      ) {
        const targets = this.normalizeStringList(metadata.wechat_group_targets);
        const message = this.firstString(metadata.wechat_reply_draft) || '';
        const targetMessages = this.normalizeWechatTargetMessageMap(
          this.firstPresent(
            metadata.wechat_group_messages,
            metadata.wechat_mass_send_contents,
          ),
        );
        if (!targets.length || (!message && !targetMessages.size)) {
          return this.blockedExecution(
            '缺少微信群发对象或群发内容，不能执行微信群发。',
            '请传入 wechat_group_targets 和 wechat_reply_draft。',
            ['缺少群发对象或群发内容。'],
            context,
            {
              status: 'blocked',
              errorCode: !targets.length ? 'target_missing' : 'content_invalid',
              nextAction: '请传入 wechat_group_targets 和 wechat_reply_draft。',
            },
            !targets.length ? 'target_not_found' : 'send_failed',
          );
        }
        const results = await this.runWechatTargets(
          targets,
          async (target) => {
            const targetMessage = targetMessages.get(target) || message;
            if (!targetMessage) {
              throw new Error(`缺少 ${target} 的群发内容。`);
            }
            return this.runWechatCommandForSession(
              session,
              'wechat-auto-reply',
              [target, targetMessage, mode],
              `wechat-auto-reply 执行超时：${target}`,
              90000,
            );
          },
          mode,
        );
        return this.summarizeWechatTargetResults(
          '微信群发',
          targets,
          results,
          context,
        );
      }

      if (
        skillId === 'wechat.contact.add' ||
        skillId === 'wechat-contact-add'
      ) {
        const targets = this.normalizeStringList(
          metadata.wechat_contact_add_targets,
        );
        const verifyMessage =
          this.firstString(metadata.wechat_contact_add_verify_message) || '';
        if (!targets.length || !verifyMessage) {
          return this.blockedExecution(
            '缺少加好友对象或验证消息，不能执行自动加好友。',
            '请传入 wechat_contact_add_targets 和 wechat_contact_add_verify_message。',
            ['缺少加好友对象或验证消息。'],
            context,
            {
              status: 'blocked',
              errorCode: !targets.length ? 'target_missing' : 'content_invalid',
              nextAction:
                '请传入 wechat_contact_add_targets 和 wechat_contact_add_verify_message。',
            },
            !targets.length ? 'target_not_found' : 'send_failed',
          );
        }
        const results = await this.runWechatTargets(
          targets,
          async (target) =>
            this.runWechatCommandForSession(
              session,
              'wechat-contact-add',
              [target, verifyMessage, mode],
              `wechat-contact-add 执行超时：${target}`,
              120000,
            ),
          mode,
        );
        return this.summarizeWechatTargetResults(
          '自动加好友',
          targets,
          results,
          context,
        );
      }

      if (
        skillId === 'wechat.moments.marketing' ||
        skillId === 'wechat-moments-marketing'
      ) {
        const marketingMode =
          this.firstString(metadata.wechat_moments_marketing_mode) || 'random';
        const contacts = this.normalizeStringList(
          metadata.wechat_moments_marketing_contacts,
        );
        const actions = this.normalizeMomentsMarketingActions(
          metadata.wechat_moments_marketing_actions,
        );
        const commentMode =
          this.firstString(metadata.wechat_moments_marketing_comment_mode) ||
          'ai';
        const fixedComment =
          this.firstString(metadata.wechat_moments_marketing_fixed_comment) ||
          '';
        const content =
          this.firstString(metadata.wechat_moments_marketing_content) || '';
        const targetCommentMap = this.normalizeTargetCommentMap(
          metadata.wechat_moments_marketing_target_comments,
        );
        const randomBrowseCount = this.normalizePositiveInteger(
          metadata.wechat_moments_marketing_random_browse_count,
          20,
          100,
        );
        const dailyLimit = this.normalizePositiveInteger(
          metadata.wechat_moments_marketing_daily_limit,
          marketingMode === 'targeted' && contacts.length
            ? contacts.length
            : randomBrowseCount,
          100,
        );
        const actionKind =
          actions.like && actions.comment
            ? 'like-comment'
            : actions.comment
              ? 'comment'
              : 'like';
        const targets =
          marketingMode === 'targeted' && contacts.length
            ? contacts
            : Array.from(
                { length: Math.max(1, randomBrowseCount) },
                (_, index) => `朋友圈第 ${index + 1} 条`,
              );
        const limitedTargets = targets.slice(
          0,
          Math.min(dailyLimit, targets.length),
        );
        const results = await this.runWechatTargets(
          limitedTargets,
          async (target, index) => {
            const commentText =
              targetCommentMap.get(target) ||
              (commentMode === 'fixed' ? fixedComment : '') ||
              content ||
              '您好，看到这条内容很有共鸣，想进一步了解一下。';
            if (actions.comment && !commentText) {
              throw new Error('缺少朋友圈评论内容，不能执行朋友圈营销。');
            }
            return this.runWechatCommandForSession(
              session,
              'wechat-moments-marketing',
              [
                target,
                actions.comment ? commentText : '',
                mode,
                actionKind,
                String(index + 1),
              ],
              `wechat-moments-marketing 执行超时：${target}`,
              120000,
            );
          },
          mode,
        );
        return this.summarizeWechatTargetResults(
          '朋友圈营销',
          limitedTargets,
          results,
          {
            ...context,
            actionKind,
            dailyLimit,
            requestedTargets: targets.length,
          },
        );
      }

      if (
        skillId === 'wechat.moments.publish' ||
        skillId === 'wechat-moments-publish'
      ) {
        const details = this.normalizeWechatMomentsPublishDetails(metadata);
        const now = Date.now();
        const dueDetails = details.filter((detail) => {
          if (!detail.scheduledPublishTime) return true;
          const scheduledAt = Date.parse(detail.scheduledPublishTime);
          return !Number.isFinite(scheduledAt) || scheduledAt <= now;
        });
        const pendingTargets = details
          .filter((detail) => {
            const scheduledPublishTime = detail.scheduledPublishTime;
            if (!scheduledPublishTime) return false;
            const scheduledAt = Date.parse(scheduledPublishTime);
            return Number.isFinite(scheduledAt) && scheduledAt > now;
          })
          .map((detail) => detail.target);
        if (!dueDetails.length) {
          return this.blockedExecution(
            '朋友圈明细还未到执行时间，当前没有发布。',
            '等待最早一条明细到达设定时间后再执行。',
            ['朋友圈明细未到执行时间。'],
            { ...context, pendingTargets },
            { pendingTargets },
            'review_required',
          );
        }
        const detailByTarget = new Map(
          dueDetails.map((detail) => [detail.target, detail]),
        );
        const targets = dueDetails.map((detail) => detail.target);
        const results = await this.runWechatTargets(
          targets,
          async (target) => {
            const detail = detailByTarget.get(target)!;
            if (!detail.content || !detail.attachments.length) {
              throw new Error('缺少朋友圈文案或媒体文件路径。');
            }
            if (detail.visibility !== 'public') {
              throw new Error(
                `朋友圈可见范围「${detail.visibilityLabel}」当前不能自动设置，本条未发布。`,
              );
            }
            return this.runWechatCommandForSession(
              session,
              'wechat-moments-publish',
              [
                detail.content,
                mode,
                detail.attachments.join('\n'),
                detail.additionalComment,
                detail.visibility,
              ],
              `wechat-moments-publish 执行超时：${target}`,
              150000,
            );
          },
          mode,
        );
        const summary = this.summarizeWechatTargetResults(
          '朋友圈发布',
          targets,
          results,
          { ...context, detailCount: details.length },
        );
        if (summary.result) {
          const successfulTargets = new Set(
            results.filter((item) => item.ok).map((item) => item.target),
          );
          const successfulDetails = dueDetails.filter((detail) =>
            successfulTargets.has(detail.target),
          );
          summary.result.pendingTargets = [
            ...this.normalizeStringList(summary.result.pendingTargets),
            ...pendingTargets,
          ];
          summary.result.details = details;
          summary.result.reply = successfulDetails[0]?.content;
          summary.result.readbackText = successfulDetails
            .map(
              (detail) =>
                `微信朋友圈${mode === 'auto-send' ? '已自动发送' : '已填入并等待继续执行'}：${detail.target} / ${detail.content} / ${detail.attachments.join('、')}`,
            )
            .join('\n');
        }
        return summary;
      }

      return this.failedExecution(
        `微信技能 ${skillId} 未注册。`,
        '检查 skill_id 是否在 Node Runtime 微信技能表内。',
        [`未知微信技能：${skillId}`],
        context,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const result =
        error instanceof WechatCommandError ? error.result : undefined;
      return this.failedExecution(
        message,
        '检查本机微信登录态、辅助功能权限、cliclick、脚本坐标和账号风控提示。',
        [message],
        context,
        result,
      );
    }
  }

  private async runWechatTargets(
    targets: string[],
    runner: (target: string, index: number) => Promise<WechatCommandResult>,
    mode: 'auto-send' | 'approval',
  ): Promise<
    Array<{
      target: string;
      ok: boolean;
      message: string;
      screenshotPath?: string;
      result?: WechatCommandResult;
    }>
  > {
    const results: Array<{
      target: string;
      ok: boolean;
      message: string;
      screenshotPath?: string;
      result?: WechatCommandResult;
    }> = [];
    for (const [index, target] of targets.entries()) {
      try {
        const result = await runner(target, index);
        results.push({
          target,
          ok: true,
          message:
            mode === 'auto-send'
              ? `已处理 ${target}。`
              : `已打开 ${target} 并等待继续执行。`,
          screenshotPath: result.screenshotPath,
          result,
        });
      } catch (error) {
        const commandResult =
          error instanceof WechatCommandError ? error.result : undefined;
        results.push({
          target,
          ok: false,
          message: error instanceof Error ? error.message : String(error),
          screenshotPath: commandResult?.screenshotPath,
          result: commandResult,
        });
      }
      if (mode !== 'auto-send') break;
    }
    return results;
  }

  private summarizeWechatTargetResults(
    label: string,
    targets: string[],
    results: Array<{
      target: string;
      ok: boolean;
      message: string;
      screenshotPath?: string;
      result?: WechatCommandResult;
    }>,
    context: Record<string, unknown>,
  ): RuntimeExecution {
    const successCount = results.filter((item) => item.ok).length;
    const failedCount = results.filter((item) => !item.ok).length;
    const mode = context.mode === 'auto-send' ? 'auto-send' : 'approval';
    const pendingTargets =
      mode === 'approval' && targets.length > results.length
        ? targets.slice(results.length)
        : [];
    if (!successCount) {
      const noTarget = results.every((item) =>
        this.isWechatNoTargetFailure(item.message, item.result),
      );
      const blockers = results.map((item) => `${item.target}: ${item.message}`);
      const firstBlocker = blockers[0];
      const userMessageBase = noTarget
        ? `${label}没有可处理对象：${failedCount} 个对象不可添加或已是联系人。`
        : `${label}没有任何对象处理成功：失败 ${failedCount} 个。`;
      const userMessage =
        firstBlocker && !userMessageBase.includes(firstBlocker)
          ? `${userMessageBase} ${firstBlocker}`
          : userMessageBase;
      return {
        ok: false,
        status: 'failed',
        reasonCode: noTarget ? 'target_not_found' : 'send_failed',
        userMessage,
        technicalMessage: noTarget
          ? `${label}目标不可添加或已是联系人；请换一个未成为好友且可搜索/可添加的微信测试对象。`
          : firstBlocker,
        browserExecution: true,
        context: {
          ...context,
          targets,
          results,
        },
        result: {
          targets,
          results,
          screenshotPath: results.find((item) => item.screenshotPath)
            ?.screenshotPath,
        },
        blockers,
        nextAction: noTarget
          ? '请换一个未成为好友且可搜索/可添加的微信测试对象后重新创建任务。'
          : '检查本机微信登录态、辅助功能权限、cliclick、脚本坐标和账号风控提示。',
      };
    }
    return {
      ok: true,
      status: 'completed',
      userMessage:
        mode === 'approval' && pendingTargets.length
          ? `${label}已完成首个对象回读：成功 ${successCount}，失败 ${failedCount}，剩余 ${pendingTargets.length} 个待继续执行。`
          : `${label}完成：成功 ${successCount}，失败 ${failedCount}。`,
      browserExecution: true,
      context: {
        ...context,
        targets,
        results,
        pendingTargets,
      },
      result: {
        targets,
        results,
        pendingTargets,
        readbackText: this.buildWechatTargetsReadback(label, results),
        replyVisible: successCount > 0,
        screenshotPath: results.find((item) => item.screenshotPath)
          ?.screenshotPath,
      },
      blockers: [],
    };
  }

  private isWechatNoTargetFailure(
    message: string,
    result?: WechatCommandResult,
  ) {
    const text = [message, result?.message, result?.status, result?.target]
      .filter(Boolean)
      .join('\n');
    return /未进入好友申请页面|没有找到可添加对象|目标已是联系人|已是联系人|不可添加|无可添加对象/.test(
      text,
    );
  }

  private completedWechatExecution(
    message: string,
    context: Record<string, unknown>,
    result: WechatCommandResult,
  ): RuntimeExecution {
    const readbackText = result.readText || result.reply || result.message;
    const sourceText = result.sourceText || result.readText;
    return {
      ok: true,
      status: 'completed',
      userMessage: message,
      browserExecution: true,
      context,
      result: {
        reply: result.reply,
        replyText: result.reply,
        readText: result.readText,
        sourceText,
        targetText: sourceText,
        replyGeneratedBy: result.generatedBy,
        generatedBy: result.generatedBy,
        readbackText,
        replyVisible: Boolean(readbackText),
        screenshotPath: result.screenshotPath,
        contact: result.contact,
        target: result.target,
        mode: result.mode,
        commandOutput: result.raw,
      },
      blockers: [],
    };
  }

  private buildWechatCommandReadback(input: {
    actionLabel: string;
    mode: 'auto-send' | 'approval';
    target: string;
    text: string;
    result?: WechatCommandResult;
  }) {
    const target =
      input.result?.contact || input.result?.target || input.target;
    const action =
      input.mode === 'auto-send' ? '已自动发送' : '已写入并等待继续执行';
    return `${input.actionLabel}${action}：${target} / ${input.text}`;
  }

  private async generateWechatDesktopReply(
    sourceText: string,
    context: string,
  ): Promise<{ reply: string; generatedBy: 'ai' | 'fallback' }> {
    const cleanSource = sourceText.trim();
    try {
      if (!this.aiClient || !this.defaultModels) {
        return {
          reply: this.buildWechatFallbackReply(cleanSource, context),
          generatedBy: 'fallback',
        };
      }
      const defaults = await this.defaultModels.getDefaults();
      const modelId = defaults.articleCreation || defaults.topicSelection;
      if (!modelId) {
        return {
          reply: this.buildWechatFallbackReply(cleanSource, context),
          generatedBy: 'fallback',
        };
      }
      const reply = await this.aiClient.generate(
        modelId,
        [
          {
            role: 'system',
            content: [
              '你是商用微信客服助手。',
              '根据当前微信聊天 OCR 读到的最近上下文，生成一条可以直接发给客户的中文回复。',
              '要求：像真人客服，简短自然，最多 80 字；不要编造价格、承诺、疗效、优惠；不确定就追问关键信息。',
              '禁止输出分析过程，只输出要发送的回复。',
              context ? `当前会话/联系人：${context}` : '',
            ]
              .filter(Boolean)
              .join('\n'),
          },
          {
            role: 'user',
            content: `当前微信聊天内容：\n${cleanSource}`,
          },
        ],
        {
          temperature: 0.5,
          maxTokens: 200,
          knowledgeMode: 'required',
          knowledgeQuery: `${context || ''}\n${cleanSource}`,
        },
      );
      const trimmed = reply.trim();
      if (!trimmed) {
        return {
          reply: this.buildWechatFallbackReply(cleanSource, context),
          generatedBy: 'fallback',
        };
      }
      return { reply: trimmed, generatedBy: 'ai' };
    } catch (error) {
      this.logger.warn(
        `桌面微信 AI 回复生成失败，使用兜底规则：${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return {
        reply: this.buildWechatFallbackReply(cleanSource, context),
        generatedBy: 'fallback',
      };
    }
  }

  private buildWechatTargetsReadback(
    label: string,
    results: Array<{
      target: string;
      ok: boolean;
      message: string;
      result?: WechatCommandResult;
    }>,
  ) {
    return results
      .filter((item) => item.ok)
      .map((item) => {
        const runtimeTarget =
          item.result?.contact || item.result?.target || item.target;
        const mode =
          item.result?.mode === 'auto-send'
            ? '已自动执行'
            : item.result?.mode === 'approval'
              ? '已写入并等待继续执行'
              : '已处理';
        const readback =
          item.result?.readText ||
          item.result?.reply ||
          item.result?.message ||
          item.message;
        return `${label}${mode}：${runtimeTarget} / ${readback}`;
      })
      .join('\n');
  }

  private async performBrowserExecution(
    session: StoredSession,
    input: NodeAgentRuntimeRunTaskInput,
    runId?: string,
  ): Promise<RuntimeExecution> {
    if (this.isRunCancelled(session, runId)) {
      return this.cancelledExecution();
    }
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
    if (this.isRunCancelled(session, runId)) {
      return this.cancelledExecution();
    }
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
        technicalMessage:
          'NodeAgentRuntimeService 缺少 PlatformInteractionExecutor provider。',
        browserExecution: true,
        context: baseContext,
        preflight,
        blockers: ['PlatformInteractionExecutor 未注入。'],
        nextAction: '检查 LocalEngineModule exports 和 RuntimeModule imports。',
      };
    }

    if (context.action === 'read') {
      if (this.isRunCancelled(session, runId)) {
        return this.cancelledExecution();
      }
      const readResult = await this.interactionExecutor.read({
        platform: context.platform,
        accountId: context.accountId,
        taskType: context.taskType,
        limit: context.limit,
      });
      const readStatus = String(readResult.status || '');
      const readStatusFailure = [
        'failed',
        'account_not_logged_in',
        'comment_page_not_ready',
        'error',
        'blocked',
      ].includes(readStatus);
      const readStatusRecognized = [
        '',
        'ok',
        'success',
        'completed',
        'ready',
      ].includes(readStatus);
      const readSummary = this.readRecord(readResult.summary);
      const payloadPresent =
        Array.isArray(readResult.comments) ||
        Array.isArray(readResult.messages) ||
        Array.isArray(readResult.items);
      const evidencePresent =
        (typeof readResult.url === 'string' &&
          readResult.url.trim().length > 0) ||
        (typeof readResult.currentUrl === 'string' &&
          readResult.currentUrl.trim().length > 0) ||
        payloadPresent;
      const readOk =
        readStatusRecognized &&
        !readStatusFailure &&
        readSummary.loadBlocked !== true &&
        !readResult.scanError &&
        (Boolean(readStatus) || evidencePresent);
      return {
        ok: readOk,
        status: readOk ? 'completed' : 'failed',
        userMessage: readOk
          ? 'Node Agent Runtime 已完成真实读取。'
          : String(readResult.message || '真实读取失败。'),
        technicalMessage: readOk
          ? undefined
          : JSON.stringify(readResult).slice(0, 2000),
        browserExecution: true,
        context: baseContext,
        preflight,
        result: readResult,
        blockers: readOk ? [] : [String(readResult.message || readStatus)],
        nextAction: readOk
          ? undefined
          : String(
              readResult.nextAction ||
                '检查平台登录态、页面入口和浏览器执行日志。',
            ),
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
        nextAction:
          '从互动任务 payload 传入目标评论/会话文本和要发送的回复文本。',
      };
    }

    if (this.isRunCancelled(session, runId)) {
      return this.cancelledExecution();
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
    const ok = result.status === 'sent' || result.status === 'draft_filled';
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
    result?: Record<string, unknown>,
  ): RuntimeExecution {
    return {
      ok: false,
      status: 'failed',
      userMessage: message,
      browserExecution: Boolean(context?.executionStarted),
      context,
      result,
      blockers: blockers.length ? blockers : [message],
      nextAction,
    };
  }

  private cancelledExecution(): RuntimeExecution {
    return {
      ok: false,
      status: 'failed',
      reasonCode: 'review_required',
      userMessage: '任务已取消，浏览器执行被中止。',
      technicalMessage:
        'Cancellation was requested before the next execution step.',
      browserExecution: false,
      blockers: ['任务已取消。'],
      nextAction: '如需执行，请重新提交任务。',
    };
  }

  private isRunCancelled(session: StoredSession, _runId?: string): boolean {
    return session.cancellation_requested === true;
  }

  private blockedExecution(
    message: string,
    nextAction: string,
    blockers: string[],
    context?: Record<string, unknown>,
    result?: Record<string, unknown>,
    reasonCode: RuntimeExecution['reasonCode'] = 'runtime_unavailable',
  ): RuntimeExecution {
    return {
      ok: false,
      status: 'blocked',
      reasonCode,
      userMessage: message,
      technicalMessage: nextAction,
      browserExecution: Boolean(context?.executionStarted),
      context,
      result: {
        status: 'blocked',
        errorCode: reasonCode,
        nextAction,
        ...(result || {}),
      },
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
          ? `平台 ${platformRaw} 未注册到 Node Agent Runtime 真实互动执行表。`
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
    if (
      normalized.includes('comment') ||
      normalized.includes('评论') ||
      normalized.includes('留言')
    ) {
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

  private async runWechatCommandForSession(
    session: StoredSession,
    command: string,
    args: string[],
    timeoutMessage: string,
    timeoutMs: number,
  ): Promise<WechatCommandResult> {
    if (session.cancellation_requested) {
      throw new Error('任务已取消，微信命令未启动。');
    }
    const result = await this.runWechatCommand(
      command,
      args,
      timeoutMessage,
      timeoutMs,
    );
    if (session.cancellation_requested) {
      throw new Error('任务已取消，微信命令结果未被采纳。');
    }
    return result;
  }

  private runWechatCommand(
    command: string,
    args: string[],
    timeoutMessage: string,
    timeoutMs: number,
  ): Promise<WechatCommandResult> {
    return new Promise((resolve, reject) => {
      const packagedResourcesRoot = (
        process as NodeJS.Process & { resourcesPath?: string }
      ).resourcesPath;
      const configuredRoot =
        process.env.KAYPAL_WECHAT_COMMAND_ROOT?.trim() ||
        [
          // 打包后：resources/wechat-macos/bin（cwd=resources/backend）
          packagedResourcesRoot
            ? join(packagedResourcesRoot, 'wechat-macos', 'bin')
            : '',
          join(
            process.cwd(),
            '..',
            'desktop',
            'runtime',
            'wechat-macos',
            'bin',
          ),
          join(process.cwd(), 'desktop', 'runtime', 'wechat-macos', 'bin'),
        ].find((candidate) => candidate && existsSync(candidate)) ||
        '';
      const resolvedCommand =
        [
          configuredRoot ? join(configuredRoot, command) : '',
          join(homedir(), '.local', 'bin', command),
          join('/opt/homebrew/bin', command),
          join('/usr/local/bin', command),
        ].find((candidate) => candidate && existsSync(candidate)) || command;
      const child = spawn(resolvedCommand, args, {
        env: {
          ...process.env,
          AI_CONTENT_CLICLICK_PATH:
            process.env.AI_CONTENT_CLICLICK_PATH ||
            (configuredRoot ? join(configuredRoot, 'cliclick') : ''),
          AI_CONTENT_NODE_PATH:
            process.env.AI_CONTENT_NODE_PATH || process.execPath,
          PATH: [
            configuredRoot,
            process.env.PATH || '',
            join(homedir(), '.local', 'bin'),
            '/opt/homebrew/bin',
            '/usr/local/bin',
          ]
            .filter(Boolean)
            .join(':'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(timeoutMessage));
      }, timeoutMs);
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          const output = stdout.trim();
          if (!output) {
            resolve({});
            return;
          }
          try {
            const parsed = JSON.parse(output) as Record<string, unknown>;
            const status =
              typeof parsed.status === 'string'
                ? parsed.status.toLowerCase()
                : '';
            if (
              parsed.ok === false ||
              [
                'failed',
                'error',
                'blocked',
                'captcha_required',
                'risk_blocked',
              ].includes(status)
            ) {
              const message =
                this.firstString(
                  parsed.message,
                  parsed.error,
                  parsed.reason,
                  stderr,
                  stdout,
                ) || `${command} 返回失败`;
              reject(
                new WechatCommandError(
                  message,
                  this.toWechatCommandResult(parsed),
                ),
              );
              return;
            }
            resolve(this.toWechatCommandResult(parsed));
          } catch {
            resolve({});
          }
          return;
        }
        reject(
          new Error((stderr || stdout || `${command} 退出码 ${code}`).trim()),
        );
      });
    });
  }

  private toWechatCommandResult(
    parsed: Record<string, unknown>,
  ): WechatCommandResult {
    return {
      screenshotPath:
        this.firstString(parsed.screenshotPath, parsed.screenshot_path) ||
        undefined,
      reply: this.firstString(parsed.reply) || undefined,
      readText:
        this.firstString(parsed.readText, parsed.read_text) || undefined,
      sourceText:
        this.firstString(parsed.sourceText, parsed.source_text) || undefined,
      generatedBy: this.normalizeReplyGeneratedBy(
        parsed.generatedBy,
        parsed.generated_by,
        parsed.replyGeneratedBy,
        parsed.reply_generated_by,
      ),
      message: this.firstString(parsed.message) || undefined,
      contact: this.firstString(parsed.contact) || undefined,
      target: this.firstString(parsed.target) || undefined,
      mode: this.firstString(parsed.mode) || undefined,
      status: this.firstString(parsed.status) || undefined,
      errorCode:
        this.firstString(parsed.errorCode, parsed.error_code) || undefined,
      nextAction:
        this.firstString(parsed.nextAction, parsed.next_action) || undefined,
      raw: parsed,
    };
  }

  private normalizeStringList(value: unknown): string[] {
    if (Array.isArray(value)) {
      return [
        ...new Set(
          value.map((item) => String(item || '').trim()).filter(Boolean),
        ),
      ];
    }
    if (typeof value === 'string') {
      return [
        ...new Set(
          value
            .split(/\n|,|，|;|；/)
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      ];
    }
    return [];
  }

  private normalizeMomentsMarketingActions(value: unknown): {
    like: boolean;
    comment: boolean;
  } {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { like: true, comment: true };
    }
    const record = value as Record<string, unknown>;
    return {
      like: record.like !== false,
      comment: record.comment !== false,
    };
  }

  private normalizePositiveInteger(
    value: unknown,
    fallback: number,
    max: number,
  ) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 1) return fallback;
    return Math.min(Math.floor(numeric), max);
  }

  private normalizeTargetCommentMap(value: unknown) {
    const map = new Map<string, string>();
    if (!Array.isArray(value)) return map;
    for (const item of value) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const record = item as Record<string, unknown>;
      const targetName = this.firstString(
        record.targetName,
        record.target,
        record.name,
      );
      const commentText = this.firstString(
        record.commentText,
        record.replyText,
        record.comment,
      );
      if (targetName && commentText) {
        map.set(targetName, commentText);
      }
    }
    return map;
  }

  private normalizeWechatTargetMessageMap(value: unknown) {
    const messages = new Map<string, string>();
    if (!Array.isArray(value)) return messages;
    for (const item of value) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const record = item as Record<string, unknown>;
      const target = this.firstString(
        record.target,
        record.targetName,
        record.contact,
      );
      const message = this.firstString(
        record.message,
        record.sendContent,
        record.replyText,
      );
      if (target && message) messages.set(target, message);
    }
    return messages;
  }

  private normalizeWechatMomentsPublishDetails(
    metadata: Record<string, unknown>,
  ) {
    const rawDetails = this.firstPresent(
      metadata.wechat_moments_details,
      metadata.momentsDetails,
    );
    const fallbackContent =
      this.firstString(metadata.wechat_moments_content, metadata.replyText) ||
      '';
    const fallbackAssets = this.normalizeStringList(
      this.firstPresent(
        metadata.wechat_moments_asset_paths,
        metadata.wechat_moments_asset_path,
        metadata.assetPaths,
        metadata.assetPath,
      ),
    );
    const fallbackVisibility = this.firstString(
      metadata.wechat_moments_visibility_code,
      metadata.wechat_moments_visibility,
    );
    const items =
      Array.isArray(rawDetails) && rawDetails.length
        ? rawDetails
        : [
            {
              content: fallbackContent,
              attachments: fallbackAssets,
              visibility: fallbackVisibility,
              additionalComment: metadata.wechat_moments_additional_comment,
              scheduledPublishTime: metadata.wechat_moments_schedule_start_time,
            },
          ];
    return items.slice(0, 100).flatMap((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const record = item as Record<string, unknown>;
      const visibilityLabel =
        this.firstString(record.visibility, fallbackVisibility) || '公开';
      const normalizedVisibility = visibilityLabel.toLowerCase();
      const visibility =
        normalizedVisibility === 'private' || visibilityLabel === '私密'
          ? 'private'
          : normalizedVisibility === 'partial' ||
              visibilityLabel === '部分可见' ||
              visibilityLabel === '不给谁看'
            ? 'partial'
            : 'public';
      return [
        {
          target:
            this.firstString(record.targetName, record.id) ||
            `朋友圈明细 ${index + 1}`,
          content:
            this.firstString(
              record.content,
              record.sendContent,
              record.replyText,
              fallbackContent,
            ) || '',
          attachments: this.normalizeStringList(
            this.firstPresent(
              record.attachments,
              record.assetPaths,
              record.assetPath,
              fallbackAssets,
            ),
          ).slice(0, 9),
          additionalComment:
            this.firstString(record.additionalComment, record.comment) || '',
          scheduledPublishTime:
            this.firstString(record.scheduledPublishTime, record.scheduledAt) ||
            undefined,
          visibility,
          visibilityLabel,
        },
      ];
    });
  }

  private buildWechatFallbackReply(readText: string, context: string) {
    const text = readText.trim();
    if (/价格|多少钱|费用|收费/.test(text)) {
      return '您好，价格需要结合您的具体需求确认。我先了解一下情况，再给您准确方案。';
    }
    if (/地址|在哪|位置|门店/.test(text)) {
      return '您好，可以的。我把门店地址和营业时间发您，您看哪个时间方便过来。';
    }
    if (/预约|几点|时间|明天|今天/.test(text)) {
      return '您好，可以先帮您看下可预约时间。您方便说一下想安排的日期和大概时间段吗？';
    }
    if (/在吗|你好|您好/.test(text)) {
      return '您好，在的。您这边想咨询哪方面，我来帮您确认。';
    }
    if (context.trim()) {
      return `您好，收到您的消息了。${context.trim().slice(0, 60)}我这边先帮您确认一下。`;
    }
    return '您好，收到您的消息了。我先帮您确认一下，稍后给您回复。';
  }

  private readRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private firstString(...values: unknown[]): string | undefined {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) return value.trim();
      if (typeof value === 'number' && Number.isFinite(value))
        return String(value);
    }
    return undefined;
  }

  private normalizeReplyGeneratedBy(
    ...values: unknown[]
  ): 'ai' | 'fallback' | undefined {
    const value = this.firstString(...values);
    return value === 'ai' || value === 'fallback' ? value : undefined;
  }

  private firstPresent(...values: unknown[]): unknown {
    return values.find(
      (value) => value !== undefined && value !== null && value !== '',
    );
  }

  private requireSession(sessionId: string): StoredSession {
    const session =
      this.sessions.get(sessionId) || this.loadPersistedSession(sessionId);
    if (session && !this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, session);
    }
    if (!session) {
      throw new Error(`Node Agent Runtime session not found: ${sessionId}`);
    }
    return session;
  }

  private sessionFilePath(sessionId: string): string {
    return join(
      this.evidenceRootPath,
      'sessions',
      `${encodeURIComponent(sessionId)}.json`,
    );
  }

  private artifactFilePath(sessionId: string, artifactId: string): string {
    return join(
      this.evidenceRootPath,
      'artifacts',
      encodeURIComponent(sessionId),
      `${encodeURIComponent(artifactId)}.json`,
    );
  }

  private persistSession(session: StoredSession): void {
    if (!this.evidenceStoreReady) return;
    const filePath = this.sessionFilePath(session.session_id);
    const tempPath = `${filePath}.tmp-${process.pid}`;
    const { artifactContents, ...serializable } = session;
    void artifactContents;
    try {
      mkdirSync(join(this.evidenceRootPath, 'sessions'), {
        recursive: true,
        mode: 0o700,
      });
      writeFileSync(tempPath, JSON.stringify(serializable, null, 2), {
        encoding: 'utf8',
        mode: 0o600,
      });
      renameSync(tempPath, filePath);
    } catch (error) {
      this.logger.warn(
        `Agent-S session evidence write failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private loadPersistedSession(sessionId: string): StoredSession | null {
    if (!this.evidenceStoreReady) return null;
    try {
      const parsed = JSON.parse(
        readFileSync(this.sessionFilePath(sessionId), 'utf8'),
      ) as Partial<StoredSession>;
      if (parsed.session_id !== sessionId) return null;
      const session = {
        ...parsed,
        events: Array.isArray(parsed.events) ? parsed.events : [],
        artifacts: Array.isArray(parsed.artifacts) ? parsed.artifacts : [],
        artifactContents: new Map<string, string>(),
        pendingRun: parsed.pendingRun || null,
      } as StoredSession;
      if (
        session.status === 'running' ||
        session.status === 'waiting_approval'
      ) {
        session.status = 'failed';
        session.completed_at = new Date().toISOString();
        session.updated_at = session.completed_at;
        session.last_error = '3011 在任务执行期间重启，未确认的任务已中止。';
        session.active_run_id = null;
        session.pendingRun = null;
        this.pushEvent(session, {
          event_type: 'task_failed',
          status: 'failed',
          run_id: null,
          message: session.last_error,
          payload: { reasonCode: 'runtime_unavailable' },
        });
      }
      return session;
    } catch {
      return null;
    }
  }

  private persistArtifactContent(
    session: StoredSession,
    artifact: NodeAgentRuntimeArtifact,
    content: string,
  ): string {
    const filePath = this.artifactFilePath(
      session.session_id,
      artifact.artifact_id,
    );
    if (!this.evidenceStoreReady)
      return `evidence-unavailable://${artifact.artifact_id}`;
    const directory = join(
      this.evidenceRootPath,
      'artifacts',
      encodeURIComponent(session.session_id),
    );
    const tempPath = `${filePath}.tmp-${process.pid}`;
    try {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      writeFileSync(tempPath, content, { encoding: 'utf8', mode: 0o600 });
      renameSync(tempPath, filePath);
      return filePath;
    } catch (error) {
      this.logger.warn(
        `Agent-S artifact evidence write failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return `evidence-unavailable://${artifact.artifact_id}`;
    }
  }

  private readArtifactContent(
    artifact: NodeAgentRuntimeArtifact,
  ): string | null {
    if (
      !artifact.path ||
      artifact.path.startsWith('memory://') ||
      artifact.path.startsWith('evidence-unavailable://')
    )
      return null;
    try {
      return readFileSync(artifact.path, 'utf8');
    } catch {
      return null;
    }
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
    this.persistSession(session);
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
      path: this.artifactFilePath(
        session.session_id,
        `node-runtime-artifact-${Date.now()}`,
      ),
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
    const {
      events,
      artifacts,
      artifactContents,
      pendingRun,
      ...publicSession
    } = session;
    void events;
    void artifacts;
    void artifactContents;
    void pendingRun;
    return publicSession;
  }
}
