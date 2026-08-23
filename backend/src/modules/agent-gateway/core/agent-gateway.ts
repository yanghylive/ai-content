import {
  AgentSession,
  AgentEvent,
  AgentTask,
  Approval,
  Artifact,
  Capabilities,
  Evidence,
  TenantContext,
  ToolCall,
  ToolRequest,
  ToolResult,
  ToolSpec,
  UsageEvent,
} from './types';
import { transition } from './task-state-machine';
import { ToolRegistry } from './tool-registry';
import { IdempotencyStore } from './idempotency';
import { ApprovalService } from './approval';
import { EventBus } from './event-bus';
import { MemoryOrchestrator } from './memory-orchestrator';
import { PayloadValidator } from './payload-validator';
import { AgentGatewayMirror } from './mirror';
import { makeError, AppErrorError } from '../contracts/error-codes';
import { AppError } from './types';
import { genId, nowIso, hashJson } from './util';
import { MockOctopAdapter, OctopAdapter } from '../adapters/octop-mock';
import {
  BusinessToolRegistry,
  ToolArtifact,
  ToolExecution,
} from '../adapters/business-tools';

export type ExecuteOutcome =
  | { kind: 'awaiting_approval'; approvalId: string; taskId: string }
  | { kind: 'result'; result: ToolResult };

export interface GatewayDeps {
  registry: ToolRegistry;
  idempotency: IdempotencyStore;
  approvals: ApprovalService;
  bus: EventBus;
  octop: OctopAdapter;
  memory: MemoryOrchestrator;
  business: BusinessToolRegistry;
  /** 执行前后用 ToolSpec.inputSchema/outputSchema 校验载荷（P2-10） */
  validator: PayloadValidator;
  /** 可选持久化 sink：每次 usage 落库后回调（真实仓库接 agent_gateway_usage_events） */
  usageSink?: (ev: UsageEvent) => void | Promise<void>;
  /** 写路径持久化镜像（session/task/event/artifact；内存态仍权威） */
  mirror?: AgentGatewayMirror;
  sessionTtlMs?: number;
  approvalTtlMs?: number;
}

/**
 * Agent Gateway 编排器 —— 整张整合图的地基。
 * 安全模型：身份只来自服务端派生(ctx)，所有资源操作校验 tenant+user+agent 所有权；
 * 审批绑定 taskId+toolCallId 且一次性消费；终态任务禁止写；异常/取消/暂停真实终止执行器；
 * usage 与 ToolCall 状态真实记录。
 */
export class AgentGateway {
  private sessions = new Map<string, AgentSession>();
  private tasks = new Map<string, AgentTask>();
  private toolCalls = new Map<string, ToolCall>();
  private artifacts = new Map<string, Artifact>();
  private evidence = new Map<string, Evidence>();
  private usageEvents = new Map<string, UsageEvent>();
  private pendingRequests = new Map<string, { request: ToolRequest; toolCallId: string; approvalId?: string }>();
  /** 每个任务一个 AbortController：取消任务 A 不得影响同会话任务 B（P1-3） */
  private controllers = new Map<string, AbortController>();

  constructor(private deps: GatewayDeps) {}

  registerToolSpec(spec: ToolSpec): void {
    this.deps.registry.register(spec);
  }

  // ---------------------------------------------------------------- 会话
  async createSession(ctx: TenantContext, mode: 'business' | 'advanced' = 'business'): Promise<AgentSession> {
    let octopSessionId: string | undefined;
    try {
      const s = await this.deps.octop.createSession(ctx);
      octopSessionId = s.octopSessionId;
    } catch {
      // Octop 挂掉不影响业务模式
    }
    const session: AgentSession = {
      id: genId('sess'),
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      agentId: ctx.agentId,
      octopSessionId,
      mode,
      status: 'active',
      lastEventId: '',
      lastSequence: 0,
      expiresAt: new Date(Date.now() + (this.deps.sessionTtlMs ?? 3_600_000)).toISOString(),
      createdAt: nowIso(),
    };
    this.sessions.set(session.id, session);
    // 先镜像 session 落库，再发布事件——事件落库时按 session 反查租户不为空（P1-5）
    this.fireMirror((m) => m.sessionCreated?.(session));
    this.deps.bus.publish(session.id, 'message', session.id, {
      content: `已创建${mode === 'advanced' ? '高级' : '业务'}会话`,
    });
    return session;
  }

