import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import axios, { AxiosInstance } from 'axios';
import { spawn } from 'child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { basename, extname, isAbsolute, join, resolve, sep } from 'path';
import {
  resolveProjectLogPath,
  resolveProjectRoot,
} from '../../common/project-paths';
import { safeText } from '../../common/text.utils';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AiClientService } from '../ai-models/ai-client.service';
import { DefaultModelsService } from '../ai-models/default-models.service';
import {
  WECHAT_NATIVE_COMMAND_CONTRACT_VERSION,
  type WechatNativeCommandKey,
} from '../local-engine/wechat-native-command.contract';

export type AgentSPhase =
  | 'idle'
  | 'connecting'
  | 'ready'
  | 'spawn-required'
  | 'stopping'
  | 'stopped'
  | 'error';

export interface AgentSSidecarConfig {
  baseUrl: string;
  healthPath?: string;
  statusPath?: string;
  stopPath?: string;
  requestTimeoutMs?: number;
  headers?: Record<string, string>;
}

export interface AgentSSidecarHealthResponse {
  ok?: boolean;
  status?: string;
  service?: string;
  version?: string;
  pid?: number;
  runner_mode?: string;
  [key: string]: unknown;
}

export interface AgentSSidecarStatusResponse {
  state?: string;
  version?: string;
  pid?: number;
  runner_mode?: string;
  session_count?: number;
  uptime_ms?: number;
  running_session_count?: number;
  artifact_root?: string;
  [key: string]: unknown;
}

export interface AgentSManagerStatus {
  phase: AgentSPhase;
  baseUrl: string;
  connected: boolean;
  canSpawn: boolean;
  spawnImplemented: boolean;
  lastSeenAt?: string;
  lastError?: string;
  sidecar?: {
    health?: AgentSSidecarHealthResponse;
    status?: AgentSSidecarStatusResponse;
  };
}

export interface AgentSClientRequestOptions {
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface AgentSEvent {
  id?: string;
  runId?: string;
  traceId?: string;
  type: string;
  toolCallId?: string;
  tool?: string;
  status?: 'running' | 'success' | 'error' | 'cancelled';
  summary?: string;
  stdoutPreview?: string;
  stderrPreview?: string;
  fileChanges?: Array<Record<string, unknown>>;
  createdAt?: string;
  payload?: Record<string, unknown>;
}

export interface AgentSSidecarSessionSummary {
  session_id: string;
  session_name?: string | null;
  task_type: string;
  status:
    | 'idle'
    | 'running'
    | 'blocked'
    | 'waiting_approval'
    | 'completed'
    | 'failed'
    | 'cancelled';
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
  metadata: Record<string, unknown>;
  labels: string[];
  run_count: number;
  active_run_id?: string | null;
  cancellation_requested: boolean;
  last_error?: string | null;
  last_event_seq: number;
  artifact_count: number;
}

export interface AgentSSidecarCreateSessionInput {
  session_name?: string | null;
  task_type?: string;
  metadata?: Record<string, unknown>;
  labels?: string[];
}

export interface AgentSSidecarRunTaskInput {
  instruction: string;
  task_type?: string | null;
  metadata?: Record<string, unknown>;
  risk_level?: 'low' | 'medium' | 'high';
  requires_approval?: boolean;
  step_count?: number;
  attachments?: AgentSConversationAttachment[];
}

export interface AgentSSidecarEvent {
  seq: number;
  session_id: string;
  run_id?: string | null;
  event_type: string;
  status: AgentSSidecarSessionSummary['status'];
  created_at: string;
  message?: string | null;
  step_index?: number | null;
  artifact_id?: string | null;
  payload: Record<string, unknown>;
}

export interface AgentSSidecarApprovalDecisionInput {
  decision: 'approved' | 'rejected';
  comment?: string;
}

export interface AgentSSidecarArtifact {
  artifact_id: string;
  session_id: string;
  run_id?: string | null;
  kind: 'screenshot' | 'json' | 'text' | 'summary' | 'log';
  filename: string;
  path: string;
  created_at: string;
  size_bytes: number;
  metadata: Record<string, unknown>;
}

export type AgentSConversationPurpose =
  | 'general'
  | 'research'
  | 'draft'
  | 'execute';

export interface AgentSConversationAttachment {
  filename: string;
  filepath: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
}

export interface AgentSConversationMessage {
  message_id: string;
  role: 'user' | 'assistant' | 'system';
  kind: 'message' | 'result' | 'status' | 'confirmation';
  content: string;
  created_at: string;
  run_id?: string | null;
  status?: AgentSSidecarSessionSummary['status'];
  purpose?: AgentSConversationPurpose;
  model_id?: string | null;
  attachments: AgentSConversationAttachment[];
  event_seq?: number | null;
  metadata: Record<string, unknown>;
}

export interface AgentSConversationSessionDetail {
  session: AgentSSidecarSessionSummary;
  purpose: AgentSConversationPurpose;
  model_id: string | null;
  messages: AgentSConversationMessage[];
  events: AgentSSidecarEvent[];
  last_run_input: AgentSSidecarRunTaskInput | null;
}

type AgentSConversationState = AgentSConversationSessionDetail & {
  tenantId: string;
  userId: string;
  artifacts: AgentSSidecarArtifact[];
  last_run_kind: 'model' | 'executor' | null;
  cancellation_requested: boolean;
  ingested_executor_event_keys: Set<string>;
};

type AgentSConversationScope = {
  tenantId: string;
  userId: string;
};

type PersistedAgentSConversation = {
  kind: typeof AGENT_S_CONVERSATION_STATE_KIND;
  version: 1;
  tenantId: string;
  userId: string;
  session: AgentSSidecarSessionSummary;
  purpose: AgentSConversationPurpose;
  model_id: string | null;
  messages: AgentSConversationMessage[];
  events: AgentSSidecarEvent[];
  last_run_input: AgentSSidecarRunTaskInput | null;
  last_run_kind: 'model' | 'executor' | null;
  cancellation_requested: boolean;
  ingested_executor_event_keys: string[];
  artifacts: AgentSSidecarArtifact[];
};

type PersistedAgentSConversationRow = {
  id: string;
  tenantId: string;
  userId: string;
  source: string;
  sessionJson: unknown;
};

const AGENT_S_CONVERSATION_SOURCE = 'agent-s-conversation';
const AGENT_S_CONVERSATION_STATE_KIND = 'agent-s-conversation-state';
const AGENT_S_UNIT_TEST_SCOPE: AgentSConversationScope = {
  tenantId: 'agent-s-unit-test-tenant',
  userId: 'agent-s-unit-test-user',
};

type RuntimeRunSnapshot = {
  run_id: string;
  task_id: string;
  status: 'accepted' | 'running' | 'completed' | 'failed' | 'cancelled';
  created_at: string;
  updated_at: string;
  last_sequence?: number;
  is_terminal?: boolean;
  [key: string]: unknown;
};

type RuntimeRunEvent = {
  event_id?: string;
  event_type?: string;
  run_id?: string;
  task_id?: string;
  trace_id?: string;
  sequence?: number;
  occurred_at?: string;
  status?: RuntimeRunSnapshot['status'];
  payload?: Record<string, unknown>;
  [key: string]: unknown;
};

type RedfoxSkillHubRunSpec = {
  provider: 'redfox-skillhub';
  packageCode?: string;
  packageName?: string;
  skillNo?: string;
  skillCode: string;
  skillName: string;
  repoUrl?: string;
  requiresApiKey: boolean;
  input: Record<string, unknown>;
  outputObjects: string[];
};

type RedfoxSkillHubDirectory = {
  directory: string;
  source: string;
};

type RedfoxSkillHubScript = {
  command: string;
  args: string[];
  cwd: string;
  scriptPath: string;
  label: string;
};

type RedfoxSkillHubScriptResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
};

type RedfoxSkillHubInstallResult = {
  attempted: boolean;
  ok: boolean;
  status: 'installed' | 'already_present' | 'disabled' | 'skipped' | 'failed';
  message: string;
  source: string | null;
  targetDirectory: string | null;
  repoUrl: string | null;
  durationMs?: number;
  command?: string;
  stderrPreview?: string;
};

@Injectable()
export class AgentSService {
  private readonly logger = new Logger(AgentSService.name);
  private readonly client: AxiosInstance;
  private readonly config: AgentSSidecarConfig;
  private status: AgentSManagerStatus;
  private readonly runtimeSessions = new Map<
    string,
    AgentSSidecarSessionSummary & { active_run_id?: string | null }
  >();
  private readonly localSkillEvents = new Map<string, AgentSSidecarEvent[]>();
  private readonly localSkillChildren = new Map<
    string,
    ReturnType<typeof spawn>
  >();
  private readonly localSkillArtifacts = new Map<
    string,
    AgentSSidecarArtifact[]
  >();
  private readonly localSkillArtifactContents = new Map<
    string,
    Map<string, string | Buffer>
  >();
  private readonly conversationSessions = new Map<
    string,
    AgentSConversationState
  >();
  private readonly hydratedConversationScopes = new Set<string>();
  private readonly conversationHydrationQueues = new Map<
    string,
    Promise<void>
  >();
  private readonly conversationPersistQueues = new Map<string, Promise<void>>();
  private readonly runtimeSessionStartedAt = new Map<string, number>();
  private readonly runtimeSessionTimeoutMs = 120000;

  constructor(
    private readonly configService: ConfigService,
    private readonly aiClient: AiClientService,
    private readonly defaultModels: DefaultModelsService,
    @Optional() private readonly prisma?: PrismaService,
    @Optional()
    private readonly authRequestContext?: AuthRequestContextService,
  ) {
    const baseUrl =
      this.configService.get<string>('AGENT_S_BASE_URL') ||
      'http://127.0.0.1:17777';
    const authToken =
      this.configService.get<string>('KAYPAL_AGENT_S_TOKEN') ||
      this.configService.get<string>('KAYPAL_RUNTIME_SHARED_SECRET') ||
      '';
    this.config = {
      baseUrl,
      healthPath: '/healthz',
      statusPath: '/healthz',
      stopPath: '/stop',
      requestTimeoutMs: 10000,
      headers: authToken ? { 'x-kaypal-agent-s-token': authToken } : {},
    };

    this.client = axios.create({
      baseURL: this.config.baseUrl,
      timeout: this.config.requestTimeoutMs,
      headers: this.config.headers,
    });

    this.status = {
      phase: 'idle',
      baseUrl: this.config.baseUrl,
      connected: false,
      canSpawn: false,
      spawnImplemented: false,
    };
  }

  async ensureRunning(
    _options: { allowSpawn?: boolean } = {},
  ): Promise<AgentSManagerStatus> {
    this.status = {
      ...this.status,
      phase: 'connecting',
      lastError: undefined,
    };

    try {
      const [health, sidecarStatus] = await Promise.all([
        this.health(),
        this.getSidecarStatus(),
      ]);

      if (health.ok === false || sidecarStatus.state === 'unavailable') {
        this.status = {
          ...this.status,
          phase: 'idle',
          connected: false,
          lastError: `Agent-S sidecar 未运行 (${this.config.baseUrl})。请启动 Kaypal Desktop 或手动启动 sidecar 服务。`,
        };
        return this.cloneStatus();
      }

      this.markReady(health, sidecarStatus);
      this.logger.log(`Connected to Agent-S sidecar at ${this.config.baseUrl}`);
      return this.cloneStatus();
    } catch (error) {
      const message = this.getErrorMessage(error);
      this.status = {
        ...this.status,
        phase: 'idle',
        connected: false,
        lastError: `Agent-S sidecar 连接失败: ${message}`,
      };
      this.logger.warn(`Agent-S sidecar is not reachable: ${message}`);
      return this.cloneStatus();
    }
  }

  async getStatus(
    options: { refresh?: boolean } = {},
  ): Promise<AgentSManagerStatus> {
    if (!options.refresh) {
      return this.cloneStatus();
    }

    try {
      const [health, sidecarStatus] = await Promise.all([
        this.health(),
        this.getSidecarStatus(),
      ]);
      this.markReady(health, sidecarStatus);
    } catch (error) {
      const message = this.getErrorMessage(error);
      this.status = {
        ...this.status,
        connected: false,
        phase: 'error',
        lastError: message,
      };
    }

    return this.cloneStatus();
  }

  async stop(): Promise<AgentSManagerStatus> {
    if (!this.status.connected) {
      this.status = {
        ...this.status,
        phase: 'stopped',
        connected: false,
      };
      return this.cloneStatus();
    }

    this.status = {
      ...this.status,
      phase: 'stopping',
      lastError: undefined,
    };

    try {
      await this.client.post(this.config.stopPath || '/stop');
      this.status = {
        ...this.status,
        phase: 'stopped',
        connected: false,
      };
      this.logger.log(
        `Stopped Agent-S sidecar connection at ${this.config.baseUrl}`,
      );
    } catch (error) {
      const message = this.getErrorMessage(error);
      this.status = {
        ...this.status,
        phase: 'error',
        lastError: message,
      };
      throw new Error(`Failed to stop Agent-S sidecar: ${message}`);
    }

    return this.cloneStatus();
  }

  async health(): Promise<AgentSSidecarHealthResponse> {
    try {
      const response = await this.client.get<AgentSSidecarHealthResponse>(
        this.config.healthPath || '/health',
      );
      // sidecar 实际返的格式：{ status: "ok", service: "...", ... }（无 ok 字段）
      // 把 status 映射到 ok 字段，让 RuntimeOrchestrator.healthCheck 能识别健康
      const data = response.data || {};
      if (data.ok !== true && data.status === 'ok') {
        return { ...data, ok: true };
      }
      return data;
    } catch {
      return {
        ok: false,
        status: 'unavailable',
        service: 'agent-s-sidecar',
        version: 'unknown',
      };
    }
  }

  async getSidecarStatus(): Promise<AgentSSidecarStatusResponse> {
    try {
      const response = await this.client.get<AgentSSidecarStatusResponse>(
        this.config.statusPath || '/status',
      );
      return response.data;
    } catch {
      return {
        state: 'unavailable',
        version: 'unknown',
        session_count: 0,
        uptime_ms: 0,
      };
    }
  }

  async isAvailable(): Promise<boolean> {
    const health = await this.health();
    return health.ok === true;
  }

