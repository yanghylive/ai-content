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
import { autoUploadApi, type AutoUploadAccount } from "@/lib/api/auto-upload";
import { toPublicError } from "@/lib/public-error";

/* 平台类型：与旧版一致 */
const PLATFORMS = [
  { type: 3, name: "抖音" },
  { type: 1, name: "小红书" },
  { type: 2, name: "视频号" },
  { type: 4, name: "快手" },
  { type: 5, name: "B站" },
] as const;

const PLATFORM_NAMES: Record<number, string> = {
  1: "小红书",
  2: "视频号",
  3: "抖音",
  4: "快手",
  5: "B站",
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

/** 后端账号表存在同 id 重复记录（脏数据），渲染前按 id 去重，避免 React key 冲突 */
function dedupeAccounts(data: unknown): AutoUploadAccount[] {
  if (!Array.isArray(data)) return [];
  const seen = new Set<number>();
  return (data as AutoUploadAccount[]).filter((a) => {
    if (a?.id == null || seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });
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

  const fetchAccounts = useCallback(async () => {
    try {
      setLoading(true);
      const data = await autoUploadApi.accounts();
      setAccounts(dedupeAccounts(data));
    } catch (err: unknown) {
      setError(toPublicError(err, "加载账号失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAccounts();
  }, [fetchAccounts]);

  // 去重（同平台同主体只显示一个）
  const displayAccounts = useMemo(() => {
    const seen = new Set<string>();
    return accounts.filter((account) => {
      const key = `${account.type}:${account.profileName || account.userName || account.id}`;
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

      if (data.startsWith("ACCOUNT_ID:")) return;

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
          setLoginStatus("success");
          void fetchAccounts();
          setTimeout(() => {
            setLoginOpen(false);
            setLoginStatus("idle");
          }, 1200);
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
      const data = await autoUploadApi.accounts({ validate: true, force: true });
      setAccounts(dedupeAccounts(data));
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
      await autoUploadApi.deleteAccount(accountToDelete.id);
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
      await autoUploadApi.prepareAccountRelogin(account.id);
    } catch {
      // 预备失败不阻断，直接走登录流
    }
    openLoginModal(account);
  };

  const expiredCount = displayAccounts.filter(
    (a) => accountStatus(a).tone === "danger",
  ).length;

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
                <div key={account.id} className="flex items-center justify-between p-5">
                  <div className="flex items-center gap-4">
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--kaypal-v3-accent-soft)]">
                      {account.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={account.avatarUrl}
                          alt=""
                          className="h-11 w-11 rounded-full object-cover"
                        />
                      ) : (
                        <Smartphone className="h-5 w-5 text-[var(--kaypal-v3-accent-ink)]" />
                      )}
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
                    {accountToDelete?.id === account.id ? (
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
