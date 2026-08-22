import { api } from "@/lib/api/client";
// 结构化动作类型以 mobile-bridge 为准（与壳执行器 schema 对齐）
import type { MaiUiAction } from "@/lib/mobile-bridge";
export type { MaiUiAction };

/** MAI-UI 规划入参（与后端 /api/mai-ui/actions 对齐） */
export interface MaiUiPlanRequest {
  imageBase64: string;
  instruction: string;
  width?: number;
  height?: number;
  context?: string;
}

export interface MaiUiPlanResult {
  ok: boolean;
  actions: MaiUiAction[];
  raw: string;
  model: string;
  parseError?: string;
}

/** 截图 + 指令 → 结构化候选动作（kaypal-vision / qwen-vl-max） */
export async function planMaiUiActions(
  input: MaiUiPlanRequest,
): Promise<MaiUiPlanResult> {
  const data = await api.post<{ ok: boolean; actions: MaiUiAction[]; raw: string; model: string; parseError?: string }>(
    "/mai-ui/actions",
    input,
  );
  return data;
}

/** 沉淀执行任务到 CRM（来源=MAI-UI 设备执行，关联 taskId） */
export async function sinkMaiUiTaskToCrm(input: {
  displayName: string;
  taskId: string;
  instruction: string;
  actionCount: number;
  resultMessage: string;
}): Promise<{ id: string; displayName: string }> {
  return api.post<{ id: string; displayName: string }>("/crm/customers", {
    displayName: input.displayName,
    sourcePlatform: "manual",
    notes: `[MAI-UI] 任务 ${input.taskId}
指令：${input.instruction}
动作数：${input.actionCount}
结果：${input.resultMessage}`,
  });
}
