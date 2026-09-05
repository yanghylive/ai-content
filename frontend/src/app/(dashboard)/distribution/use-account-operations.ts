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
  // 登录阶段（实时反馈用）：idle → connecting → qr/manual → detecting → done / failed / reconnecting
  const [loginPhase, setLoginPhase] = useState<
    | "idle"
    | "connecting"
    | "qr"
    | "manual"
    | "detecting"
    | "reconnecting"
    | "failed"
  >("idle");

  const eventSourceRef = useRef<EventSource | null>(null);
  const loginTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loginPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const loginPollCountRef = useRef(0);

  const closeLoginStream = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    if (loginTimerRef.current) {
      clearTimeout(loginTimerRef.current);
      loginTimerRef.current = null;
    }
    if (loginPollRef.current) {
      clearInterval(loginPollRef.current);
      loginPollRef.current = null;
    }
    loginPollCountRef.current = 0;
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

  // 2026-09-02（弹窗风暴根治）：cdp-sessions 会触发后端对每个账号做浏览器
  // 会话探测，不能做成 6s 高频轮询（页面一直弹浏览器窗口 + 引擎持续忙碌）。
  // 只在页面挂载拉一次；打开后台 / 校验状态 / 重登同步等显式操作后再刷新。
  useEffect(() => {
    void refreshCdpSessions();
  }, [refreshCdpSessions]);

  const isAccountLoggedIn = (account: AutoUploadAccount) =>
    account.lifecycleStatus === "online" ||
    account.sessionStatus === "logged_in" ||
    account.statusCode === "ok";

  /** 断线/手动重检：拉一次账号列表，判断目标账号是否已登录成功 */
  const detectLoginNow = useCallback(async (): Promise<boolean> => {
    try {
      const list = await autoUploadApi.accounts();
      const arr = Array.isArray(list) ? list : [];
      if (loginRecord) {
        return arr.some(
          (a) => String(a.id) === String(loginRecord.id) && isAccountLoggedIn(a),
        );
      }
      const name = loginProfileName.trim();
      if (!name) return false;
      return arr.some(
        (a) =>
          (a.profileName === name || a.userName === name) &&
          isAccountLoggedIn(a),
      );
    } catch {
      return false;
    }
  }, [loginRecord, loginProfileName]);

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
    setLoginPhase("idle");
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
    setLoginPhase("idle");
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
    const targetRecord = loginRecord;
    const targetName = profileName;
    const targetPlatformType = loginPlatformType;
    setLoginRequestId(requestId);
    setLoginQrCode("");
    setLoginStatus("");
    setLoginError("");
    setLoginConnecting(true);
    setLoginPhase("connecting");

    // 成功收尾（SSE 200 / 轮询命中 / 手动「我已登录」共用）
    const finishSuccess = () => {
      setLoginConnecting(false);
      setLoginPhase("detecting");
      setLoginStatus("200");
      notify({
        title: targetRecord ? "重新登录成功" : "绑定成功",
        tone: "success",
      });
      onRefresh().catch(() => undefined);
      setTimeout(() => {
        setLoginOpen(false);
        setLoginPhase("idle");
      }, 900);
    };

    // 轮询兜底：SSE 断线不代表登录失败——后端通常仍在等待浏览器
    // 完成登录并保存账号。断开后转为每 3s 轮询账号列表，识别到目标
    // 账号已登录即自动收尾，用户无需重试。
    const startPolling = (reason: string) => {
      closeLoginStream();
      setLoginConnecting(false);
      setLoginPhase("reconnecting");
      setLoginStatus("reconnecting");
      setLoginError(reason);
      loginPollCountRef.current = 0;
      const tick = async () => {
        loginPollCountRef.current += 1;
        if (loginPollCountRef.current > 20) {
          if (loginPollRef.current) clearInterval(loginPollRef.current);
          loginPollRef.current = null;
          loginPollCountRef.current = 0;
          setLoginPhase("failed");
          setLoginStatus("500");
          setLoginError(
            "仍未检测到登录。如已在浏览器中完成登录，点下方「我已登录」立即同步；否则请重试。",
          );
          return;
        }
        try {
          const list = await autoUploadApi.accounts();
          const arr = Array.isArray(list) ? list : [];
          const hit = targetRecord
            ? arr.some(
                (a) =>
                  String(a.id) === String(targetRecord.id) &&
                  isAccountLoggedIn(a),
              )
            : arr.some(
                (a) =>
                  (a.profileName === targetName ||
                    a.userName === targetName) &&
                  isAccountLoggedIn(a),
              );
          if (hit) {
            if (loginPollRef.current) clearInterval(loginPollRef.current);
            loginPollRef.current = null;
            loginPollCountRef.current = 0;
            finishSuccess();
          }
        } catch {
          // 本地服务暂不可达，继续下一轮
        }
      };
      void tick();
      loginPollRef.current = setInterval(() => void tick(), 3000);
    };

    let hasLoginPrompt = false;
    let completed = false;
    let lastStreamError = "";
    const source = new EventSource(
      autoUploadApi.loginUrl({
        type: targetPlatformType,
        profileName: targetName,
        requestId,
        update: Boolean(targetRecord),
        recordId: targetRecord?.id,
      }),
      { withCredentials: true },
    );
    eventSourceRef.current = source;
    loginTimerRef.current = setTimeout(() => {
      if (!hasLoginPrompt && !completed) {
        completed = true;
        setLoginPhase("failed");
        setLoginStatus("500");
        setLoginError("登录页面加载超时，暂未获取到二维码。");
        closeLoginStream();
        setLoginConnecting(false);
      }
    }, 65000);

    source.onmessage = (event) => {
      const data = event.data;
      if (completed) return;
      if (data.startsWith("ERROR:")) {
        const message =
          data.replace(/^ERROR:\s*/, "") || "绑定失败，请稍后再试";
        lastStreamError = message;
        completed = true;
        setLoginPhase("failed");
        setLoginStatus("500");
        setLoginError(message);
        closeLoginStream();
        setLoginConnecting(false);
        notify({ title: "登录失败", description: message, tone: "danger" });
        return;
      }

      if (data.startsWith("STATUS:")) {
        // 2026-09-02：登录等待期心跳（后端每 5s 一条），显示实时进度，
        // 不清除二维码 / 不打断流程。
        const statusText = data.slice("STATUS:".length).trim();
        if (statusText && !completed) {
          setLoginStatus(statusText);
          if (loginTimerRef.current) {
            clearTimeout(loginTimerRef.current);
            loginTimerRef.current = null;
          }
        }
        return;
      }

      if (data === "CANCELLED") {
        completed = true;
        closeLoginStream();
        setLoginConnecting(false);
        setLoginPhase("idle");
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
        if (targetPlatformType !== 2 || !trustedUrl) {
          completed = true;
          const message = "登录页地址未通过安全校验，请关闭窗口后重试。";
          setLoginPhase("failed");
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
        setLoginStatus("manual");
        setLoginPhase("manual");
        setLoginError("");
        return;
      }

      if (data.startsWith("data:image")) {
        // 2026-09-05 方案 B（引擎 headless 化，修「点登录弹外部浏览器」）：
        // 视频号二维码在跨域 iframe（open.weixin.qq.com/qrconnect）主 frame 抽不到，
        // 后端改投「登录页整页截图」data URL——先发 LOGIN_URL（进 manual 态），
        // 截图随后到达。此时 hasLoginPrompt 已置位，不能走下方 !hasLoginPrompt
        // 分支——直通更新二维码区并把 manual 升级为 qr（弹窗内显示登录页截图，
        // 用户手机扫码，桌面零弹窗）。
        setLoginQrCode(data);
        setLoginPhase("qr");
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
        setLoginPhase("qr");
        return;
      }

      if (data === "200" || data === "500") {
        completed = true;
        closeLoginStream();
        if (data === "200") {
          finishSuccess();
        } else {
          setLoginPhase("failed");
          setLoginStatus("500");
          setLoginConnecting(false);
          setLoginError(
            lastStreamError ||
              "绑定失败：平台登录未完成或登录态校验失败。请确认新打开的平台窗口已经完成登录，再点击「我已登录」同步状态。",
          );
        }
      }
    };

    source.onerror = () => {
      // SSE 断线不判死：转轮询确认登录结果，识别到已登录自动收尾
      if (completed) return;
      completed = true;
      startPolling("本地服务连接不稳定，正在确认登录状态…");
    };
  };

  /** 手动兜底：「我已登录」——立即检测一次，命中则自动完成绑定收尾 */
  const checkLoginNow = async () => {
    if (loginConnecting && loginPhase === "connecting") return;
    const ok = await detectLoginNow();
    if (ok) {
      setLoginConnecting(false);
      setLoginPhase("detecting");
      setLoginStatus("200");
      notify({
        title: loginRecord ? "重新登录成功" : "绑定成功",
        tone: "success",
      });
      onRefresh().catch(() => undefined);
      setTimeout(() => {
        setLoginOpen(false);
        setLoginPhase("idle");
      }, 900);
    } else {
      notify({
        title: "尚未检测到登录",
        description: "请确认在浏览器中已完成该平台的登录，再点击同步。",
        tone: "warning",
      });
    }
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
    loginPhase,
    setLoginProfileName,
    setLoginPlatformType,
    setAccountToDelete,
    setLoginOpen,
    refreshCdpSessions,
    openLoginModal,
    cancelLogin,
    startLogin,
    checkLoginNow,
    handleCheckAccounts,
    handleOpenAccount,
    handleRefreshAvatar,
    handleDeleteAccount,
  };
}
