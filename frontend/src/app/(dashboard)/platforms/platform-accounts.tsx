"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCcw,
  Smartphone,
  Trash2,
  XCircle,
  AlertTriangle,
  QrCode,
} from "lucide-react";
import {
  V2Section,
  V2StatusChip,
  V2GhostButton,
  V2PrimaryButton,
  V2DangerButton,
  V2EmptyState,
  V2Field,
  V2Input,
  V2Select,
} from "@/components/v2/ui-kit";
import { Avatar } from "@/components/avatar";
import {
  autoUploadApi,
  buildRiskConfirmation,
  type AutoUploadAccount,
} from "@/lib/api/auto-upload";
import {
  autoUploadAccountIdentityKey,
  dedupeAutoUploadAccounts,
} from "@/lib/auto-upload-account-state";
import { toPublicError } from "@/lib/public-error";
import { useIsMobile } from "@/lib/hooks/use-media-query";
import {
  PLATFORM_LABEL,
  openApp,
  platformTypeToKey,
  rpaStatus,
  type PlatformKey,
} from "@/lib/mobile-bridge";
import { mobileExecutorApi } from "@/lib/api/mobile-executor";

/* 平台类型：与后端一致 */
const PLATFORMS = [
  { type: 3, name: "抖音" },
  { type: 1, name: "小红书" },
  { type: 2, name: "视频号" },
  { type: 4, name: "快手" },
  { type: 5, name: "B站" },
  { type: 6, name: "微博" },
  { type: 7, name: "知乎" },
  { type: 8, name: "头条" },
  { type: 9, name: "公众号" },
] as const;

const PLATFORM_NAMES: Record<number, string> = {
  1: "小红书",
  2: "视频号",
  3: "抖音",
  4: "快手",
  5: "B站",
  6: "微博",
  7: "知乎",
  8: "头条",
  9: "公众号",
};

function accountStatus(account: AutoUploadAccount): {
  label: string;
  tone: "success" | "warning" | "danger" | "muted";
} {
  // 真实 session 状态优先（从 runtime_executions 反推）
  if (account.sessionStatus === "logged_in")
    return { label: "已登录", tone: "success" };
  if (account.sessionStatus === "needs_login")
    return { label: "登录失效", tone: "danger" };
  if (account.sessionStatus === "error")
    return { label: "状态异常", tone: "danger" };
  // 退回 statusLabel 文本判断
  const label = account.statusLabel || "";
  if (label.includes("正常") || label.includes("有效") || label.includes("在线"))
    return { label: "已登录", tone: "success" };
  if (label.includes("失效") || label.includes("登录") || label.includes("过期"))
    return { label: label.includes("需") ? label : "登录失效", tone: "danger" };
  return { label: label || "未知", tone: "muted" };
}

