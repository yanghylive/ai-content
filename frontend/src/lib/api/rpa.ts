import { api } from "./client";

/**
 * 统一 RPA 执行记录（对齐后端 rpa_executions 表 + RpaExecutionStore 输出）
 */
export interface RpaExecutionRecord {
  id: string;
  tenantId: string | null;
  userId: string;
  platform: string;
  sessionId: string | null;
  accountId: string | null;
  mode: string;
  steps: Array<{
    stepName: string;
    status: "running" | "success" | "failed";
    reasonCode?: string;
    message?: string;
    evidenceUrl?: string;
    pageFingerprint?: string;
    sequenceNo?: number;
    attempt?: number;
    resultHash?: string;
    occurredAt: string;
  }>;
  resumeStep: string | null;
  reasonCode: string | null;
  nextAction: string | null;
  pageFingerprint: string | null;
  evidence: unknown[];
  status:
    | "running"
    | "paused"
    | "needs-human"
    | "success"
    | "partial"
    | "failed"
    | "skipped"
    | "cancelled"
    | "reconcile_required";
  driverVersion: string | null;
  runId: string | null;
  userMessage: string;
  technicalMessage: string | null;
  startedAt: string;
  endedAt: string | null;
}

export interface RpaCapabilityRow {
  platform: string;
  displayName: string;
  runtimeReady: boolean;
  actions: Array<{
    action: string;
    supported: boolean;
    unavailableReason?: string;
    unavailableReasonCode?: string;
  }>;
  driverVersion: string;
  /** P1-1：账号级预检（platform+accountId 探测时返回） */
  accountProbe?: RpaAccountProbe;
}

/** 账号级 preflight（登录态/验证码/风控/busy/cooldown，替代"仅会话就绪"） */
export interface RpaAccountProbe {
  accountId: string;
  browserReady: boolean;
  loggedIn: boolean;
  pageInteractive: boolean;
  captchaRequired: boolean;
  riskControl: boolean;
  /** P1-5 复核：账号级活动执行中（running/paused/needs-human 有并发锁） */
  busy?: boolean;
  /** P1-5 复核：配额/风控冷却中 */
  cooldown?: boolean;
  checkedAt: string;
  reasonCode: string | null;
}

export interface RpaCreateExecutionInput {
  platform: string;
  accountId: string;
  mode?: string;
  driverVersion?: string;
  runId?: string;
}

/** 六平台 RPA 能力总览 */
export async function fetchRpaCapabilities(
  platform?: string,
  accountId?: string,
): Promise<RpaCapabilityRow[]> {
  const query =
    platform && accountId
      ? `?platform=${encodeURIComponent(platform)}&accountId=${encodeURIComponent(accountId)}`
      : "";
  return api.get<RpaCapabilityRow[]>(`/rpa/capabilities${query}`);
}

/** RPA 执行记录列表（步骤/断点/证据/失败原因） */
export async function fetchRpaExecutions(
  limit = 50,
): Promise<RpaExecutionRecord[]> {
  return api.get<RpaExecutionRecord[]>(`/rpa/executions?limit=${limit}`);
}

/** 执行记录详情（逐步状态机） */
export async function fetchRpaExecution(
  id: string,
): Promise<RpaExecutionRecord> {
  return api.get<RpaExecutionRecord>(`/rpa/executions/${id}`);
}

/** 创建执行任务（后端会尝试真实 openSession） */
export async function createRpaExecution(
  input: RpaCreateExecutionInput,
): Promise<RpaExecutionRecord> {
  return api.post<RpaExecutionRecord>("/rpa/executions", input);
}

/** 追加一个执行步骤 */
export async function appendRpaStep(
  id: string,
  input: {
    stepName: string;
    status?: "running" | "success" | "failed";
    reasonCode?: string;
    message?: string;
    evidenceUrl?: string;
    pageFingerprint?: string;
  },
): Promise<RpaExecutionRecord> {
  return api.post<RpaExecutionRecord>(`/rpa/executions/${id}/steps`, input);
}

/** 暂停（记录断点） */
export async function pauseRpaExecution(
  id: string,
  resumeStep?: string,
): Promise<RpaExecutionRecord> {
  return api.post<RpaExecutionRecord>(`/rpa/executions/${id}/pause`, {
    resumeStep,
  });
}

/** 恢复（从断点续跑） */
export async function resumeRpaExecution(
  id: string,
): Promise<RpaExecutionRecord> {
  return api.post<RpaExecutionRecord>(`/rpa/executions/${id}/resume`, {});
}

/** 取消 */
export async function cancelRpaExecution(
  id: string,
): Promise<RpaExecutionRecord> {
  return api.post<RpaExecutionRecord>(`/rpa/executions/${id}/cancel`, {});
}

/** 人工接管（标记 needs-human，停止自动执行） */
export async function manualTakeoverRpaExecution(
  id: string,
  nextAction?: string,
): Promise<RpaExecutionRecord> {
  return api.post<RpaExecutionRecord>(`/rpa/executions/${id}/manual-takeover`, {
    nextAction,
  });
}

/** 完成回读（写终态） */
export async function finalizeRpaExecution(
  id: string,
  input: {
    status?: "success" | "failed" | "partial";
    reasonCode?: string;
    nextAction?: string;
    evidence?: unknown[];
  },
): Promise<RpaExecutionRecord> {
  return api.post<RpaExecutionRecord>(`/rpa/executions/${id}/finalize`, input);
}

/** 平台显示名 */
export const RPA_PLATFORM_LABELS: Record<string, string> = {
  douyin: "抖音",
  kuaishou: "快手",
  xiaohongshu: "小红书",
  "wechat-channel": "视频号",
  wechat: "微信",
  wecom: "企业微信",
};

/** 执行状态显示标签（含颜色语义） */
export const RPA_STATUS_META: Record<
  RpaExecutionRecord["status"],
  { label: string; tone: "success" | "warning" | "danger" | "muted" }
> = {
  running: { label: "执行中", tone: "success" },
  paused: { label: "已暂停", tone: "warning" },
  "needs-human": { label: "待人工接管", tone: "danger" },
  success: { label: "成功", tone: "success" },
  partial: { label: "部分成功", tone: "warning" },
  failed: { label: "失败", tone: "danger" },
  skipped: { label: "已跳过", tone: "muted" },
  reconcile_required: { label: "需人工核对", tone: "danger" },
  cancelled: { label: "已取消", tone: "muted" },
};

/** 评论回复输入（人工确认式触达） */
export interface RpaReplyCommentInput {
  platform: string;
  accountId: string;
  contentUrl: string;
  keyword?: string;
  targetText: string;
  replyText: string;
  /** dryRun=true 预览不发送；false 真实发送（需人工确认） */
  dryRun?: boolean;
}

export interface RpaReplyCommentResult {
  platform: string;
  dryRun: boolean;
  /** P0-4 复核：以审计终态为准——无回读证据降级 reconcile_required 时 sent=false */
  sent: boolean;
  message: string;
  /** P0-4 复核：最终审计状态（success/partial/reconcile_required...），UI 据此展示「已发送/待核对」 */
  status?: RpaExecutionRecord["status"];
  /** P0-4 复核：本次回复的 RPA 执行记录 id（审计追踪） */
  rpaRecordId?: string;
}

/** 回复指定评论（dry-run 预览 / 确认发送） */
export async function replyToComment(
  input: RpaReplyCommentInput,
): Promise<RpaReplyCommentResult> {
  return api.post<RpaReplyCommentResult>("/rpa/actions/reply-comment", input);
}
