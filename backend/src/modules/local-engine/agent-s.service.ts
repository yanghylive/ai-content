import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { basename, isAbsolute, join } from 'path';
import { AiClientService } from '../ai-models/ai-client.service';
import { DefaultModelsService } from '../ai-models/default-models.service';

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
  mock_step_delay_ms?: number;
  simulate_failure_step?: number;
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
  private readonly runtimeSessionStartedAt = new Map<string, number>();
  private readonly runtimeSessionTimeoutMs = 120000;

  constructor(
    private readonly configService: ConfigService,
    private readonly aiClient: AiClientService,
    private readonly defaultModels: DefaultModelsService,
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
    options: { allowSpawn?: boolean } = {},
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
    } catch (error) {
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
    } catch (error) {
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
    try {
      const response = await this.client.post('/sessions', input);
      return response.data;
    } catch (error) {
      if (!this.isNotFound(error)) {
        throw error;
      }
      const now = new Date().toISOString();
      const session: AgentSSidecarSessionSummary = {
        session_id: `runtime-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        session_name: input.session_name || null,
        task_type: input.task_type || 'ops-workbench.task',
        status: 'idle',
        created_at: now,
        updated_at: now,
        completed_at: null,
        metadata: input.metadata || {},
        labels: input.labels || [],
        run_count: 0,
        active_run_id: null,
        cancellation_requested: false,
        last_error: null,
        last_event_seq: 0,
        artifact_count: 0,
      };
      this.runtimeSessions.set(session.session_id, session);
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
    const localSkillResult = await this.tryRunLocalSkill(sessionId, input);
    if (localSkillResult) {
      return localSkillResult;
    }

    try {
      const response = await this.client.post(
        `/sessions/${sessionId}/run`,
        input,
      );
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

  async getEvents(
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
      const response = await this.client.get(`/sessions/${sessionId}/events`, {
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
    const response = await this.client.post(`/sessions/${sessionId}/cancel`);
    return response.data;
  }

  async approveSession(
    sessionId: string,
    input: AgentSSidecarApprovalDecisionInput,
  ): Promise<{ session_id: string; status: string; decision: string }> {
    try {
      const response = await this.client.post(
        `/sessions/${sessionId}/approve`,
        input,
      );
      return response.data;
    } catch (error) {
      if (!this.isNotFound(error)) {
        throw error;
      }
      const response = await this.client.post(
        `/sessions/${sessionId}/approval`,
        input,
      );
      return response.data;
    }
  }

  async getArtifacts(
    sessionId: string,
  ): Promise<{ session_id: string; artifacts: AgentSSidecarArtifact[] }> {
    const response = await this.client.get(`/sessions/${sessionId}/artifacts`);
    return response.data;
  }

  async getArtifact(
    sessionId: string,
    artifactId: string,
  ): Promise<{ artifact: AgentSSidecarArtifact; content: string | Buffer }> {
    const response = await this.client.get(
      `/sessions/${sessionId}/artifacts/${artifactId}`,
    );
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
      const response = await this.client.post('/runs', {
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
        const detail = error.response?.data?.detail || error.message;
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
      const response = await this.client.get(`/runs/${runId}/events`, {
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
    if (skillId === 'wechat.moments.publish') {
      throw new Error('朋友圈发布功能已下线。');
    }

    if (
      skillId !== 'wechat.live.auto_reply' &&
      skillId !== 'wechat.session.auto_reply' &&
      skillId !== 'wechat.group.broadcast'
    ) {
      return null;
    }

    const runId = `local-skill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

    try {
      if (skillId === 'wechat.live.auto_reply') {
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
      } else if (skillId === 'wechat.group.broadcast') {
        const targets = this.normalizeStringList(metadata.wechat_group_targets);
        const message =
          this.asNonEmptyString(metadata.wechat_reply_draft) ||
          this.extractLineValue(input.instruction, '群发内容');
        if (!targets.length || !message) {
          throw new Error('缺少群发目标或群发内容，不能执行微信群发。');
        }
        const mode =
          this.asNonEmptyString(metadata.wechat_reply_mode) === 'auto-send'
            ? 'auto-send'
            : 'approval';
        const results: Array<{
          target: string;
          status: 'success' | 'failed';
          message: string;
          screenshotPath?: string;
        }> = [];
        for (const [index, target] of targets.entries()) {
          pushEvent(
            'SkillTargetStarted',
            'running',
            `正在发送第 ${index + 1}/${targets.length} 个目标：${target}`,
            { target },
          );
          this.logger.log(
            `Running wechat-auto-reply group skill: target=${target} mode=${mode}`,
          );
          try {
            const result = await this.runWechatAutoReply(target, message, mode);
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
              { target, message, mode, screenshotPath: result.screenshotPath },
            );
          } catch (error) {
            const failure =
              error instanceof Error ? error.message : String(error);
            results.push({ target, status: 'failed', message: failure });
            pushEvent(
              'SkillTargetFailed',
              'running',
              `发送给 ${target} 失败：${failure}`,
              { target, message, mode, error: failure },
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
            message,
            mode,
            results,
            summary: {
              total: targets.length,
              success: successCount,
              failed: failedCount,
            },
          },
        );
      } else {
        const content =
          this.asNonEmptyString(metadata.wechat_moments_content) ||
          this.extractLineValue(input.instruction, '朋友圈文案');
        const assetPath = this.asNonEmptyString(
          metadata.wechat_moments_asset_path,
        );
        const mode =
          this.asNonEmptyString(metadata.wechat_reply_mode) === 'auto-send'
            ? 'auto-send'
            : 'approval';
        if (!content) {
          throw new Error('缺少朋友圈文案，不能执行朋友圈发布。');
        }
        if (!assetPath) {
          throw new Error('缺少朋友圈素材路径，不能执行朋友圈发布。');
        }
        this.logger.log(`Running wechat-moments-publish skill: mode=${mode}`);
        const result = await this.runWechatMomentsPublish(
          content,
          mode,
          assetPath,
        );
        pushEvent(
          'SkillCompleted',
          'completed',
          mode === 'auto-send'
            ? '微信朋友圈已执行发表。'
            : '微信朋友圈已填入内容，停在发表前。',
          { content, mode, assetPath, screenshotPath: result.screenshotPath },
        );
      }

      this.localSkillEvents.set(sessionId, events);
      if (session) {
        this.runtimeSessions.set(sessionId, {
          ...this.runtimeSessions.get(sessionId)!,
          status: 'completed',
          updated_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          last_event_seq: events.length,
        });
      }
      return {
        accepted: true,
        session_id: sessionId,
        run_id: runId,
        status: 'completed',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushEvent('SkillFailed', 'failed', message, { error: message });
      this.localSkillEvents.set(sessionId, events);
      if (session) {
        this.runtimeSessions.set(sessionId, {
          ...this.runtimeSessions.get(sessionId)!,
          status: 'failed',
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
        status: 'failed',
      };
    }
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
        reject(error);
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
        { temperature: 0.5, maxTokens: 200 },
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
            const parsed = JSON.parse(output) as { screenshotPath?: unknown };
            resolve({
              screenshotPath:
                this.asNonEmptyString(parsed.screenshotPath) || undefined,
            });
          } catch {
            resolve({});
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

  private runWechatMomentsPublish(
    content: string,
    mode: 'auto-send' | 'approval',
    assetPath: string,
  ): Promise<{ screenshotPath?: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        'wechat-moments-publish',
        [content, mode, assetPath],
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
            const parsed = JSON.parse(output) as { screenshotPath?: unknown };
            resolve({
              screenshotPath:
                this.asNonEmptyString(parsed.screenshotPath) || undefined,
            });
          } catch {
            resolve({});
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

  private extractLineValue(instruction: string, label: string): string | null {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = instruction.match(
      new RegExp(`${escapedLabel}[:：]([^\\n]+)`),
    );
    return match?.[1]?.trim() || null;
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
      return error.response?.data?.message || error.message;
    }
    return String(error);
  }
}