  /** 恢复会话：必须校验会话所有权（防跨租户越权恢复） */
  resumeSession(sessionId: string, ctx: TenantContext, lastEventId?: string): { session: AgentSession; events: ReturnType<EventBus['snapshot']> } {
    const session = this.requireSession(sessionId);
    this.assertOwnership(session, ctx);
    if (session.status === 'expired' || Date.parse(session.expiresAt) <= Date.now()) {
      throw makeError('SESSION_EXPIRED', { details: { sessionId } });
    }
    const events = this.deps.bus.getEventsSince(sessionId, lastEventId);
    // P2-8：实时更新会话消费进度（契约字段语义：lastEventId/lastSequence 表示已消费到哪）
    if (events.length > 0) {
      session.lastEventId = events[events.length - 1].eventId;
      session.lastSequence = events[events.length - 1].sequence;
      this.fireMirror((m) => m.sessionUpdated?.(session));
    }
    return { session, events };
  }

  // ---------------------------------------------------------------- 任务
  createTask(ctx: TenantContext, sessionId: string, type: string, plan: Record<string, unknown>): AgentTask {
    const session = this.requireSession(sessionId);
    this.assertOwnership(session, ctx);
    const task: AgentTask = {
      id: genId('task'),
      sessionId,
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      agentId: ctx.agentId,
      type,
      status: transition('draft', 'plan'),
      planJson: plan,
      checkpointJson: {},
      createdAt: nowIso(),
    };
    this.tasks.set(task.id, task);
    this.deps.bus.publish(sessionId, 'thinking', task.id, {
      step: 'plan',
      summary: `已规划任务 ${type}`,
    });
    this.fireMirror((m) => m.taskCreated?.(task));
    return task;
  }

  createTaskFromPlan(ctx: TenantContext, sessionId: string, type: string, plan: Record<string, unknown>): AgentTask {
    return this.createTask(ctx, sessionId, type, plan);
  }

