// ============================================================================
// 3010 × Octop 整合核心引擎 —— 共享类型
// 严格对齐《开发前补充文档包》第三/四/五章与《整合 PRD》第八/十章。
// 身份(tenant/user/agent)永远由服务端派生，前端/模型传入值一律忽略。
// ============================================================================

/** 服务端派生的租户上下文（绝不可来自客户端） */
export interface TenantContext {
  tenantId: string;
  userId: string;
  agentId: string;
}

// ---------------------------------------------------------------------------
// 任务状态机
// ---------------------------------------------------------------------------
export type TaskStatus =
  | 'draft'
  | 'planned'
  | 'awaiting_confirmation'
  | 'running'
  | 'partially_succeeded'
  | 'succeeded'
  | 'paused'
  | 'failed_retryable'
  | 'failed_terminal'
  | 'cancelled';

/** 终态：不可再执行写工具，恢复只能从 checkpoint 继续 */
export const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  'succeeded',
  'failed_terminal',
  'cancelled',
]);

// ---------------------------------------------------------------------------
// 工具注册表 (ToolSpec) —— 对齐补充包 5.1
// ---------------------------------------------------------------------------
export type ToolRisk = 'low' | 'medium' | 'high';

export type ToolDomain =
  | 'content'
  | 'publish'
  | 'interaction'
  | 'lead'
  | 'crm'
  | 'review';

export interface ToolSpec {
  name: string;
  version: string;
  domain: ToolDomain;
  readOnly: boolean;
  risk: ToolRisk;
  requiresConfirmation: boolean;
  supportsPause: boolean;
  supportsResume: boolean;
  /** 如 ["rpa.browser"] */
  requiredCapabilities: string[];
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  /** 幂等作用域字段，如 "tenant+content+platform+schedule" */
  idempotencyScope: string;
  evidenceTypes: string[];
  compensation: string;
}

// ---------------------------------------------------------------------------
// 统一事件协议 —— 对齐补充包 3.3
// 顶层为传输字段；PRD 的逐事件必填字段放入 payload。
// ---------------------------------------------------------------------------
export type AgentEventType =
  | 'message'
  | 'thinking'
  | 'tool_started'
  | 'tool_progress'
  | 'approval_required'
  | 'artifact_created'
  | 'task_paused'
  | 'task_failed'
  | 'task_done';