  async createSession(
    input: AgentSSidecarCreateSessionInput,
  ): Promise<{ session: AgentSSidecarSessionSummary }> {
    const conversationScope = this.isConversationCreateInput(input)
      ? await this.resolveConversationScope()
      : null;
    const effectiveInput = conversationScope
      ? {
          ...input,
          metadata: {
            ...(input.metadata || {}),
            tenant_id: conversationScope.tenantId,
            user_id: conversationScope.userId,
          },
        }
      : input;
    try {
      const response = await this.client.post<{
        session: AgentSSidecarSessionSummary;
      }>('/sessions', effectiveInput);
      await this.registerConversationSession(
        response.data.session,
        effectiveInput,
        conversationScope,
      );
      return response.data;
    } catch (error) {
      if (!this.shouldFallbackToRuntimeSession(error)) {
        throw error;
      }
      const now = new Date().toISOString();
      const session: AgentSSidecarSessionSummary = {
        session_id: `runtime-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        session_name: effectiveInput.session_name || null,
        task_type: effectiveInput.task_type || 'ops-workbench.task',
        status: 'idle',
        created_at: now,
        updated_at: now,
        completed_at: null,
        metadata: effectiveInput.metadata || {},
        labels: effectiveInput.labels || [],
        run_count: 0,
        active_run_id: null,
        cancellation_requested: false,
        last_error: null,
        last_event_seq: 0,
        artifact_count: 0,
      };
      this.runtimeSessions.set(session.session_id, session);
      await this.registerConversationSession(
        session,
        effectiveInput,
        conversationScope,
      );
      return { session };
    }
  }

  async runTask(
    sessionId: string,
    input: AgentSSidecarRunTaskInput,
  ): Promise<{
    accepted: boolean;
    session_id: string;
    run_id: string;
    status: string;
  }> {
    if (await this.isConversationSession(sessionId)) {
      return this.runConversationTask(sessionId, input);
    }
    return this.runTaskThroughExecutor(sessionId, input);
  }

  private async runTaskThroughExecutor(
    sessionId: string,
    input: AgentSSidecarRunTaskInput,
  ): Promise<{
    accepted: boolean;
    session_id: string;
    run_id: string;
    status: string;
  }> {
    const localSkillResult = await this.tryRunLocalSkill(sessionId, input);
    if (localSkillResult) {
      return localSkillResult;
    }

    try {
      const response = await this.client.post<{
        accepted: boolean;
        session_id: string;
        run_id: string;
        status: string;
      }>(`/sessions/${sessionId}/run`, input);
      return response.data;
    } catch (error) {
      if (!this.isNotFound(error)) {
        throw error;
      }
      const session = this.runtimeSessions.get(sessionId);
      const metadata: Record<string, unknown> = {
        ...(session?.metadata || {}),
        ...(input.metadata || {}),
        source:
          input.metadata?.source ||
          session?.metadata.source ||
          'ai-content-agent-s',
        sessionId,
        taskType: input.task_type || session?.task_type || 'ops-workbench.task',
        riskLevel: input.risk_level || 'medium',
      };
      this.attachBrowserStorageStatePath(metadata);
      const approvedTools = this.normalizeStringList(
        metadata.approvedTools || metadata.approved_tools,
      );
      const response = await this.client.post<RuntimeRunSnapshot>('/runs', {
        task_id: `${input.task_type || session?.task_type || 'agent-s-task'}:${sessionId}`,
        user_id: 'ai-content-user',
        sandbox_profile: 'restricted',
        approved_tools: approvedTools.length
          ? approvedTools
          : ['local-controller'],
        metadata,
        input_messages: [
          { role: 'user', content: input.instruction, metadata: {} },
        ],
      });
      const snapshot = response.data;
      if (session) {
        const updated: AgentSSidecarSessionSummary = {
          ...session,
          status: this.mapRuntimeStatus(snapshot.status),
          updated_at: snapshot.updated_at || new Date().toISOString(),
          run_count: session.run_count + 1,
          active_run_id: snapshot.run_id,
          last_event_seq: snapshot.last_sequence || session.last_event_seq || 0,
        };
        this.runtimeSessions.set(sessionId, updated);
        this.runtimeSessionStartedAt.set(sessionId, Date.now());
      }
      return {
        accepted: true,
        session_id: sessionId,
        run_id: snapshot.run_id,
        status: this.mapRuntimeStatus(snapshot.status),
      };
    }
  }

  async isConversationSession(sessionId: string): Promise<boolean> {
    return Boolean(await this.findConversationSession(sessionId));
  }

  async listConversationSessions(limit = 50): Promise<{
    sessions: AgentSConversationSessionDetail[];
  }> {
    const scope = await this.resolveConversationScope();
    await this.hydrateConversationSessions(scope);
    const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 100));
    const sessions = [...this.conversationSessions.values()]
      .filter((state) => this.isConversationStateInScope(state, scope))
      .sort(
        (left, right) =>
          new Date(right.session.updated_at).getTime() -
          new Date(left.session.updated_at).getTime(),
      )
      .slice(0, safeLimit)
      .map((state) => this.cloneConversationSession(state));
    return { sessions };
  }

  async getConversationSession(
    sessionId: string,
  ): Promise<AgentSConversationSessionDetail> {
    return this.cloneConversationSession(
      await this.requireConversationSession(sessionId),
    );
  }

  async retryConversationSession(sessionId: string) {
    const state = await this.requireConversationSession(sessionId);
    if (
      state.session.status === 'running' ||
      state.session.status === 'waiting_approval'
    ) {
      throw new ConflictException('当前对话仍在运行或等待确认，不能重复提交。');
    }
    if (!state.last_run_input) {
      throw new BadRequestException('当前对话没有可重试的上一条消息。');
    }
    return this.runConversationTask(sessionId, {
      ...state.last_run_input,
      metadata: { ...(state.last_run_input.metadata || {}) },
      attachments: [...(state.last_run_input.attachments || [])],
    });
  }

  private async runConversationTask(
    sessionId: string,
    input: AgentSSidecarRunTaskInput,
  ): Promise<{
    accepted: boolean;
    session_id: string;
    run_id: string;
    status: string;
  }> {
    const state = await this.requireConversationSession(sessionId);
    if (
      state.session.status === 'running' ||
      state.session.status === 'waiting_approval'
    ) {
      throw new ConflictException(
        '当前对话仍在运行或等待确认，请先完成当前步骤。',
      );
    }

    const instruction = String(input.instruction || '').trim();
    if (!instruction) {
      throw new BadRequestException('请输入消息后再发送。');
    }
    const metadata = { ...(input.metadata || {}) };
    const purpose = this.normalizeConversationPurpose(
      metadata.conversation_purpose || state.purpose,
    );
    const modelId =
      this.asNonEmptyString(metadata.conversation_model_id) || state.model_id;
    const attachments = this.sanitizeConversationAttachments(
      input.attachments || metadata.attachments,
    );
    const normalizedInput: AgentSSidecarRunTaskInput = {
      ...input,
      instruction,
      metadata: {
        ...metadata,
        conversation_mode: true,
        conversation_purpose: purpose,
        conversation_model_id: modelId,
        attachments,
        tenant_id: state.tenantId,
        user_id: state.userId,
      },
      attachments,
    };
    const now = new Date().toISOString();

    state.purpose = purpose;
    state.model_id = modelId || null;
    state.last_run_input = normalizedInput;
    state.cancellation_requested = false;
    state.session.cancellation_requested = false;
    state.session.updated_at = now;
    if (
      !state.session.session_name ||
      ['Agent 对话', '新对话'].includes(state.session.session_name)
    ) {
      state.session.session_name = instruction.slice(0, 40);
    }
    this.appendConversationMessage(state, {
      role: 'user',
      kind: 'message',
      content: instruction,
      created_at: now,
      purpose,
      model_id: modelId || null,
      attachments,
      metadata: {},
    });
    await this.persistConversationState(state);

    if (purpose !== 'execute') {
      return this.runConversationModelTurn(state, normalizedInput);
    }

    const runMetadata = {
      ...metadata,
      conversation_mode: true,
      conversation_purpose: purpose,
      conversation_model_id: modelId,
      conversation_history: this.buildConversationHistoryPayload(state),
      attachments,
      tenant_id: state.tenantId,
      user_id: state.userId,
      local_controller_permission_mode: 'custom',
      agent_s_execution_policy: 'approval_execute',
      allow_desktop_action_execution: true,
    };
    const executorInput: AgentSSidecarRunTaskInput = {
      instruction: this.buildConversationExecutorInstruction(
        state,
        instruction,
        attachments,
      ),
      task_type: input.task_type || 'agent.conversation.execute',
      metadata: runMetadata,
      risk_level: 'high',
      requires_approval: true,
      step_count: input.step_count,
    };
    state.last_run_kind = 'executor';
    state.session.status = 'running';
    this.appendConversationEvent(state, {
      event_type: 'conversation_turn_submitted',
      status: 'running',
      message: '执行请求已提交给 Agent-S。',
      payload: {
        purpose,
        model_id: modelId,
        requires_approval: true,
        attachment_count: attachments.length,
      },
    });
    await this.persistConversationState(state);

    try {
      const result = await this.runTaskThroughExecutor(
        sessionId,
        executorInput,
      );
      state.session.run_count += 1;
      state.session.active_run_id = result.run_id;
      state.session.status = this.normalizeConversationStatus(result.status);
      state.session.updated_at = new Date().toISOString();
      await this.persistConversationState(state);
      return result;
    } catch (error) {
      const message = this.getErrorMessage(error);
      state.session.status = 'failed';
      state.session.active_run_id = null;
      state.session.last_error = message;
      state.session.completed_at = new Date().toISOString();
      this.appendConversationEvent(state, {
        event_type: 'conversation_turn_failed',
        status: 'failed',
        message,
        payload: { stage: 'agent-s-submit' },
      });
      this.appendConversationMessage(state, {
        role: 'assistant',
        kind: 'result',
        content: `Agent-S 未能开始执行：${message}`,
        created_at: new Date().toISOString(),
        status: 'failed',
        purpose,
        model_id: modelId || null,
        attachments: [],
        metadata: { stage: 'agent-s-submit' },
      });
      await this.persistConversationState(state);
      throw error;
    }
  }

  private async runConversationModelTurn(
    state: AgentSConversationState,
    input: AgentSSidecarRunTaskInput,
  ): Promise<{
    accepted: boolean;
    session_id: string;
    run_id: string;
    status: string;
  }> {
    const runId = `conversation-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const purpose = this.normalizeConversationPurpose(
      input.metadata?.conversation_purpose || state.purpose,
    );
    const attachments = input.attachments || [];
    const modelId = await this.resolveConversationModelId(
      this.asNonEmptyString(input.metadata?.conversation_model_id) ||
        state.model_id,
    );

    state.model_id = modelId;
    state.last_run_kind = 'model';
    state.session.status = 'running';
    state.session.active_run_id = runId;
    state.session.completed_at = null;
    state.session.last_error = null;
    state.session.run_count += 1;
    this.appendConversationEvent(state, {
      run_id: runId,
      event_type: 'conversation_turn_started',
      status: 'running',
      message: '已交给所选模型处理。',
      payload: {
        purpose,
        model_id: modelId,
        attachment_count: attachments.length,
      },
    });
    await this.persistConversationState(state);

    try {
      const result = await this.generateConversationReply(
        state,
        input.instruction,
        purpose,
        modelId,
        attachments,
      );
      if (state.cancellation_requested) {
        state.session.status = 'cancelled';
        state.session.active_run_id = null;
        state.session.completed_at = new Date().toISOString();
        this.appendConversationEvent(state, {
          run_id: runId,
          event_type: 'conversation_turn_cancelled',
          status: 'cancelled',
          message: '本轮已取消，模型结果未写入对话。',
          payload: { purpose, model_id: modelId },
        });
        await this.persistConversationState(state);
        return {
          accepted: true,
          session_id: state.session.session_id,
          run_id: runId,
          status: 'cancelled',
        };
      }

      const artifact = this.writeConversationArtifact(
        state.session.session_id,
        runId,
        result,
        { purpose, model_id: modelId },
      );
      const completedAt = new Date().toISOString();
      state.session.status = 'completed';
      state.session.active_run_id = null;
      state.session.updated_at = completedAt;
      state.session.completed_at = completedAt;
      state.session.artifact_count =
        this.localSkillArtifacts.get(state.session.session_id)?.length || 0;
      this.appendConversationMessage(state, {
        role: 'assistant',
        kind: 'result',
        content: result,
        created_at: completedAt,
        run_id: runId,
        status: 'completed',
        purpose,
        model_id: modelId,
        attachments: [],
        metadata: {
          artifact_id: artifact.artifact_id,
          source: 'configured-model',
        },
      });
      this.appendConversationEvent(state, {
        run_id: runId,
        event_type: 'conversation_result',
        status: 'completed',
        message: '模型结果已写入对话。',
        artifact_id: artifact.artifact_id,
        payload: {
          purpose,
          model_id: modelId,
          result,
          source: 'configured-model',
          attachments: attachments.map((attachment) => ({
            filename: attachment.filename,
            mimeType: attachment.mimeType,
          })),
        },
      });
      await this.persistConversationState(state);
      return {
        accepted: true,
        session_id: state.session.session_id,
        run_id: runId,
        status: 'completed',
      };
    } catch (error) {
      const message = this.getErrorMessage(error);
      state.session.status = 'failed';
      state.session.active_run_id = null;
      state.session.last_error = message;
      state.session.completed_at = new Date().toISOString();
      this.appendConversationEvent(state, {
        run_id: runId,
        event_type: 'conversation_turn_failed',
        status: 'failed',
        message,
        payload: { purpose, model_id: modelId, stage: 'model-generation' },
      });
      this.appendConversationMessage(state, {
        role: 'assistant',
        kind: 'result',
        content: `本轮处理失败：${message}`,
        created_at: new Date().toISOString(),
        run_id: runId,
        status: 'failed',
        purpose,
        model_id: modelId,
        attachments: [],
        metadata: { stage: 'model-generation' },
      });
      await this.persistConversationState(state);
      throw error;
    }
  }

  async getEvents(
    sessionId: string,
    afterSeq?: number,
  ): Promise<{
    session_id: string;
    after_seq: number;
    next_seq: number;
    events: AgentSSidecarEvent[];
  }> {
    if (await this.isConversationSession(sessionId)) {
      return this.getConversationEvents(sessionId, afterSeq);
    }
    return this.getEventsThroughExecutor(sessionId, afterSeq);
  }

  private async getEventsThroughExecutor(
    sessionId: string,
    afterSeq?: number,
  ): Promise<{
    session_id: string;
    after_seq: number;
    next_seq: number;
    events: AgentSSidecarEvent[];
  }> {
    const localEvents = this.localSkillEvents.get(sessionId);
    if (localEvents) {
      const filteredEvents = localEvents.filter(
        (event) => event.seq > (afterSeq || 0),
      );
      const nextSeq = localEvents.reduce(
        (max, event) => Math.max(max, event.seq),
        afterSeq || 0,
      );
      return {
        session_id: sessionId,
        after_seq: afterSeq || 0,
        next_seq: nextSeq,
        events: filteredEvents,
      };
    }

    const runtimeSession = this.runtimeSessions.get(sessionId);
    if (runtimeSession?.active_run_id) {
      return this.getRuntimeSessionEvents(
        sessionId,
        runtimeSession.active_run_id,
        afterSeq,
      );
    }

    try {
      const params = afterSeq !== undefined ? { after_seq: afterSeq } : {};
      const response = await this.client.get<{
        session_id: string;
        after_seq: number;
        next_seq: number;
        events: AgentSSidecarEvent[];
      }>(`/sessions/${sessionId}/events`, {
        params,
      });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        const session = this.runtimeSessions.get(sessionId);
        const runId = session?.active_run_id;
        if (runId) {
          return this.getRuntimeSessionEvents(sessionId, runId, afterSeq);
        }
        return {
          session_id: sessionId,
          after_seq: afterSeq || 0,
          next_seq: 0,
          events: [],
        };
      }
      throw error;
    }
  }

  private async getConversationEvents(
    sessionId: string,
    afterSeq?: number,
  ): Promise<{
    session_id: string;
    after_seq: number;
    next_seq: number;
    events: AgentSSidecarEvent[];
  }> {
    const state = await this.requireConversationSession(sessionId);
    let changed = false;
    if (state.last_run_kind === 'executor') {
      const external = await this.getEventsThroughExecutor(sessionId);
      for (const event of external.events || []) {
        const sourceKey = [
          event.run_id || 'session',
          event.seq,
          event.event_type,
        ].join(':');
        if (state.ingested_executor_event_keys.has(sourceKey)) continue;
        state.ingested_executor_event_keys.add(sourceKey);
        this.ingestConversationExecutorEvent(state, event);
        changed = true;
      }
    }

    if (changed) {
      await this.persistConversationState(state);
    }

    const fromSeq = Number.isFinite(afterSeq) ? Number(afterSeq) : 0;
    const nextSeq = state.events.reduce(
      (max, event) => Math.max(max, event.seq),
      0,
    );
    return {
      session_id: sessionId,
      after_seq: fromSeq,
      next_seq: nextSeq,
      events: state.events
        .filter((event) => event.seq > fromSeq)
        .map((event) => ({ ...event, payload: { ...event.payload } })),
    };
  }

  private ingestConversationExecutorEvent(
    state: AgentSConversationState,
    sourceEvent: AgentSSidecarEvent,
  ) {
    const event = this.appendConversationEvent(state, {
      run_id: sourceEvent.run_id,
      event_type: sourceEvent.event_type,
      status: sourceEvent.status,
      message: sourceEvent.message,
      step_index: sourceEvent.step_index,
      artifact_id: sourceEvent.artifact_id,
      created_at: sourceEvent.created_at,
      payload: {
        ...sourceEvent.payload,
        source: 'agent-s-executor',
        source_seq: sourceEvent.seq,
      },
    });
    const eventType = sourceEvent.event_type.toLowerCase();
    const payload = sourceEvent.payload || {};

    if (eventType.includes('approval_required')) {
      const content =
        this.asNonEmptyString(payload.approval_prompt) ||
        this.asNonEmptyString(payload.approval_hint) ||
        sourceEvent.message ||
        'Agent-S 需要确认后才能继续。';
      this.appendConversationMessage(state, {
        role: 'assistant',
        kind: 'confirmation',
        content,
        created_at: sourceEvent.created_at,
        run_id: sourceEvent.run_id,
        status: 'waiting_approval',
        purpose: 'execute',
        model_id: state.model_id,
        attachments: [],
        event_seq: event.seq,
        metadata: { ...payload },
      });
      return;
    }

    const isCompleted =
      sourceEvent.status === 'completed' &&
      /(run|task|skill).*completed|completed$/.test(eventType);
    const isFailed =
      ['failed', 'blocked', 'cancelled'].includes(sourceEvent.status) &&
      /(run|task|skill|runtime|conversation).*(failed|blocked|cancel)/.test(
        eventType,
      );
    if (!isCompleted && !isFailed) return;

    const content =
      this.asNonEmptyString(payload.summary) ||
      this.asNonEmptyString(payload.result) ||
      sourceEvent.message ||
      (isCompleted
        ? 'Agent-S 已返回完成事件。'
        : 'Agent-S 已返回失败或取消事件。');
    this.appendConversationMessage(state, {
      role: 'assistant',
      kind: 'result',
      content,
      created_at: sourceEvent.created_at,
      run_id: sourceEvent.run_id,
      status: sourceEvent.status,
      purpose: 'execute',
      model_id: state.model_id,
      attachments: [],
      event_seq: event.seq,
      metadata: { ...payload },
    });
  }

  private async getRuntimeSessionEvents(
    sessionId: string,
    runId: string,
    afterSeq?: number,
  ): Promise<{
    session_id: string;
    after_seq: number;
    next_seq: number;
    events: AgentSSidecarEvent[];
  }> {
    const runtimeEvents = await this.getRunEvents(runId, afterSeq);
    const mappedEvents = (
      runtimeEvents.events as unknown as RuntimeRunEvent[]
    ).map((event) => this.mapRuntimeEventToSessionEvent(sessionId, event));
    const nextSeq = mappedEvents.reduce(
      (max, event) => Math.max(max, event.seq),
      afterSeq || 0,
    );
    const session = this.runtimeSessions.get(sessionId);
    if (session) {
      const runtimeStatus = this.mapRuntimeStatus(
        (runtimeEvents.run.status as RuntimeRunSnapshot['status']) ||
          session.status,
      );
      const startedAt = this.runtimeSessionStartedAt.get(sessionId);
      const timedOut =
        runtimeStatus === 'running' &&
        Boolean(startedAt) &&
        Date.now() - Number(startedAt) > this.runtimeSessionTimeoutMs;
      this.runtimeSessions.set(sessionId, {
        ...session,
        status: timedOut ? 'failed' : runtimeStatus,
        updated_at:
          (runtimeEvents.run.updated_at as string) || session.updated_at,
        completed_at: timedOut
          ? new Date().toISOString()
          : session.completed_at,
        last_error: timedOut
          ? 'Agent-S 运行超过 120 秒未返回发送结果，已自动停止等待。'
          : session.last_error,
        last_event_seq: nextSeq,
      });
      if (
        timedOut &&
        !mappedEvents.some((event) => event.event_type === 'RuntimeTimeout')
      ) {
        mappedEvents.push({
          seq: nextSeq + 1,
          session_id: sessionId,
          run_id: runId,
          event_type: 'RuntimeTimeout',
          status: 'failed',
          created_at: new Date().toISOString(),
          message: 'Agent-S 运行超过 120 秒未返回发送结果，已自动停止等待。',
          step_index: null,
          artifact_id: null,
          payload: { timeoutMs: this.runtimeSessionTimeoutMs },
        });
      }
    }
    return {
      session_id: sessionId,
      after_seq: afterSeq || 0,
      next_seq: nextSeq,
      events: mappedEvents,
    };
  }

  async cancelSession(sessionId: string): Promise<{
    session_id: string;
    status: string;
    cancellation_requested: boolean;
  }> {
    const localSession = this.runtimeSessions.get(sessionId);
    if (
      localSession &&
      (this.localSkillEvents.has(sessionId) ||
        this.localSkillChildren.has(sessionId))
    ) {
      const now = new Date().toISOString();
      this.runtimeSessions.set(sessionId, {
        ...localSession,
        status: 'cancelled',
        cancellation_requested: true,
        updated_at: now,
        completed_at: now,
      });
      const child = this.localSkillChildren.get(sessionId);
      if (child && !child.killed) child.kill('SIGTERM');
      const events = this.localSkillEvents.get(sessionId) || [];
      if (!events.some((event) => event.event_type === 'SkillCancelled')) {
        events.push({
          seq: events.length + 1,
          session_id: sessionId,
          run_id: localSession.active_run_id,
          event_type: 'SkillCancelled',
          status: 'cancelled',
          created_at: now,
          message: '已停止当前对象后的后续微信执行。',
          step_index: events.length,
          artifact_id: null,
          payload: { source: 'user', preserveCompletedTargets: true },
        });
        this.localSkillEvents.set(sessionId, events);
      }
      return {
        session_id: sessionId,
        status: 'cancelled',
        cancellation_requested: true,
      };
    }
    const conversation = await this.findConversationSession(sessionId);
    if (conversation?.last_run_kind === 'model') {
      conversation.cancellation_requested = true;
      conversation.session.cancellation_requested = true;
      conversation.session.status = 'cancelled';
      conversation.session.active_run_id = null;
      conversation.session.completed_at = new Date().toISOString();
      this.appendConversationEvent(conversation, {
        event_type: 'conversation_cancel_requested',
        status: 'cancelled',
        message: '已取消当前模型处理。',
        payload: { source: 'user' },
      });
      await this.persistConversationState(conversation);
      return {
        session_id: sessionId,
        status: 'cancelled',
        cancellation_requested: true,
      };
    }

    const response = await this.client.post<{
      session_id: string;
      status: string;
      cancellation_requested: boolean;
    }>(`/sessions/${sessionId}/cancel`);
    if (conversation) {
      conversation.cancellation_requested = true;
      conversation.session.cancellation_requested =
        response.data.cancellation_requested;
      conversation.session.status = this.normalizeConversationStatus(
        response.data.status,
      );
      conversation.session.updated_at = new Date().toISOString();
      this.appendConversationEvent(conversation, {
        event_type: 'conversation_cancel_requested',
        status: conversation.session.status,
        message: '已向 Agent-S 请求取消当前执行。',
        payload: { source: 'user' },
      });
      await this.persistConversationState(conversation);
    }
    return response.data;
  }

  async approveSession(
    sessionId: string,
    input: AgentSSidecarApprovalDecisionInput,
  ): Promise<{ session_id: string; status: string; decision: string }> {
    const conversation = await this.findConversationSession(sessionId);
    const result = await this.approveExecutorSession(sessionId, input);
    if (conversation) {
      const status = this.normalizeConversationStatus(result.status);
      conversation.session.status = status;
      conversation.session.updated_at = new Date().toISOString();
      conversation.session.cancellation_requested = false;
      if (['completed', 'failed', 'cancelled'].includes(status)) {
        conversation.session.active_run_id = null;
        conversation.session.completed_at = conversation.session.updated_at;
      }
      const approved = input.decision === 'approved';
      const event = this.appendConversationEvent(conversation, {
        event_type: approved
          ? 'conversation_approval_granted'
          : 'conversation_approval_rejected',
        status,
        message: approved ? '用户已确认继续执行。' : '用户已拒绝执行。',
        payload: {
          decision: input.decision,
          comment: input.comment || null,
        },
      });
      this.appendConversationMessage(conversation, {
        role: 'user',
        kind: 'status',
        content: approved ? '确认执行' : '拒绝执行',
        created_at: event.created_at,
        run_id: conversation.session.active_run_id,
        status,
        purpose: 'execute',
        model_id: conversation.model_id,
        attachments: [],
        event_seq: event.seq,
        metadata: { comment: input.comment || null },
      });
      await this.persistConversationState(conversation);
    }
    return result;
  }

  private async approveExecutorSession(
    sessionId: string,
    input: AgentSSidecarApprovalDecisionInput,
  ): Promise<{ session_id: string; status: string; decision: string }> {
    try {
      const response = await this.client.post<{
        session_id: string;
        status: string;
        decision: string;
      }>(`/sessions/${sessionId}/approve`, input);
      return response.data;
    } catch (error) {
      if (!this.isNotFound(error)) {
        throw error;
      }
      const response = await this.client.post<{
        session_id: string;
        status: string;
        decision: string;
      }>(`/sessions/${sessionId}/approval`, input);
      return response.data;
    }
  }

  async getArtifacts(
    sessionId: string,
  ): Promise<{ session_id: string; artifacts: AgentSSidecarArtifact[] }> {
    const conversation = await this.findConversationSession(sessionId);
    const localArtifacts = this.localSkillArtifacts.get(sessionId) || [];
    if (conversation && conversation.last_run_kind !== 'executor') {
      return { session_id: sessionId, artifacts: localArtifacts };
    }
    if (!conversation && localArtifacts.length) {
      return { session_id: sessionId, artifacts: localArtifacts };
    }
    try {
      const response = await this.client.get<{
        session_id: string;
        artifacts: AgentSSidecarArtifact[];
      }>(`/sessions/${sessionId}/artifacts`);
      const artifacts = [...localArtifacts, ...(response.data.artifacts || [])]
        .filter(
          (artifact, index, all) =>
            all.findIndex(
              (candidate) => candidate.artifact_id === artifact.artifact_id,
            ) === index,
        )
        .sort(
          (left, right) =>
            new Date(right.created_at).getTime() -
            new Date(left.created_at).getTime(),
        );
      if (conversation) {
        conversation.session.artifact_count = artifacts.length;
        conversation.artifacts = artifacts;
        this.localSkillArtifacts.set(sessionId, artifacts);
        await this.persistConversationState(conversation);
      }
      return { session_id: sessionId, artifacts };
    } catch (error) {
      if (
        (conversation || this.runtimeSessions.has(sessionId)) &&
        this.isNotFound(error)
      ) {
        return { session_id: sessionId, artifacts: localArtifacts };
      }
      if (localArtifacts.length && this.shouldFallbackToRuntimeSession(error)) {
        return { session_id: sessionId, artifacts: localArtifacts };
      }
      throw error;
    }
  }

  async getArtifact(
    sessionId: string,
    artifactId: string,
  ): Promise<{ artifact: AgentSSidecarArtifact; content: string | Buffer }> {
    await this.findConversationSession(sessionId);
    const localArtifacts = this.localSkillArtifacts.get(sessionId);
    const localArtifact = localArtifacts?.find(
      (artifact) => artifact.artifact_id === artifactId,
    );
    if (localArtifact) {
      const content =
        this.localSkillArtifactContents.get(sessionId)?.get(artifactId) ??
        (existsSync(localArtifact.path)
          ? readFileSync(localArtifact.path, 'utf8')
          : '');
      return { artifact: localArtifact, content };
    }
    const response = await this.client.get<{
      artifact: AgentSSidecarArtifact;
      content: string | Buffer;
    }>(`/sessions/${sessionId}/artifacts/${artifactId}`);
    return response.data;
  }

  async submitRun(input: {
    taskId: string;
    userId: string;
    instruction: string;
    sandboxProfile?: string;
    approvedTools?: string[];
    metadata?: Record<string, unknown>;
  }): Promise<{
    run_id: string;
    status: string;
    events: AgentSSidecarEvent[];
  }> {
    const metadata = { ...(input.metadata || {}) };
    this.attachBrowserStorageStatePath(metadata);
    try {
      const response = await this.client.post<{
        run_id: string;
        status: string;
        events: AgentSSidecarEvent[];
      }>('/runs', {
        task_id: input.taskId,
        user_id: input.userId,
        sandbox_profile: input.sandboxProfile || 'restricted',
        approved_tools: input.approvedTools || [],
        metadata,
        input_messages: [
          { role: 'user', content: input.instruction, metadata: {} },
        ],
      });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const detail =
          (error.response?.data as { detail?: string } | undefined)?.detail ||
          error.message;
        throw new Error(`Kaypal Runtime 执行失败: ${detail}`);
      }
      throw error;
    }
  }