  // ---------------------------------------------------------------- 工具执行
  async executeTool(ctx: TenantContext, request: ToolRequest): Promise<ExecuteOutcome> {
    const session = this.requireSession(request.sessionId);
    this.assertOwnership(session, ctx);
    const task = this.requireTask(request.taskId);
    this.assertOwnership(task, ctx);

    // P0-5：终态任务禁止再执行写工具
    if (this.isTerminal(task.status)) {
      return { kind: 'result', result: this.errorResult(request, makeError('TASK_TERMINAL', { details: { taskId: task.id, status: task.status } })) };
    }

    // P1-5：awaiting_confirmation 重复提交 → 幂等返回现有审批，不新建幂等/pending/审批
    if (task.status === 'awaiting_confirmation') {
      const existing = this.pendingRequests.get(task.id);
      if (existing?.approvalId) {
        return { kind: 'awaiting_approval', approvalId: existing.approvalId, taskId: task.id };
      }
      return { kind: 'result', result: this.errorResult(request, makeError('CHECKPOINT_MISSING', { details: { taskId: task.id, reason: '任务等待确认但缺少审批记录' } })) };
    }
    // 其他非 planned 状态不允许提交新工具调用（恢复请走 resumeTask / 控制面）
    if (task.status !== 'planned') {
      return { kind: 'result', result: this.errorResult(request, makeError('INVALID_PLAN', { details: { taskId: task.id, status: task.status, reason: '任务不在可执行状态，请走恢复/控制面' } })) };
    }

    const spec = this.deps.registry.get(request.toolName);
    if (!spec) {
      return { kind: 'result', result: this.errorResult(request, makeError('TOOL_NOT_ALLOWED')) };
    }
    const caps = this.getCapabilities();
    if (!this.deps.registry.capabilitiesSatisfied(spec, caps)) {
      return { kind: 'result', result: this.errorResult(request, makeError('OCTOP_DEGRADED')) };
    }

    // P2-10：执行前用 inputSchema 校验载荷，避免无效请求进幂等/执行
    const inOk = this.deps.validator.validateInput(request.payload, spec.inputSchema);
    if (!inOk.ok) {
      return { kind: 'result', result: this.errorResult(request, makeError('INVALID_PLAN', { details: { toolName: spec.name, reason: inOk.errors } })) };
    }

    let claim: ReturnType<IdempotencyStore['claim']>;
    try {
      claim = await this.deps.idempotency.claim(ctx.tenantId, request.idempotencyKey, task.id, {
        userId: request.userId,
        toolName: spec.name,
        risk: spec.risk,
        inputHash: hashJson(request.payload),
        requestJson: JSON.stringify(request),
      });
    } catch (e) {
      // claim 对 in_progress 抛 IDEMPOTENCY_CONFLICT，转为统一错误结果
      if (this.isAppErrorWithCode(e, 'IDEMPOTENCY_CONFLICT')) {
        return { kind: 'result', result: this.errorResult(request, e as AppError) };
      }
      throw e;
    }
    if (claim.status === 'done') {
      return { kind: 'result', result: this.errorResult(request, makeError('DUPLICATE_REQUEST')) };
    }

    // 所有执行路径统一登记 ToolCall + pending（确认与非确认都要，供审批绑定/失败恢复用）
    const toolCallId = this.createToolCall(task, spec, request);

    if (spec.requiresConfirmation) {
      const preview = { toolName: request.toolName, payload: request.payload };
      const approval = await this.deps.approvals.create(task.id, toolCallId, preview, this.deps.approvalTtlMs ?? 300_000);
      this.pendingRequests.set(task.id, { request, toolCallId, approvalId: approval.id });
      this.mutateTask(task, 'request_confirmation');
      this.deps.bus.publish(request.sessionId, 'approval_required', task.id, {
        approvalId: approval.id,
        risk: spec.risk,
        preview,
        expiresAt: approval.expiresAt,
      });
      return { kind: 'awaiting_approval', approvalId: approval.id, taskId: task.id };
    }

    this.pendingRequests.set(task.id, { request, toolCallId });
    return { kind: 'result', result: await this.runTool(ctx, request, task, spec, undefined, toolCallId) };
  }

  async approveTask(
    ctx: TenantContext,
    taskId: string,
    approvalId: string,
    currentPreview: unknown,
  ): Promise<ToolResult> {
    const task = this.requireTask(taskId);
    this.assertOwnership(task, ctx);
    this.assertTaskSessionAlive(task); // P1-1：过期会话不可审批/控制任务
    const pending = this.pendingRequests.get(taskId);

    // P0-4：先做绑定校验（taskId/toolCallId/预览），跨任务复用直接 APPROVAL_MISMATCH
    await this.deps.approvals.validate(approvalId, currentPreview, taskId, pending?.toolCallId ?? '');
    if (!pending) throw makeError('CHECKPOINT_MISSING', { details: { taskId } });

    // P1-4：先状态迁移（可能因并发取消失败）→ 成功后一次性消费审批，避免审批丢失
    this.mutateTask(task, 'approve');
    await this.deps.approvals.consume(approvalId);

    const spec = this.deps.registry.require(pending.request.toolName);
    return this.runTool(ctx, pending.request, task, spec, undefined, pending.toolCallId);
  }

  // ---------------------------------------------------------------- 控制面
  pauseTask(ctx: TenantContext, taskId: string): AgentTask {
    const task = this.requireTask(taskId);
    this.assertOwnership(task, ctx);
    this.assertTaskSessionAlive(task); // P1-1
    this.abortTask(taskId); // 真正中止该任务的在途执行（不影响同会话其他任务）
    void this.deps.octop.cancelRun(task.sessionId, 'user_pause').catch(() => undefined);
    this.mutateTask(task, 'pause');
    this.deps.bus.publish(task.sessionId, 'task_paused', task.id, {
      reason: 'user_pause',
      resumable: true,
      evidence: [],
    });
    return task;
  }

