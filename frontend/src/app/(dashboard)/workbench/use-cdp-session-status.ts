"use client";

import React from "react";
import {
  autoUploadApi,
  type AutoUploadAccount,
  type AutoUploadCdpBrowserSession,
} from "@/lib/api/auto-upload";

export type CdpSessionPlatform = "douyin" | "wechat-channel";

export function useCdpSessionStatus(
  platform: CdpSessionPlatform,
  account: AutoUploadAccount | null,
) {
  const [sessions, setSessions] = React.useState<AutoUploadCdpBrowserSession[]>(
    [],
  );
  const [available, setAvailable] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const refresh = React.useCallback(async () => {
    if (!account?.id) {
      setSessions([]);
      setAvailable(false);
      setMessage(null);
      return;
    }

    try {
      setLoading(true);
      const result = await autoUploadApi.cdpSessions();
      setAvailable(result.available);
      setSessions(result.sessions);
      setMessage(result.message || null);
    } catch (error) {
      setAvailable(false);
      setSessions([]);
      setMessage(error instanceof Error ? error.message : "读取 CDP 状态失败");
    } finally {
      setLoading(false);
    }
  }, [account?.id]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const session = React.useMemo(
    () =>
      sessions.find(
        (item) =>
          item.platform === platform &&
          String(item.accountId || "") === String(account?.id || ""),
      ) || null,
    [account?.id, platform, sessions],
  );

  const accountReady = account?.status === 1;
  const sessionReady = available && accountReady && session?.status === "ready";
  const blocker = !account?.id
    ? "未选择平台账号"
    : !accountReady
      ? `${account.platform || "平台"}账号未登录或不可用`
      : !available
        ? message || "本地发布服务没有返回 CDP 状态"
        : !session
          ? "没有找到这个账号的 CDP 浏览器会话"
          : session.status !== "ready"
            ? session.lastError ||
              `CDP 浏览器会话状态为 ${session.status || "unknown"}`
            : null;

  return {
    loading,
    refresh,
    session,
    sessionReady,
    blocker,
  };
}
