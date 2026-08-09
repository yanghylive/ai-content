"use client";

import { useState, useCallback } from "react";
import { LOCAL_BRIDGE_ACTIONS } from "../actions";
import { localBridge } from "../client";

type LocalBridgePlatformCapability = {
  platform: string;
  displayName: string;
};

type LocalBridgeAccount = {
  platform: string;
  status: string;
};

export interface PublishHubPlatform {
  platform: string;
  displayName: string;
  selected: boolean;
  status: "idle" | "publishing" | "success" | "failed";
  taskId?: number;
  message?: string;
}

export interface PublishHubState {
  platforms: PublishHubPlatform[];
  publishing: boolean;
  countdown: number;
}

export function usePublishHub(
  capabilities: LocalBridgePlatformCapability[],
  accounts: LocalBridgeAccount[],
) {
  const [state, setState] = useState<PublishHubState>({
    platforms: capabilities.map((cap) => ({
      platform: cap.platform,
      displayName: cap.displayName,
      selected: accounts.some(
        (acc) => acc.platform === cap.platform && acc.status === "ready",
      ),
      status: "idle" as const,
    })),
    publishing: false,
    countdown: 0,
  });

  const togglePlatform = useCallback((platform: string) => {
    setState((prev) => ({
      ...prev,
      platforms: prev.platforms.map((p) =>
        p.platform === platform ? { ...p, selected: !p.selected } : p,
      ),
    }));
  }, []);

  const publishToAll = useCallback(
    async (request: {
      confirmationId: string;
      idempotencyKey: string;
      payloads: unknown[];
    }) => {
      const selected = state.platforms.filter((p) => p.selected);
      if (selected.length === 0) return;

      setState((prev) => ({
        ...prev,
        publishing: true,
        platforms: prev.platforms.map((p) =>
          p.selected ? { ...p, status: "publishing" as const } : p,
        ),
      }));

      // 倒计时 3 秒
      for (let i = 3; i > 0; i--) {
        setState((prev) => ({ ...prev, countdown: i }));
        await new Promise((r) => setTimeout(r, 1000));
      }
      setState((prev) => ({ ...prev, countdown: 0 }));

      // 并发发布到所有选中平台
      const results = await Promise.allSettled(
        selected.map(async (p) => {
          const response = await localBridge.request(
            LOCAL_BRIDGE_ACTIONS.EXECUTE_PUBLISH,
            request,
            { timeoutMs: 15000 },
          );
          return { platform: p.platform, response };
        }),
      );

      setState((prev) => ({
        ...prev,
        publishing: false,
        platforms: prev.platforms.map((p) => {
          const result = results.find(
            (r) => r.status === "fulfilled" && r.value.platform === p.platform,
          );
          if (!result || result.status !== "fulfilled") {
            return {
              ...p,
              status: "failed" as const,
              message: "发布请求失败",
            };
          }
          const data = result.value.response as { taskId?: number; accepted?: boolean };
          return {
            ...p,
            status: "success" as const,
            taskId: data?.taskId,
            message: `任务 #${data?.taskId} 已排队`,
          };
        }),
      }));
    },
    [state.platforms],
  );

  const reset = useCallback(() => {
    setState((prev) => ({
      ...prev,
      platforms: prev.platforms.map((p) => ({
        ...p,
        status: "idle" as const,
        taskId: undefined,
        message: undefined,
      })),
      publishing: false,
      countdown: 0,
    }));
  }, []);

  return { ...state, togglePlatform, publishToAll, reset };
}