  async resumeTask(ctx: TenantContext, taskId: string): Promise<ToolResult> {
    const task = this.requireTask(taskId);
    this.assertOwnership(task, ctx);
    this.assertTaskSessionAlive(task); // P1-1
    this.mutateTask(task, 'resume');
    const pending = this.pendingRequests.get(taskId);
    if (!pending) throw makeError('CHECKPOINT_MISSING', { details: { taskId } });
    const spec = this.deps.registry.require(pending.request.toolName);
    return this.runTool(ctx, pending.request, task, spec, task.checkpointJson, pending.toolCallId);
  }

  cancelTask(ctx: TenantContext, taskId: string): AgentTask {
    const task = this.requireTask(taskId);
    this.assertOwnership(task, ctx);
    this.assertTaskSessionAlive(task); // P1-1
    this.abortTask(taskId); // 真正中止该任务的在途执行（不影响同会话其他任务）
    void this.deps.octop.cancelRun(task.sessionId, 'user_cancel').catch(() => undefined);
    this.mutateTask(task, 'cancel');
    this.deps.bus.publish(task.sessionId, 'task_done', task.id, {
      reason: 'cancelled',
      resumable: false,
      evidence: [],
    });
    return task;
  }

  // ---------------------------------------------------------------- 重启恢复（持久化模式）
  /** 从 DB 反灌内存（写路径镜像的读侧；只恢复仍活跃的会话及其资源） */
  hydrate(data: {
    sessions?: AgentSession[];
    tasks?: AgentTask[];
    artifacts?: Artifact[];
    events?: AgentEvent[];
    pending?: Array<{ taskId: string; request: ToolRequest; toolCallId: string; approvalId?: string }>;
  }): void {
    for (const s of data.sessions ?? []) this.sessions.set(s.id, s);
    for (const t of data.tasks ?? []) this.tasks.set(t.id, t);
    for (const a of data.artifacts ?? []) this.artifacts.set(a.id, a);
    if (data.events?.length) this.deps.bus.hydrateEvents(data.events);
    // P1-6：重建 awaiting_confirmation 的 pending（审批/恢复不再 CHECKPOINT_MISSING）
    for (const p of data.pending ?? []) {
      this.pendingRequests.set(p.taskId, { request: p.request, toolCallId: p.toolCallId, approvalId: p.approvalId });
    }
  }

  // ---------------------------------------------------------------- 能力 / 记忆
  getCapabilities(): Capabilities {
    const caps = this.deps.octop.getCapabilities();
    caps.businessTools = this.deps.registry.list().map((s) => s.name);
    return caps;
  }

  async memorySearch(ctx: TenantContext, scope: string, query: string) {
    return this.deps.memory.recall(ctx, scope, query);
  }

  async memoryAdd(ctx: TenantContext, scope: string, content: string, source = 'confirmed_user_statement') {
    return this.deps.memory.capture(ctx, scope, content, source);
  }

  async memoryDelete(ctx: TenantContext, id: string, scope?: string): Promise<{ deleted: boolean }> {
    return this.deps.memory.delete(ctx, id, scope);
  }

  /** Octop 高级模式：创建原生 octop 会话 */
  async createOctopSession(ctx: TenantContext): Promise<{ octopSessionId: string }> {
    return this.deps.octop.createSession(ctx);
  }

  /** Octop 高级模式：token 交换 */
  async tokenExchange(ctx: TenantContext, sessionId: string): Promise<{ token: string; expiresAt: string }> {
    const session = this.requireSession(sessionId);
    this.assertOwnership(session, ctx);
    if (!session.octopSessionId) throw makeError('SESSION_EXPIRED', { details: { sessionId } });
    return this.deps.octop.tokenExchange(session.octopSessionId);
  }

