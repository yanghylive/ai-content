import { api } from "./client";

/** 手机执行器设备（agent 注册的心跳设备） */
export interface MobileExecutorDevice {
  id: string;
  deviceName: string;
  platform: string;
  status: "online" | "offline";
  lastHeartbeatAt?: string | null;
}

/** 手机执行器任务 */
export interface MobileExecutorTask {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  status: "queued" | "claimed" | "running" | "done" | "failed" | "cancelled";
  createdAt: string;
}

export interface CreateDeviceTaskInput {
  platform: string;
  action: "dm-reply";
  content: string;
}

/**
 * 手机执行器 API（全自动 RPA）：
 * 设备列表 + 创建自动执行任务（设备 agent 领取后由无障碍驱动目标 App 执行）。
 */
export const mobileExecutorApi = {
  /** 我的设备列表（含在线状态） */
  devices(): Promise<MobileExecutorDevice[]> {
    return api.get<MobileExecutorDevice[]>("/mobile-executor/devices");
  },

  /** 我的任务列表 */
  tasks(limit = 10): Promise<MobileExecutorTask[]> {
    return api.get<MobileExecutorTask[]>(`/mobile-executor/tasks?limit=${limit}`);
  },

  /** 创建自动回复任务（type=custom，设备领取后 RPA 执行） */
  createDmReplyTask(input: CreateDeviceTaskInput): Promise<MobileExecutorTask> {
    return api.post<MobileExecutorTask>("/mobile-executor/tasks", {
      type: "custom",
      payload: {
        platform: input.platform,
        action: input.action,
        content: input.content,
      },
    });
  },
};
