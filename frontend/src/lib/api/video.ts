"use client";

import { api } from "./client";

/** 带货文案（确定性模板：标题/口播脚本/分镜段落） */
export interface ProductCopy {
  title: string;
  copy: string;
  usedAi: boolean;
  segments: Array<{ subtitle: string; visual: string; seconds: number }>;
}

export interface ProductCutResult {
  ok: boolean;
  videoUrl?: string;
  taskId?: string;
  status?: string;
  copy?: ProductCopy;
  message?: string;
}

/** 视频发布计划（定时发布的视频任务） */
export interface ReleasePlan {
  id: string;
  createdAt: string;
  status: string;
  scheduled: boolean;
  scheduleTime: string | null;
  platforms: string[];
  title: string | null;
}

/** 商品视频剪辑（炼刀 video_creation 对标，2026-08-10 前端接入） */
export const videoApi = {
  /** 带货文案生成（确定性模板，离线友好） */
  productCopy(input: {
    productName: string;
    sellingPoints?: string[];
    price?: number | string;
    audience?: string;
    durationSeconds?: number;
  }) {
    return api.post<ProductCopy>("/video/product-copy", input);
  },

  /** 商品 → 文案 → studio_core promo 管线成片（引擎离线降级返回文案） */
  productCut(input: {
    productName: string;
    sellingPoints?: string[];
    price?: number | string;
    audience?: string;
    durationSeconds?: number;
    imageUrl?: string;
  }) {
    return api.post<ProductCutResult>("/video/product-cut", input);
  },

  /** 视频发布计划（定时发布的视频任务列表） */
  listReleasePlans(limit?: number) {
    const query = limit ? `?limit=${Math.floor(limit)}` : "";
    return api.get<ReleasePlan[]>(`/video/release-plans${query}`);
  },
};