  // ---------------------------------------------------------------- 内部执行
  private async runTool(
    ctx: TenantContext,
    request: ToolRequest,
    task: AgentTask,
    spec: ToolSpec,
    checkpoint?: Record<string, unknown>,
    toolCallId?: string,
  ): Promise<ToolResult> {
    // 每个任务独立 AbortController，传入执行器以支持真实中止（P1-3：不跨任务互斥）
    const controller = new AbortController();
    this.controllers.set(task.id, controller);
    const signal = controller.signal;

    const callId = toolCallId ?? this.createToolCall(task, spec, request);
    // 无确认工具从 planned 进入 running；审批/恢复后已是 running，跳过
    if (task.status === 'planned') this.mutateTask(task, 'run');
    this.deps.bus.publish(request.sessionId, 'tool_started', task.id, { toolCallId: callId, toolName: spec.name });
    if (checkpoint) task.checkpointJson = checkpoint;

    let exec: ToolExecution;
    try {
      const executor = this.deps.business.get(spec.name);
      if (!executor) throw makeError('TOOL_EXECUTION_FAILED', { details: { reason: `未实现业务工具: ${spec.name}` } });
      exec = await executor(ctx, request, checkpoint, signal);
      // P2-10：执行后用 outputSchema 校验结果，不合规视为执行失败
      const outOk = this.deps.validator.validateOutput(exec.data ?? {}, spec.outputSchema);
      if (!outOk.ok) {
        throw makeError('TOOL_EXECUTION_FAILED', { details: { reason: 'outputSchema 校验失败', errors: outOk.errors } });
      }
    } catch (e) {
      return this.handleExecutionError(task, callId, request, spec, signal, e);
    }

    // 执行成功：补全状态
    this.setToolCallStatus(callId, 'done', exec.usage.usageId);
    this.deps.bus.publish(request.sessionId, 'tool_progress', task.id, {
      toolCallId: callId,
      toolName: spec.name,
      progress: 100,
      message: '已完成',
    });

    for (const a of exec.artifacts ?? []) {
      const artifact = this.storeArtifact(task, a);
      this.deps.bus.publish(request.sessionId, 'artifact_created', task.id, {
        artifactId: artifact.id,
        type: artifact.type,
        uri: artifact.uri,
        checksum: artifact.checksum,
      });
    }

    this.recordUsage(request, exec, callId);
    this.deps.idempotency.markDone(ctx.tenantId, request.idempotencyKey, exec.usage.usageId);

    const action: Parameters<typeof transition>[1] =
      exec.status === 'succeeded'
        ? 'succeed'
        : exec.status === 'partially_succeeded'
          ? 'partial_success'
          : exec.status === 'failed_retryable'
            ? 'fail_retryable'
            : 'fail_terminal';
    // P1-9：执行成功后若并发取消已先置终态，迁移会抛——外部已成功，接口不得报错，
    // 事件照发（任务状态以状态机为准，结果以本次执行为准）
    try {
      this.mutateTask(task, action);
    } catch {
      /* 并发控制面已置终态，忽略（外部动作已成功） */
    }

    this.deps.bus.publish(request.sessionId, exec.status === 'succeeded' ? 'task_done' : 'task_failed', task.id, {
      reason: exec.status,
      resumable: exec.status !== 'failed_terminal',
      evidence: exec.evidence.map((e) => ({ type: e.type, uri: e.uri })),
    });

    return {
      requestId: request.requestId,
      status: exec.status,
      data: exec.data,
      evidence: exec.evidence,
      usage: exec.usage,
      error: null,
    };
  }

  private handleExecutionError(
    task: AgentTask,
    toolCallId: string,
    request: ToolRequest,
    spec: ToolSpec,
    signal: AbortSignal,
    e: unknown,
  ): ToolResult {
    this.setToolCallStatus(toolCallId, 'failed');

    // 已被取消/暂停中止：控制面已改变任务状态，不重复迁移；但必须释放幂等锁以便后续重试
    if (signal.aborted) {
      this.deps.idempotency.release(request.tenantId, request.idempotencyKey);
      if (task.status === 'running') this.safeMutate(task, 'fail_retryable');
      return this.errorResult(request, makeError('CANCEL_TIMEOUT', { details: { reason: '执行已被用户中止' } }));
    }

    // 真实异常：释放幂等锁以便重试，任务落失败态，记录失败 usage
    this.deps.idempotency.release(request.tenantId, request.idempotencyKey);
    const appErr = this.toAppError(e);
    const next: Parameters<typeof transition>[1] = appErr.retryable ? 'fail_retryable' : 'fail_terminal';
    this.safeMutate(task, next);
    this.deps.bus.publish(request.sessionId ?? task.sessionId, 'task_failed', task.id, {
      reason: appErr.code,
      resumable: appErr.retryable,
      evidence: [],
    });
    this.recordFailureUsage(request, appErr);
    return this.errorResult(request, appErr);
  }

