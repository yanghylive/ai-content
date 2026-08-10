"use client";

import { api } from "./client";

/** /api/video-generation Wan2.1 图生视频任务 */
export interface VideoGenTask {
  id: string;
  status: "pending" | "running" | "ready" | "failed";
  progress?: number;
  error?: string | null;
  videoUrl?: string | null;
}

export interface VideoGenCreateResult {
  success: boolean;
  taskId?: string;
  task?: { id: string; status: string };
}

export const videoGenApi = {
  create(input: { imageData: string; prompt: string; duration?: number; aspect?: string }) {
    return api.post<VideoGenCreateResult>("/video-generation/tasks", input);
  },
  task(id: string) {
    return api.get<VideoGenTask>(`/video-generation/tasks/${encodeURIComponent(id)}`);
  },
};
