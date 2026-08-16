"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  autoUploadApi,
  buildRiskConfirmation,
  type AutoUploadAccount,
  type AutoUploadCdpBrowserSession,
} from "@/lib/api/auto-upload";
import { parseTrustedWechatChannelLoginUrl } from "@/lib/trusted-platform-login-url";
import { toPublicError } from "@/lib/public-error";
import {
  createRequestId,
  cleanUserFacingRuntimeText,
  findAccountCdpSession,
} from "./account-utils";

export type NotifyTone = "success" | "warning" | "danger";

export type Notify = (msg: {
  title: string;
  description?: string;
  tone: NotifyTone;
}) => void;

/**
 * 账号运维逻辑（从 legacy AccountsPanel 原样迁出）：
 * CDP 会话轮询 + 二维码登录 SSE + 打开后台 / 头像刷新 / 两段式删除 / 账号校验。
 * 通知通过 notify 回调解耦，UI 层自行决定展示方式。
 */
export function useAccountOperations(options: {
  onRefresh: () => Promise<void>;
  notify: Notify;
}) {
  const { onRefresh, notify } = options;

  const [checking, setChecking] = useState(false);
  const [openingId, setOpeningId] = useState<number | null>(null);
  const [refreshingAvatarId, setRefreshingAvatarId] = useState<number | null>(
    null,
  );
  const [cdpSessions, setCdpSessions] = useState<AutoUploadCdpBrowserSession[]>(
    [],
  );
  const [cdpMessage, setCdpMessage] = useState("");
  const [cdpLoading, setCdpLoading] = useState(false);
  const [accountToDelete, setAccountToDelete] =
    useState<AutoUploadAccount | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginProfileName, setLoginProfileName] = useState("");
  const [loginPlatformType, setLoginPlatformType] = useState(3);
  const [loginRecord, setLoginRecord] = useState<AutoUploadAccount | null>(null);
  const [loginRequestId, setLoginRequestId] = useState("");
  const [loginQrCode, setLoginQrCode] = useState("");
  const [loginStatus, setLoginStatus] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginConnecting, setLoginConnecting] = useState(false);

  const eventSourceRef = useRef<EventSource | null>(null);
  const loginTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const closeLoginStream = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    if (loginTimerRef.current) {
      clearTimeout(loginTimerRef.current);
      loginTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => closeLoginStream();
  }, [closeLoginStream]);

  const refreshCdpSessions = useCallback(async () => {
    setCdpLoading(true);
    try {
      const result = await autoUploadApi.cdpSessions();
      setCdpSessions(result.sessions || []);
      setCdpMessage(cleanUserFacingRuntimeText(result.message));
      return result.sessions || [];
    } catch (error) {
      const message = toPublicError(
        error,
        "平台后台状态暂时无法读取，请重试。",
      );
      setCdpSessions([]);
      setCdpMessage(cleanUserFacingRuntimeText(message));
      return [];
    } finally {
      setCdpLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshCdpSessions();
    const timer = window.setInterval(() => {
      void refreshCdpSessions();
    }, 6000);
    return () => window.clearInterval(timer);
  }, [refreshCdpSessions]);

  const openLoginModal = (account?: AutoUploadAccount) => {
    closeLoginStream();
    setLoginRecord(account || null);
    setLoginProfileName(account?.profileName || account?.userName || "");
    setLoginPlatformType(account?.type || 3);
    setLoginRequestId("");
    setLoginQrCode("");
    setLoginStatus("");
    setLoginError("");
    setLoginConnecting(false);
    setLoginOpen(true);
  };

  const cancelLogin = async (closeModal = true) => {
    const requestId = loginRequestId;
    closeLoginStream();
    if (loginConnecting && requestId) {
      try {
        await autoUploadApi.cancelLogin(requestId);
      } catch {
        notify({ title: "已关闭登录窗口", tone: "warning" });
      }
    }
    setLoginConnecting(false);
    setLoginQrCode("");
    setLoginStatus("");
    setLoginError("");
    setLoginRequestId("");
    if (closeModal) {
      setLoginOpen(false);
    }
  };

  const startLogin = () => {
    const profileName = loginProfileName.trim();
    if (!profileName) {
      notify({ title: "请填写账号主体名称", tone: "warning" });
      return;
    }

    closeLoginStream();
    const requestId = createRequestId();
    setLoginRequestId(requestId);
    setLoginQrCode("");
    setLoginStatus("");
    setLoginError("");
    setLoginConnecting(true);

    let hasLoginPrompt = false;
    let completed = false;
    let lastStreamError = "";
    const source = new EventSource(
      autoUploadApi.loginUrl({
        type: loginPlatformType,
        profileName,
        requestId,
        update: Boolean(loginRecord),
        recordId: loginRecord?.id,
      }),
      { withCredentials: true },
    );
    eventSourceRef.current = source;
    loginTimerRef.current = setTimeout(() => {
      if (!hasLoginPrompt && !completed) {
        setLoginStatus("500");
        setLoginError("登录页面加载超时，暂未获取到二维码。");
        closeLoginStream();
        setLoginConnecting(false);
      }
    }, 65000);

    source.onmessage = (event) => {
      const data = event.data;
      if (data.startsWith("ERROR:")) {
        const message =
          data.replace(/^ERROR:\s*/, "") || "绑定失败，请稍后再试";
        lastStreamError = message;
        completed = true;
        setLoginStatus("500");
        setLoginError(message);
        closeLoginStream();
        setLoginConnecting(false);
        notify({ title: "登录失败", description: message, tone: "danger" });
        return;
      }

      if (data === "CANCELLED") {
        completed = true;
        closeLoginStream();
        setLoginConnecting(false);
        setLoginOpen(false);
        return;
      }

      if (data.startsWith("ACCOUNT_ID:")) {
        return;
      }

      if (data.startsWith("LOGIN_URL:")) {
        const trustedUrl = parseTrustedWechatChannelLoginUrl(
          data.slice("LOGIN_URL:".length),
        );
        if (loginPlatformType !== 2 || !trustedUrl) {
          completed = true;
          const message = "登录页地址未通过安全校验，请关闭窗口后重试。";
          setLoginStatus("500");
          setLoginError(message);
          closeLoginStream();
          setLoginConnecting(false);
          notify({ title: "登录流程异常", description: message, tone: "danger" });
          return;
        }
        hasLoginPrompt = true;
        if (loginTimerRef.current) {
          clearTimeout(loginTimerRef.current);
          loginTimerRef.current = null;
        }
        setLoginQrCode("");
        setLoginStatus("manual");
        setLoginError("");
        return;
      }

      if (!hasLoginPrompt && data.length > 100) {
        hasLoginPrompt = true;
        const isImageUrl =
          data.startsWith("data:image") ||
          data.startsWith("http://") ||
          data.startsWith("https://") ||
          data.startsWith("//") ||
          data.startsWith("blob:");
        setLoginQrCode(isImageUrl ? data : `data:image/png;base64,${data}`);
        return;
      }

      if (data === "200" || data === "500") {
        completed = true;
        setLoginStatus(data);
        closeLoginStream();
        setLoginConnecting(false);
        if (data === "200") {
          notify({
            title: loginRecord ? "重新登录成功" : "绑定成功",
            tone: "success",
          });
          onRefresh().catch(() => undefined);
          setTimeout(() => setLoginOpen(false), 900);
        } else {
          setLoginError(
            lastStreamError ||
              "绑定失败：平台登录未完成或登录态校验失败。请确认新打开的平台窗口已经完成登录，再点击刷新账号状态。",
          );
        }
      }
    };

    source.onerror = () => {
      completed = true;
      closeLoginStream();
      setLoginConnecting(false);
      setLoginStatus("500");
      setLoginError("登录连接中断，请确认本地服务仍在运行。");
      notify({ title: "登录连接中断", tone: "danger" });
    };
  };

  const handleCheckAccounts = async (): Promise<AutoUploadAccount[] | null> => {
    setChecking(true);
    try {
      const result = await autoUploadApi.accounts({
        validate: true,
        force: true,
      });
      await refreshCdpSessions();
      notify({ title: "账号状态校验完成", tone: "success" });
      return result;
    } catch (e: unknown) {
      notify({
        title: "账号校验失败",
        description: toPublicError(e, "账号状态未更新，请稍后重试。"),
        tone: "danger",
      });
      return null;
    } finally {
      setChecking(false);
    }
  };

  const handleOpenAccount = async (account: AutoUploadAccount) => {
    setOpeningId(account.id);
    try {
      const result = await autoUploadApi.openAccounts([account.id]);
      const sessions = await refreshCdpSessions();
      const session = findAccountCdpSession(sessions, account);
      const skipped = result.skipped?.find(
        (item) => String(item.id) === String(account.id),
      );
      if (skipped) {
        notify({
          title: "打开平台后台失败",
          description: skipped.reason,
          tone: "danger",
        });
      } else {
        notify({
          title: session?.status === "ready" ? "平台后台已就绪" : "已请求打开平台后台",
          description:
            cleanUserFacingRuntimeText(session?.lastError) ||
            (session?.currentUrl
              ? "平台页面已打开，稍后会自动同步登录状态。"
              : "") ||
            "稍后会自动刷新账号页会话状态。",
          tone: session?.status === "ready" ? "success" : "warning",
        });
      }
    } catch (e: unknown) {
      notify({
        title: "打开失败",
        description: toPublicError(e, "平台后台暂时无法打开，请稍后重试。"),
        tone: "danger",
      });
    } finally {
      setOpeningId(null);
    }
  };

  const handleRefreshAvatar = async (account: AutoUploadAccount) => {
    setRefreshingAvatarId(account.id);
    try {
      await autoUploadApi.refreshAccountAvatar(account.id);
      await onRefresh();
      notify({ title: "账号头像已刷新", tone: "success" });
    } catch (e: unknown) {
      notify({
        title: "头像刷新失败",
        description: toPublicError(e, "账号头像未刷新，请稍后重试。"),
        tone: "danger",
      });
    } finally {
      setRefreshingAvatarId(null);
    }
  };

  const handleDeleteAccount = async () => {
    if (!accountToDelete) return;

    setDeleting(true);
    try {
      await autoUploadApi.deleteAccount(
        accountToDelete.id,
        buildRiskConfirmation("platform-account-delete"),
      );
      notify({ title: "账号已删除", tone: "success" });
      setAccountToDelete(null);
      await onRefresh();
    } catch (e: unknown) {
      notify({
        title: "删除失败",
        description: toPublicError(e, "平台账号未删除，请稍后重试。"),
        tone: "danger",
      });
    } finally {
      setDeleting(false);
    }
  };

  return {
    checking,
    openingId,
    refreshingAvatarId,
    cdpSessions,
    cdpMessage,
    cdpLoading,
    accountToDelete,
    deleting,
    loginOpen,
    loginProfileName,
    loginPlatformType,
    loginRecord,
    loginRequestId,
    loginQrCode,
    loginStatus,
    loginError,
    loginConnecting,
    setLoginProfileName,
    setLoginPlatformType,
    setAccountToDelete,
    setLoginOpen,
    refreshCdpSessions,
    openLoginModal,
    cancelLogin,
    startLogin,
    handleCheckAccounts,
    handleOpenAccount,
    handleRefreshAvatar,
    handleDeleteAccount,
  };
}
