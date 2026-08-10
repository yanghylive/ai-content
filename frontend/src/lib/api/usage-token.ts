"use client";

import { api } from "./client";

/** /api/usage/token 今日 Token 用量与额度 */
export interface TokenQuota {
  scene: "token";
  chatCount: number;
  chatLimit: number;
  chatRemaining: number;
  toolCount: number;
  toolLimit: number;
  toolRemaining: number;
  tokenCount: number;
  tokenLimit: number;
  tokenRemaining: number;
}

export const usageTokenApi = {
  /** 今日 Token 用量与额度（GET /usage/token） */
  quota() {
    return api.get<TokenQuota>("/usage/token");
  },
};
