"use client";

/**
 * SWR hooks for frequently called dashboard APIs.
 * 解决首屏 /api/growth/home、/api/workspaces 等接口被多个子组件重复调用的问题。
 * SWR 的 dedup 机制确保同一 key 在 dedupingInterval 内只发一次请求。
 */

import useSWR from "swr";
import { growthApi } from "@/lib/api/growth";
import { workspaceApi } from "@/lib/api/workspace";
import { authApi } from "@/lib/api/auth";
import type { GrowthHomeResponse } from "@/lib/api/growth";
import type { Workspace } from "@/lib/api/workspace";
import type { AuthUser } from "@/lib/api/auth";

/** 今日增长首页聚合数据（多个子组件共享，SWR 自动去重） */
export function useGrowthHome(range: "today" | "30d" = "today") {
  return useSWR<GrowthHomeResponse>(
    `/growth/home${range === "30d" ? "?range=30d" : ""}`,
    () => growthApi.getGrowthHome(range),
    { refreshInterval: 30000 },
  );
}

/** 工作区列表（多组件共享） */
export function useWorkspaces() {
  return useSWR<Workspace[]>(
    "workspaces",
    () => workspaceApi.list(),
    { refreshInterval: 60000 },
  );
}

/** 当前用户信息（轻量缓存，5 分钟过期） */
export function useCurrentUser() {
  return useSWR<AuthUser | null>(
    "auth/me",
    () => authApi.me(),
    { refreshInterval: 300000 },
  );
}
