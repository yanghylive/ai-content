"use client";

import React from "react";
import {
  autoUploadApi,
  type AutoUploadAccount,
  type AutoUploadCdpBrowserSession,
} from "@/lib/api/auto-upload";
import { toPublicError } from "@/lib/public-error";

export type CdpSessionPlatform = "douyin" | "wechat-channel";

function cleanSessionMessage(value: string | null | undefined) {
  return String(value || "")
    .replace(/3011\s*本地\s*Runtime/g, "本机执行服务")
    .replace(/Chrome\/CDP\s*持久浏览器/g, "本机平台后台")
    .replace(/CDP\s*会话接口/g, "平台后台状态")
    .replace(/CDP\s*浏览器会话/g, "平台后台连接")
    .replace(/CDP\s*会话/g, "平台后台连接")
    .replace(/CDP/g, "平台后台")
    .replace(/persistent-cdp-browser/gi, "本机平台后台")
    .replace(/local-browser-engine/gi, "本机浏览器")
    .replace(/\bRuntime\b/g, "本机服务")
    .replace(/\bprofile\b/gi, "登录环境")
    .replace(/engine:\s*/gi, "")
    .replace(/尚未打开\s+本机平台后台/g, "尚未打开平台后台")
    .replace(/本地浏览器\s+本机服务/g, "本机浏览器")
    .replace(/账号\s+登录环境/g, "账号登录环境")
    .replace(/本机浏览器\s+已就绪/g, "本机浏览器已就绪")
    .replace(/账号登录环境\s+已准备/g, "账号登录环境已准备")
    .replace(/\/Users\/[^\s；,，。)）]+/g, "本机文件")
    .trim();
}

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
      setMessage(cleanSessionMessage(result.message) || null);
    } catch (error) {
      setAvailable(false);
      setSessions([]);
      setMessage(toPublicError(error, "平台后台状态暂时无法读取，请重试。"));
    } finally {
      setLoading(false);
    }
  }, [account?.id]);

  const refreshAndGetSession = React.useCallback(async () => {
    if (!account?.id) {
      setSessions([]);
      setAvailable(false);
      setMessage(null);
      return null;
    }

    try {
      setLoading(true);
      const result = await autoUploadApi.cdpSessions();
      setAvailable(result.available);
      setSessions(result.sessions);
      setMessage(cleanSessionMessage(result.message) || null);
      return (
        result.sessions.find(
          (item) =>
            item.platform === platform &&
            String(item.accountId || "") === String(account.id || ""),
        ) || null
      );
    } catch (error) {
      setAvailable(false);
      setSessions([]);
      setMessage(toPublicError(error, "平台后台状态暂时无法读取，请重试。"));
      return null;
    } finally {
      setLoading(false);
    }
  }, [account?.id, platform]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  React.useEffect(() => {
    if (!account?.id) return;
    const timer = window.setInterval(() => {
      void refresh();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [account?.id, refresh]);

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

  // 任务执行必须建立在已打开并验证过的平台后台页面上；进入后台按钮仍负责创建/刷新会话。
  const serviceDown =
    !!message &&
    (message.startsWith("平台后台状态不可用") ||
      message.startsWith("本机执行服务没有返回"));
  const sessionBlocked = session?.status != null && session.status !== "ready";
  const sessionReady =
    accountReady && !serviceDown && Boolean(session) && !sessionBlocked;
  const blocker = !account?.id
    ? "未选择平台账号"
    : !accountReady
      ? `${account.platform || "平台"}账号未登录或不可用`
      : serviceDown
        ? message || "本机执行服务没有返回平台后台状态"
        : !session
          ? "尚未读取到平台账号后台状态"
          : session.status !== "ready"
            ? cleanSessionMessage(session.lastError) ||
              (session.status === "needs_login"
                ? "平台页面要求重新登录"
                : session.status === "unknown"
                  ? "尚未打开平台后台确认登录态"
                  : "平台后台连接状态待确认")
            : null;

  return {
    loading,
    refresh,
    refreshAndGetSession,
    session,
    available,
    sessionReady,
    blocker,
  };
}
