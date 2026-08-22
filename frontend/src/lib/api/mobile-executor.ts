import { api } from "@/lib/api/client";
import type { MaiUiAction } from "@/lib/mobile-bridge";

/** ExecutorTask 视图（mobile-executor 任务） */
export interface ExecutorTaskView {
  id: string;
  type: string;
  payload: unknown;
  status: "queued" | "claimed" | "running" | "done" | "failed" | "cancelled";
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
