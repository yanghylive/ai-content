import { api } from "@/lib/api/client";
import type { MaiUiAction } from "@/lib/mobile-bridge";

/** ExecutorTask 视图（mobile-executor 任务） */
export interface ExecutorTaskView {
  id: string;
  type: string;
  payload: unknown;
  status: "queued" | "claimed" | "running" | "done" | "failed" | "cancelled" | "unknown";
  result?: unknown;
  createdAt: string;
}

/** 创建 MAI-UI 执行任务（type=custom，payload 携带动作序列，留痕+防 agent 误领） */
export async function createMaiUiTask(input: {
  instruction: string;
  actions: MaiUiAction[];
}): Promise<ExecutorTaskView> {
  const data = await api.post<ExecutorTaskView>("/mobile-executor/tasks", {
    type: "custom",
    payload: {
      mode: "mai-ui",
      instruction: input.instruction,
      actionCount: input.actions.length,
      actions: input.actions,
    },
  });
  return data;
}

/** 回传任务状态（running 占位 / done / failed） */
export async function reportTaskStatus(
  taskId: string,
  input: {
    status: "running" | "done" | "failed";
    result?: Record<string, unknown>;
    error?: string;
  },
): Promise<{ id: string; status: string }> {
  return api.post<{ id: string; status: string }>(
    `/mobile-executor/tasks/${taskId}/status`,
    input,
  );
}

/** 我的任务列表 */
export async function listExecutorTasks(limit = 10): Promise<ExecutorTaskView[]> {
  const data = await api.get<ExecutorTaskView[]>(
    `/mobile-executor/tasks?limit=${limit}`,
  );
  return data;
}

/** 设备信息（mobile-executor DeviceInfo） */
export interface MobileDeviceInfo {
  id: string;
  deviceName: string;
  platform: string;
  status: "online" | "offline";
  lastHeartbeatAt: string | null;
}

/** 活跃租约 */
export interface ExecutorLeaseView {
  id: string;
  accountId: string;
  deviceId: string;
  taskId: string;
  expiresAt: string;
  createdAt: string;
}

/** 我的设备列表 */
export async function listDevices(): Promise<MobileDeviceInfo[]> {
  return api.get<MobileDeviceInfo[]>("/mobile-executor/devices");
}

/** 任务证据 */
export interface ExecutorEvidence {
  id: string;
  stepIndex: number;
  type: string;
  content: Record<string, unknown>;
  createdAt: string;
}

/** 上传任务执行证据（截图 dataURL / 结构化内容） */
export async function addTaskEvidence(
  taskId: string,
  input: { type: string; stepIndex?: number; content: Record<string, unknown> },
): Promise<{ id: string; taskId: string; type: string }> {
  return api.post<{ id: string; taskId: string; type: string }>(
    `/mobile-executor/tasks/${taskId}/evidence`,
    input,
  );
}

/** 查询任务证据 */
export async function listTaskEvidence(taskId: string): Promise<ExecutorEvidence[]> {
  return api.get<ExecutorEvidence[]>(`/mobile-executor/tasks/${taskId}/evidence`);
}

/** 活跃租约列表 */
export async function listActiveLeases(): Promise<ExecutorLeaseView[]> {
  return api.get<ExecutorLeaseView[]>("/mobile-executor/leases");
}

/** 执行会话（Run）+ 步骤（P1-12 断点） */
export interface ExecutorRunView {
  id: string;
  taskId: string;
  deviceId: string;
  status: string;
  checkpoint: string | null;
  steps: Array<{ stepIndex: number; type: string; status: string; createdAt: string }>;
}

/** 查询任务执行会话断点（P2-26 检查点 UI） */
export async function getTaskRun(taskId: string): Promise<ExecutorRunView | null> {
  return api.get<ExecutorRunView | null>(`/mobile-executor/tasks/${taskId}/run`);
}

/** 创建一次性审批（MAI-UI 外发动作：短时 5min + inputHash 绑定） */
export async function createApproval(input: {
  actionType: string;
  riskLevel?: string;
  inputHash: string;
  actionId: string;
  reason?: string;
}): Promise<{ id: string; status: string; riskLevel: string; expiresAt: string }> {
  return api.post<{ id: string; status: string; riskLevel: string; expiresAt: string }>(
    "/approvals",
    input,
  );
}

/** 审批操作（approve/reject/...）；重复操作被拒绝（一次性） */
export async function actApproval(
  approvalId: string,
  action: "approve" | "reject" | "expire",
  reason?: string,
): Promise<{ status: string }> {
  return api.post<{ status: string }>(`/approvals/${approvalId}/act`, {
    action,
    reason,
  });
}

/** SHA-256 摘要（内容 hash，审批绑定防篡改）。P2-28：无 WebCrypto 时抛错，不静默降级 */
export async function sha256Hex(text: string): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("当前环境不支持 WebCrypto（SHA-256），无法进行安全的审批防篡改");
  }
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
