"use client";

import { api } from "./client";

/** /api/commercial/client-config 客户端配置快照（运营 KV 下发） */
export interface ClientConfigSnapshot {
  version: number;
  issuedAt: string;
  features: Record<string, boolean>;
  resources: Record<string, { url: string; version: string }>;
}

export interface ClientConfigRow {
  key: string;
  value: string;
  updatedAt?: string;
}

export const clientConfigApi = {
  /** 客户端启动拉取配置（公开只读） */
  snapshot() {
    return api.get<ClientConfigSnapshot>("/commercial/client-config");
  },
  /** 配置清单（运营/调试用） */
  list() {
    return api.get<ClientConfigRow[]>("/commercial/client-config/list");
  },
};