  private createToolCall(task: AgentTask, spec: ToolSpec, request: ToolRequest): string {
    const id = genId('call');
    const tc: ToolCall = {
      id,
      taskId: task.id,
      tenantId: task.tenantId,
      toolName: spec.name,
      risk: spec.risk,
      inputHash: hashJson(request.payload),
      status: 'running',
      idempotencyKey: request.idempotencyKey,
      createdAt: nowIso(),
    };
    this.toolCalls.set(id, tc);
    return id;
  }

  private setToolCallStatus(id: string, status: ToolCall['status'], usageId?: string): void {
    const tc = this.toolCalls.get(id);
    if (tc) {
      tc.status = status;
      if (usageId) tc.usageId = usageId;
    }
  }

  private storeArtifact(task: AgentTask, a: ToolArtifact): Artifact {
    const id = genId('art');
    const artifact: Artifact = {
      id,
      taskId: task.id,
      tenantId: task.tenantId,
      type: a.type,
      uri: a.uri,
      checksum: a.checksum,
      version: a.version,
      metadataJson: a.metadata ?? {},
      createdAt: nowIso(),
    };
    this.artifacts.set(id, artifact);
    this.fireMirror((m) => m.artifactStored?.(artifact));
    return artifact;
  }

  private recordUsage(request: ToolRequest, exec: ToolExecution, toolCallId?: string): void {
    const u = exec.usage;
    const ev: UsageEvent = {
      id: genId('ue'),
      requestId: request.requestId,
      tenantId: request.tenantId,
      taskId: request.taskId,
      toolCallId: toolCallId ?? null,
      usageId: u.usageId,
      model: u.model,
      inputTokens: u.inputTokens,
      outputTokens: u.modelTokens,
      computeUnits: u.computeUnits,
      cost: u.cost ?? 0,
      status: 'ok',
      createdAt: nowIso(),
    };
    this.usageEvents.set(ev.id, ev);
    this.fireUsageSink(ev);
  }

  private recordFailureUsage(request: ToolRequest, err: AppError): void {
    const ev: UsageEvent = {
      id: genId('ue'),
      requestId: request.requestId,
      tenantId: request.tenantId,
      usageId: `fail_${genId('u')}`,
      model: undefined,
      inputTokens: Math.ceil(JSON.stringify(request.payload).length / 4),
      outputTokens: 0,
      computeUnits: 0,
      cost: 0,
      status: 'failed',
      createdAt: nowIso(),
    };
    this.usageEvents.set(ev.id, ev);
    this.fireUsageSink(ev);
    void err;
  }

  /** 可选持久化 sink（fire-and-forget，失败静默——内存态仍是权威，DB 为对账副本） */
  private fireUsageSink(ev: UsageEvent): void {
    if (!this.deps.usageSink) return;
    try {
      void Promise.resolve(this.deps.usageSink(ev)).catch(() => undefined);
    } catch {
      /* 忽略 */
    }
  }

  /** 写路径镜像（fire-and-forget，失败静默——内存态仍是权威，DB 为持久化副本） */
  private fireMirror(fn: (m: AgentGatewayMirror) => void | Promise<void>): void {
    if (!this.deps.mirror) return;
    try {
      const r = fn(this.deps.mirror);
      if (r && typeof (r as Promise<void>).then === 'function') {
        void (r as Promise<void>).catch(() => undefined);
      }
    } catch {
      /* 镜像失败不阻断主链路 */
    }
  }

  private mutateTask(task: AgentTask, action: Parameters<typeof transition>[1]): void {
    const next = transition(task.status, action);
    task.status = next;
    if (next === 'running') task.startedAt = nowIso();
    if (['succeeded', 'failed_terminal', 'cancelled'].includes(next)) task.finishedAt = nowIso();
    this.deps.bus.publish(task.sessionId, 'thinking', task.id, { step: next, summary: `任务状态 → ${next}` });
    this.fireMirror((m) => m.taskUpdated?.(task));
  }