function createRequestId() {
  return `login_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function PlatformAccounts() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<AutoUploadAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 删除确认
  const [accountToDelete, setAccountToDelete] = useState<AutoUploadAccount | null>(null);
  const [deleting, setDeleting] = useState(false);

  // 登录弹窗状态
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginProfileName, setLoginProfileName] = useState("");
  const [loginPlatformType, setLoginPlatformType] = useState(3);
  const [loginRecord, setLoginRecord] = useState<AutoUploadAccount | null>(null);
  const [loginQrCode, setLoginQrCode] = useState("");
  const [loginStatus, setLoginStatus] = useState<"idle" | "connecting" | "scanning" | "success" | "failed">("idle");
  const [loginError, setLoginError] = useState("");
  const eventSourceRef = useRef<EventSource | null>(null);
  const loginTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loginRequestIdRef = useRef("");
  const loginEngineAccountIdRef = useRef<number | null>(null);

  // 移动端「调起 App 登录」状态
  const [mobilePickerOpen, setMobilePickerOpen] = useState(false);
  const [mobileBridgeMsg, setMobileBridgeMsg] = useState("");

  // 刷新头像（存量账号重抓昵称/头像）
  const [refreshingAvatarId, setRefreshingAvatarId] = useState<
    number | string | null
  >(null);

  // 恢复因账号失效而阻塞的发布任务
  const [recoveringId, setRecoveringId] = useState<number | null>(null);
  const handleRefreshAvatar = async (account: AutoUploadAccount) => {
    setRefreshingAvatarId(account.id);
    setError(null);
    try {
      await autoUploadApi.refreshAccountAvatar(
        Number(account.id) || Number(account.stableId) || 0,
      );
      await fetchAccounts({ silent: true });
    } catch (err: unknown) {
      setError(toPublicError(err, "刷新头像失败"));
    } finally {
      setRefreshingAvatarId(null);
    }
  };

  // 全自动执行器状态（RPA 无障碍 + 设备在线）
  const [executorEnabled, setExecutorEnabled] = useState(false);
  const [executorBridge, setExecutorBridge] = useState(false);
  const [devicesOnline, setDevicesOnline] = useState(0);

  // 创建自动回复任务弹层
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [taskPlatform, setTaskPlatform] = useState(3);
  const [taskContent, setTaskContent] = useState("");
  const [taskSubmitting, setTaskSubmitting] = useState(false);
  const [taskMsg, setTaskMsg] = useState("");

  useEffect(() => {
    const status = rpaStatus();
    setExecutorEnabled(status.enabled);
    setExecutorBridge(status.available);
    void mobileExecutorApi
      .devices()
      .then((devices) => {
        setDevicesOnline(devices.filter((d) => d.status === "online").length);
      })
      .catch(() => {
        /* 设备列表拉取失败不阻塞 */
      });
  }, []);

  const handleCreateTask = async () => {
    const content = taskContent.trim();
    if (!content) {
      setTaskMsg("请填写回复内容");
      return;
    }
    setTaskSubmitting(true);
    setTaskMsg("");
    try {
      await mobileExecutorApi.createDmReplyTask({
        platform: platformTypeToKey(taskPlatform),
        action: "dm-reply",
        content,
      });
      setTaskModalOpen(false);
      setTaskContent("");
      setMobileBridgeMsg("自动回复任务已下发，设备执行中…");
      window.setTimeout(() => setMobileBridgeMsg(""), 3500);
    } catch (e) {
      setTaskMsg(e instanceof Error ? e.message : "创建任务失败");
    } finally {
      setTaskSubmitting(false);
    }
  };

  const handleMobileLaunchApp = (platformKey: PlatformKey) => {
    const result = openApp(platformKey);
    setMobilePickerOpen(false);
    setMobileBridgeMsg(result.message);
    window.setTimeout(() => setMobileBridgeMsg(""), 3200);
  };

  const fetchAccounts = useCallback(async (options?: { validate?: boolean; force?: boolean; silent?: boolean }) => {
    try {
      if (!options?.silent) setLoading(true);
      const data = await autoUploadApi.accounts({
        validate: options?.validate,
        force: options?.force,
      });
      setAccounts(dedupeAutoUploadAccounts(data));
    } catch (err: unknown) {
      setError(toPublicError(err, "加载账号失败"));
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      // 初始加载不做强制 validate：validate 在云端/无浏览器环境会误判账号失效
      // （B1 状态机修复，2026-08-09）。主动校验交给「刷新登录状态」按钮。
      await fetchAccounts();
      if (!active) return;
    })();
    return () => {
      active = false;
    };
  }, [fetchAccounts]);

  // 去重（同平台同主体只显示一个）
  const displayAccounts = useMemo(() => {
    const seen = new Set<string>();
    return accounts.filter((account) => {
      const key = `${account.type}:${account.profileName || account.userName || autoUploadAccountIdentityKey(account)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [accounts]);

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

  const openLoginModal = (account?: AutoUploadAccount) => {
    closeLoginStream();
    setLoginRecord(account || null);
    setLoginProfileName(account?.profileName || account?.userName || "");
    setLoginPlatformType(account?.type || 3);
    setLoginQrCode("");
    setLoginStatus("idle");
    setLoginError("");
    loginRequestIdRef.current = "";
    loginEngineAccountIdRef.current = null;
    setLoginOpen(true);
  };

  const cancelLogin = async () => {
    const requestId = loginRequestIdRef.current;
    closeLoginStream();
    if (requestId && (loginStatus === "connecting" || loginStatus === "scanning")) {
      try {
        await autoUploadApi.cancelLogin(requestId);
      } catch {
        // 忽略取消失败
      }
    }
    setLoginOpen(false);
    setLoginStatus("idle");
    setLoginQrCode("");
    setLoginError("");
    loginRequestIdRef.current = "";
    loginEngineAccountIdRef.current = null;
  };

  const refreshAccountsAfterLogin = async () => {
    const targetId = loginEngineAccountIdRef.current;
    let latest: AutoUploadAccount[] = [];

    for (let attempt = 0; attempt < 8; attempt += 1) {
      latest = await autoUploadApi
        .accounts({ validate: true, force: true })
        .catch(() => []);
      const deduped = dedupeAutoUploadAccounts(latest);
      setAccounts(deduped);

      const targetFound =
        targetId == null ||
        deduped.some(
          (account) =>
            account.id === targetId ||
            account.stableId === String(targetId) ||
            account.filePath === String(targetId),
        );
      if (targetFound) return true;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    await fetchAccounts({ validate: true, force: true, silent: true });
    return targetId == null
      ? latest.length > 0
      : latest.some(
          (account) =>
            account.id === targetId ||
            account.stableId === String(targetId) ||
            account.filePath === String(targetId),
        );
  };

  /* 核心：流式扫码登录（与旧版逐事件一致） */
  const startLogin = () => {
    const profileName = loginProfileName.trim();
    if (!profileName) {
      setLoginError("请填写账号主体名称（例如：你的店铺名）");
      return;
    }

    closeLoginStream();
    const requestId = createRequestId();
    loginRequestIdRef.current = requestId;
    setLoginQrCode("");
    setLoginError("");
    setLoginStatus("connecting");

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

    // 65 秒超时（与旧版一致）
    loginTimerRef.current = setTimeout(() => {
      if (!hasLoginPrompt && !completed) {
        setLoginStatus("failed");
        setLoginError("登录页面加载超时，暂未获取到二维码。请重试。");
        closeLoginStream();
      }
    }, 65000);

    source.onmessage = (event) => {
      const data = event.data;

      if (data.startsWith("ERROR:")) {
        const message = data.replace(/^ERROR:\s*/, "") || "绑定失败，请稍后再试";
        lastStreamError = message;
        completed = true;
        setLoginStatus("failed");
        setLoginError(message);
        closeLoginStream();
        return;
      }

      if (data === "CANCELLED") {
        completed = true;
        closeLoginStream();
        setLoginOpen(false);
        setLoginStatus("idle");
        return;
      }

      if (data.startsWith("ACCOUNT_ID:")) {
        const accountId = Number(data.slice("ACCOUNT_ID:".length).trim());
        loginEngineAccountIdRef.current =
          Number.isInteger(accountId) && accountId > 0 ? accountId : null;
        return;
      }

      if (data.startsWith("LOGIN_URL:")) {
        // 手动登录模式（视频号专用流程）
        hasLoginPrompt = true;
        if (loginTimerRef.current) {
          clearTimeout(loginTimerRef.current);
          loginTimerRef.current = null;
        }
        setLoginQrCode("");
        setLoginStatus("scanning");
        return;
      }

      // 二维码数据（长字符串）
      if (!hasLoginPrompt && data.length > 100) {
        hasLoginPrompt = true;
        const isImageUrl =
          data.startsWith("data:image") ||
          data.startsWith("http://") ||
          data.startsWith("https://") ||
          data.startsWith("//") ||
          data.startsWith("blob:");
        setLoginQrCode(isImageUrl ? data : `data:image/png;base64,${data}`);
        setLoginStatus("scanning");
        return;
      }

      if (data === "200" || data === "500") {
        completed = true;
        closeLoginStream();
        if (data === "200") {
          void (async () => {
            const synced = await refreshAccountsAfterLogin();
            if (!synced) {
              setLoginStatus("failed");
              setLoginError(
                "平台已经完成绑定，但账号列表同步超时。请点击“刷新登录状态”；如果仍未显示，请重新打开平台账号页。",
              );
              return;
            }
            setLoginStatus("success");
            setTimeout(() => {
              setLoginOpen(false);
              setLoginStatus("idle");
              loginEngineAccountIdRef.current = null;
            }, 1200);
          })();
        } else {
          setLoginStatus("failed");
          setLoginError(
            lastStreamError ||
              "绑定失败：平台登录未完成或登录态校验失败。请确认在新打开的平台窗口里完成了登录，再点「刷新状态」。",
          );
        }
      }
    };

    source.onerror = () => {
      if (completed) return;
      completed = true;
      closeLoginStream();
      setLoginStatus("failed");
      setLoginError("登录连接中断，请重试。");
    };
  };

  const handleValidate = async () => {
    setValidating(true);
    setError(null);
    try {
      await fetchAccounts({ validate: true, force: true });
    } catch (err: unknown) {
      setError(toPublicError(err, "刷新状态失败"));
    } finally {
      setValidating(false);
    }
  };

  const handleDelete = async () => {
    if (!accountToDelete) return;
    setDeleting(true);
    setError(null);
    try {
      await autoUploadApi.deleteAccount(
        accountToDelete.id,
        buildRiskConfirmation("platform-account-delete", "high"),
        accountToDelete.platformKey || accountToDelete.platform,
      );
      setAccountToDelete(null);
      await fetchAccounts();
    } catch (err: unknown) {
      setError(toPublicError(err, "删除失败，请稍后重试"));
    } finally {
      setDeleting(false);
    }
  };

  const handleRelogin = async (account: AutoUploadAccount) => {
    try {
      await autoUploadApi.prepareAccountRelogin(
        account.id,
        account.platformKey || account.platform,
      );
    } catch {
      // 预备失败不阻断，直接走登录流
    }
    openLoginModal(account);
  };

  // 恢复该账号因失效而阻塞的发布任务（先风控确认，再恢复）
  const handleRecoverTasks = async (account: AutoUploadAccount) => {
    setRecoveringId(account.id);
    setError(null);
    try {
      const confirmation =
        await autoUploadApi.createRecoverBlockedTasksConfirmation(account.id);
      const result = await autoUploadApi.recoverBlockedTasks(
        account.id,
        confirmation.confirmationId,
      );
      setMobileBridgeMsg(
        `已恢复 ${result.resumed} 个任务${
          result.skipped ? `，跳过 ${result.skipped} 个` : ""
        }`,
      );
      await fetchAccounts({ silent: true });
    } catch (err) {
      setError(toPublicError(err, "恢复任务失败，请先确认账号已重新登录"));
    } finally {
      setRecoveringId(null);
    }
  };

  const expiredCount = displayAccounts.filter(
    (a) => accountStatus(a).tone === "danger",
  ).length;

  /* 移动端（<768px）：手机逻辑——调起 App 登录 / 一键转发，不再引导去电脑端 */
  const isMobile = useIsMobile();
  if (isMobile) {
    const statusDot = (a: AutoUploadAccount) => {
      const tone = accountStatus(a).tone;
      return tone === "success" ? { color: "#34d399", cls: "ok-dot" }
        : tone === "warning" ? { color: "#fbbf24", cls: "warn-dot" }
          : { color: "#f87171", cls: "err-dot" };
    };
    return (
      <div className="kx-mobile-ambient">
        <header className="mx-header">
          <div className="mx-header-row">
            <div>
              <div className="mx-brand-eyebrow">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 .304.377l6.001 4.1a.5.5 0 0 1-.29.908l-6.985.49a1 1 0 0 0-.673.42l-3.45 4.8a.5.5 0 0 1-.84 0l-3.45-4.8a1 1 0 0 0-.673-.42l-6.985-.49a.5.5 0 0 1-.29-.908l6.001-4.1a1 1 0 0 0 .304-.377z" /></svg>
                JIUZHANG AI
              </div>
              <h1 className="mx-page-title">平台账号</h1>
              <p className="mx-page-sub">各平台登录状态 · 手机端调起 App 登录</p>
            </div>
          </div>
        </header>

        <section className="mx-px" style={{ marginTop: 14 }}>
          <div className="mx-hero" style={{ borderRadius: 22, padding: 16 }}>
            <div className="mx-hero-ring" style={{ width: 110, height: 110, top: -30, right: -22 }} />
            <div style={{ position: "relative", zIndex: 2, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 12, color: "rgba(219,234,254,.72)" }}>已绑定账号</div>
                <div className="mx-gold-text" style={{ fontSize: 24, fontWeight: 800, marginTop: 2 }}>{displayAccounts.length}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: "#f87171" }}>{expiredCount}</div>
                <div style={{ fontSize: 10, color: "rgba(219,234,254,.6)" }}>失效待处理</div>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-px" style={{ marginTop: 16, paddingBottom: 28 }}>
          {error && (
            <div style={{ marginBottom: 12, padding: 10, borderRadius: 10, background: "rgba(239,68,68,.09)", fontSize: 12, color: "#dc2626" }}>{error}</div>
          )}
          {mobileBridgeMsg && (
            <div style={{ marginBottom: 12, padding: 10, borderRadius: 10, background: "rgba(16,185,129,.1)", border: "1px solid rgba(16,185,129,.3)", fontSize: 12, color: "#34d399" }}>{mobileBridgeMsg}</div>
          )}
          <div className="mx-card mx-list-card">
            {loading ? (
              <div>
                <div className="mx-skeleton-row"><span className="mx-skeleton mx-skeleton-ic" /><div style={{ flex: 1 }}><div className="mx-skeleton mx-skeleton-line" style={{ width: "70%" }} /><div className="mx-skeleton mx-skeleton-line mx-skeleton-line-sm" style={{ marginTop: 7 }} /></div></div>
                <div className="mx-skeleton-row"><span className="mx-skeleton mx-skeleton-ic" /><div style={{ flex: 1 }}><div className="mx-skeleton mx-skeleton-line" style={{ width: "58%" }} /><div className="mx-skeleton mx-skeleton-line mx-skeleton-line-sm" style={{ marginTop: 7 }} /></div></div>
              </div>
            ) : displayAccounts.length === 0 ? (
              <div className="mx-empty">
                <p>还没有绑定平台账号，点下方「添加账号」调起 App 登录</p>
              </div>
            ) : (
              displayAccounts.map((account) => {
                const dot = statusDot(account);
                const tone = accountStatus(account).tone;
                return (
                  <div className="mx-row" key={account.id}>
                    <span className="mx-row-ic" style={{ background: "rgba(37,99,235,.1)", color: "#2563eb" }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><rect width="20" height="14" x="2" y="5" rx="2" /><line x1="2" x2="22" y1="10" y2="10" /></svg>
                    </span>
                    <div className="mx-row-main">
                      <div className="mx-row-title">{PLATFORM_NAMES[account.type] || `平台 ${account.type}`}</div>
                      <div className="mx-row-desc" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span className="platform-dot" style={{ background: dot.color, boxShadow: `0 0 0 3px ${dot.color}22`, width: 7, height: 7, borderRadius: 999, flexShrink: 0 }} />
                        {account.profileName || account.userName || "未命名账号"}
                      </div>
                    </div>
                    <div className="mx-row-right" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {tone === "success" ? <span className="mx-badge mx-badge-green">正常</span>
                        : tone === "warning" ? <span className="mx-badge mx-badge-gold">需关注</span>
                          : (
                            <>
                              <span className="mx-badge mx-badge-red">失效</span>
                              <button
                                type="button"
                                style={{ fontSize: 11, padding: "4px 10px", borderRadius: 999, background: "rgba(244,187,103,.15)", border: "1px solid rgba(244,187,103,.5)", color: "#f4bb67" }}
                                onClick={() => handleMobileLaunchApp(platformTypeToKey(account.type))}
                              >
                                去重登
                              </button>
                              <button
                                type="button"
                                disabled={recoveringId === account.id}
                                style={{ fontSize: 11, padding: "4px 10px", borderRadius: 999, background: "rgba(52,211,153,.12)", border: "1px solid rgba(52,211,153,.45)", color: "#34d399", opacity: recoveringId === account.id ? 0.6 : 1, cursor: recoveringId === account.id ? "not-allowed" : "pointer" }}
                                onClick={() => void handleRecoverTasks(account)}
                              >
                                {recoveringId === account.id ? "恢复中…" : "恢复任务"}
                              </button>
                            </>
                          )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
          {/* 全自动执行器（RPA） */}
          <div className="mx-card" style={{ marginTop: 14, padding: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#e2edf9" }}>全自动执行器</div>
                <div style={{ fontSize: 11, marginTop: 4, color: "rgba(219,234,254,.55)", lineHeight: 1.5 }}>
                  {executorEnabled
                    ? `无障碍已开启 · 设备在线 ${devicesOnline} 台`
                    : executorBridge
                      ? "无障碍未开启（请到系统设置开启）"
                      : "当前环境无执行器（需 APK 壳）"}
                </div>
              </div>
              <button
                type="button"
                style={{
                  flexShrink: 0, fontSize: 12, padding: "8px 14px", borderRadius: 999,
                  background: "rgba(16,185,129,.15)", border: "1px solid rgba(16,185,129,.5)", color: "#34d399",
                }}
                onClick={() => {
                  setTaskMsg("");
                  setTaskModalOpen(true);
                }}
              >
                自动回复任务
              </button>
            </div>
          </div>

          <button
            type="button"
            className="mx-btn-gold"
            style={{ marginTop: 14, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
            onClick={() => setMobilePickerOpen(true)}
          >
            <Smartphone width={16} height={16} />
            添加账号 · 调起 App 登录
          </button>
          <p style={{ marginTop: 10, fontSize: 11, color: "rgba(219,234,254,.5)", textAlign: "center", lineHeight: 1.6 }}>
            登录与发布均在本机完成：调起目标 App 登录，生成内容后一键转发到视频号 / 微信 / 抖音
          </p>
        </section>

        {/* 移动端平台选择弹层（调起 App） */}
        {mobilePickerOpen && (
          <div
            className="fixed inset-0 z-50 flex items-end justify-center"
            style={{ background: "rgba(0,0,0,.6)" }}
            onClick={() => setMobilePickerOpen(false)}
          >
            <div
              className="w-full max-w-md rounded-t-[22px] p-5"
              style={{ background: "#101a2b", border: "1px solid rgba(255,255,255,.08)", borderBottom: "none", paddingBottom: 28 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#e2edf9" }}>选择平台 · 调起 App 登录</div>
                <button type="button" onClick={() => setMobilePickerOpen(false)} style={{ color: "rgba(219,234,254,.6)", fontSize: 20, lineHeight: 1 }}>×</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                {PLATFORMS.map((p) => (
                  <button
                    key={p.type}
                    type="button"
                    style={{
                      padding: "12px 6px", borderRadius: 12, fontSize: 13,
                      background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", color: "#dbe7f5",
                    }}
                    onClick={() => handleMobileLaunchApp(platformTypeToKey(p.type))}
                  >
                    {PLATFORM_LABEL[platformTypeToKey(p.type)]}
                  </button>
                ))}
              </div>
              <p style={{ marginTop: 12, fontSize: 11, color: "rgba(219,234,254,.5)", textAlign: "center", lineHeight: 1.6 }}>
                调起后将打开目标平台 App，请在其中完成登录后返回
              </p>
            </div>
          </div>
        )}

        {/* 创建自动回复任务弹层（全自动 RPA） */}
        {taskModalOpen && (
          <div
            className="fixed inset-0 z-50 flex items-end justify-center"
            style={{ background: "rgba(0,0,0,.6)" }}
            onClick={() => setTaskModalOpen(false)}
          >
            <div
              className="w-full max-w-md rounded-t-[22px] p-5"
              style={{ background: "#101a2b", border: "1px solid rgba(255,255,255,.08)", borderBottom: "none", paddingBottom: 28 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#e2edf9" }}>创建自动回复任务</div>
                <button type="button" onClick={() => setTaskModalOpen(false)} style={{ color: "rgba(219,234,254,.6)", fontSize: 20, lineHeight: 1 }}>×</button>
              </div>
              <div style={{ fontSize: 12, color: "rgba(219,234,254,.6)", marginBottom: 8 }}>目标平台</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                {PLATFORMS.map((p) => (
                  <button
                    key={p.type}
                    type="button"
                    style={{
                      padding: "10px 4px", borderRadius: 10, fontSize: 12.5,
                      background: taskPlatform === p.type ? "rgba(16,185,129,.18)" : "rgba(255,255,255,.05)",
                      border: taskPlatform === p.type ? "1px solid rgba(16,185,129,.55)" : "1px solid rgba(255,255,255,.1)",
                      color: taskPlatform === p.type ? "#34d399" : "#dbe7f5",
                    }}
                    onClick={() => setTaskPlatform(p.type)}
                  >
                    {PLATFORM_LABEL[platformTypeToKey(p.type)]}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 12, color: "rgba(219,234,254,.6)", marginTop: 12, marginBottom: 8 }}>回复内容</div>
              <textarea
                placeholder="输入要自动发送的回复内容…"
                value={taskContent}
                onChange={(e) => setTaskContent(e.target.value)}
                rows={3}
                style={{
                  width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,.07)",
                  border: "1px solid rgba(255,255,255,.18)", borderRadius: 10, color: "#dbe7f5",
                  padding: "10px 12px", fontSize: 13, resize: "vertical", lineHeight: 1.6,
                }}
              />
              {taskMsg && (
                <div style={{ marginTop: 8, fontSize: 11, color: "#f87171" }}>{taskMsg}</div>
              )}
              <button
                type="button"
                disabled={taskSubmitting}
                style={{
                  marginTop: 14, width: "100%", padding: "11px 0", borderRadius: 999,
                  background: taskSubmitting ? "rgba(16,185,129,.4)" : "rgba(16,185,129,.85)", color: "#04150e",
                  fontSize: 13.5, fontWeight: 700, border: "none",
                }}
                onClick={() => void handleCreateTask()}
              >
                {taskSubmitting ? "下派中…" : "下发任务 · 设备自动执行"}
              </button>
              <p style={{ marginTop: 10, fontSize: 11, color: "rgba(219,234,254,.45)", textAlign: "center", lineHeight: 1.6 }}>
                需开启无障碍权限且设备在线；执行器会自动调起目标 App 输入并发送
              </p>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* 顶部 */}
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)] hover:text-[var(--kaypal-v3-ink)]"
            onClick={() => router.push("/growth")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">
              平台账号
            </h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              登录各平台账号，系统才能帮你执行发布和互动
            </p>
          </div>
          <V2StatusChip tone={expiredCount > 0 ? "warning" : displayAccounts.length > 0 ? "success" : "muted"}>
            {loading
              ? "加载中"
              : expiredCount > 0
                ? `${expiredCount} 个失效`
                : `${displayAccounts.length} 个账号`}
          </V2StatusChip>
        </div>
      </section>

      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      {/* 账号列表 */}
      <V2Section
        title="我的账号"
        padding={false}
        action={
          <V2PrimaryButton icon={QrCode} onClick={() => openLoginModal()}>
            添加账号
          </V2PrimaryButton>
        }
      >
        {loading ? (
          <div className="p-12 text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-[var(--kaypal-v3-accent)] border-t-transparent" />
          </div>
        ) : displayAccounts.length === 0 ? (
          <V2EmptyState
            icon={Smartphone}
            title="还没有平台账号"
            description="添加一个账号，扫码登录后系统就能帮你干活了"
            action={
              <V2PrimaryButton icon={QrCode} onClick={() => openLoginModal()}>
                添加第一个账号
              </V2PrimaryButton>
            }
          />
        ) : (
          <div className="divide-y divide-[var(--kaypal-v3-border)]">
            {displayAccounts.map((account) => {
              const status = accountStatus(account);
              return (
                <div key={autoUploadAccountIdentityKey(account)} className="flex items-center justify-between p-5">
                  <div className="flex items-center gap-4">
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--kaypal-v3-accent-soft)]">
                      <Avatar
                        src={account.avatarUrl}
                        name={account.profileName || account.userName || "账号"}
                        size={44}
                        alt={account.profileName || account.userName || "账号"}
                        fallback={<Smartphone className="h-5 w-5 text-[var(--kaypal-v3-accent-ink)]" />}
                      />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-[var(--kaypal-v3-ink)]">
                          {account.profileName || account.userName || `账号 ${account.id}`}
                        </p>
                        <V2StatusChip tone={status.tone}>{status.label}</V2StatusChip>
                      </div>
                      <p className="mt-0.5 text-sm text-[var(--kaypal-v3-muted)]">
                        {PLATFORM_NAMES[account.type] || `平台 ${account.type}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {status.tone === "danger" && (
                      <V2PrimaryButton onClick={() => void handleRelogin(account)}>
                        重新登录
                      </V2PrimaryButton>
                    )}
                    <V2GhostButton
                      icon={refreshingAvatarId === account.id ? Loader2 : RefreshCcw}
                      loading={refreshingAvatarId === account.id}
                      onClick={() => void handleRefreshAvatar(account)}
                      disabled={refreshingAvatarId !== null}
                    >
                      刷新头像
                    </V2GhostButton>
                    {accountToDelete &&
                    autoUploadAccountIdentityKey(accountToDelete) ===
                    autoUploadAccountIdentityKey(account) ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-[var(--kaypal-v3-danger)]">
                          确认删除？
                        </span>
                        <V2DangerButton loading={deleting} onClick={() => void handleDelete()}>
                          确认
                        </V2DangerButton>
                        <V2GhostButton onClick={() => setAccountToDelete(null)}>
                          取消
                        </V2GhostButton>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-danger-soft)] hover:text-[var(--kaypal-v3-danger)]"
                        onClick={() => setAccountToDelete(account)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </V2Section>

      {/* 底部操作 */}
      <section className="flex items-center justify-between">
        <V2GhostButton icon={ArrowLeft} onClick={() => router.push("/growth")}>
          返回
        </V2GhostButton>
        <V2GhostButton
          icon={validating ? Loader2 : RefreshCcw}
          loading={validating}
          onClick={() => void handleValidate()}
        >
          {validating ? "正在检查..." : "刷新登录状态"}
        </V2GhostButton>
      </section>

      {/* 登录弹窗 */}
      {loginOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-[var(--kaypal-v3-radius)] bg-[var(--kaypal-v3-paper)] p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-[var(--kaypal-v3-ink)]">
                {loginRecord ? "重新登录" : "添加平台账号"}
              </h3>
              <button
                type="button"
                className="rounded-full p-1 text-[var(--kaypal-v3-muted)] hover:bg-[var(--kaypal-v3-paper-soft)]"
                onClick={() => void cancelLogin()}
              >
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            {loginStatus === "idle" && (
              <div className="mt-5 space-y-4">
                <V2Field label="平台" required>
                  <V2Select
                    value={String(loginPlatformType)}
                    onChange={(e) => setLoginPlatformType(Number(e.target.value))}
                  >
                    {PLATFORMS.map((p) => (
                      <option key={p.type} value={p.type}>
                        {p.name}
                      </option>
                    ))}
                  </V2Select>
                </V2Field>
                <V2Field label="账号主体名称" required hint="给这个账号起个你能认出来的名字">
                  <V2Input
                    placeholder="例如：XX 官方旗舰店"
                    value={loginProfileName}
                    onChange={(e) => setLoginProfileName(e.target.value)}
                  />
                </V2Field>
                {loginError && (
                  <p className="text-sm text-[var(--kaypal-v3-danger)]">{loginError}</p>
                )}
                <V2PrimaryButton
                  icon={QrCode}
                  className="w-full justify-center"
                  onClick={startLogin}
                >
                  开始扫码登录
                </V2PrimaryButton>
              </div>
            )}

            {loginStatus === "connecting" && (
              <div className="py-12 text-center">
                <Loader2 className="mx-auto h-10 w-10 animate-spin text-[var(--kaypal-v3-accent)]" />
                <p className="mt-4 text-sm text-[var(--kaypal-v3-muted)]">
                  正在打开登录页面，稍等...
                </p>
              </div>
            )}

            {loginStatus === "scanning" && (
              <div className="py-4 text-center">
                {loginQrCode ? (
                  <>
                    <p className="mb-3 text-sm font-medium text-[var(--kaypal-v3-ink)]">
                      用{PLATFORM_NAMES[loginPlatformType]} App 扫码登录
                    </p>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={loginQrCode}
                      alt="登录二维码"
                      className="mx-auto h-56 w-56 rounded-[var(--kaypal-v3-radius)] border border-[var(--kaypal-v3-border)]"
                    />
                    <p className="mt-3 text-xs text-[var(--kaypal-v3-muted)]">
                      扫码后请在手机上确认登录
                    </p>
                  </>
                ) : (
                  <>
                    <ExternalLink className="mx-auto h-10 w-10 text-[var(--kaypal-v3-accent)]" />
                    <p className="mt-4 text-sm text-[var(--kaypal-v3-ink)]">
                      已打开平台登录窗口
                    </p>
                    <p className="mt-1 text-xs text-[var(--kaypal-v3-muted)]">
                      请在新打开的窗口里完成登录，完成后这里会自动更新
                    </p>
                  </>
                )}
              </div>
            )}

            {loginStatus === "success" && (
              <div className="py-12 text-center">
                <CheckCircle2 className="mx-auto h-12 w-12 text-[var(--kaypal-v3-success)]" />
                <p className="mt-4 font-medium text-[var(--kaypal-v3-success)]">
                  {loginRecord ? "重新登录成功" : "绑定成功"}
                </p>
              </div>
            )}

            {loginStatus === "failed" && (
              <div className="py-6 text-center">
                <AlertTriangle className="mx-auto h-10 w-10 text-[var(--kaypal-v3-danger)]" />
                <p className="mt-4 text-sm text-[var(--kaypal-v3-danger)]">{loginError}</p>
                <div className="mt-5 flex items-center justify-center gap-3">
                  <V2GhostButton onClick={() => void cancelLogin()}>关闭</V2GhostButton>
                  <V2PrimaryButton onClick={startLogin}>重试</V2PrimaryButton>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