export interface AgentEvent {
  eventId: string;
  sequence: number;
  type: AgentEventType;
  taskId: string;
  sessionId: string;
  occurredAt: string; // ISO-8601
  payload: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 工具结果 / 证据 / 用量
// ---------------------------------------------------------------------------
export interface EvidenceRef {
  type: string; // screenshot | platform_url | text | video
  uri: string;
  checksum?: string;
}

export interface UsageInfo {
  model?: string;
  /** 真实输入 token 估算，接入 Kaypal 计费前必须可核对 */
  inputTokens: number;
  modelTokens: number;
  computeUnits: number;
  cost?: number;
  /** 与 Kaypal 回执可对账；一次模型调用唯一一个 usageId */
  usageId: string;
}

export type ToolResultStatus =
  | 'succeeded'
  | 'partially_succeeded'
  | 'failed_retryable'
  | 'failed_terminal';

export interface ToolResult {
  requestId: string;
  status: ToolResultStatus;
  data?: Record<string, unknown>;
  evidence?: EvidenceRef[];
  usage?: UsageInfo;
  error: AppError | null;
}

// ---------------------------------------------------------------------------
// 错误协议 —— 对齐补充包 3.4
// ---------------------------------------------------------------------------
export type ErrorCode =
  | 'INVALID_PLAN'
  | 'DUPLICATE_REQUEST'
  | 'APPROVAL_EXPIRED'
  | 'PREVIEW_CHANGED'
  | 'NOT_PAUSABLE'
  | 'TASK_TERMINAL'
  | 'CHECKPOINT_MISSING'
  | 'DEVICE_OFFLINE'
  | 'CANCEL_TIMEOUT'
  | 'TOOL_NOT_ALLOWED'
  | 'TOOL_EXECUTION_FAILED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'MEMORY_TIMEOUT'
  | 'NAMESPACE_INVALID'
  | 'MEMORY_REJECTED'
  | 'DUPLICATE_EVENT'
  | 'OCTOP_DEGRADED'
  | 'OCTOP_UNAVAILABLE'
  | 'RESUME_WINDOW_EXPIRED'
  | 'SESSION_EXPIRED'
  | 'UNAUTHORIZED'
  | 'AUTH_INVALID'
  | 'FORBIDDEN'
  | 'APPROVAL_MISMATCH'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'RATE_LIMITED';

export interface AppError {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  requestId?: string;
  taskId?: string;
  details?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 能力探测 —— 对齐 PRD 6 / 补充包 8.1
// ---------------------------------------------------------------------------
export interface CapabilityStatus {
  available: boolean;
  degraded?: boolean;
  reason?: string;
}

export interface Capabilities {
  browser: CapabilityStatus;
  computer: CapabilityStatus;
  mobile: CapabilityStatus;
  file: CapabilityStatus;
  businessTools: string[];
}

// ---------------------------------------------------------------------------
// 引擎内部实体（镜像 PRD 4.1 / 补充包 4.1，运行时用内存存储）
// ---------------------------------------------------------------------------
export interface AgentSession {
  id: string;
  tenantId: string;
  userId: string;
  agentId: string;
  octopSessionId?: string;
  mode: 'business' | 'advanced';
  status: 'active' | 'expired';
  lastEventId: string;
  lastSequence: number;
  expiresAt: string;
  createdAt: string;
}

export interface AgentTask {
  id: string;
  sessionId: string;
  tenantId: string;
  userId: string;
  agentId: string;
  type: string;
  status: TaskStatus;
  planJson: Record<string, unknown>;
  checkpointJson: Record<string, unknown>;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
}

export interface ToolCall {
  id: string;
  taskId: string;
  tenantId: string;
  toolName: string;
  risk: ToolRisk;
  inputHash: string;
  status: 'scheduled' | 'running' | 'done' | 'failed';
  idempotencyKey: string;
  usageId?: string;
  createdAt: string;
}

export interface Approval {
  id: string;
  taskId: string;
  toolCallId: string;
  previewHash: string;
  approvedBy?: string;
  /** 一次性消费标记：审批通过后置 true，复用同一审批 ID 一律拒绝 */
  consumed: boolean;
  expiresAt: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  createdAt: string;
}

export interface Artifact {
  id: string;
  taskId: string;
  tenantId: string;
  type: string;
  uri: string;
  checksum: string;
  version: number;
  metadataJson: Record<string, unknown>;
  createdAt: string;
}

export interface Evidence {
  id: string;
  toolCallId: string;
  type: string;
  uri: string;
  capturedAt: string;
  redactionVersion: number;
}

export interface UsageEvent {
  id: string;
  requestId: string;
  tenantId: string;
  taskId?: string;
  toolCallId?: string | null;
  usageId: string;
  model?: string;
  inputTokens: number;
  outputTokens: number;
  computeUnits: number;
  cost: number;
  status: 'ok' | 'failed';
  createdAt: string;
}

export interface MemoryOutbox {
  id: string;
  memoryEventId: string;
  namespace: string;
  operation: 'add' | 'delete';
  payloadHash: string;
  attempts: number;
  nextRetryAt: string;
  status: 'pending' | 'dead' | 'done';
}

export interface DeviceLease {
  id: string;
  deviceId: string;
  taskId: string;
  owner: string;
  tenantId: string;
  status: 'active' | 'expired';
  heartbeatAt: string;
  expiresAt: string;
}

// ---------------------------------------------------------------------------
// 标准请求/响应（对齐 PRD 8.2）
// ---------------------------------------------------------------------------
export interface ToolRequest {
  requestId: string;
  tenantId: string;
  userId: string;
  agentId: string;
  sessionId: string;
  taskId: string;
  idempotencyKey: string;
  toolName: string;
  requiresConfirmation: boolean;
  payload: Record<string, unknown>;
}

export interface MemoryNamespace {
  tenantId: string;
  userId: string;
  agentId: string;
  scope: string;
  source: string;
  retention: 'session' | 'long_term';
}