  /** 安全迁移：并发控制面已改状态时，忽略非法迁移异常，绝不静默吞掉原始错误 */
  private safeMutate(task: AgentTask, action: Parameters<typeof transition>[1]): void {
    try {
      this.mutateTask(task, action);
    } catch {
      /* 状态已由控制面改变，忽略 */
    }
  }

  private errorResult(request: ToolRequest, err: AppError): ToolResult {
    return {
      requestId: request.requestId,
      status: err.retryable ? 'failed_retryable' : 'failed_terminal',
      error: err,
    };
  }

  private toAppError(e: unknown): AppError {
    if (e instanceof AppErrorError) return e;
    if (e && typeof e === 'object' && 'code' in e) return e as AppError;
    if (e instanceof Error) return makeError('TOOL_EXECUTION_FAILED', { details: { reason: e.message } });
    return makeError('TOOL_EXECUTION_FAILED', { details: { reason: String(e) } });
  }

  private isAppErrorWithCode(e: unknown, code: string): boolean {
    return !!e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === code;
  }

  private requireSession(id: string): AgentSession {
    const s = this.sessions.get(id);
    if (!s) throw makeError('SESSION_EXPIRED', { details: { sessionId: id } });
    // P1-2：统一过期校验（createTask/executeTool/approveTask/tokenExchange 等全部经此）
    if (s.status === 'expired' || Date.parse(s.expiresAt) <= Date.now()) {
      throw makeError('SESSION_EXPIRED', { details: { sessionId: id, reason: '会话已过期' } });
    }
    return s;
  }

  private requireTask(id: string): AgentTask {
    const t = this.tasks.get(id);
    if (!t) throw makeError('CHECKPOINT_MISSING', { details: { taskId: id } });
    return t;
  }

  /** P1-1：任务所属会话必须存在且未过期（审批/暂停/恢复/取消统一走此） */
  private assertTaskSessionAlive(task: AgentTask): void {
    this.requireSession(task.sessionId);
  }

  private isTerminal(status: string): boolean {
    return status === 'succeeded' || status === 'failed_terminal' || status === 'cancelled';
  }

  /** 所有权校验：tenant + user + agent 三项必须一致，杜绝同租户跨用户越权 */
  private assertOwnership(entity: { tenantId: string; userId: string; agentId: string }, ctx: TenantContext): void {
    if (
      entity.tenantId !== ctx.tenantId ||
      entity.userId !== ctx.userId ||
      entity.agentId !== ctx.agentId
    ) {
      throw makeError('FORBIDDEN', {
        details: { expected: { tenantId: entity.tenantId, userId: entity.userId, agentId: entity.agentId }, got: { tenantId: ctx.tenantId, userId: ctx.userId, agentId: ctx.agentId } },
      });
    }
  }

  private abortTask(taskId: string): void {
    const c = this.controllers.get(taskId);
    if (c && !c.signal.aborted) c.abort();
  }

  // 暴露给测试/演示的只读访问
  getTask(id: string): AgentTask | undefined {
    return this.tasks.get(id);
  }
  getSession(id: string): AgentSession | undefined {
    return this.sessions.get(id);
  }
  getToolCall(id: string): ToolCall | undefined {
    return this.toolCalls.get(id);
  }
  getUsageEvents(): UsageEvent[] {
    return [...this.usageEvents.values()];
  }
  getControllers(): Map<string, AbortController> {
    return this.controllers;
  }
  snapshotEvents(sessionId: string) {
    return this.deps.bus.snapshot(sessionId);
  }
  /** lastEventId 之后的事件；lastEventId 超窗抛 RESUME_WINDOW_EXPIRED（供 WS 重放） */
  getEventsSince(sessionId: string, lastEventId?: string) {
    return this.deps.bus.getEventsSince(sessionId, lastEventId);
  }
  subscribeEvents(sessionId: string, fn: (e: AgentEvent) => void): () => void {
    return this.deps.bus.subscribe(sessionId, fn);
  }
}