  async getRunEvents(
    runId: string,
    afterSequence?: number,
  ): Promise<{ run: Record<string, unknown>; events: AgentSSidecarEvent[] }> {
    try {
      const params =
        afterSequence !== undefined ? { after_sequence: afterSequence } : {};
      const response = await this.client.get<{
        run: Record<string, unknown>;
        events: AgentSSidecarEvent[];
      }>(`/runs/${runId}/events`, {
        params,
      });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return { run: {}, events: [] };
      }
      throw error;
    }
  }

  private isNotFound(error: unknown): boolean {
    return axios.isAxiosError(error) && error.response?.status === 404;
  }

  private shouldFallbackToRuntimeSession(error: unknown): boolean {
    if (!axios.isAxiosError(error)) return false;
    if (error.response?.status === 404) return true;
    const code = String(error.code || '');
    return (
      code === 'ECONNREFUSED' ||
      code === 'ECONNRESET' ||
      code === 'ENOTFOUND' ||
      code === 'ETIMEDOUT' ||
      code === 'ECONNABORTED' ||
      !error.response
    );
  }

  private async tryRunLocalSkill(
    sessionId: string,
    input: AgentSSidecarRunTaskInput,
  ): Promise<{
    accepted: boolean;
    session_id: string;
    run_id: string;
    status: string;
  } | null> {
    const session = this.runtimeSessions.get(sessionId);
    const metadata: Record<string, unknown> = {
      ...(session?.metadata || {}),
      ...(input.metadata || {}),
    };
    const skillId =
      this.asNonEmptyString(metadata.skill_id) ||
      this.asNonEmptyString(input.task_type);
    if (this.isRedfoxSkillHubRoute(skillId, input, metadata)) {
      return this.runRedfoxSkillHubLocalSkill(
        sessionId,
        input,
        session,
        metadata,
      );
    }
    const isWechatContactAddSkill =
      skillId === 'wechat-contact-add' || skillId === 'wechat.contact.add';
    const isWechatFriendAcceptSkill =
      skillId === 'wechat-friend-accept' || skillId === 'wechat.friend.accept';
    const isWechatMomentsMarketingSkill =
      skillId === 'wechat-moments-marketing' ||
      skillId === 'wechat.moments.marketing';

    if (
      skillId !== 'wechat.live.auto_reply' &&
      skillId !== 'wechat.session.auto_reply' &&
      skillId !== 'wechat.group.broadcast' &&
      skillId !== 'wechat.moments.publish' &&
      skillId !== 'wechat-group-broadcast' &&
      skillId !== 'wechat-moments-publish' &&
      !isWechatContactAddSkill &&
      !isWechatFriendAcceptSkill &&
      !isWechatMomentsMarketingSkill
    ) {
      return null;
    }

    const detached = metadata.__agent_s_local_skill_detached === true;
    const interactionTaskId =
      this.asNonEmptyString(metadata.interaction_task_id) ||
      this.asNonEmptyString(metadata.interactionTaskId);
    if (interactionTaskId && !detached) {
      const runId = `local-skill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      void this.tryRunLocalSkill(sessionId, {
        ...input,
        metadata: {
          ...(input.metadata || {}),
          __agent_s_local_skill_detached: true,
          __agent_s_local_skill_run_id: runId,
        },
      }).catch((error) => {
        this.logger.error(
          `Detached Agent-S WeChat skill failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
      return {
        accepted: true,
        session_id: sessionId,
        run_id: runId,
        status: 'running',
      };
    }

    const runId =
      this.asNonEmptyString(metadata.__agent_s_local_skill_run_id) ||
      `local-skill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.logger.log(
      `Agent-S local SkillHub route accepted: skill=${skillId} session=${sessionId}`,
    );
    const events: AgentSSidecarEvent[] = [];
    const pushEvent = (
      event_type: string,
      status: AgentSSidecarSessionSummary['status'],
      message: string,
      payload: Record<string, unknown> = {},
    ) => {
      events.push({
        seq: events.length + 1,
        session_id: sessionId,
        run_id: runId,
        event_type,
        status,
        created_at: new Date().toISOString(),
        message,
        step_index: events.length,
        artifact_id: null,
        payload: {
          skill_id: skillId,
          ...payload,
        },
      });
    };

    const startedAt = new Date().toISOString();
    if (session) {
      this.runtimeSessions.set(sessionId, {
        ...session,
        status: 'running',
        updated_at: startedAt,
        run_count: session.run_count + 1,
        active_run_id: runId,
      });
    }

    pushEvent(
      'SkillStarted',
      'running',
      `${skillId} 开始调用本机 SkillHub 执行命令。`,
    );
    this.localSkillEvents.set(sessionId, events);
    const blockLocalSkill = (
      message: string,
      payload: Record<string, unknown>,
    ) => {
      pushEvent('SkillBlocked', 'blocked', message, {
        ...payload,
      });
      this.localSkillEvents.set(sessionId, events);
      if (session) {
        this.runtimeSessions.set(sessionId, {
          ...this.runtimeSessions.get(sessionId)!,
          status: 'blocked',
          updated_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          last_error: message,
          last_event_seq: events.length,
        });
      }
      return {
        accepted: true,
        session_id: sessionId,
        run_id: runId,
        status: 'blocked',
      };
    };
    const customerServiceDecision =
      this.readRecord(metadata.customerServiceDecision) || {};
    if (
      metadata.customerServiceNoReply === true ||
      customerServiceDecision.action === 'no-reply'
    ) {
      return blockLocalSkill('当前客服规则要求不自动回复，本次没有发送。', {
        customerServiceDecision,
        errorCode: 'review_required',
      });
    }
    const customerServiceNotBefore = this.asNonEmptyString(
      metadata.customerServiceNotBefore,
    );
    if (
      customerServiceNotBefore &&
      Date.parse(customerServiceNotBefore) > Date.now()
    ) {
      return blockLocalSkill('当前回复仍在等待设定的回复时间，本次没有发送。', {
        notBefore: customerServiceNotBefore,
        errorCode: 'review_required',
      });
    }
    const commercialExecutionBlocker =
      this.resolveWechatCommercialExecutionBlocker(metadata);
    if (commercialExecutionBlocker) {
      return blockLocalSkill(commercialExecutionBlocker, {
        errorCode: 'permission_missing',
        requestedMode: this.asNonEmptyString(metadata.wechat_reply_mode),
      });
    }
    const wechatAccountProtection =
      this.resolveWechatAccountProtection(metadata);
    if (wechatAccountProtection.blocker) {
      pushEvent('SkillFailed', 'failed', wechatAccountProtection.blocker, {
        error: wechatAccountProtection.blocker,
        associatedWeChat: wechatAccountProtection.associatedWeChat,
        currentWechatId: wechatAccountProtection.currentWechatId,
      });
      this.localSkillEvents.set(sessionId, events);
      if (session) {
        this.runtimeSessions.set(sessionId, {
          ...this.runtimeSessions.get(sessionId)!,
          status: 'failed',
          updated_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          last_error: wechatAccountProtection.blocker,
          last_event_seq: events.length,
        });
      }
      return {
        accepted: true,
        session_id: sessionId,
        run_id: runId,
        status: 'failed',
      };
    }
    if (wechatAccountProtection.warning) {
      pushEvent(
        'WechatAccountWarning',
        'running',
        wechatAccountProtection.warning,
        {
          warning: wechatAccountProtection.warning,
          associatedWeChat: wechatAccountProtection.associatedWeChat,
        },
      );
    }

    try {
      const nativeHandled = await this.tryRunWindowsWechatNativeSkill({
        sessionId,
        runId,
        skillId,
        input,
        metadata,
        pushEvent,
      });
      if (nativeHandled) {
        // The native runner already emitted per-target and final result events.
      } else if (isWechatFriendAcceptSkill) {
        throw new Error(
          '自动通过好友需要 Windows 桌面微信 native runtime；当前环境未执行任何好友申请。',
        );
      } else if (skillId === 'wechat.live.auto_reply') {
        const context =
          this.asNonEmptyString(metadata.wechat_context_note) ||
          this.extractLineValue(input.instruction, '补充要求') ||
          '';
        this.logger.log('Running wechat-live-auto-reply skill');
        const readResult = await this.runWechatLiveAutoReply(
          context,
          'read-only',
        );
        const aiReply = await this.generateWechatLiveReply(
          readResult.readText,
          context,
        );
        pushEvent(
          'WechatLiveRead',
          'running',
          `已读取当前微信聊天：${readResult.readText.slice(0, 120)}`,
          {
            context,
            readText: readResult.readText,
            generatedBy: aiReply.generatedBy,
          },
        );
        const result = await this.runWechatLiveAutoReply(
          context,
          'auto-send',
          aiReply.reply,
        );
        pushEvent(
          'SkillCompleted',
          'completed',
          `微信当前聊天已自动回复：${result.reply}`,
          {
            context,
            readText: readResult.readText,
            reply: result.reply,
            generatedBy: aiReply.generatedBy,
            screenshotPath: result.screenshotPath,
          },
        );
      } else if (skillId === 'wechat.session.auto_reply') {
        const contact =
          this.asNonEmptyString(metadata.wechat_contact_name) ||
          this.asNonEmptyString(metadata.wechat_expected_contact_name);
        const message =
          this.asNonEmptyString(metadata.wechat_reply_draft) ||
          this.extractLineValue(input.instruction, '回复内容');
        if (!contact || !message) {
          throw new Error('缺少目标联系人或回复内容，不能执行微信发送。');
        }
        const mode =
          this.asNonEmptyString(metadata.wechat_reply_mode) === 'auto-send'
            ? 'auto-send'
            : 'approval';
        this.logger.log(
          `Running wechat-auto-reply skill: contact=${contact} mode=${mode}`,
        );
        const result = await this.runWechatAutoReply(contact, message, mode);
        pushEvent(
          'SkillCompleted',
          'completed',
          mode === 'auto-send'
            ? `微信消息已发送给 ${contact}。`
            : `微信消息已填入 ${contact}，停在发送前。`,
          { contact, message, mode, screenshotPath: result.screenshotPath },
        );
      } else if (
        skillId === 'wechat.group.broadcast' ||
        skillId === 'wechat-group-broadcast'
      ) {
        const targets = this.normalizeStringList(metadata.wechat_group_targets);
        const message =
          this.asNonEmptyString(metadata.wechat_reply_draft) ||
          this.extractLineValue(input.instruction, '群发内容');
        const targetMessages = this.normalizeWechatTargetMessageMap(
          metadata.wechat_group_messages ?? metadata.wechat_mass_send_contents,
        );
        if (!targets.length || (!message && !targetMessages.size)) {
          throw new Error('缺少群发目标或群发内容，不能执行微信群发。');
        }
        const mode =
          this.asNonEmptyString(metadata.wechat_reply_mode) === 'auto-send'
            ? 'auto-send'
            : 'approval';
        const dailyLimit = this.normalizePositiveInteger(
          metadata.wechat_group_daily_limit,
          targets.length,
          200,
        );
        const intervalSeconds = this.normalizePositiveInteger(
          metadata.wechat_group_interval_seconds,
          0,
          3600,
        );
        const limitedTargets = targets.slice(
          0,
          Math.min(dailyLimit, targets.length),
        );
        if (limitedTargets.length < targets.length) {
          pushEvent(
            'SkillRateLimitApplied',
            'running',
            `已按每天上限截取 ${limitedTargets.length}/${targets.length} 个群发目标。`,
            {
              requestedTargets: targets.length,
              dailyLimit,
              selectedTargets: limitedTargets,
            },
          );
        }
        const results: Array<{
          target: string;
          status: 'success' | 'failed';
          message: string;
          screenshotPath?: string;
        }> = [];
        for (const [index, target] of limitedTargets.entries()) {
          pushEvent(
            'SkillTargetStarted',
            'running',
            `正在发送第 ${index + 1}/${limitedTargets.length} 个目标：${target}`,
            { target, dailyLimit, intervalSeconds },
          );
          this.logger.log(
            `Running wechat-auto-reply group skill: target=${target} mode=${mode}`,
          );
          try {
            const targetMessage = targetMessages.get(target) || message || '';
            if (!targetMessage) {
              throw new Error(`缺少 ${target} 的群发内容。`);
            }
            const result = await this.runWechatAutoReply(
              target,
              targetMessage,
              mode,
            );
            results.push({
              target,
              status: 'success',
              message:
                mode === 'auto-send'
                  ? `已发送给 ${target}。`
                  : `已填入 ${target}，停在发送前。`,
              screenshotPath: result.screenshotPath,
            });
            pushEvent(
              'SkillTargetCompleted',
              'running',
              mode === 'auto-send'
                ? `已发送给 ${target}。`
                : `已填入 ${target}，停在发送前。`,
              {
                target,
                message: targetMessage,
                mode,
                screenshotPath: result.screenshotPath,
                dailyLimit,
                intervalSeconds,
              },
            );
          } catch (error) {
            const failure =
              error instanceof Error ? error.message : String(error);
            results.push({ target, status: 'failed', message: failure });
            pushEvent(
              'SkillTargetFailed',
              'running',
              `发送给 ${target} 失败：${failure}`,
              {
                target,
                message: targetMessages.get(target) || message,
                mode,
                error: failure,
              },
            );
          }
          if (mode !== 'auto-send') {
            break;
          }
          if (intervalSeconds > 0 && index < limitedTargets.length - 1) {
            pushEvent(
              'SkillRateLimitWait',
              'running',
              `等待 ${intervalSeconds} 秒后继续下一个群发目标。`,
              { intervalSeconds, nextTarget: limitedTargets[index + 1] },
            );
            await this.delay(intervalSeconds * 1000);
          }
        }
        const successCount = results.filter(
          (result) => result.status === 'success',
        ).length;
        const failedCount = results.filter(
          (result) => result.status === 'failed',
        ).length;
        if (successCount === 0) {
          throw new Error(
            `微信群发没有任何目标发送成功：失败 ${failedCount} 个。`,
          );
        }
        pushEvent(
          'SkillCompleted',
          'completed',
          mode === 'auto-send'
            ? `微信群发完成：成功 ${successCount}，失败 ${failedCount}。`
            : '微信群发确认模式已停在首个目标发送前。',
          {
            targets,
            executedTargets: limitedTargets,
            message,
            targetMessages: Array.from(targetMessages.entries()).map(
              ([target, targetMessage]) => ({ target, message: targetMessage }),
            ),
            mode,
            dailyLimit,
            intervalSeconds,
            results,
            summary: {
              total: limitedTargets.length,
              requested: targets.length,
              success: successCount,
              failed: failedCount,
            },
            completedTargets: results
              .filter((result) => result.status === 'success')
              .map((result) => result.target),
            failedTargets: results
              .filter((result) => result.status === 'failed')
              .map((result) => ({
                targetName: result.target,
                reason: result.message,
              })),
            pendingTargets: targets.filter(
              (target) => !limitedTargets.includes(target),
            ),
          },
        );
      } else if (isWechatContactAddSkill || isWechatMomentsMarketingSkill) {
        if (isWechatContactAddSkill) {
          const targets = this.normalizeStringList(
            metadata.wechat_contact_add_targets,
          );
          const verifyMessage =
            this.asNonEmptyString(metadata.wechat_contact_add_verify_message) ||
            this.extractLineValue(input.instruction, '验证消息');
          if (!targets.length || !verifyMessage) {
            throw new Error('缺少加好友目标或验证消息，不能执行自动加好友。');
          }
          const mode =
            this.asNonEmptyString(metadata.wechat_reply_mode) === 'auto-send'
              ? 'auto-send'
              : 'approval';
          const dailyLimit = this.normalizePositiveInteger(
            metadata.wechat_contact_add_daily_limit,
            targets.length,
            50,
          );
          const blacklist = this.normalizeStringList(
            metadata.wechat_contact_add_blacklist,
          );
          const blacklistSet = new Set(
            blacklist.map((item) => item.trim().toLowerCase()).filter(Boolean),
          );
          const executableTargets = targets
            .filter((target) => !blacklistSet.has(target.trim().toLowerCase()))
            .slice(0, Math.min(dailyLimit, targets.length));
          const skippedByBlacklist = targets.filter((target) =>
            blacklistSet.has(target.trim().toLowerCase()),
          );
          const pendingTargets = targets.filter(
            (target) =>
              !blacklistSet.has(target.trim().toLowerCase()) &&
              !executableTargets.includes(target),
          );
          if (skippedByBlacklist.length) {
            pushEvent(
              'SkillBlacklistApplied',
              'running',
              `已跳过黑名单对象 ${skippedByBlacklist.length} 个。`,
              {
                skippedByBlacklist,
                blacklist,
                summary: {
                  requested: targets.length,
                  skipped: skippedByBlacklist.length,
                  pending: pendingTargets.length,
                  dailyLimit,
                },
              },
            );
          }
          if (
            executableTargets.length <
            targets.length - skippedByBlacklist.length
          ) {
            pushEvent(
              'SkillRateLimitApplied',
              'running',
              `已按每天上限截取 ${executableTargets.length}/${targets.length - skippedByBlacklist.length} 个加好友对象。`,
              {
                requestedTargets: targets.length,
                dailyLimit,
                selectedTargets: executableTargets,
                pendingTargets,
              },
            );
          }
          if (!executableTargets.length) {
            throw new Error(
              '所有加好友目标都被黑名单或每日上限过滤，不能执行自动加好友。',
            );
          }
          const results: Array<{
            target: string;
            status: 'success' | 'failed';
            message: string;
            screenshotPath?: string;
          }> = [];
          for (const [index, target] of executableTargets.entries()) {
            pushEvent(
              'SkillTargetStarted',
              'running',
              `正在处理第 ${index + 1}/${executableTargets.length} 个加好友对象：${target}`,
              { target, dailyLimit },
            );
            try {
              const result = await this.runWechatContactAdd(
                target,
                verifyMessage,
                mode,
              );
              results.push({
                target,
                status: 'success',
                message:
                  mode === 'auto-send'
                    ? `已向 ${target} 提交好友申请。`
                    : `已打开 ${target} 的好友申请窗口并等待继续执行。`,
                screenshotPath: result.screenshotPath,
              });
              const successMessage =
                results[results.length - 1]?.message || `已处理 ${target}`;
              pushEvent('SkillTargetCompleted', 'running', successMessage, {
                target,
                verifyMessage,
                mode,
                screenshotPath: result.screenshotPath,
                dailyLimit,
              });
            } catch (error) {
              const failure =
                error instanceof Error ? error.message : String(error);
              results.push({ target, status: 'failed', message: failure });
              pushEvent(
                'SkillTargetFailed',
                'running',
                `加好友 ${target} 失败：${failure}`,
                { target, verifyMessage, mode, error: failure },
              );
            }
            if (mode !== 'auto-send') {
              break;
            }
          }
          const successCount = results.filter(
            (result) => result.status === 'success',
          ).length;
          const failedCount = results.filter(
            (result) => result.status === 'failed',
          ).length;
          if (successCount === 0) {
            throw new Error(
              `自动加好友没有任何目标处理成功：失败 ${failedCount} 个。`,
            );
          }
          pushEvent(
            'SkillCompleted',
            'completed',
            mode === 'auto-send'
              ? `自动加好友完成：成功 ${successCount}，失败 ${failedCount}。`
              : '自动加好友确认模式已停在首个对象提交前。',
            {
              targets,
              executedTargets: executableTargets,
              skippedByBlacklist,
              pendingTargets,
              verifyMessage,
              mode,
              dailyLimit,
              results,
              summary: {
                total: executableTargets.length,
                requested: targets.length,
                success: successCount,
                failed: failedCount,
                skippedByBlacklist: skippedByBlacklist.length,
                skipped: skippedByBlacklist.length,
                pending: pendingTargets.length,
              },
              completedTargets: results
                .filter((result) => result.status === 'success')
                .map((result) => result.target),
              failedTargets: results
                .filter((result) => result.status === 'failed')
                .map((result) => ({
                  targetName: result.target,
                  reason: result.message,
                })),
              skippedTargets: skippedByBlacklist,
            },
          );
        } else {
          const marketingMode =
            this.asNonEmptyString(metadata.wechat_moments_marketing_mode) ||
            'random';
          const contacts = this.normalizeStringList(
            metadata.wechat_moments_marketing_contacts,
          );
          const actions = this.normalizeMomentsMarketingActions(
            metadata.wechat_moments_marketing_actions,
          );
          const autoLike =
            typeof metadata.autoLike === 'boolean'
              ? metadata.autoLike
              : typeof metadata.wechat_moments_auto_like === 'boolean'
                ? metadata.wechat_moments_auto_like
                : undefined;
          const autoComment =
            typeof metadata.autoComment === 'boolean'
              ? metadata.autoComment
              : typeof metadata.wechat_moments_auto_comment === 'boolean'
                ? metadata.wechat_moments_auto_comment
                : undefined;
          if (autoLike !== undefined) {
            actions.like = autoLike;
          }
          if (autoComment !== undefined) {
            actions.comment = autoComment;
          }
          const commentMode =
            this.asNonEmptyString(
              metadata.wechat_moments_marketing_comment_mode,
            ) || 'ai';
          const fixedComment = this.asNonEmptyString(
            metadata.wechat_moments_marketing_fixed_comment,
          );
          const content = this.asNonEmptyString(
            metadata.wechat_moments_marketing_content,
          );
          const dailyLimit = this.normalizePositiveInteger(
            metadata.wechat_moments_marketing_daily_limit,
            contacts.length || 20,
            100,
          );
          const plan = this.readMomentsPlanState(metadata, dailyLimit);
          this.assertMomentsScheduleReady(plan);
          const randomBrowseCount = this.normalizePositiveInteger(
            metadata.wechat_moments_marketing_random_browse_count,
            dailyLimit,
            100,
          );
          const targetCommentMap = this.normalizeTargetCommentMap(
            metadata.wechat_moments_marketing_target_comments,
          );
          const mode =
            this.asNonEmptyString(metadata.wechat_reply_mode) === 'auto-send'
              ? 'auto-send'
              : 'approval';
          const targets =
            marketingMode === 'targeted' && contacts.length
              ? contacts
              : Array.from(
                  { length: Math.max(1, randomBrowseCount) },
                  (_, index) => `朋友圈第 ${index + 1} 条`,
                );
          const executableLimit = Math.min(dailyLimit, plan.remainingToday);
          if (executableLimit <= 0) {
            throw new Error(
              `朋友圈营销今日额度已用完：${plan.dailyPublished}/${plan.dailyQuota}。`,
            );
          }
          const limitedTargets = targets.slice(
            0,
            Math.min(executableLimit, targets.length),
          );
          const actionKind =
            actions.like && actions.comment
              ? 'like-comment'
              : actions.comment
                ? 'comment'
                : actions.like
                  ? 'like'
                  : 'browse';
          const results: Array<{
            target: string;
            status: 'success' | 'failed';
            message: string;
            screenshotPath?: string;
          }> = [];
          for (const [index, target] of limitedTargets.entries()) {
            const commentText =
              targetCommentMap.get(target) ||
              (commentMode === 'fixed' ? fixedComment || '' : '') ||
              content ||
              '您好，看到这条内容很有共鸣，想进一步了解一下。';
            if (actions.comment && !commentText) {
              results.push({
                target,
                status: 'failed',
                message: '缺少朋友圈评论内容，不能执行朋友圈营销。',
              });
              continue;
            }
            pushEvent(
              'SkillTargetStarted',
              'running',
              `正在处理第 ${index + 1}/${limitedTargets.length} 个朋友圈对象：${target}`,
              { target },
            );
            try {
              const result = await this.runWechatMomentsMarketing(
                target,
                actions.comment ? commentText : '',
                mode,
                actionKind,
                index + 1,
              );
              results.push({
                target,
                status: 'success',
                message:
                  mode === 'auto-send'
                    ? `已完成 ${target} 的朋友圈互动。`
                    : `已打开 ${target} 的朋友圈互动动作并等待继续执行。`,
                screenshotPath: result.screenshotPath,
              });
              const successMessage =
                results[results.length - 1]?.message || `已处理 ${target}`;
              pushEvent('SkillTargetCompleted', 'running', successMessage, {
                target,
                commentText,
                mode,
                actionKind,
                screenshotPath: result.screenshotPath,
              });
            } catch (error) {
              const failure =
                error instanceof Error ? error.message : String(error);
              results.push({ target, status: 'failed', message: failure });
              pushEvent(
                'SkillTargetFailed',
                'running',
                `朋友圈营销 ${target} 失败：${failure}`,
                { target, commentText, mode, actionKind, error: failure },
              );
            }
            if (mode !== 'auto-send') {
              break;
            }
          }
          const successCount = results.filter(
            (result) => result.status === 'success',
          ).length;
          const failedCount = results.filter(
            (result) => result.status === 'failed',
          ).length;
          if (successCount === 0) {
            throw new Error(
              `朋友圈营销没有任何对象处理成功：失败 ${failedCount} 个。`,
            );
          }
          pushEvent(
            'SkillCompleted',
            'completed',
            mode === 'auto-send'
              ? `朋友圈营销完成：成功 ${successCount}，失败 ${failedCount}。`
              : '朋友圈营销确认模式已停在首个对象执行前。',
            {
              targets: limitedTargets,
              mode,
              actionKind,
              results,
              plan,
              summary: {
                total: targets.length,
                success: successCount,
                failed: failedCount,
              },
              completedTargets: results
                .filter((result) => result.status === 'success')
                .map((result) => result.target),
              failedTargets: results
                .filter((result) => result.status === 'failed')
                .map((result) => ({
                  targetName: result.target,
                  reason: result.message,
                })),
              pendingTargets: targets.filter(
                (target) => !limitedTargets.includes(target),
              ),
            },
          );
        }
      } else {
        const mode =
          this.asNonEmptyString(metadata.wechat_reply_mode) === 'auto-send'
            ? 'auto-send'
            : 'approval';
        const details = this.normalizeWechatMomentsPublishDetails(
          metadata,
          input.instruction,
        );
        const plan = this.readMomentsPlanState(metadata, details.length || 1);
        this.assertMomentsScheduleReady(plan);
        if (plan.remainingToday <= 0) {
          throw new Error(
            `朋友圈发布今日额度已用完：${plan.dailyPublished}/${plan.dailyQuota}。`,
          );
        }
        const now = Date.now();
        const dueDetails = details
          .filter(
            (detail) =>
              !detail.scheduledPublishTime ||
              Date.parse(detail.scheduledPublishTime) <= now,
          )
          .slice(0, plan.remainingToday);
        const pendingDetails = details.filter(
          (detail) => !dueDetails.some((due) => due.target === detail.target),
        );
        if (!dueDetails.length) {
          throw new Error('朋友圈明细还未到执行时间，当前没有发布。');
        }
        const results: Array<{
          target: string;
          status: 'success' | 'failed';
          message: string;
          screenshotPath?: string;
        }> = [];
        for (const detail of dueDetails) {
          try {
            if (!detail.content) {
              throw new Error('缺少朋友圈文案。');
            }
            if (!detail.attachments.length) {
              throw new Error('缺少朋友圈媒体文件路径。');
            }
            if (detail.visibility !== 'public') {
              throw new Error(
                `朋友圈可见范围「${detail.visibilityLabel}」当前不能自动设置，本条未发布。`,
              );
            }
            this.logger.log(
              `Running wechat-moments-publish skill: target=${detail.target} mode=${mode}`,
            );
            const result = await this.runWechatMomentsPublish(
              detail.content,
              mode,
              detail.attachments.join('\n'),
              detail.additionalComment,
              detail.visibility,
            );
            results.push({
              target: detail.target,
              status: 'success',
              message:
                mode === 'auto-send'
                  ? `朋友圈已发布：${detail.target}`
                  : `朋友圈已填入：${detail.target}`,
              screenshotPath: result.screenshotPath,
            });
            pushEvent(
              'SkillTargetCompleted',
              'running',
              results[results.length - 1]?.message || `已处理 ${detail.target}`,
              {
                ...detail,
                mode,
                screenshotPath: result.screenshotPath,
              },
            );
          } catch (error) {
            const failure =
              error instanceof Error ? error.message : String(error);
            results.push({
              target: detail.target,
              status: 'failed',
              message: failure,
            });
            pushEvent(
              'SkillTargetFailed',
              'running',
              `${detail.target} 发布失败：${failure}`,
              { ...detail, mode, error: failure },
            );
          }
          if (mode !== 'auto-send') break;
        }
        const completedTargets = results
          .filter((result) => result.status === 'success')
          .map((result) => result.target);
        const failedTargets = results
          .filter((result) => result.status === 'failed')
          .map((result) => ({
            targetName: result.target,
            reason: result.message,
          }));
        if (!completedTargets.length) {
          throw new Error(
            `朋友圈发布没有任何明细成功：${failedTargets[0]?.reason || '请检查内容、媒体、可见范围和执行时间。'}`,
          );
        }
        pushEvent(
          'SkillCompleted',
          'completed',
          mode === 'auto-send'
            ? `朋友圈发布完成：成功 ${completedTargets.length}，失败 ${failedTargets.length}。`
            : '朋友圈已填入首条内容，停在发表前。',
          {
            mode,
            results,
            completedTargets,
            failedTargets,
            pendingTargets: pendingDetails.map((detail) => detail.target),
            details,
            plan,
          },
        );
      }

      const cancelled = this.isLocalSkillCancelled(sessionId);
      if (
        cancelled &&
        !events.some((event) => event.event_type === 'SkillCancelled')
      ) {
        pushEvent(
          'SkillCancelled',
          'cancelled',
          '微信任务已暂停，已完成对象保留，后续对象未执行。',
          { preserveCompletedTargets: true },
        );
      }
      this.localSkillEvents.set(sessionId, events);
      if (session) {
        this.runtimeSessions.set(sessionId, {
          ...this.runtimeSessions.get(sessionId)!,
          status: cancelled ? 'cancelled' : 'completed',
          updated_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          last_event_seq: events.length,
        });
      }
      return {
        accepted: true,
        session_id: sessionId,
        run_id: runId,
        status: cancelled ? 'cancelled' : 'completed',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const cancelled = this.isLocalSkillCancelled(sessionId);
      const latestBatchPayload = [...events]
        .reverse()
        .find((event) => event.event_type === 'SkillBatchResult')?.payload;
      pushEvent(
        cancelled ? 'SkillCancelled' : 'SkillFailed',
        cancelled ? 'cancelled' : 'failed',
        cancelled
          ? '微信任务已暂停，已完成对象保留，后续对象未执行。'
          : message,
        cancelled
          ? { ...(latestBatchPayload || {}), preserveCompletedTargets: true }
          : { ...(latestBatchPayload || {}), error: message },
      );
      this.localSkillEvents.set(sessionId, events);
      if (session) {
        this.runtimeSessions.set(sessionId, {
          ...this.runtimeSessions.get(sessionId)!,
          status: cancelled ? 'cancelled' : 'failed',
          updated_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          last_error: cancelled ? null : message,
          last_event_seq: events.length,
        });
      }
      return {
        accepted: true,
        session_id: sessionId,
        run_id: runId,
        status: cancelled ? 'cancelled' : 'failed',
      };
    }
  }

  private isRedfoxSkillHubRoute(
    skillId: string | null,
    input: AgentSSidecarRunTaskInput,
    metadata: Record<string, unknown>,
  ) {
    return (
      skillId === 'redfox.skillhub.run' ||
      input.task_type === 'redfox.skillhub.run' ||
      this.asNonEmptyString(metadata.provider) === 'redfox-skillhub' ||
      this.asNonEmptyString(metadata.source) === 'redfox-skillhub'
    );
  }

  private async runRedfoxSkillHubLocalSkill(
    sessionId: string,
    input: AgentSSidecarRunTaskInput,
    session:
      | (AgentSSidecarSessionSummary & { active_run_id?: string | null })
      | undefined,
    metadata: Record<string, unknown>,
  ): Promise<{
    accepted: boolean;
    session_id: string;
    run_id: string;
    status: string;
  }> {
    const runId = `redfox-skillhub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const events: AgentSSidecarEvent[] = [];
    const pushEvent = (
      event_type: string,
      status: AgentSSidecarSessionSummary['status'],
      message: string,
      payload: Record<string, unknown> = {},
      artifactId: string | null = null,
    ) => {
      events.push({
        seq: events.length + 1,
        session_id: sessionId,
        run_id: runId,
        event_type,
        status,
        created_at: new Date().toISOString(),
        message,
        step_index: events.length,
        artifact_id: artifactId,
        payload,
      });
    };
    const finish = (
      status: AgentSSidecarSessionSummary['status'],
      lastError?: string,
    ) => {
      this.localSkillEvents.set(sessionId, events);
      if (session) {
        this.runtimeSessions.set(sessionId, {
          ...this.runtimeSessions.get(sessionId)!,
          status,
          updated_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          last_error: lastError || null,
          last_event_seq: events.length,
        });
      }
      return {
        accepted: true,
        session_id: sessionId,
        run_id: runId,
        status,
      };
    };

    if (session) {
      this.runtimeSessions.set(sessionId, {
        ...session,
        status: 'running',
        updated_at: new Date().toISOString(),
        run_count: session.run_count + 1,
        active_run_id: runId,
      });
    }

    let spec: RedfoxSkillHubRunSpec;
    try {
      spec = this.resolveRedfoxSkillHubRunSpec(input, metadata);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const artifact = this.writeLocalSkillArtifact(sessionId, runId, {
        kind: 'json',
        filename: 'redfox-skillhub-blocked.json',
        content: JSON.stringify(
          {
            ok: false,
            status: 'blocked',
            reasonCode: 'invalid_redfox_skillhub_request',
            message,
            createdAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        metadata: { provider: 'redfox-skillhub' },
      });
      pushEvent(
        'SkillBlocked',
        'blocked',
        message,
        { provider: 'redfox-skillhub', reasonCode: 'invalid_request' },
        artifact.artifact_id,
      );
      return finish('blocked', message);
    }

    this.logger.log(
      `Agent-S RedFox SkillHub route accepted: skill=${spec.skillCode} session=${sessionId}`,
    );
    pushEvent(
      'SkillStarted',
      'running',
      `${spec.skillName} 开始本机能力试跑。`,
      this.redfoxSkillHubEventPayload(spec),
    );

    let directory = this.resolveRedfoxSkillHubDirectory(spec);
    let installResult: RedfoxSkillHubInstallResult | null = null;
    if (!directory) {
      installResult = await this.ensureRedfoxSkillHubInstalled(spec);
      if (installResult.attempted) {
        pushEvent(
          installResult.ok ? 'SkillInstallCompleted' : 'SkillInstallFailed',
          installResult.ok ? 'running' : 'blocked',
          installResult.message,
          {
            ...this.redfoxSkillHubEventPayload(spec),
            install: installResult,
          },
        );
      } else {
        pushEvent('SkillInstallSkipped', 'running', installResult.message, {
          ...this.redfoxSkillHubEventPayload(spec),
          install: installResult,
        });
      }
      directory = this.resolveRedfoxSkillHubDirectory(spec);
    }
    const script = directory
      ? this.resolveRedfoxSkillHubScript(directory.directory)
      : null;
    const apiKey = this.resolveRedfoxApiKey();
    const blockers: string[] = [];
    const technicalBlockers: string[] = [];
    if (!directory) {
      blockers.push(
        `「${spec.skillName}」本机能力包还没有安装，暂时不能直接试跑。`,
      );
      technicalBlockers.push(
        `本机未安装 ${spec.skillName} 能力脚本。请将 redfox-data/redfox-community 的 skills/${spec.skillCode} 打包到 skillhub-skills 或配置 REDFOX_SKILLHUB_ROOT。`,
      );
      if (installResult?.message) {
        technicalBlockers.push(`自动安装结果：${installResult.message}`);
      }
    }
    if (directory && !script) {
      blockers.push(
        `「${spec.skillName}」本机能力包缺少可执行入口，需要补齐后才能试跑。`,
      );
      technicalBlockers.push(
        `${spec.skillName} 已有本地目录，但未发现可执行入口 scripts/run.(js|mjs|py|sh)。`,
      );
    }
    if (spec.requiresApiKey && !apiKey) {
      blockers.push('RedFox 授权密钥还没有连接，暂时不能调用需要授权的能力。');
      technicalBlockers.push(
        '缺少 REDFOX_API_KEY，不能执行需要授权的官方能力。',
      );
    }

    pushEvent(
      'SkillPreflight',
      blockers.length ? 'blocked' : 'running',
      blockers.length
        ? `本机能力试跑被阻断：${blockers[0]}`
        : `本机能力已就绪：${directory?.source || '本地目录'}。`,
      {
        ...this.redfoxSkillHubEventPayload(spec),
        directory: directory?.directory || null,
        script: script?.label || null,
        install: installResult,
        blockers,
        technicalBlockers,
      },
    );

    if (blockers.length) {
      const artifact = this.writeLocalSkillArtifact(sessionId, runId, {
        kind: 'json',
        filename: `${this.safeArtifactFilename(spec.skillCode)}-preflight.json`,
        content: JSON.stringify(
          {
            ok: false,
            status: 'blocked',
            reasonCode: 'redfox_skillhub_preflight_blocked',
            skill: this.redfoxSkillHubEventPayload(spec),
            blockers,
            technicalBlockers,
            directory: directory?.directory || null,
            script: script?.label || null,
            install: installResult,
            expectedInstallTargets: this.redfoxSkillHubInstallTargets(
              spec.skillCode,
            ),
            createdAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        metadata: this.redfoxSkillHubEventPayload(spec),
      });
      pushEvent(
        'SkillBlocked',
        'blocked',
        `本机能力暂未就绪：${blockers.join('；')}`,
        {
          ...this.redfoxSkillHubEventPayload(spec),
          blockers,
          technicalBlockers,
          artifactId: artifact.artifact_id,
        },
        artifact.artifact_id,
      );
      return finish('blocked', `本机能力暂未就绪：${blockers.join('；')}`);
    }

    try {
      pushEvent(
        'SkillExecutionStarted',
        'running',
        `${spec.skillName} 正在生成交付结果。`,
        {
          ...this.redfoxSkillHubEventPayload(spec),
          script: script!.label,
        },
      );
      const scriptResult = await this.executeRedfoxSkillHubScript(
        script!,
        spec,
        {
          apiKey: apiKey || '',
          sessionId,
          runId,
        },
      );
      const output = this.parseRedfoxSkillHubOutput(scriptResult.stdout);
      const artifact = this.writeLocalSkillArtifact(sessionId, runId, {
        kind: 'json',
        filename: `${this.safeArtifactFilename(spec.skillCode)}-result.json`,
        content: JSON.stringify(
          {
            ok: true,
            status: 'completed',
            skill: this.redfoxSkillHubEventPayload(spec),
            output,
            stderrPreview: scriptResult.stderr.slice(0, 1000),
            durationMs: scriptResult.durationMs,
            createdAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        metadata: {
          ...this.redfoxSkillHubEventPayload(spec),
          script: script!.label,
          durationMs: scriptResult.durationMs,
        },
      });
      pushEvent(
        'SkillCompleted',
        'completed',
        `${spec.skillName} 试跑完成：${this.summarizeRedfoxSkillHubOutput(output)}。`,
        {
          ...this.redfoxSkillHubEventPayload(spec),
          artifactId: artifact.artifact_id,
          artifactPath: artifact.path,
          durationMs: scriptResult.durationMs,
        },
        artifact.artifact_id,
      );
      return finish('completed');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const artifact = this.writeLocalSkillArtifact(sessionId, runId, {
        kind: 'json',
        filename: `${this.safeArtifactFilename(spec.skillCode)}-failed.json`,
        content: JSON.stringify(
          {
            ok: false,
            status: 'failed',
            reasonCode: 'redfox_skillhub_execution_failed',
            skill: this.redfoxSkillHubEventPayload(spec),
            message,
            createdAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        metadata: this.redfoxSkillHubEventPayload(spec),
      });
      pushEvent(
        'SkillFailed',
        'failed',
        `${spec.skillName} 试跑失败：${message}`,
        {
          ...this.redfoxSkillHubEventPayload(spec),
          error: message,
          artifactId: artifact.artifact_id,
        },
        artifact.artifact_id,
      );
      return finish('failed', message);
    }
  }

  private resolveRedfoxSkillHubRunSpec(
    input: AgentSSidecarRunTaskInput,
    metadata: Record<string, unknown>,
  ): RedfoxSkillHubRunSpec {
    const skillCode =
      this.asNonEmptyString(metadata.skillCode) ||
      this.asNonEmptyString(metadata.skill_code) ||
      this.asNonEmptyString(metadata.skill_id);
    const skillName =
      this.asNonEmptyString(metadata.skillName) ||
      this.asNonEmptyString(metadata.skill_name) ||
      skillCode;
    if (!skillCode || skillCode === 'redfox.skillhub.run') {
      throw new Error('缺少 RedFox 本机能力标识，不能启动试跑。');
    }
    const rawInput = this.readRecord(metadata.input) || {
      instruction: input.instruction,
    };
    return {
      provider: 'redfox-skillhub',
      packageCode:
        this.asNonEmptyString(metadata.packageCode) ||
        this.asNonEmptyString(metadata.package_code) ||
        undefined,
      packageName:
        this.asNonEmptyString(metadata.packageName) ||
        this.asNonEmptyString(metadata.package_name) ||
        undefined,
      skillNo:
        this.asNonEmptyString(metadata.skillNo) ||
        this.asNonEmptyString(metadata.skill_no) ||
        undefined,
      skillCode,
      skillName: skillName || skillCode,
      repoUrl:
        this.asNonEmptyString(metadata.repoUrl) ||
        this.asNonEmptyString(metadata.repo_url) ||
        undefined,
      requiresApiKey:
        metadata.requiresApiKey === false || metadata.requires_api_key === false
          ? false
          : true,
      input: this.normalizeRedfoxSkillHubInput(rawInput),
      outputObjects: this.normalizeStringList(metadata.outputObjects),
    };
  }

  private normalizeRedfoxSkillHubInput(input: Record<string, unknown>) {
    const normalized = { ...input };
    const platform =
      this.asNonEmptyString(normalized.platform) ||
      this.asNonEmptyString(normalized.sourcePlatform) ||
      this.firstStringValue(normalized.platforms) ||
      'all';
    normalized.platform = this.normalizeRedfoxSkillHubPlatform(platform);
    if (!Array.isArray(normalized.platforms)) {
      normalized.platforms = [normalized.platform];
    }
    return normalized;
  }

  private normalizeRedfoxSkillHubPlatform(platform: string) {
    const normalized = platform.trim().toLowerCase();
    const map: Record<string, string> = {
      web: 'all',
      all: 'all',
      全网: 'all',
      多平台: 'all',
      multi_platform: 'all',
      douyin: 'douyin',
      抖音: 'douyin',
      xiaohongshu: 'xiaohongshu',
      xhs: 'xiaohongshu',
      小红书: 'xiaohongshu',
      gzh: 'gzh',
      wechat: 'gzh',
      公众号: 'gzh',
      bilibili: 'bilibili',
      b站: 'bilibili',
      'b 站': 'bilibili',
      tiktok: 'tiktok',
    };
    return map[normalized] || normalized || 'all';
  }

  private firstStringValue(value: unknown) {
    if (typeof value === 'string') return this.asNonEmptyString(value);
    if (!Array.isArray(value)) return '';
    for (const item of value) {
      const stringValue = this.asNonEmptyString(item);
      if (stringValue) return stringValue;
    }
    return '';
  }

  private redfoxSkillHubEventPayload(spec: RedfoxSkillHubRunSpec) {
    return {
      provider: spec.provider,
      packageCode: spec.packageCode || null,
      packageName: spec.packageName || null,
      skillNo: spec.skillNo || null,
      skillCode: spec.skillCode,
      skillName: spec.skillName,
      repoUrl: spec.repoUrl || null,
      requiresApiKey: spec.requiresApiKey,
      outputObjects: spec.outputObjects,
    };
  }

  private resolveRedfoxApiKey() {
    return (
      this.asNonEmptyString(this.configService.get<string>('REDFOX_API_KEY')) ||
      this.asNonEmptyString(
        this.configService.get<string>('REDFOX_SANDBOX_API_KEY'),
      ) ||
      this.asNonEmptyString(
        this.configService.get<string>('REDFOX_API_TOKEN'),
      ) ||
      this.asNonEmptyString(process.env.REDFOX_API_KEY) ||
      this.asNonEmptyString(process.env.REDFOX_SANDBOX_API_KEY) ||
      this.asNonEmptyString(process.env.REDFOX_API_TOKEN)
    );
  }

  private async ensureRedfoxSkillHubInstalled(
    spec: RedfoxSkillHubRunSpec,
  ): Promise<RedfoxSkillHubInstallResult> {
    const startedAt = Date.now();
    if (!this.isRedfoxSkillHubAutoInstallEnabled()) {
      return {
        attempted: false,
        ok: false,
        status: 'disabled',
        message: 'RedFox SkillHub 自动安装未开启，只检查本机已安装能力目录。',
        source: null,
        targetDirectory: null,
        repoUrl: spec.repoUrl || null,
      };
    }
    if (!this.isSafeRedfoxSkillCode(spec.skillCode)) {
      return {
        attempted: true,
        ok: false,
        status: 'failed',
        message: `RedFox SkillHub skillCode 不安全，已拒绝安装：${spec.skillCode}`,
        source: null,
        targetDirectory: null,
        repoUrl: spec.repoUrl || null,
        durationMs: Date.now() - startedAt,
      };
    }

    const installRoot = this.resolveRedfoxSkillHubInstallRoot();
    const targetDirectory = join(installRoot, spec.skillCode);
    if (existsSync(targetDirectory)) {
      return {
        attempted: true,
        ok: false,
        status: 'already_present',
        message:
          'RedFox SkillHub 安装目录已存在但未被识别，请检查 SKILL.md 或 scripts 入口。',
        source: null,
        targetDirectory,
        repoUrl: spec.repoUrl || null,
        durationMs: Date.now() - startedAt,
      };
    }

    const localSource = this.resolveRedfoxSkillHubOfficialSource(spec);
    if (localSource) {
      mkdirSync(installRoot, { recursive: true });
      try {
        cpSync(localSource.directory, targetDirectory, {
          recursive: true,
          force: false,
          errorOnExist: true,
        });
        this.writeRedfoxSkillHubInstallManifest(
          targetDirectory,
          spec,
          localSource.source,
        );
        return {
          attempted: true,
          ok: true,
          status: 'installed',
          message: `已从本地官方 SkillHub 镜像安装 ${spec.skillName}。`,
          source: localSource.source,
          targetDirectory,
          repoUrl: spec.repoUrl || null,
          durationMs: Date.now() - startedAt,
        };
      } catch (error) {
        rmSync(targetDirectory, { recursive: true, force: true });
        const message = error instanceof Error ? error.message : String(error);
        return {
          attempted: true,
          ok: false,
          status: 'failed',
          message: `从本地官方 SkillHub 镜像安装失败：${message}`,
          source: localSource.source,
          targetDirectory,
          repoUrl: spec.repoUrl || null,
          durationMs: Date.now() - startedAt,
        };
      }
    }

    const parsedRepo = this.parseOfficialRedfoxSkillHubRepoUrl(spec);
    if (!parsedRepo) {
      return {
        attempted: false,
        ok: false,
        status: 'skipped',
        message: '缺少可信 RedFox 官方 SkillHub repoUrl，已跳过自动安装。',
        source: null,
        targetDirectory,
        repoUrl: spec.repoUrl || null,
        durationMs: Date.now() - startedAt,
      };
    }

    mkdirSync(installRoot, { recursive: true });
    const tempDirectory = join(
      installRoot,
      `.install-${this.safeArtifactFilename(spec.skillCode)}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    try {
      const cloneArgs = [
        'clone',
        '--depth=1',
        '--filter=blob:none',
        '--sparse',
        '--branch',
        parsedRepo.branch,
        parsedRepo.repositoryUrl,
        tempDirectory,
      ];
      await this.runRedfoxSkillHubInstallCommand('git', cloneArgs, installRoot);
      await this.runRedfoxSkillHubInstallCommand(
        'git',
        ['-C', tempDirectory, 'sparse-checkout', 'set', parsedRepo.skillPath],
        installRoot,
      );
      const sourceDirectory = join(tempDirectory, parsedRepo.skillPath);
      if (!this.isRedfoxSkillHubDirectoryUsable(sourceDirectory)) {
        throw new Error(
          `官方仓库中未发现可用 Skill 目录：${parsedRepo.skillPath}`,
        );
      }
      cpSync(sourceDirectory, targetDirectory, {
        recursive: true,
        force: false,
        errorOnExist: true,
      });
      this.writeRedfoxSkillHubInstallManifest(
        targetDirectory,
        spec,
        spec.repoUrl || parsedRepo.repoWebUrl,
      );
      return {
        attempted: true,
        ok: true,
        status: 'installed',
        message: `已从 RedFox 官方仓库安装 ${spec.skillName}。`,
        source: parsedRepo.repoWebUrl,
        targetDirectory,
        repoUrl: spec.repoUrl || parsedRepo.repoWebUrl,
        durationMs: Date.now() - startedAt,
        command: `git clone --depth=1 --filter=blob:none --sparse --branch ${parsedRepo.branch} ${parsedRepo.repositoryUrl}`,
      };
    } catch (error) {
      rmSync(targetDirectory, { recursive: true, force: true });
      const message = error instanceof Error ? error.message : String(error);
      return {
        attempted: true,
        ok: false,
        status: 'failed',
        message: `从 RedFox 官方仓库安装失败：${message}`,
        source: parsedRepo.repoWebUrl,
        targetDirectory,
        repoUrl: spec.repoUrl || parsedRepo.repoWebUrl,
        durationMs: Date.now() - startedAt,
        command: `git clone --depth=1 --filter=blob:none --sparse --branch ${parsedRepo.branch} ${parsedRepo.repositoryUrl}`,
      };
    } finally {
      rmSync(tempDirectory, { recursive: true, force: true });
    }
  }

  private isRedfoxSkillHubAutoInstallEnabled() {
    const value =
      this.asNonEmptyString(
        this.configService.get<string>('REDFOX_SKILLHUB_AUTO_INSTALL'),
      ) || this.asNonEmptyString(process.env.REDFOX_SKILLHUB_AUTO_INSTALL);
    if (!value) return true;
    return !['0', 'false', 'off', 'disabled'].includes(
      value.trim().toLowerCase(),
    );
  }

  private resolveRedfoxSkillHubInstallRoot() {
    const projectRoot = resolveProjectRoot(process.cwd());
    return (
      this.asNonEmptyString(
        this.configService.get<string>('REDFOX_SKILLHUB_INSTALL_ROOT'),
      ) ||
      this.asNonEmptyString(
        this.configService.get<string>('AI_CONTENT_SKILLHUB_INSTALL_ROOT'),
      ) ||
      this.asNonEmptyString(process.env.REDFOX_SKILLHUB_INSTALL_ROOT) ||
      this.asNonEmptyString(process.env.AI_CONTENT_SKILLHUB_INSTALL_ROOT) ||
      join(projectRoot, 'skillhub-skills')
    );
  }

  private resolveRedfoxSkillHubOfficialSource(
    spec: RedfoxSkillHubRunSpec,
  ): RedfoxSkillHubDirectory | null {
    const configuredRoot =
      this.asNonEmptyString(
        this.configService.get<string>('REDFOX_SKILLHUB_OFFICIAL_SOURCE_ROOT'),
      ) ||
      this.asNonEmptyString(
        this.configService.get<string>(
          'AI_CONTENT_SKILLHUB_OFFICIAL_SOURCE_ROOT',
        ),
      ) ||
      this.asNonEmptyString(process.env.REDFOX_SKILLHUB_OFFICIAL_SOURCE_ROOT) ||
      this.asNonEmptyString(
        process.env.AI_CONTENT_SKILLHUB_OFFICIAL_SOURCE_ROOT,
      );
    if (!configuredRoot) return null;
    const candidates = [
      {
        directory: join(configuredRoot, spec.skillCode),
        source: configuredRoot,
      },
      {
        directory: join(configuredRoot, 'skills', spec.skillCode),
        source: `${configuredRoot}/skills`,
      },
    ];
    if (basename(configuredRoot) === spec.skillCode) {
      candidates.push({
        directory: configuredRoot,
        source: configuredRoot,
      });
    }
    return (
      candidates.find((candidate) =>
        this.isRedfoxSkillHubDirectoryUsable(candidate.directory),
      ) || null
    );
  }

  private parseOfficialRedfoxSkillHubRepoUrl(spec: RedfoxSkillHubRunSpec): {
    repositoryUrl: string;
    repoWebUrl: string;
    branch: string;
    skillPath: string;
  } | null {
    if (!spec.repoUrl) return null;
    try {
      const url = new URL(spec.repoUrl);
      if (url.hostname !== 'github.com') return null;
      const parts = url.pathname.split('/').filter(Boolean);
      if (
        parts[0] !== 'redfox-data' ||
        parts[1] !== 'redfox-community' ||
        parts[2] !== 'tree'
      ) {
        return null;
      }
      const skillsIndex = parts.indexOf('skills', 3);
      if (skillsIndex < 4) return null;
      const branch = parts.slice(3, skillsIndex).join('/');
      const skillCode = parts[skillsIndex + 1];
      if (skillCode !== spec.skillCode) return null;
      if (!this.isSafeRedfoxSkillCode(skillCode)) return null;
      return {
        repositoryUrl: 'https://github.com/redfox-data/redfox-community.git',
        repoWebUrl: 'https://github.com/redfox-data/redfox-community/tree/main',
        branch: branch || 'main',
        skillPath: `skills/${skillCode}`,
      };
    } catch {
      return null;
    }
  }

  private isRedfoxSkillHubDirectoryUsable(directory: string) {
    return (
      existsSync(directory) &&
      (existsSync(join(directory, 'SKILL.md')) ||
        existsSync(join(directory, 'README.md')) ||
        existsSync(join(directory, 'scripts')))
    );
  }

  private isSafeRedfoxSkillCode(value: string) {
    return /^[0-9A-Za-z][0-9A-Za-z._-]{0,120}$/.test(value);
  }

  private writeRedfoxSkillHubInstallManifest(
    directory: string,
    spec: RedfoxSkillHubRunSpec,
    source: string,
  ) {
    writeFileSync(
      join(directory, '.kaypal-redfox-skillhub-install.json'),
      JSON.stringify(
        {
          provider: 'redfox-skillhub',
          skillCode: spec.skillCode,
          skillNo: spec.skillNo || null,
          skillName: spec.skillName,
          repoUrl: spec.repoUrl || null,
          source,
          installedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      'utf8',
    );
  }

  private runRedfoxSkillHubInstallCommand(
    command: string,
    args: string[],
    cwd: string,
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        env: {
          ...process.env,
          PATH: `${process.env.PATH || ''}:/Users/yanghy/.local/bin:/opt/homebrew/bin:/usr/local/bin`,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error('RedFox SkillHub 安装命令执行超时'));
      }, 120000);
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        if ((code ?? 0) !== 0) {
          reject(
            new Error(
              (stderr || stdout || `${command} 退出码 ${code}`).slice(0, 1200),
            ),
          );
          return;
        }
        resolve({ stdout, stderr });
      });
    });
  }

  private resolveRedfoxSkillHubDirectory(
    spec: RedfoxSkillHubRunSpec,
  ): RedfoxSkillHubDirectory | null {
    const projectRoot = resolveProjectRoot(process.cwd());
    const configuredRoot =
      this.asNonEmptyString(
        this.configService.get<string>('REDFOX_SKILLHUB_ROOT'),
      ) ||
      this.asNonEmptyString(
        this.configService.get<string>('AI_CONTENT_SKILLHUB_ROOT'),
      ) ||
      this.asNonEmptyString(process.env.REDFOX_SKILLHUB_ROOT) ||
      this.asNonEmptyString(process.env.AI_CONTENT_SKILLHUB_ROOT);
    const roots = [
      configuredRoot,
      this.resolveRedfoxSkillHubInstallRoot(),
      join(projectRoot, 'skillhub-skills'),
      join(projectRoot, 'vendor', 'redfox-skillhub'),
      join(projectRoot, 'vendor', 'skillhub'),
      join(projectRoot, 'redfox-community', 'skills'),
      join(projectRoot, 'vendor', 'redfox-community', 'skills'),
      join(projectRoot, '.redfox-community', 'skills'),
    ].filter((value): value is string => Boolean(value));
    const candidates: RedfoxSkillHubDirectory[] = [];
    for (const root of roots) {
      candidates.push(
        {
          directory: join(root, spec.skillCode),
          source: root === configuredRoot ? '配置目录' : root,
        },
        {
          directory: join(root, 'skills', spec.skillCode),
          source: root === configuredRoot ? '配置目录 skills 子目录' : root,
        },
      );
      if (basename(root) === spec.skillCode) {
        candidates.push({
          directory: root,
          source: root === configuredRoot ? '配置目录' : root,
        });
      }
    }
    return (
      candidates.find(
        (candidate) =>
          existsSync(candidate.directory) &&
          (existsSync(join(candidate.directory, 'SKILL.md')) ||
            existsSync(join(candidate.directory, 'README.md')) ||
            existsSync(join(candidate.directory, 'scripts'))),
      ) || null
    );
  }

  private resolveRedfoxSkillHubScript(
    skillDirectory: string,
  ): RedfoxSkillHubScript | null {
    const candidates = [
      'scripts/run.mjs',
      'scripts/run.js',
      'scripts/index.mjs',
      'scripts/index.js',
      'scripts/main.mjs',
      'scripts/main.js',
      'scripts/fetch_hotspot.py',
      'scripts/run.py',
      'scripts/main.py',
      'scripts/run.sh',
      'run.mjs',
      'run.js',
      'main.mjs',
      'main.js',
      'run.py',
      'main.py',
      'run.sh',
    ];
    for (const relativePath of candidates) {
      const scriptPath = join(skillDirectory, relativePath);
      if (!existsSync(scriptPath)) continue;
      return this.createRedfoxSkillHubScript(
        skillDirectory,
        scriptPath,
        relativePath,
      );
    }
    const scriptsDir = join(skillDirectory, 'scripts');
    if (!existsSync(scriptsDir)) return null;
    const scriptFiles = readdirSync(scriptsDir)
      .filter((filename) => !filename.startsWith('.'))
      .filter((filename) =>
        ['.py', '.js', '.mjs', '.sh'].includes(extname(filename).toLowerCase()),
      )
      .sort((a, b) => {
        const score = (filename: string) =>
          /^(fetch|search|check|rewrite|generate|analy[sz]e|extract|subscribe)/i.test(
            filename,
          )
            ? 0
            : 1;
        return score(a) - score(b) || a.localeCompare(b);
      });
    const fallbackScript = scriptFiles[0];
    if (!fallbackScript) return null;
    return this.createRedfoxSkillHubScript(
      skillDirectory,
      join(scriptsDir, fallbackScript),
      `scripts/${fallbackScript}`,
    );
  }

  private createRedfoxSkillHubScript(
    skillDirectory: string,
    scriptPath: string,
    label: string,
  ): RedfoxSkillHubScript {
    const ext = extname(scriptPath).toLowerCase();
    if (ext === '.py') {
      return {
        command: this.resolveRedfoxSkillHubPythonCommand(),
        args: [scriptPath],
        cwd: skillDirectory,
        scriptPath,
        label,
      };
    }
    if (ext === '.sh') {
      return {
        command: 'bash',
        args: [scriptPath],
        cwd: skillDirectory,
        scriptPath,
        label,
      };
    }
    return {
      command: 'node',
      args: [scriptPath],
      cwd: skillDirectory,
      scriptPath,
      label,
    };
  }

  private resolveRedfoxSkillHubPythonCommand() {
    return (
      this.asNonEmptyString(
        this.configService.get<string>('REDFOX_SKILLHUB_PYTHON'),
      ) ||
      this.asNonEmptyString(process.env.REDFOX_SKILLHUB_PYTHON) ||
      (existsSync('/usr/bin/python3') ? '/usr/bin/python3' : 'python3')
    );
  }

  private executeRedfoxSkillHubScript(
    script: RedfoxSkillHubScript,
    spec: RedfoxSkillHubRunSpec,
    context: { apiKey: string; sessionId: string; runId: string },
  ): Promise<RedfoxSkillHubScriptResult> {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const scriptArgs = [
        ...script.args,
        ...this.buildRedfoxSkillHubScriptArgs(script, spec, context),
      ];
      const child = spawn(script.command, scriptArgs, {
        cwd: script.cwd,
        env: {
          ...process.env,
          PATH: `${process.env.PATH || ''}:/Users/yanghy/.local/bin:/opt/homebrew/bin:/usr/local/bin`,
          REDFOX_API_KEY: context.apiKey,
          REDFOX_SKILL_CODE: spec.skillCode,
          REDFOX_SKILL_NO: spec.skillNo || '',
          REDFOX_SKILL_NAME: spec.skillName,
          REDFOX_SKILL_INPUT_JSON: JSON.stringify(spec.input),
          AI_CONTENT_AGENT_SESSION_ID: context.sessionId,
          AI_CONTENT_AGENT_RUN_ID: context.runId,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`${spec.skillName} 执行超时`));
      }, 120000);
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        const exitCode = code ?? 0;
        const durationMs = Date.now() - startedAt;
        if (exitCode !== 0) {
          reject(
            new Error(
              (
                stderr ||
                stdout ||
                `${spec.skillName} 执行失败，退出码 ${exitCode}`
              ).trim(),
            ),
          );
          return;
        }
        resolve({ stdout, stderr, exitCode, durationMs });
      });
      child.stdin.end(
        JSON.stringify(
          {
            ...spec.input,
            skill: this.redfoxSkillHubEventPayload(spec),
            input: spec.input,
          },
          null,
          2,
        ),
      );
    });
  }

  private buildRedfoxSkillHubScriptArgs(
    script: RedfoxSkillHubScript,
    spec: RedfoxSkillHubRunSpec,
    context: { apiKey: string },
  ): string[] {
    const label = script.label.toLowerCase();
    const keyword =
      this.redfoxSkillHubInputText(spec.input, [
        'keyword',
        'query',
        'q',
        'topic',
        'brief',
      ]) || '咖啡';
    const content =
      this.redfoxSkillHubInputText(spec.input, [
        'content',
        'text',
        'article',
        'brief',
        'topic',
        'keyword',
      ]) || keyword;

    if (label.includes('fetch_xhs_trends.py')) {
      return ['--keyword', keyword, '--output-format', 'json'];
    }
    if (label.includes('fetch_official_account_trends.py')) {
      return ['--keyword', keyword];
    }
    if (label.includes('check_sensitive_words.py')) {
      const args = ['--content', content];
      if (spec.skillCode === 'multi-wordcheck') {
        args.push('--platform', this.redfoxSkillHubChinesePlatform(spec.input));
      }
      return args;
    }
    if (label.includes('videogen.py')) {
      const prompt =
        this.redfoxSkillHubInputText(spec.input, [
          'prompt',
          'content',
          'text',
          'brief',
          'topic',
        ]) || '咖啡新品 5 秒产品展示视频，干净自然光，镜头慢推';
      if (spec.input.recordOnly !== false) {
        return [prompt, '--record-only'];
      }
      return [
        prompt,
        '--api-key',
        context.apiKey,
        '--no-download',
        '--duration',
        safeText(spec.input.duration || 5),
        '--ratio',
        safeText(spec.input.ratio || '16:9'),
      ];
    }
    if (label.includes('pdf_text_extractor.py')) {
      const filePath = this.redfoxSkillHubInputText(spec.input, [
        'filePath',
        'pdfPath',
        'path',
        'localPath',
      ]);
      return filePath ? [filePath] : [];
    }
    return [];
  }

  private redfoxSkillHubInputText(
    input: Record<string, unknown>,
    keys: string[],
  ) {
    for (const key of keys) {
      const direct = this.asNonEmptyString(input[key]);
      if (direct) return direct;
    }
    return '';
  }

  private redfoxSkillHubChinesePlatform(input: Record<string, unknown>) {
    const platform =
      this.asNonEmptyString(input.platform) ||
      this.firstStringValue(input.platforms) ||
      '公众号';
    const normalized = platform.trim().toLowerCase();
    const map: Record<string, string> = {
      all: '公众号',
      web: '公众号',
      multi_platform: '公众号',
      gzh: '公众号',
      wechat: '公众号',
      douyin: '抖音',
      xiaohongshu: '小红书',
      xhs: '小红书',
    };
    return map[normalized] || platform || '公众号';
  }

  private parseRedfoxSkillHubOutput(stdout: string) {
    const trimmed = stdout.trim();
    if (!trimmed) {
      return { rawText: '', empty: true };
    }
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return { rawText: trimmed };
    }
  }

  private summarizeRedfoxSkillHubOutput(output: unknown) {
    if (Array.isArray(output)) {
      return `返回 ${output.length} 条结果`;
    }
    const record = this.readRecord(output);
    if (record) {
      if (typeof record.rawText === 'string') return '生成试跑结果';
      const items = Array.isArray(record.items)
        ? record.items
        : Array.isArray(record.data)
          ? record.data
          : Array.isArray(record.results)
            ? record.results
            : null;
      if (items) return `返回 ${items.length} 条结果`;
      if (record.empty === true) return '执行完成但没有返回正文';
      return `返回 ${Object.keys(record).length} 个字段`;
    }
    return '执行完成';
  }

  private writeLocalSkillArtifact(
    sessionId: string,
    runId: string,
    input: {
      kind: AgentSSidecarArtifact['kind'];
      filename: string;
      content: string;
      metadata?: Record<string, unknown>;
    },
  ): AgentSSidecarArtifact {
    const artifactRoot =
      this.asNonEmptyString(
        this.configService.get<string>('AI_CONTENT_LOCAL_ARTIFACT_ROOT'),
      ) ||
      this.asNonEmptyString(process.env.AI_CONTENT_LOCAL_ARTIFACT_ROOT) ||
      resolveProjectLogPath('agent-s-artifacts');
    const directory = join(artifactRoot, 'redfox-skillhub', sessionId);
    mkdirSync(directory, { recursive: true });
    const filename = this.safeArtifactFilename(input.filename);
    const path = join(directory, filename);
    writeFileSync(path, input.content, 'utf8');
    const artifact: AgentSSidecarArtifact = {
      artifact_id: `local-artifact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      session_id: sessionId,
      run_id: runId,
      kind: input.kind,
      filename,
      path,
      created_at: new Date().toISOString(),
      size_bytes: Buffer.byteLength(input.content, 'utf8'),
      metadata: input.metadata || {},
    };
    const artifacts = this.localSkillArtifacts.get(sessionId) || [];
    const nextArtifacts = [...artifacts, artifact];
    this.localSkillArtifacts.set(sessionId, nextArtifacts);
    const conversation = this.conversationSessions.get(sessionId);
    if (conversation) conversation.artifacts = nextArtifacts;
    const contents =
      this.localSkillArtifactContents.get(sessionId) ||
      new Map<string, string | Buffer>();
    contents.set(artifact.artifact_id, input.content);
    this.localSkillArtifactContents.set(sessionId, contents);
    return artifact;
  }

  private redfoxSkillHubInstallTargets(skillCode: string) {
    const projectRoot = resolveProjectRoot(process.cwd());
    return [
      join(this.resolveRedfoxSkillHubInstallRoot(), skillCode),
      join(projectRoot, 'skillhub-skills', skillCode),
      join(projectRoot, 'vendor', 'redfox-skillhub', skillCode),
      `https://github.com/redfox-data/redfox-community/tree/main/skills/${skillCode}`,
      `npx skills add https://github.com/redfox-data/redfox-community/tree/main/skills/${skillCode}`,
      '或设置 REDFOX_SKILLHUB_ROOT 指向 redfox-community/skills 目录',
    ];
  }

  private safeArtifactFilename(value: string) {
    const safe = basename(value).replace(/[^0-9A-Za-z._-]+/g, '-');
    return safe || `artifact-${Date.now()}.json`;
  }

  private readRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private runWechatLiveAutoReply(
    context: string,
    mode: 'read-only' | 'auto-send' = 'auto-send',
    reply?: string,
  ): Promise<{ reply: string; readText: string; screenshotPath?: string }> {
    return new Promise((resolve, reject) => {
      const args = [context || '', mode];
      if (reply) {
        args.push(reply);
      }
      const child = spawn('wechat-live-auto-reply', args, {
        env: {
          ...process.env,
          PATH: `${process.env.PATH || ''}:/Users/yanghy/.local/bin:/opt/homebrew/bin:/usr/local/bin`,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error('wechat-live-auto-reply 执行超时'));
      }, 90000);
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          reject(
            new Error(
              (
                stderr ||
                stdout ||
                `wechat-live-auto-reply 退出码 ${code}`
              ).trim(),
            ),
          );
          return;
        }
        try {
          const parsed = JSON.parse(stdout.trim() || '{}') as {
            reply?: unknown;
            readText?: unknown;
            screenshotPath?: unknown;
          };
          const parsedReply = this.asNonEmptyString(parsed.reply);
          const readText = this.asNonEmptyString(parsed.readText);
          if (mode === 'read-only' && !readText) {
            reject(new Error('wechat-live-auto-reply 未返回读取到的聊天内容'));
            return;
          }
          if (mode === 'auto-send' && !parsedReply) {
            reject(new Error('wechat-live-auto-reply 未返回回复内容'));
            return;
          }
          resolve({
            reply: parsedReply || '',
            readText: readText || '',
            screenshotPath:
              this.asNonEmptyString(parsed.screenshotPath) || undefined,
          });
        } catch (error) {
          reject(
            new Error(
              `wechat-live-auto-reply 返回结果不可解析：${error instanceof Error ? error.message : String(error)}`,
            ),
          );
        }
      });
    });
  }

  private async generateWechatLiveReply(
    readText: string,
    context: string,
  ): Promise<{ reply: string; generatedBy: 'ai' | 'fallback' }> {
    const sourceText = readText.trim();
    try {
      const defaults = await this.defaultModels.getDefaults();
      const modelId = defaults.articleCreation || defaults.topicSelection;
      if (!modelId) {
        return {
          reply: this.buildWechatFallbackReply(sourceText, context),
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
              '你会根据当前微信聊天 OCR 读到的最近上下文，生成可以直接发送的一条中文回复。',
              '要求：像真人客服，简短自然，最多 80 字；不要编造价格、承诺、疗效、优惠；不确定就追问关键信息。',
              '禁止把分析过程发给客户，只输出要发送的回复。',
              context ? `补充要求：${context}` : '',
            ]
              .filter(Boolean)
              .join('\n'),
          },
          {
            role: 'user',
            content: `当前微信聊天内容：\n${sourceText}`,
          },
        ],
        {
          temperature: 0.5,
          maxTokens: 200,
          knowledgeMode: 'required',
          knowledgeQuery: `${context || ''}\n${sourceText}`,
        },
      );
      const trimmed = reply.trim();
      if (!trimmed) {
        return {
          reply: this.buildWechatFallbackReply(sourceText, context),
          generatedBy: 'fallback',
        };
      }
      return { reply: trimmed, generatedBy: 'ai' };
    } catch (error) {
      this.logger.warn(
        `微信当前聊天 AI 回复生成失败，使用兜底规则：${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return {
        reply: this.buildWechatFallbackReply(sourceText, context),
        generatedBy: 'fallback',
      };
    }
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

  private runWechatAutoReply(
    contact: string,
    message: string,
    mode: 'auto-send' | 'approval' = 'auto-send',
  ): Promise<{ screenshotPath?: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn('wechat-auto-reply', [contact, message, mode], {
        env: {
          ...process.env,
          PATH: `${process.env.PATH || ''}:/Users/yanghy/.local/bin:/opt/homebrew/bin:/usr/local/bin`,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`wechat-auto-reply 执行超时：${contact}`));
      }, 90000);
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error(String(error)));
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
            resolve(this.parseWechatCommandOutput(output, 'wechat-auto-reply'));
          } catch (error) {
            if (error instanceof SyntaxError) {
              resolve({});
            } else {
              reject(error instanceof Error ? error : new Error(String(error)));
            }
          }
          return;
        }
        reject(
          new Error(
            (stderr || stdout || `wechat-auto-reply 退出码 ${code}`).trim(),
          ),
        );
      });
    });
  }

  private normalizePositiveInteger(
    value: unknown,
    fallback: number,
    max: number,
  ) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return fallback;
    return Math.min(Math.floor(numeric), max);
  }

  private normalizeTargetCommentMap(value: unknown) {
    const map = new Map<string, string>();
    if (!Array.isArray(value)) return map;
    for (const item of value) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const record = item as Record<string, unknown>;
      const targetName =
        this.asNonEmptyString(record.targetName) ||
        this.asNonEmptyString(record.target) ||
        this.asNonEmptyString(record.name);
      const commentText =
        this.asNonEmptyString(record.commentText) ||
        this.asNonEmptyString(record.replyText) ||
        this.asNonEmptyString(record.comment);
      if (targetName && commentText) {
        map.set(targetName, commentText);
      }
    }
    return map;
  }

  private normalizeWechatTargetMessageMap(value: unknown) {
    const map = new Map<string, string>();
    if (!Array.isArray(value)) return map;
    for (const item of value) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const record = item as Record<string, unknown>;
      const target =
        this.asNonEmptyString(record.target) ||
        this.asNonEmptyString(record.targetName) ||
        this.asNonEmptyString(record.contact);
      const message =
        this.asNonEmptyString(record.message) ||
        this.asNonEmptyString(record.sendContent) ||
        this.asNonEmptyString(record.replyText);
      if (target && message) map.set(target, message);
    }
    return map;
  }

  private resolveWechatCommercialExecutionBlocker(
    metadata: Record<string, unknown>,
  ): string | null {
    if (this.asNonEmptyString(metadata.wechat_reply_mode) !== 'auto-send') {
      return null;
    }
    if (metadata.commercialExecutionRequested !== true) {
      return '自动执行缺少显式商用发送确认，本次没有操作微信。';
    }

    const bypass =
      this.configService.get<string>('KAYPAL_ALLOW_LOCAL_PLAN_BYPASS') ===
      'true';
    const requestContext = this.authRequestContext?.get();
    if (requestContext) {
      if (requestContext.user?.commercialExecutionAllowed !== true && !bypass) {
        return '当前账号没有商用自动执行权限，本次没有操作微信。';
      }
      return null;
    }

    if (
      metadata.scheduler_dispatch === true &&
      metadata.commercialExecutionAllowed !== true &&
      !bypass
    ) {
      return '定时微信计划缺少已保存的商用执行授权，本次没有操作微信。';
    }
    return null;
  }

  private async tryRunWindowsWechatNativeSkill(args: {
    sessionId: string;
    runId: string;
    skillId: string | null;
    input: AgentSSidecarRunTaskInput;
    metadata: Record<string, unknown>;
    pushEvent: (
      eventType: string,
      status: AgentSSidecarSessionSummary['status'],
      message: string,
      payload?: Record<string, unknown>,
    ) => void;
  }): Promise<boolean> {
    if (process.platform !== 'win32') return false;
    const command = this.resolveWechatNativeCommand(args.skillId);
    if (!command) return false;

    const runtimePath = this.resolveWechatNativeRuntimePath();
    if (!runtimePath) {
      throw new Error(
        `Windows 微信 native runtime 缺失，无法执行 ${command}。`,
      );
    }
    const sendMode =
      this.asNonEmptyString(args.metadata.wechat_reply_mode) === 'auto-send'
        ? 'auto-send'
        : 'approval';
    if (command === 'friend-accept' && sendMode !== 'auto-send') {
      throw new Error('自动通过好友属于真实写入动作，请确认自动发送后再执行。');
    }

    const request = {
      contractVersion: WECHAT_NATIVE_COMMAND_CONTRACT_VERSION,
      command,
      input: this.buildWechatNativeSkillInput(
        command,
        args.input,
        args.metadata,
      ),
      context: {
        runId: args.runId,
        relatedId:
          this.asNonEmptyString(args.metadata.interaction_task_id) ||
          args.sessionId,
        relatedType: 'agent-s-session',
        tenantId: this.asNonEmptyString(args.metadata.tenant_id) || undefined,
        locale: 'zh-CN',
        account: {
          accountId:
            this.asNonEmptyString(args.metadata.accountId) ||
            'local-wechat-desktop',
          accountName:
            this.asNonEmptyString(args.metadata.accountName) || '本机微信',
          currentWechatId:
            this.asNonEmptyString(args.metadata.currentWechatId) || undefined,
          plannedWechatId:
            this.asNonEmptyString(args.metadata.plannedWechatId) ||
            this.asNonEmptyString(args.metadata.associatedWeChat) ||
            undefined,
        },
        runtime: {
          platform: 'win32',
          engine: 'agent-s',
          enginePath: runtimePath,
        },
        safety: {
          sendMode,
          riskLevel: 'high',
          dryRun: args.metadata.dryRun === true,
          requiresApproval: sendMode !== 'auto-send',
          targetLockRequired: true,
          contentPreviewRequired: true,
          readbackRequired: true,
          stopOnRiskPrompt: true,
        },
        metadata: {
          skillId: args.skillId,
          source: 'agent-s-primary-wechat-path',
        },
      },
    };
    args.pushEvent(
      'WechatNativeCommandStarted',
      'running',
      `Agent-S 已调用 Windows 微信 native runtime：${command}。`,
      { command, runtimePath, sendMode },
    );

    const parsed = await this.runWindowsWechatNativeCommand(
      args.sessionId,
      command,
      request,
      runtimePath,
    );
    const output = this.readRecord(parsed.output) || {};
    const rawResults = Array.isArray(output.results) ? output.results : [];
    const completedTargets: string[] = [];
    const failedTargets: Array<{ targetName: string; reason: string }> = [];
    const skippedTargets: string[] = [];

    for (const [index, rawResult] of rawResults.entries()) {
      const result = this.readRecord(rawResult) || {};
      const target =
        this.asNonEmptyString(result.targetName) ||
        this.asNonEmptyString(result.targetId) ||
        `对象 ${index + 1}`;
      const status = (
        this.asNonEmptyString(result.status) ||
        (result.ok === true ? 'success' : 'failed')
      ).toLowerCase();
      const succeeded = this.isWechatNativeTargetSuccess(status, result.ok);
      const message =
        this.asNonEmptyString(result.message) ||
        (status === 'success' ? `${target} 已完成。` : `${target} 未完成。`);
      const payload = {
        command,
        target,
        targetId: this.asNonEmptyString(result.targetId) || undefined,
        resultStatus: status,
        action: this.asNonEmptyString(result.action) || undefined,
        sentText: this.asNonEmptyString(result.sentText) || undefined,
        screenshotPath:
          this.asNonEmptyString(result.screenshotPath) || undefined,
        readback: result.readback,
        evidence: result.evidence,
        rawResult: result,
      };
      if (succeeded) {
        completedTargets.push(target);
        args.pushEvent('SkillTargetCompleted', 'running', message, payload);
      } else if (status === 'skipped') {
        skippedTargets.push(target);
        args.pushEvent('SkillTargetSkipped', 'running', message, payload);
      } else {
        failedTargets.push({ targetName: target, reason: message });
        args.pushEvent('SkillTargetFailed', 'running', message, payload);
      }
    }

    const nativeStatus = (
      this.asNonEmptyString(parsed.status) ||
      (parsed.ok === true ? 'success' : 'failed')
    ).toLowerCase();
    const noTarget = output.noTarget === true;
    const batchPayload: Record<string, unknown> = {
      command,
      nativeStatus,
      completedTargets,
      failedTargets,
      skippedTargets,
      pendingTargets: [],
      noTarget,
      summary: output.summary,
      readback: output.readback,
      screenshotPath:
        this.asNonEmptyString(parsed.screenshotPath) ||
        this.asNonEmptyString(
          (this.readRecord(parsed.diagnostics) || {}).screenshotPath,
        ) ||
        undefined,
      diagnostics: parsed.diagnostics,
      nativeResponse: parsed,
      results: rawResults.map((rawResult, index) => {
        const result = this.readRecord(rawResult) || {};
        const target =
          this.asNonEmptyString(result.targetName) ||
          this.asNonEmptyString(result.targetId) ||
          `对象 ${index + 1}`;
        const status = (
          this.asNonEmptyString(result.status) ||
          (result.ok === true ? 'success' : 'failed')
        ).toLowerCase();
        const succeeded = this.isWechatNativeTargetSuccess(status, result.ok);
        return {
          ...result,
          target,
          ok: succeeded,
          status,
          message:
            this.asNonEmptyString(result.message) ||
            (succeeded ? `${target} 已完成。` : `${target} 未完成。`),
        };
      }),
    };
    args.pushEvent(
      'SkillBatchResult',
      'running',
      noTarget
        ? '当前没有待处理的微信对象。'
        : `逐对象执行结果：成功 ${completedTargets.length}，失败 ${failedTargets.length}，跳过 ${skippedTargets.length}。`,
      batchPayload,
    );

    if (
      parsed.ok !== true ||
      nativeStatus === 'partial' ||
      nativeStatus === 'blocked' ||
      nativeStatus === 'failed'
    ) {
      throw new Error(
        this.asNonEmptyString(parsed.message) ||
          this.asNonEmptyString(parsed.error) ||
          `Windows 微信 ${command} 没有完整执行成功。`,
      );
    }
    args.pushEvent(
      'SkillCompleted',
      'completed',
      noTarget
        ? '当前没有待处理的微信对象。'
        : `Windows 微信执行完成：成功 ${completedTargets.length}，跳过 ${skippedTargets.length}。`,
      batchPayload,
    );
    return true;
  }

  private isWechatNativeTargetSuccess(status: string, ok: unknown) {
    if (ok === false) return false;
    return [
      'success',
      'read',
      'draft_filled',
      'sent',
      'request_submitted',
      'published',
      'browsed',
      'liked',
      'commented',
    ].includes(status);
  }

  private resolveWechatNativeCommand(
    skillId: string | null,
  ): Exclude<WechatNativeCommandKey, 'contacts' | 'chat-history'> | null {
    const aliases: Record<
      string,
      Exclude<WechatNativeCommandKey, 'contacts' | 'chat-history'>
    > = {
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
    };
    return skillId ? aliases[skillId] || null : null;
  }

  private buildWechatNativeSkillInput(
    command: Exclude<WechatNativeCommandKey, 'contacts' | 'chat-history'>,
    input: AgentSSidecarRunTaskInput,
    metadata: Record<string, unknown>,
  ): Record<string, unknown> {
    if (command === 'group-broadcast') {
      const targets = this.normalizeStringList(metadata.wechat_group_targets);
      const messages = this.normalizeWechatTargetMessageMap(
        metadata.wechat_group_messages ?? metadata.wechat_mass_send_contents,
      );
      const defaultMessage =
        this.asNonEmptyString(metadata.wechat_reply_draft) ||
        this.extractLineValue(input.instruction, '群发内容') ||
        '';
      const attachments = this.normalizeStringList(
        metadata.massSendFiles ?? metadata.wechat_mass_send_files,
      );
      return {
        targets: targets.map((target, index) => ({
          id: `target-${index + 1}`,
          displayName: target,
          nickname: target,
          searchText: target,
        })),
        message: {
          text: defaultMessage,
          attachments: attachments.map((path) => ({
            path,
            role: 'attachment',
          })),
        },
        messages: targets.flatMap((target, index) => {
          const message = messages.get(target);
          return message
            ? [
                {
                  targetId: `target-${index + 1}`,
                  targetName: target,
                  message: {
                    text: message,
                    attachments: attachments.map((path) => ({
                      path,
                      role: 'attachment',
                    })),
                  },
                },
              ]
            : [];
        }),
        rateLimit: {
          dailyLimit: this.normalizePositiveInteger(
            metadata.wechat_group_daily_limit,
            targets.length || 1,
            200,
          ),
          intervalMs:
            this.normalizePositiveInteger(
              metadata.wechat_group_interval_seconds,
              0,
              3600,
            ) * 1000,
        },
        allowGroupChats: true,
        stopOnFailure: false,
      };
    }
    if (command === 'contact-add') {
      const targets = this.normalizeStringList(
        metadata.wechat_contact_add_targets,
      );
      const verifyMessage =
        this.asNonEmptyString(metadata.wechat_contact_add_verify_message) ||
        this.extractLineValue(input.instruction, '验证消息') ||
        '';
      return {
        targets: targets.map((target, index) => ({
          id: `target-${index + 1}`,
          displayName: target,
          searchText: target,
          verifyMessage,
        })),
        verifyMessage,
        remark: {
          strategy:
            this.asNonEmptyString(
              metadata.wechat_contact_add_remark_strategy,
            ) || 'none',
          value:
            this.asNonEmptyString(metadata.wechat_contact_add_remark_content) ||
            '',
        },
        blacklistTags: this.normalizeStringList(
          metadata.wechat_contact_add_blacklist,
        ),
        rateLimit: {
          dailyLimit: this.normalizePositiveInteger(
            metadata.wechat_contact_add_daily_limit,
            targets.length || 1,
            50,
          ),
        },
      };
    }
    if (command === 'friend-accept') {
      return {
        remark: {
          strategy:
            this.asNonEmptyString(
              metadata.wechat_friend_accept_remark_strategy,
            ) || 'request_name',
          value:
            this.asNonEmptyString(
              metadata.wechat_friend_accept_remark_content,
            ) || '',
        },
        welcomeMessage:
          this.asNonEmptyString(
            metadata.wechat_friend_accept_welcome_message,
          ) || '',
        matchKeywords: this.normalizeStringList(
          metadata.wechat_friend_accept_match_keywords,
        ),
        dailyLimit: this.normalizePositiveInteger(
          metadata.wechat_friend_accept_daily_limit,
          20,
          100,
        ),
      };
    }
    if (command === 'moments-publish') {
      const details = this.normalizeWechatMomentsPublishDetails(
        metadata,
        input.instruction,
      );
      const first = details[0];
      return {
        content: {
          text: first?.content || '',
          assets: (first?.attachments || []).map((path) => ({
            path,
            role: 'attachment',
          })),
          firstComment: first?.additionalComment || '',
          visibility: first?.visibility || 'public',
          publishAt: first?.scheduledPublishTime || '',
        },
        items: details.map((detail) => ({
          id: detail.target,
          text: detail.content,
          assets: detail.attachments.map((path) => ({
            path,
            role: 'attachment',
          })),
          firstComment: detail.additionalComment,
          visibility: detail.visibility,
          publishAt: detail.scheduledPublishTime || '',
        })),
      };
    }

    const contacts = this.normalizeStringList(
      metadata.wechat_moments_marketing_contacts,
    );
    const mode =
      this.asNonEmptyString(metadata.wechat_moments_marketing_mode) ===
      'targeted'
        ? 'targeted'
        : 'random';
    const actions = this.normalizeMomentsMarketingActions(
      metadata.wechat_moments_marketing_actions,
    );
    const browseLimit = this.normalizePositiveInteger(
      metadata.wechat_moments_marketing_random_browse_count,
      contacts.length || 1,
      100,
    );
    return {
      mode,
      actions: { browse: true, like: actions.like, comment: actions.comment },
      contacts: contacts.map((target, index) => ({
        id: `target-${index + 1}`,
        displayName: target,
        searchText: target,
      })),
      targets: contacts.map((target, index) => ({
        id: `moment-${index + 1}`,
        ordinal: index + 1,
        contact: {
          id: `target-${index + 1}`,
          displayName: target,
          searchText: target,
        },
      })),
      browseLimit,
      comment: {
        mode:
          this.asNonEmptyString(
            metadata.wechat_moments_marketing_comment_mode,
          ) || 'none',
        fixedText:
          this.asNonEmptyString(
            metadata.wechat_moments_marketing_fixed_comment,
          ) || '',
        targetComments: Array.isArray(
          metadata.wechat_moments_marketing_target_comments,
        )
          ? metadata.wechat_moments_marketing_target_comments
          : [],
      },
      rateLimit: {
        dailyLimit: this.normalizePositiveInteger(
          metadata.wechat_moments_marketing_daily_limit,
          contacts.length || browseLimit,
          100,
        ),
      },
    };
  }

  private resolveWechatNativeRuntimePath(): string | null {
    const projectRoot = resolveProjectRoot(process.cwd());
    const resourcesPath = (
      process as NodeJS.Process & { resourcesPath?: string }
    ).resourcesPath;
    const candidates = [
      this.configService.get<string>('AI_CONTENT_WECHAT_NATIVE_RUNTIME'),
      process.env.AI_CONTENT_WECHAT_NATIVE_RUNTIME,
      resourcesPath
        ? join(
            resourcesPath,
            'wechat-native-runtime',
            'kaypal-wechat-native-runtime.exe',
          )
        : undefined,
      resourcesPath
        ? join(
            resourcesPath,
            'wechat-native-runtime',
            'kaypal-wechat-native-runtime.js',
          )
        : undefined,
      join(
        projectRoot,
        'desktop',
        'runtime',
        'wechat-native-runtime',
        'kaypal-wechat-native-runtime.exe',
      ),
      join(
        projectRoot,
        'desktop',
        'runtime',
        'wechat-native-runtime',
        'kaypal-wechat-native-runtime.js',
      ),
    ];
    for (const candidate of candidates) {
      const path = this.asNonEmptyString(candidate);
      if (path && existsSync(path)) return path;
    }
    return null;
  }

  private runWindowsWechatNativeCommand(
    sessionId: string,
    command: WechatNativeCommandKey,
    request: Record<string, unknown>,
    runtimePath: string,
  ): Promise<Record<string, unknown>> {
    const executable =
      extname(runtimePath).toLowerCase() === '.js'
        ? process.execPath
        : runtimePath;
    const commandArgs =
      executable === process.execPath ? [runtimePath, command] : [command];
    return new Promise((resolvePromise, reject) => {
      const child = spawn(executable, commandArgs, {
        env: {
          ...process.env,
          AI_CONTENT_WECHAT_NATIVE_RUNTIME: runtimePath,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      this.localSkillChildren.set(sessionId, child);
      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.localSkillChildren.delete(sessionId);
        callback();
      };
      const timeout = setTimeout(() => {
        if (!child.killed) child.kill('SIGTERM');
        finish(() =>
          reject(
            new Error(`Windows 微信 native runtime ${command} 执行超时。`),
          ),
        );
      }, 180000);
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.on('error', (error) => {
        finish(() => reject(error));
      });
      child.on('close', (code) => {
        finish(() => {
          if (this.isLocalSkillCancelled(sessionId)) {
            reject(new Error('微信任务已暂停。'));
            return;
          }
          const jsonLine = this.findLastJsonLine(stdout);
          if (!jsonLine) {
            reject(
              new Error(
                (stderr || stdout || `native runtime 退出码 ${code}`).trim(),
              ),
            );
            return;
          }
          try {
            resolvePromise(JSON.parse(jsonLine) as Record<string, unknown>);
          } catch (error) {
            reject(
              new Error(
                `Windows 微信 native runtime 返回结果不可解析：${
                  error instanceof Error ? error.message : String(error)
                }`,
              ),
            );
          }
        });
      });
      child.stdin.end(JSON.stringify(request));
    });
  }

  private findLastJsonLine(output: string): string | null {
    const lines = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .reverse();
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as unknown;
        if (parsed && typeof parsed === 'object') return line;
      } catch {
        // Keep scanning earlier diagnostic lines.
      }
    }
    return null;
  }

  private isLocalSkillCancelled(sessionId: string): boolean {
    const session = this.runtimeSessions.get(sessionId);
    return Boolean(
      session?.cancellation_requested === true ||
      session?.status === 'cancelled',
    );
  }

  private normalizeWechatMomentsPublishDetails(
    metadata: Record<string, unknown>,
    instruction: string,
  ) {
    const rawDetails = Array.isArray(metadata.wechat_moments_details)
      ? metadata.wechat_moments_details
      : Array.isArray(metadata.momentsDetails)
        ? metadata.momentsDetails
        : [];
    const fallbackContent =
      this.asNonEmptyString(metadata.wechat_moments_content) ||
      this.asNonEmptyString(metadata.replyText) ||
      this.extractLineValue(instruction, '朋友圈文案') ||
      '';
    const fallbackAsset =
      this.asNonEmptyString(metadata.wechat_moments_asset_path) ||
      this.asNonEmptyString(metadata.assetPath) ||
      '';
    const fallbackVisibility =
      this.asNonEmptyString(metadata.wechat_moments_visibility_code) ||
      this.asNonEmptyString(metadata.wechat_moments_visibility) ||
      'public';
    const source = rawDetails.length
      ? rawDetails
      : [
          {
            content: fallbackContent,
            attachments: fallbackAsset ? [fallbackAsset] : [],
            visibility: fallbackVisibility,
            additionalComment: metadata.wechat_moments_additional_comment,
            scheduledPublishTime: metadata.wechat_moments_schedule_start_time,
          },
        ];
    return source.slice(0, 100).flatMap((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const record = item as Record<string, unknown>;
      const visibilityLabel =
        this.asNonEmptyString(record.visibility) || fallbackVisibility;
      const normalizedVisibility = visibilityLabel.toLowerCase();
      const visibility =
        normalizedVisibility === 'private' || visibilityLabel === '私密'
          ? 'private'
          : normalizedVisibility === 'partial' ||
              visibilityLabel === '部分可见' ||
              visibilityLabel === '不给谁看'
            ? 'partial'
            : 'public';
      const rawAttachments =
        record.attachments ?? record.assetPaths ?? record.assetPath;
      const attachments = Array.isArray(rawAttachments)
        ? this.normalizeStringList(rawAttachments).slice(0, 9)
        : this.asNonEmptyString(rawAttachments)
          ? [this.asNonEmptyString(rawAttachments)!]
          : fallbackAsset
            ? [fallbackAsset]
            : [];
      return [
        {
          target:
            this.asNonEmptyString(record.targetName) ||
            this.asNonEmptyString(record.id) ||
            `朋友圈明细 ${index + 1}`,
          content:
            this.asNonEmptyString(record.content) ||
            this.asNonEmptyString(record.sendContent) ||
            this.asNonEmptyString(record.replyText) ||
            fallbackContent,
          attachments,
          additionalComment:
            this.asNonEmptyString(record.additionalComment) ||
            this.asNonEmptyString(record.comment) ||
            '',
          scheduledPublishTime:
            this.asNonEmptyString(record.scheduledPublishTime) ||
            this.asNonEmptyString(record.scheduledAt) ||
            undefined,
          visibility,
          visibilityLabel,
        },
      ];
    });
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
  }

  private runWechatMomentsPublish(
    content: string,
    mode: 'auto-send' | 'approval',
    assetPath: string,
    additionalComment = '',
    visibility = 'public',
  ): Promise<{ screenshotPath?: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        'wechat-moments-publish',
        [content, mode, assetPath, additionalComment, visibility],
        {
          env: {
            ...process.env,
            PATH: `${process.env.PATH || ''}:/Users/yanghy/.local/bin:/opt/homebrew/bin:/usr/local/bin`,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error('wechat-moments-publish 执行超时'));
      }, 90000);
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error(String(error)));
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
            resolve(
              this.parseWechatCommandOutput(output, 'wechat-moments-publish'),
            );
          } catch (error) {
            if (error instanceof SyntaxError) {
              resolve({});
            } else {
              reject(error instanceof Error ? error : new Error(String(error)));
            }
          }
          return;
        }
        reject(
          new Error(
            (
              stderr ||
              stdout ||
              `wechat-moments-publish 退出码 ${code}`
            ).trim(),
          ),
        );
      });
    });
  }

  private runWechatContactAdd(
    target: string,
    verifyMessage: string,
    mode: 'auto-send' | 'approval',
  ): Promise<{ screenshotPath?: string }> {
    return this.runWechatCommand(
      'wechat-contact-add',
      [target, verifyMessage, mode],
      `wechat-contact-add 执行超时：${target}`,
    );
  }

  private runWechatMomentsMarketing(
    target: string,
    commentText: string,
    mode: 'auto-send' | 'approval',
    actionKind: 'like' | 'comment' | 'like-comment' | 'browse',
    browseIndex = 1,
  ): Promise<{ screenshotPath?: string }> {
    return this.runWechatCommand(
      'wechat-moments-marketing',
      [target, commentText, mode, actionKind, String(browseIndex)],
      `wechat-moments-marketing 执行超时：${target}`,
    );
  }

  private runWechatCommand(
    command: string,
    args: string[],
    timeoutMessage: string,
  ): Promise<{ screenshotPath?: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        env: {
          ...process.env,
          PATH: `${process.env.PATH || ''}:/Users/yanghy/.local/bin:/opt/homebrew/bin:/usr/local/bin`,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(timeoutMessage));
      }, 120000);
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error(String(error)));
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
            resolve(this.parseWechatCommandOutput(output, command));
          } catch (error) {
            if (error instanceof SyntaxError) {
              resolve({});
            } else {
              reject(error instanceof Error ? error : new Error(String(error)));
            }
          }
          return;
        }
        reject(
          new Error((stderr || stdout || `${command} 退出码 ${code}`).trim()),
        );
      });
    });
  }

  private parseWechatCommandOutput(
    output: string,
    command: string,
  ): { screenshotPath?: string } {
    const parsed = JSON.parse(output) as Record<string, unknown>;
    const ok = parsed.ok;
    const status = safeText(parsed.status || '').toLowerCase();
    if (
      ok === false ||
      [
        'failed',
        'error',
        'blocked',
        'captcha_required',
        'risk_blocked',
      ].includes(status)
    ) {
      const message =
        this.asNonEmptyString(parsed.error) ||
        this.asNonEmptyString(parsed.message) ||
        this.asNonEmptyString(parsed.reason) ||
        `${command} 返回失败`;
      throw new Error(message);
    }
    return {
      screenshotPath: this.asNonEmptyString(parsed.screenshotPath) || undefined,
    };
  }

  private extractLineValue(instruction: string, label: string): string | null {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = instruction.match(
      new RegExp(`${escapedLabel}[:：]([^\\n]+)`),
    );
    return match?.[1]?.trim() || null;
  }

  private resolveWechatAccountProtection(metadata: Record<string, unknown>): {
    associatedWeChat?: string;
    currentWechatId?: string;
    warning?: string;
    blocker?: string;
  } {
    const associatedWeChat =
      this.asNonEmptyString(metadata.associatedWeChat) ||
      this.asNonEmptyString(metadata.associated_wechat) ||
      this.asNonEmptyString(metadata.plannedWechatId) ||
      this.asNonEmptyString(metadata.planned_wechat_id);
    if (!associatedWeChat) {
      return {};
    }
    const currentWechatId =
      this.asNonEmptyString(metadata.currentWechatId) ||
      this.asNonEmptyString(metadata.current_wechat_id) ||
      this.asNonEmptyString(metadata.currentWeChat) ||
      this.asNonEmptyString(metadata.current_wechat);
    if (!currentWechatId) {
      return {
        associatedWeChat,
        warning: `计划关联微信号为 ${associatedWeChat}，但当前微信号不可读取；已继续执行，请人工核对当前登录微信号。`,
      };
    }
    if (currentWechatId !== associatedWeChat) {
      return {
        associatedWeChat,
        currentWechatId,
        blocker: `微信号保护阻断：计划关联微信号为 ${associatedWeChat}，当前微信号为 ${currentWechatId}，不一致时禁止执行。`,
      };
    }
    return { associatedWeChat, currentWechatId };
  }

  private normalizeStringList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return [
      ...new Set(
        value
          .filter(
            (item): item is string =>
              typeof item === 'string' && item.trim().length > 0,
          )
          .map((item) => item.trim()),
      ),
    ];
  }

  private readMomentsPlanState(
    metadata: Record<string, unknown>,
    fallbackDailyQuota: number,
  ) {
    const dailyPublished = this.normalizePositiveInteger(
      metadata.dailyPublished ?? metadata.wechat_moments_daily_published,
      0,
      10000,
    );
    const dailyQuota = this.normalizePositiveInteger(
      metadata.dailyQuota ?? metadata.wechat_moments_daily_quota,
      fallbackDailyQuota,
      10000,
    );
    return {
      dailyPublished,
      dailyQuota,
      remainingToday: Math.max(0, dailyQuota - dailyPublished),
      scheduleStartTime:
        this.asNonEmptyString(metadata.scheduleStartTime) ||
        this.asNonEmptyString(metadata.wechat_moments_schedule_start_time) ||
        undefined,
      recordSummary:
        this.asNonEmptyString(metadata.recordSummary) ||
        this.asNonEmptyString(metadata.wechat_moments_record_summary) ||
        undefined,
      prompts: Array.isArray(metadata.prompts)
        ? metadata.prompts
        : Array.isArray(metadata.wechat_moments_prompts)
          ? metadata.wechat_moments_prompts
          : [],
    };
  }

  private assertMomentsScheduleReady(plan: { scheduleStartTime?: string }) {
    if (!plan.scheduleStartTime) return;
    const timestamp = Date.parse(plan.scheduleStartTime);
    if (!Number.isFinite(timestamp)) return;
    if (timestamp > Date.now()) {
      throw new Error(
        `朋友圈计划尚未到开始时间：${plan.scheduleStartTime}，请到点后继续执行。`,
      );
    }
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

  private isConversationCreateInput(
    input: AgentSSidecarCreateSessionInput,
  ): boolean {
    const metadata = input.metadata || {};
    return (
      metadata.conversation_mode === true ||
      metadata.source === 'agent-workbench' ||
      (input.labels || []).includes('agent-workbench') ||
      input.task_type === 'agent.conversation' ||
      input.task_type === 'agent.conversation.execute'
    );
  }

  private async resolveConversationScope(): Promise<AgentSConversationScope> {
    if (!this.authRequestContext && !this.prisma) {
      const environment = (
        this.configService.get<string>('NODE_ENV') ||
        process.env.NODE_ENV ||
        ''
      )
        .trim()
        .toLowerCase();
      if (environment === 'test') return AGENT_S_UNIT_TEST_SCOPE;
      throw new UnauthorizedException('无法确认当前登录上下文。');
    }

    const user = this.authRequestContext?.get()?.user;
    const userId = user?.id?.trim() || '';
    if (!userId) {
      throw new UnauthorizedException('请先登录后访问本机助手对话。');
    }

    if (this.prisma) {
      try {
        const membership = await this.prisma.tenantMember.findFirst({
          where: { userId, status: 'active' },
          orderBy: [{ joinedAt: 'asc' }, { createdAt: 'asc' }],
          select: { tenantId: true },
        });
        if (membership?.tenantId) {
          return { tenantId: membership.tenantId, userId };
        }
      } catch (error) {
        if (user?.kaypalLocalOnly !== true) {
          throw error;
        }
      }
    }

    if (user?.kaypalLocalOnly === true) {
      return { tenantId: `local-desktop:${userId}`, userId };
    }

    throw new ForbiddenException('当前账号尚未绑定可用组织。');
  }

  private conversationScopeKey(scope: AgentSConversationScope): string {
    return `${scope.tenantId}\u0000${scope.userId}`;
  }

  private isConversationStateInScope(
    state: AgentSConversationState,
    scope: AgentSConversationScope,
  ): boolean {
    return state.tenantId === scope.tenantId && state.userId === scope.userId;
  }

  private async registerConversationSession(
    session: AgentSSidecarSessionSummary,
    input: AgentSSidecarCreateSessionInput,
    resolvedScope?: AgentSConversationScope | null,
  ): Promise<void> {
    const metadata = { ...(input.metadata || session.metadata || {}) };
    const labels = [
      ...new Set([...(session.labels || []), ...(input.labels || [])]),
    ];
    if (!this.isConversationCreateInput({ ...input, metadata, labels })) return;

    const scope = resolvedScope || (await this.resolveConversationScope());
    metadata.tenant_id = scope.tenantId;
    metadata.user_id = scope.userId;

    const existing = await this.findConversationSession(session.session_id);
    if (existing) {
      if (!this.isConversationStateInScope(existing, scope)) {
        throw new NotFoundException(
          `本机助手对话不存在：${session.session_id}`,
        );
      }
      existing.session = {
        ...existing.session,
        ...session,
        metadata: { ...existing.session.metadata, ...metadata },
        labels,
      };
      await this.persistConversationState(existing);
      return;
    }

    const state: AgentSConversationState = {
      tenantId: scope.tenantId,
      userId: scope.userId,
      session: {
        ...session,
        metadata,
        labels,
      },
      purpose: this.normalizeConversationPurpose(metadata.conversation_purpose),
      model_id: this.asNonEmptyString(metadata.conversation_model_id),
      messages: [],
      events: [],
      artifacts: [],
      last_run_input: null,
      last_run_kind: null,
      cancellation_requested: false,
      ingested_executor_event_keys: new Set<string>(),
    };
    this.conversationSessions.set(session.session_id, state);
    this.appendConversationEvent(state, {
      event_type: 'conversation_created',
      status: 'idle',
      message: 'Agent-S 对话已创建。',
      payload: {
        purpose: state.purpose,
        model_id: state.model_id,
      },
    });
    try {
      await this.persistConversationState(state);
    } catch (error) {
      this.conversationSessions.delete(session.session_id);
      throw error;
    }
  }

  private cloneConversationSession(
    state: AgentSConversationState,
  ): AgentSConversationSessionDetail {
    const lastRunInput = state.last_run_input
      ? {
          ...state.last_run_input,
          metadata: { ...(state.last_run_input.metadata || {}) },
          attachments: [...(state.last_run_input.attachments || [])].map(
            (attachment) => ({ ...attachment }),
          ),
        }
      : null;
    return {
      session: {
        ...state.session,
        metadata: { ...state.session.metadata },
        labels: [...state.session.labels],
      },
      purpose: state.purpose,
      model_id: state.model_id,
      messages: state.messages.map((message) => ({
        ...message,
        attachments: message.attachments.map((attachment) => ({
          ...attachment,
        })),
        metadata: { ...message.metadata },
      })),
      events: state.events.map((event) => ({
        ...event,
        payload: { ...event.payload },
      })),
      last_run_input: lastRunInput,
    };
  }

  private async requireConversationSession(sessionId: string) {
    const state = await this.findConversationSession(sessionId);
    if (!state) {
      throw new NotFoundException(`本机助手对话不存在：${sessionId}`);
    }
    return state;
  }

  private async findConversationSession(
    sessionId: string,
  ): Promise<AgentSConversationState | null> {
    const cached = this.conversationSessions.get(sessionId);
    if (cached) {
      const scope = await this.resolveConversationScope();
      if (!this.isConversationStateInScope(cached, scope)) {
        throw new NotFoundException(`本机助手对话不存在：${sessionId}`);
      }
      return cached;
    }

    if (!this.prisma) return null;
    const record = await this.prisma.agentSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        tenantId: true,
        userId: true,
        source: true,
        sessionJson: true,
      },
    });
    if (!record || record.source !== AGENT_S_CONVERSATION_SOURCE) {
      return null;
    }

    const scope = await this.resolveConversationScope();
    if (record.tenantId !== scope.tenantId || record.userId !== scope.userId) {
      throw new NotFoundException(`本机助手对话不存在：${sessionId}`);
    }

    const restored = this.restoreConversationState(record, scope);
    if (!restored) {
      throw new NotFoundException(`本机助手对话不存在：${sessionId}`);
    }
    this.cacheRestoredConversationState(restored);
    return restored;
  }

  private async hydrateConversationSessions(
    scope: AgentSConversationScope,
  ): Promise<void> {
    if (!this.prisma) return;
    const scopeKey = this.conversationScopeKey(scope);
    if (this.hydratedConversationScopes.has(scopeKey)) return;

    const pending = this.conversationHydrationQueues.get(scopeKey);
    if (pending) return pending;

    const hydration = (async () => {
      const records = await this.prisma!.agentSession.findMany({
        where: {
          tenantId: scope.tenantId,
          userId: scope.userId,
          source: AGENT_S_CONVERSATION_SOURCE,
        },
        orderBy: { updatedAt: 'desc' },
        take: 200,
        select: {
          id: true,
          tenantId: true,
          userId: true,
          source: true,
          sessionJson: true,
        },
      });
      for (const record of records) {
        const cached = this.conversationSessions.get(record.id);
        if (cached) continue;
        const restored = this.restoreConversationState(record, scope);
        if (restored) this.cacheRestoredConversationState(restored);
      }
      this.hydratedConversationScopes.add(scopeKey);
    })();
    this.conversationHydrationQueues.set(scopeKey, hydration);
    try {
      await hydration;
    } finally {
      if (this.conversationHydrationQueues.get(scopeKey) === hydration) {
        this.conversationHydrationQueues.delete(scopeKey);
      }
    }
  }

  private cacheRestoredConversationState(state: AgentSConversationState): void {
    this.conversationSessions.set(state.session.session_id, state);
    if (state.artifacts.length) {
      this.localSkillArtifacts.set(state.session.session_id, state.artifacts);
    }
  }

  private restoreConversationState(
    record: PersistedAgentSConversationRow,
    scope: AgentSConversationScope,
  ): AgentSConversationState | null {
    const payload = this.readRecord(record.sessionJson);
    if (
      !payload ||
      payload.kind !== AGENT_S_CONVERSATION_STATE_KIND ||
      payload.version !== 1 ||
      payload.tenantId !== scope.tenantId ||
      payload.userId !== scope.userId ||
      record.tenantId !== scope.tenantId ||
      record.userId !== scope.userId
    ) {
      return null;
    }

    const rawSession = this.readRecord(payload.session);
    if (
      !rawSession ||
      this.asNonEmptyString(rawSession.session_id) !== record.id
    ) {
      return null;
    }

    const artifacts = this.restoreConversationArtifacts(
      record.id,
      payload.artifacts,
    );
    const metadata = {
      ...(this.readRecord(rawSession.metadata) || {}),
      tenant_id: scope.tenantId,
      user_id: scope.userId,
    };
    const createdAt =
      this.asNonEmptyString(rawSession.created_at) || new Date().toISOString();
    const updatedAt = this.asNonEmptyString(rawSession.updated_at) || createdAt;
    const completedAt = this.asNonEmptyString(rawSession.completed_at);
    const lastError = this.asNonEmptyString(rawSession.last_error);
    const state: AgentSConversationState = {
      tenantId: scope.tenantId,
      userId: scope.userId,
      session: {
        session_id: record.id,
        session_name: this.asNonEmptyString(rawSession.session_name) || null,
        task_type:
          this.asNonEmptyString(rawSession.task_type) || 'agent.conversation',
        status: this.normalizeConversationStatus(rawSession.status),
        created_at: createdAt,
        updated_at: updatedAt,
        completed_at: completedAt || null,
        metadata,
        labels: this.normalizeStringList(rawSession.labels),
        run_count: this.normalizeConversationInteger(rawSession.run_count),
        active_run_id: this.asNonEmptyString(rawSession.active_run_id) || null,
        cancellation_requested:
          rawSession.cancellation_requested === true ||
          payload.cancellation_requested === true,
        last_error: lastError || null,
        last_event_seq: this.normalizeConversationInteger(
          rawSession.last_event_seq,
        ),
        artifact_count: artifacts.length,
      },
      purpose: this.normalizeConversationPurpose(payload.purpose),
      model_id: this.asNonEmptyString(payload.model_id),
      messages: this.restoreConversationMessages(payload.messages),
      events: this.restoreConversationEvents(record.id, payload.events),
      artifacts,
      last_run_input: this.restoreConversationRunInput(payload.last_run_input),
      last_run_kind:
        payload.last_run_kind === 'model' ||
        payload.last_run_kind === 'executor'
          ? payload.last_run_kind
          : null,
      cancellation_requested: payload.cancellation_requested === true,
      ingested_executor_event_keys: new Set(
        this.normalizeStringList(payload.ingested_executor_event_keys),
      ),
    };
    state.session.last_event_seq = state.events.reduce(
      (maximum, event) => Math.max(maximum, event.seq),
      state.session.last_event_seq,
    );
    return state;
  }

  private restoreConversationMessages(
    value: unknown,
  ): AgentSConversationMessage[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((candidate) => {
      const record = this.readRecord(candidate);
      const messageId = this.asNonEmptyString(record?.message_id);
      const content =
        typeof record?.content === 'string' ? record.content : null;
      const createdAt = this.asNonEmptyString(record?.created_at);
      const role = record?.role;
      const kind = record?.kind;
      if (
        !record ||
        !messageId ||
        content === null ||
        !createdAt ||
        (role !== 'user' && role !== 'assistant' && role !== 'system') ||
        (kind !== 'message' &&
          kind !== 'result' &&
          kind !== 'status' &&
          kind !== 'confirmation')
      ) {
        return [];
      }
      const rawStatus = this.asNonEmptyString(record.status);
      const eventSeq = Number(record.event_seq);
      return [
        {
          message_id: messageId,
          role,
          kind,
          content,
          created_at: createdAt,
          run_id: this.asNonEmptyString(record.run_id) || null,
          status: rawStatus
            ? this.normalizeConversationStatus(rawStatus)
            : undefined,
          purpose: record.purpose
            ? this.normalizeConversationPurpose(record.purpose)
            : undefined,
          model_id: this.asNonEmptyString(record.model_id),
          attachments: this.restoreConversationAttachments(record.attachments),
          event_seq: Number.isFinite(eventSeq) ? eventSeq : null,
          metadata: { ...(this.readRecord(record.metadata) || {}) },
        },
      ];
    });
  }

  private restoreConversationAttachments(
    value: unknown,
  ): AgentSConversationAttachment[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((candidate) => {
      const record = this.readRecord(candidate);
      const filename = this.asNonEmptyString(record?.filename);
      const filepath = this.asNonEmptyString(record?.filepath);
      const mimeType = this.asNonEmptyString(record?.mimeType);
      const uploadedAt = this.asNonEmptyString(record?.uploadedAt);
      const sizeBytes = Number(record?.sizeBytes);
      if (
        !record ||
        !filename ||
        !filepath ||
        !mimeType ||
        !uploadedAt ||
        !Number.isFinite(sizeBytes) ||
        sizeBytes < 0
      ) {
        return [];
      }
      return [{ filename, filepath, mimeType, uploadedAt, sizeBytes }];
    });
  }

  private restoreConversationEvents(
    sessionId: string,
    value: unknown,
  ): AgentSSidecarEvent[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((candidate) => {
      const record = this.readRecord(candidate);
      const seq = Number(record?.seq);
      const eventType = this.asNonEmptyString(record?.event_type);
      const createdAt = this.asNonEmptyString(record?.created_at);
      if (
        !record ||
        !Number.isFinite(seq) ||
        seq <= 0 ||
        !eventType ||
        !createdAt
      ) {
        return [];
      }
      const stepIndex = Number(record.step_index);
      return [
        {
          seq,
          session_id: sessionId,
          run_id: this.asNonEmptyString(record.run_id) || null,
          event_type: eventType,
          status: this.normalizeConversationStatus(record.status),
          created_at: createdAt,
          message: typeof record.message === 'string' ? record.message : null,
          step_index: Number.isFinite(stepIndex) ? stepIndex : null,
          artifact_id: this.asNonEmptyString(record.artifact_id) || null,
          payload: { ...(this.readRecord(record.payload) || {}) },
        },
      ];
    });
  }

  private restoreConversationRunInput(
    value: unknown,
  ): AgentSSidecarRunTaskInput | null {
    const record = this.readRecord(value);
    const instruction = this.asNonEmptyString(record?.instruction);
    if (!record || !instruction) return null;
    const riskLevel = record.risk_level;
    const stepCount = Number(record.step_count);
    return {
      instruction,
      task_type: this.asNonEmptyString(record.task_type),
      metadata: { ...(this.readRecord(record.metadata) || {}) },
      risk_level:
        riskLevel === 'low' || riskLevel === 'medium' || riskLevel === 'high'
          ? riskLevel
          : undefined,
      requires_approval:
        typeof record.requires_approval === 'boolean'
          ? record.requires_approval
          : undefined,
      step_count: Number.isFinite(stepCount) ? stepCount : undefined,
      attachments: this.restoreConversationAttachments(record.attachments),
    };
  }

  private restoreConversationArtifacts(
    sessionId: string,
    value: unknown,
  ): AgentSSidecarArtifact[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((candidate) => {
      const record = this.readRecord(candidate);
      const artifactId = this.asNonEmptyString(record?.artifact_id);
      const filename = this.asNonEmptyString(record?.filename);
      const path = this.asNonEmptyString(record?.path);
      const createdAt = this.asNonEmptyString(record?.created_at);
      const sizeBytes = Number(record?.size_bytes);
      const kind = record?.kind;
      if (
        !record ||
        !artifactId ||
        !filename ||
        !path ||
        !createdAt ||
        !Number.isFinite(sizeBytes) ||
        !['screenshot', 'json', 'text', 'summary', 'log'].includes(String(kind))
      ) {
        return [];
      }
      return [
        {
          artifact_id: artifactId,
          session_id: sessionId,
          run_id: this.asNonEmptyString(record.run_id) || null,
          kind: kind as AgentSSidecarArtifact['kind'],
          filename,
          path,
          created_at: createdAt,
          size_bytes: sizeBytes,
          metadata: { ...(this.readRecord(record.metadata) || {}) },
        },
      ];
    });
  }

  private normalizeConversationInteger(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
  }

  private buildPersistedConversationState(
    state: AgentSConversationState,
  ): PersistedAgentSConversation {
    const artifacts = this.localSkillArtifacts.get(state.session.session_id);
    if (artifacts)
      state.artifacts = artifacts.map((artifact) => ({
        ...artifact,
        metadata: { ...artifact.metadata },
      }));
    return {
      kind: AGENT_S_CONVERSATION_STATE_KIND,
      version: 1,
      tenantId: state.tenantId,
      userId: state.userId,
      session: {
        ...state.session,
        metadata: { ...state.session.metadata },
        labels: [...state.session.labels],
      },
      purpose: state.purpose,
      model_id: state.model_id,
      messages: state.messages.map((message) => ({
        ...message,
        attachments: message.attachments.map((attachment) => ({
          ...attachment,
        })),
        metadata: { ...message.metadata },
      })),
      events: state.events.map((event) => ({
        ...event,
        payload: { ...event.payload },
      })),
      last_run_input: state.last_run_input
        ? {
            ...state.last_run_input,
            metadata: { ...(state.last_run_input.metadata || {}) },
            attachments: [...(state.last_run_input.attachments || [])].map(
              (attachment) => ({ ...attachment }),
            ),
          }
        : null,
      last_run_kind: state.last_run_kind,
      cancellation_requested: state.cancellation_requested,
      ingested_executor_event_keys: [...state.ingested_executor_event_keys],
      artifacts: state.artifacts.map((artifact) => ({
        ...artifact,
        metadata: { ...artifact.metadata },
      })),
    };
  }

  private async persistConversationState(
    state: AgentSConversationState,
  ): Promise<void> {
    if (!this.prisma) return;
    const sessionId = state.session.session_id;
    const snapshot = this.buildPersistedConversationState(state);
    const previous = this.conversationPersistQueues.get(sessionId);
    const operation = (previous || Promise.resolve())
      .catch(() => undefined)
      .then(() => this.writePersistedConversationState(snapshot));
    this.conversationPersistQueues.set(sessionId, operation);
    try {
      await operation;
    } finally {
      if (this.conversationPersistQueues.get(sessionId) === operation) {
        this.conversationPersistQueues.delete(sessionId);
      }
    }
  }

  private async writePersistedConversationState(
    snapshot: PersistedAgentSConversation,
  ): Promise<void> {
    if (!this.prisma) return;
    const sessionId = snapshot.session.session_id;
    const existing = await this.prisma.agentSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        tenantId: true,
        userId: true,
        source: true,
      },
    });
    if (
      existing &&
      (existing.tenantId !== snapshot.tenantId ||
        existing.userId !== snapshot.userId ||
        existing.source !== AGENT_S_CONVERSATION_SOURCE)
    ) {
      throw new ForbiddenException('会话标识已被其他归属记录占用。');
    }

    const latestInstruction = [...snapshot.messages]
      .reverse()
      .find(
        (message) => message.role === 'user' && message.kind === 'message',
      )?.content;
    const sessionJson = this.toConversationJson(snapshot);
    const events = this.toConversationJson(snapshot.events);
    const confirmations = this.toConversationJson(
      snapshot.messages.filter((message) => message.kind === 'confirmation'),
    );
    const evidence = this.toConversationJson(snapshot.artifacts);
    const updatedAt = this.toConversationDate(snapshot.session.updated_at);
    const completedAt = snapshot.session.completed_at
      ? this.toConversationDate(snapshot.session.completed_at)
      : null;
    const data = {
      tenantId: snapshot.tenantId,
      userId: snapshot.userId,
      source: AGENT_S_CONVERSATION_SOURCE,
      status: snapshot.session.status,
      title: snapshot.session.session_name || '新对话',
      scope: `agent-conversation:${snapshot.purpose}`,
      targetApp: 'agent-s',
      instruction: latestInstruction || null,
      riskLevel: snapshot.purpose === 'execute' ? 'high' : 'low',
      events,
      confirmations,
      evidence,
      sessionJson,
      updatedAt,
      completedAt,
    };

    if (existing) {
      const result = await this.prisma.agentSession.updateMany({
        where: {
          id: sessionId,
          tenantId: snapshot.tenantId,
          userId: snapshot.userId,
          source: AGENT_S_CONVERSATION_SOURCE,
        },
        data,
      });
      if (result.count !== 1) {
        throw new ForbiddenException('会话归属已变化，状态写入被拒绝。');
      }
      return;
    }

    await this.prisma.agentSession.create({
      data: {
        id: sessionId,
        ...data,
        createdAt: this.toConversationDate(snapshot.session.created_at),
      },
    });
  }

  private toConversationJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private toConversationDate(value: string): Date {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : new Date();
  }

  private normalizeConversationPurpose(
    value: unknown,
  ): AgentSConversationPurpose {
    return value === 'research' || value === 'draft' || value === 'execute'
      ? value
      : 'general';
  }

  private sanitizeConversationAttachments(
    value: unknown,
  ): AgentSConversationAttachment[] {
    if (!Array.isArray(value) || value.length === 0) return [];
    if (value.length > 3) {
      throw new BadRequestException('每条消息最多添加 3 个图片附件。');
    }

    const configuredRoot = resolveProjectLogPath('interaction-assets');
    const allowedRoot = existsSync(configuredRoot)
      ? realpathSync(configuredRoot)
      : resolve(configuredRoot);
    return value.map((rawAttachment) => {
      const record = this.readRecord(rawAttachment);
      const requestedPath = this.asNonEmptyString(record?.filepath);
      if (!record || !requestedPath || !existsSync(requestedPath)) {
        throw new BadRequestException('附件不存在，请重新上传后再试。');
      }
      const filepath = realpathSync(resolve(requestedPath));
      if (
        filepath !== allowedRoot &&
        !filepath.startsWith(`${allowedRoot}${sep}`)
      ) {
        throw new BadRequestException('附件不在允许的上传目录中。');
      }
      const fileStat = statSync(filepath);
      if (!fileStat.isFile() || fileStat.size <= 0) {
        throw new BadRequestException('附件为空或不是有效文件。');
      }
      if (fileStat.size > 30 * 1024 * 1024) {
        throw new BadRequestException('单个附件不能超过 30MB。');
      }
      const mimeType = this.asNonEmptyString(record.mimeType) || '';
      const extension = extname(filepath).toLowerCase();
      if (
        !mimeType.startsWith('image/') ||
        !['.png', '.jpg', '.jpeg', '.webp'].includes(extension)
      ) {
        throw new BadRequestException('当前仅支持 PNG、JPG 或 WebP 图片附件。');
      }
      return {
        filename:
          basename(this.asNonEmptyString(record.filename) || filepath) ||
          `attachment${extension}`,
        filepath,
        mimeType,
        sizeBytes: fileStat.size,
        uploadedAt:
          this.asNonEmptyString(record.uploadedAt) ||
          new Date(fileStat.mtimeMs).toISOString(),
      };
    });
  }

  private appendConversationMessage(
    state: AgentSConversationState,
    input: Omit<AgentSConversationMessage, 'message_id'>,
  ): AgentSConversationMessage {
    const message: AgentSConversationMessage = {
      ...input,
      message_id: `conversation-message-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      attachments: input.attachments.map((attachment) => ({ ...attachment })),
      metadata: { ...input.metadata },
    };
    state.messages.push(message);
    state.session.updated_at = message.created_at;
    return message;
  }

  private buildConversationHistoryPayload(state: AgentSConversationState) {
    return state.messages
      .filter(
        (message) => message.kind === 'message' || message.kind === 'result',
      )
      .slice(-12)
      .map((message) => ({
        role: message.role,
        content: message.content.slice(0, 4000),
        created_at: message.created_at,
        purpose: message.purpose || state.purpose,
        attachments: message.attachments.map((attachment) => ({
          filename: attachment.filename,
          mimeType: attachment.mimeType,
        })),
      }));
  }

  private buildConversationExecutorInstruction(
    state: AgentSConversationState,
    instruction: string,
    attachments: AgentSConversationAttachment[],
  ) {
    const previousMessages = state.messages
      .slice(0, -1)
      .filter(
        (message) => message.kind === 'message' || message.kind === 'result',
      )
      .slice(-8)
      .map((message) => `${message.role}: ${message.content.slice(0, 1200)}`);
    const attachmentLines = attachments.map(
      (attachment) =>
        `- ${attachment.filename} (${attachment.mimeType}): ${attachment.filepath}`,
    );
    return [
      previousMessages.length
        ? `Conversation context:\n${previousMessages.join('\n')}`
        : null,
      `Current user request:\n${instruction}`,
      attachmentLines.length
        ? `Approved local attachments:\n${attachmentLines.join('\n')}`
        : null,
      'Risk rule: prepare the next desktop action and pause before any external send, publish, delete, submit, or irreversible change. Do not report completion without an executor event and readback evidence.',
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  private appendConversationEvent(
    state: AgentSConversationState,
    input: Omit<
      AgentSSidecarEvent,
      'seq' | 'session_id' | 'created_at' | 'payload'
    > & {
      created_at?: string;
      payload?: Record<string, unknown>;
    },
  ): AgentSSidecarEvent {
    const event: AgentSSidecarEvent = {
      seq:
        state.events.reduce((max, current) => Math.max(max, current.seq), 0) +
        1,
      session_id: state.session.session_id,
      run_id: input.run_id || state.session.active_run_id || null,
      event_type: input.event_type,
      status: input.status,
      created_at: input.created_at || new Date().toISOString(),
      message: input.message || null,
      step_index: input.step_index ?? null,
      artifact_id: input.artifact_id || null,
      payload: { ...(input.payload || {}) },
    };
    state.events.push(event);
    state.session.status = event.status;
    state.session.updated_at = event.created_at;
    state.session.last_event_seq = event.seq;
    if (
      ['completed', 'failed', 'cancelled', 'blocked'].includes(event.status)
    ) {
      state.session.active_run_id = null;
      state.session.completed_at = event.created_at;
      if (event.status === 'failed' || event.status === 'blocked') {
        state.session.last_error = event.message || state.session.last_error;
      }
    }
    return event;
  }

  private normalizeConversationStatus(
    value: unknown,
  ): AgentSSidecarSessionSummary['status'] {
    if (
      value === 'idle' ||
      value === 'running' ||
      value === 'blocked' ||
      value === 'waiting_approval' ||
      value === 'completed' ||
      value === 'failed' ||
      value === 'cancelled'
    ) {
      return value;
    }
    return value === 'accepted' ? 'running' : 'failed';
  }

  private async resolveConversationModelId(value?: string | null) {
    const configured = this.asNonEmptyString(value);
    if (configured) return configured;
    const defaults = await this.defaultModels.getDefaults();
    const fallback = defaults.articleCreation || defaults.topicSelection;
    if (!fallback) {
      throw new BadRequestException(
        '尚未配置可用模型，请先在模型设置中选择默认文本模型。',
      );
    }
    return fallback;
  }

  private async generateConversationReply(
    state: AgentSConversationState,
    instruction: string,
    purpose: AgentSConversationPurpose,
    modelId: string,
    attachments: AgentSConversationAttachment[],
  ) {
    const purposeInstructions: Record<
      Exclude<AgentSConversationPurpose, 'execute'>,
      string
    > = {
      general:
        '与用户协作澄清目标、分析问题并给出下一步。回答要直接、具体，不要声称已经执行任何外部操作。',
      research:
        '整理现有上下文和可用知识，明确区分已知信息、推断和缺失信息。不要虚构来源或引用。',
      draft:
        '根据对话生成可编辑的内容草稿。发送、发布、删除或外部提交都只能作为草稿建议，不能声称已经完成。',
    };
    const systemPrompt = [
      '你是 Agent-S 工作台中的对话规划助手。',
      purposeInstructions[
        purpose as Exclude<AgentSConversationPurpose, 'execute'>
      ],
      '真实桌面执行只由 Agent-S 执行器完成；没有执行器事件和回读证据时，绝不能宣称操作成功或已完成。',
      '使用简洁中文回答。',
    ].join('\n');
    const history = state.messages
      .filter(
        (message) => message.kind === 'message' || message.kind === 'result',
      )
      .slice(-14);
    let reply: string;

    if (attachments.length) {
      const attachment = attachments[0];
      const prompt = [
        ...history.map(
          (message) => `${message.role}: ${message.content.slice(0, 3000)}`,
        ),
        `当前请求：${instruction}`,
        `图片附件：${attachment.filename}`,
      ].join('\n\n');
      reply = await this.aiClient.generateWithImage(
        modelId,
        {
          system: systemPrompt,
          prompt,
          imageBase64: readFileSync(attachment.filepath).toString('base64'),
        },
        {
          mimeType: attachment.mimeType,
          temperature: purpose === 'draft' ? 0.7 : 0.4,
          maxTokens: 1800,
          knowledgeMode: purpose === 'research' ? 'preferred' : 'contextual',
          knowledgeQuery: instruction,
        },
      );
    } else {
      reply = await this.aiClient.generate(
        modelId,
        [
          { role: 'system', content: systemPrompt },
          ...history.map((message) => ({
            role: message.role as 'user' | 'assistant',
            content: message.content,
          })),
        ],
        {
          temperature: purpose === 'draft' ? 0.7 : 0.4,
          maxTokens: 1800,
          knowledgeMode: purpose === 'research' ? 'preferred' : 'contextual',
          knowledgeQuery: instruction,
        },
      );
    }

    const normalized = reply.trim();
    if (!normalized) {
      throw new Error('所选模型未返回内容。');
    }
    return normalized;
  }

  private writeConversationArtifact(
    sessionId: string,
    runId: string,
    content: string,
    metadata: Record<string, unknown>,
  ): AgentSSidecarArtifact {
    const artifactRoot =
      this.asNonEmptyString(
        this.configService.get<string>('AI_CONTENT_LOCAL_ARTIFACT_ROOT'),
      ) ||
      this.asNonEmptyString(process.env.AI_CONTENT_LOCAL_ARTIFACT_ROOT) ||
      resolveProjectLogPath('agent-s-artifacts');
    const directory = join(artifactRoot, 'agent-workbench', sessionId);
    mkdirSync(directory, { recursive: true });
    const filename = this.safeArtifactFilename(`result-${runId}.md`);
    const path = join(directory, filename);
    writeFileSync(path, content, 'utf8');
    const artifact: AgentSSidecarArtifact = {
      artifact_id: `conversation-artifact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      session_id: sessionId,
      run_id: runId,
      kind: 'summary',
      filename,
      path,
      created_at: new Date().toISOString(),
      size_bytes: Buffer.byteLength(content, 'utf8'),
      metadata: { ...metadata, source: 'agent-workbench' },
    };
    const artifacts = this.localSkillArtifacts.get(sessionId) || [];
    this.localSkillArtifacts.set(sessionId, [...artifacts, artifact]);
    const contents =
      this.localSkillArtifactContents.get(sessionId) ||
      new Map<string, string | Buffer>();
    contents.set(artifact.artifact_id, content);
    this.localSkillArtifactContents.set(sessionId, contents);
    return artifact;
  }

  private attachBrowserStorageStatePath(
    metadata: Record<string, unknown>,
  ): void {
    if (
      typeof metadata.browserStorageStatePath === 'string' &&
      metadata.browserStorageStatePath.trim()
    ) {
      return;
    }
    if (
      typeof metadata.storageStatePath === 'string' &&
      metadata.storageStatePath.trim()
    ) {
      metadata.browserStorageStatePath = metadata.storageStatePath.trim();
      return;
    }

    const accountFile =
      this.asNonEmptyString(metadata.platformAccountFile) ||
      this.asNonEmptyString(metadata.platformAccountFilePath) ||
      this.asNonEmptyString(metadata.accountFile) ||
      this.asNonEmptyString(metadata.accountFilePath);
    if (!accountFile) {
      return;
    }

    const candidate = this.resolveAutoUploadCookiePath(accountFile);
    if (candidate) {
      metadata.browserStorageStatePath = candidate;
      metadata.storageStatePath = candidate;
    }
  }

  private resolveAutoUploadCookiePath(filePath: string): string | null {
    const safeFileName = basename(filePath);
    if (!safeFileName || safeFileName === '.' || safeFileName === '..') {
      return null;
    }
    const directCandidate = isAbsolute(filePath) ? filePath : '';
    if (directCandidate && existsSync(directCandidate)) {
      return directCandidate;
    }
    const configuredRoot = this.asNonEmptyString(
      this.configService.get<string>('LEGACY_AUTO_UPLOAD_ROOT'),
    );
    if (!configuredRoot) {
      return null;
    }
    const candidate = join(configuredRoot, 'cookiesFile', safeFileName);
    return existsSync(candidate) ? candidate : null;
  }

  private asNonEmptyString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : null;
  }

  private mapRuntimeStatus(
    status?: string,
  ): AgentSSidecarSessionSummary['status'] {
    if (status === 'completed') return 'completed';
    if (status === 'failed') return 'failed';
    if (status === 'blocked') return 'blocked';
    if (status === 'cancelled') return 'cancelled';
    if (status === 'running' || status === 'accepted') return 'running';
    return 'running';
  }

  private mapRuntimeEventToSessionEvent(
    sessionId: string,
    event: RuntimeRunEvent,
  ): AgentSSidecarEvent {
    const seq = typeof event.sequence === 'number' ? event.sequence : 0;
    const payload = event.payload || {};
    const message =
      typeof payload.summary === 'string'
        ? payload.summary
        : typeof payload.message === 'string'
          ? payload.message
          : typeof payload.response === 'string'
            ? payload.response
            : event.event_type || null;
    return {
      seq,
      session_id: sessionId,
      run_id: event.run_id || null,
      event_type: event.event_type || 'RuntimeEvent',
      status: this.mapRuntimeStatus(event.status),
      created_at: event.occurred_at || new Date().toISOString(),
      message,
      step_index: null,
      artifact_id: null,
      payload: {
        ...payload,
        runtimeEventId: event.event_id || null,
        taskId: event.task_id || null,
        traceId: event.trace_id || null,
      },
    };
  }

  private markReady(
    health: AgentSSidecarHealthResponse,
    sidecarStatus: AgentSSidecarStatusResponse,
  ): void {
    this.status = {
      ...this.status,
      phase: 'ready',
      connected: true,
      lastSeenAt: new Date().toISOString(),
      lastError: undefined,
      sidecar: {
        health,
        status: sidecarStatus,
      },
    };
  }

  private cloneStatus(): AgentSManagerStatus {
    return {
      ...this.status,
      sidecar: this.status.sidecar
        ? {
            health: this.status.sidecar.health
              ? { ...this.status.sidecar.health }
              : undefined,
            status: this.status.sidecar.status
              ? { ...this.status.sidecar.status }
              : undefined,
          }
        : undefined,
    };
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (axios.isAxiosError(error)) {
      return (
        (error.response?.data as { message?: string } | undefined)?.message ||
        error.message
      );
    }
    return String(error);
  }
}
