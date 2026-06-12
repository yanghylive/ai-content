/**
 * Node Agent Runtime contract.
 *
 * The one-click desktop package keeps the existing Agent-S API shape, but the
 * implementation behind it is the packaged Node/CDP/Playwright runtime.
 */

export const NODE_AGENT_RUNTIME_CONTRACT_VERSION = '2026-06-08.phase1';

export const NODE_AGENT_RUNTIME_ENDPOINTS = {
  status: '/agent-s/status',
  health: '/agent-s/health',
  createSession: '/agent-s/sessions',
  runTask: '/agent-s/sessions/:sessionId/run',
  events: '/agent-s/sessions/:sessionId/events',
  cancel: '/agent-s/sessions/:sessionId/cancel',
  approve: '/agent-s/sessions/:sessionId/approve',
  artifacts: '/agent-s/sessions/:sessionId/artifacts',
  artifact: '/agent-s/sessions/:sessionId/artifacts/:artifactId',
} as const;

export type NodeAgentRuntimeStatus =
  | 'idle'
  | 'running'
  | 'waiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type NodeAgentRuntimeArtifactKind =
  | 'screenshot'
  | 'json'
  | 'text'
  | 'summary'
  | 'log'
  | 'trace';

export interface NodeAgentRuntimeHealth {
  ok: boolean;
  status: 'ready' | 'degraded' | 'blocked' | 'stopped' | 'error';
  service: 'node-agent-runtime';
  version: string;
  pid?: number;
  runner_mode: 'node-playwright';
  engineUrl?: string;
  checkedAt?: string;
  capabilities: {
    browserControl: boolean;
    persistentProfiles: boolean;
    localQueue: boolean;
    evidenceStore: boolean;
    approvalGate: boolean;
  };
  reasons?: string[];
  blockers?: string[];
  warnings?: string[];
  nextAction?: string;
}

export interface NodeAgentRuntimeSession {
  session_id: string;
  session_name?: string | null;
  task_type: string;
  status: NodeAgentRuntimeStatus;
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

export interface NodeAgentRuntimeCreateSessionInput {
  session_name?: string | null;
  task_type?: string;
  metadata?: Record<string, unknown>;
  labels?: string[];
}

export interface NodeAgentRuntimeRunTaskInput {
  instruction: string;
  task_type?: string | null;
  metadata?: Record<string, unknown>;
  platform?: 'douyin' | 'wechat-channel' | 'kuaishou' | 'xiaohongshu' | 'mixed' | string;
  accountId?: string | number | null;
  taskType?: 'comment-reply' | 'direct-message-reply' | string | null;
  action?: 'read' | 'draft' | 'send' | 'preflight' | string | null;
  risk_level?: 'low' | 'medium' | 'high';
  requires_approval?: boolean;
  step_count?: number;
  mock_step_delay_ms?: number;
  simulate_failure_step?: number;
}

export interface NodeAgentRuntimeEvent {
  seq: number;
  session_id: string;
  run_id?: string | null;
  event_type:
    | 'session_created'
    | 'task_started'
    | 'tool_call_started'
    | 'tool_call_completed'
    | 'approval_required'
    | 'artifact_created'
    | 'task_completed'
    | 'task_failed'
    | 'task_cancelled';
  status: NodeAgentRuntimeStatus;
  created_at: string;
  message?: string | null;
  step_index?: number | null;
  artifact_id?: string | null;
  payload: Record<string, unknown>;
}

export interface NodeAgentRuntimeApprovalDecisionInput {
  decision: 'approved' | 'rejected';
  comment?: string;
}

export interface NodeAgentRuntimeArtifact {
  artifact_id: string;
  session_id: string;
  run_id?: string | null;
  kind: NodeAgentRuntimeArtifactKind;
  filename: string;
  path: string;
  created_at: string;
  size_bytes: number;
  metadata: Record<string, unknown>;
}

export interface NodeAgentRuntimeBrowserContext {
  platform?: 'douyin' | 'wechat-channel' | 'kuaishou' | 'xiaohongshu' | 'mixed';
  accountId?: string;
  profileDir?: string;
  cookiesFile?: string;
  storageStateFile?: string;
  cdpPort?: number;
  pageUrl?: string;
}

export interface NodeAgentRuntimeTaskEvidence {
  type: 'screenshot' | 'page-url' | 'network' | 'readback' | 'text' | 'trace';
  label: string;
  value?: string;
  path?: string;
  createdAt: string;
  raw?: Record<string, unknown>;
}

export interface NodeAgentRuntimeTaskResult {
  ok: boolean;
  status: 'success' | 'failed' | 'blocked' | 'skipped';
  reasonCode:
    | 'success'
    | 'runtime_unavailable'
    | 'account_not_logged_in'
    | 'captcha_required'
    | 'permission_missing'
    | 'target_not_found'
    | 'send_failed'
    | 'readback_failed'
    | 'platform_changed'
    | 'approval_required';
  userMessage: string;
  technicalMessage?: string;
  browser?: NodeAgentRuntimeBrowserContext;
  evidence: NodeAgentRuntimeTaskEvidence[];
}
