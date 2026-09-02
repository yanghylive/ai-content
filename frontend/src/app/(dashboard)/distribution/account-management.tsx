"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Loader2,
  LogIn,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserCheck,
  X,
} from "lucide-react";
import { autoUploadApi, type AutoUploadAccount } from "@/lib/api/auto-upload";
import {
  V2Section,
  V2StatusChip,
  V2GhostButton,
  V2DangerButton,
  V2PrimaryButton,
  V2EmptyState,
} from "@/components/v2/ui-kit";
import { RiskConfirmationDialog } from "@/components/risk-confirmation-dialog";
import { PlatformBadge } from "@/components/platform-badge";
import { useAccountOperations } from "./use-account-operations";
import {
  accountIdentityKey,
  accountRowKey,
  cdpSessionChip,
  findAccountCdpSession,
} from "./account-utils";

// 平台品牌色 + 官方图形 logo（本地白色版，圆形品牌底上展示）：
// douyin/xiaohongshu/kuaishou/bilibili 取自 simple-icons（品牌官方图形，
// TikTok 同源音符代抖音——抖音暂缺开源 SVG）；视频号取自 Remix Icon
// wechat-channels（Apache-2.0）。
const PLATFORMS = [
  { type: 3, label: "抖音", brand: "#fe2c55", logo: "/platform-logos/douyin.svg" },
  { type: 1, label: "小红书", brand: "#ff2442", logo: "/platform-logos/xiaohongshu.svg" },
  { type: 2, label: "视频号", brand: "#007fff", logo: "/platform-logos/shipinhao.svg" },
  { type: 4, label: "快手", brand: "#ff4d2e", logo: "/platform-logos/kuaishou.svg" },
  { type: 5, label: "B站", brand: "#00a1d6", logo: "/platform-logos/bilibili.svg" },
] as const;

function sessionStatusTone(status?: string) {
  if (status === "logged_in") return "success" as const;
  if (status === "needs_login") return "warning" as const;
  if (status === "error") return "danger" as const;
  return "muted" as const;
}

function sessionStatusLabel(status?: string) {
  if (status === "logged_in") return "已登录";
  if (status === "needs_login") return "未登录";
  if (status === "error") return "异常";
  return "待验证";
}

// 统一生命周期状态（后端 deriveAccountLifecycle 返回）
const LIFECYCLE_LABEL: Record<string, string> = {
  unbound: "未绑定",
  login_pending: "待校验",
  online: "已登录",
  degraded: "浏览器阻断",
  expired: "登录失效",
  reauth: "需要重新登录",
  disabled: "已禁用",
};
const LIFECYCLE_TONE: Record<string, "success" | "warning" | "danger" | "muted"> = {
  online: "success",
  login_pending: "muted",
  reauth: "warning",
  degraded: "danger",
  expired: "danger",
  disabled: "danger",
  unbound: "muted",
};
function lifecycleStatusTone(status?: string | null) {
  return (status && LIFECYCLE_TONE[status]) || "muted";
}
function lifecycleStatusLabel(status?: string | null) {
  return (status && LIFECYCLE_LABEL[status]) || "待验证";
}

export function AccountManagement() {
  const [accounts, setAccounts] = useState<AutoUploadAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{
    title: string;
    description?: string;
    tone: "success" | "warning" | "danger";
  } | null>(null);

  const notify = useCallback(
    (msg: { title: string; description?: string; tone: "success" | "warning" | "danger" }) => {
      setNotice(msg);
      window.setTimeout(() => setNotice(null), 3000);
    },
    [],
  );

  const fetchAccounts = useCallback(async () => {
    try {
      const result = await autoUploadApi.accounts();
      setAccounts(Array.isArray(result) ? result : []);
    } catch {
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAccounts();
  }, [fetchAccounts]);

  const ops = useAccountOperations({ onRefresh: fetchAccounts, notify });

  const displayAccounts = useMemo(() => {
    const seen = new Set<string>();
    return accounts.filter((account) => {
      const key = accountIdentityKey(account);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [accounts]);

  const handleCheck = async () => {
    const result = await ops.handleCheckAccounts();
    if (result) setAccounts(result);
  };

  return (
    <div className="flex flex-col gap-[var(--space-section)]">
      <div className="kx-page-head">
        <div>
          <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">平台账号</h1>
          <p className="kx-greet-sub mt-1 text-[var(--kaypal-v3-muted)]">
            账号、登录状态和平台后台统一在这里管理
          </p>
        </div>
      </div>
      <V2Section
        title="账号列表"
      action={
        <div className="flex items-center gap-2">
          <V2GhostButton
            icon={ShieldCheck}
            loading={ops.checking}
            onClick={() => void handleCheck()}
          >
            校验状态
          </V2GhostButton>
          <Link
            href="/platforms/new"
            className="inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-4 py-2.5 text-sm font-medium text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)]"
          >
            <KeyRound className="h-4 w-4" />
            添加发布账号
          </Link>
          <V2PrimaryButton icon={Plus} onClick={() => ops.openLoginModal()}>
            绑定平台
          </V2PrimaryButton>
        </div>
      }
    >
      {notice && (
        <div
          className={`mb-4 rounded-[var(--kaypal-v3-radius)] border p-3 text-sm ${
            notice.tone === "success"
              ? "border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] text-[var(--kaypal-v3-success)]"
              : notice.tone === "danger"
                ? "border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] text-[var(--kaypal-v3-danger)]"
                : "border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)] text-[var(--kaypal-v3-amber)]"
          }`}
        >
          <p className="font-medium">{notice.title}</p>
          {notice.description ? (
            <p className="mt-0.5 text-xs opacity-80">{notice.description}</p>
          ) : null}
        </div>
      )}

      {loading ? (
        <div className="py-8 text-center text-sm text-[var(--kaypal-v3-muted)]">
          正在加载账号...
        </div>
      ) : displayAccounts.length === 0 ? (
        <V2EmptyState
          icon={UserCheck}
          title="暂无平台账号"
          description="绑定平台账号后，发布、互动和账号健康检查都会使用同一套登录状态。"
          action={
            <V2PrimaryButton icon={Plus} onClick={() => ops.openLoginModal()}>
              绑定平台
            </V2PrimaryButton>
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {displayAccounts.map((account, index) => {
            const session = findAccountCdpSession(ops.cdpSessions, account);
            const chip = cdpSessionChip(session);
            // 优先用后端统一生命周期状态，无则回退 sessionStatus
            const statusTone = account.lifecycleStatus
              ? lifecycleStatusTone(account.lifecycleStatus)
              : sessionStatusTone(account.sessionStatus);
            const statusLabel = account.lifecycleStatus
              ? lifecycleStatusLabel(account.lifecycleStatus)
              : sessionStatusLabel(account.sessionStatus);
            const storageLabel =
              session?.status === "ready"
                ? "账号环境已接管"
                : account.filePath
                  ? "账号文件已保存"
                  : "等待同步";
            return (
              <div
                key={accountRowKey(account, index)}
                className="kaypal-v3-surface p-4"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <PlatformBadge platform={account.platform} size={20} />
                      <span className="text-[13px] text-[var(--kaypal-v3-muted)]">
                        {account.platform}
                      </span>
                      <span className="font-medium text-[var(--kaypal-v3-ink)]">
                        {account.profileName ||
                          account.accountName ||
                          account.userName ||
                          `账号 ${account.id}`}
                      </span>
                      <span className="text-xs text-[var(--kaypal-v3-muted)]">
                        ID {account.id}
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <V2StatusChip tone={statusTone}>
                        {statusLabel}
                      </V2StatusChip>
                      <V2StatusChip tone={chip.tone}>{chip.label}</V2StatusChip>
                      <span className="text-xs text-[var(--kaypal-v3-muted)]">
                        {storageLabel}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <V2GhostButton
                      icon={ExternalLink}
                      loading={ops.openingId === account.id}
                      onClick={() => void ops.handleOpenAccount(account)}
                    >
                      打开
                    </V2GhostButton>
                    <V2GhostButton
                      icon={RefreshCw}
                      loading={ops.refreshingAvatarId === account.id}
                      onClick={() => void ops.handleRefreshAvatar(account)}
                    >
                      刷新头像
                    </V2GhostButton>
                    <V2GhostButton
                      icon={UserCheck}
                      onClick={() => ops.openLoginModal(account)}
                    >
                      重登
                    </V2GhostButton>
                    <V2DangerButton
                      icon={Trash2}
                      onClick={() => ops.setAccountToDelete(account)}
                    >
                      删除
                    </V2DangerButton>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 登录弹窗 */}
      {ops.loginOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => {
            if (!ops.loginConnecting) ops.cancelLogin(true).catch(() => undefined);
          }}
        >
          <div
            className="relative w-full max-w-md overflow-hidden rounded-[20px] border border-[var(--kaypal-v3-border-strong)] bg-[var(--kaypal-v3-paper)] shadow-[0_24px_64px_-16px_rgba(0,0,0,0.28)]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 顶部品牌渐变装饰条 */}
            <div
              className="w-full"
              style={{
                height: 5,
                background: "var(--kaypal-v3-gradient-primary)",
                boxShadow:
                  "0 1px 0 0 var(--kaypal-v3-accent, rgba(114,46,209,0.35))",
              }}
            />

            <div className="p-6">
              {/* 头部：图标徽章 + 标题 + 关闭 */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-[12px] text-white"
                    style={{
                      backgroundImage: "var(--kaypal-v3-gradient-primary)",
                      boxShadow:
                        "0 6px 16px -6px var(--kaypal-v3-accent, rgba(114,46,209,0.55))",
                    }}
                  >
                    <KeyRound className="h-5 w-5" strokeWidth={1.9} />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold leading-6 text-[var(--kaypal-v3-ink)]">
                      {ops.loginRecord ? "重新登录平台账号" : "绑定平台账号"}
                    </h2>
                    <p className="mt-0.5 text-xs text-[var(--kaypal-v3-muted)]">
                      {ops.loginRecord
                        ? "重新授权后，发布与互动任务将沿用新的登录状态"
                        : "绑定后即可用于发布、互动与账号健康检测"}
                    </p>
                  </div>
                </div>
                {!ops.loginConnecting && (
                  <button
                    type="button"
                    aria-label="关闭"
                    className="rounded-lg p-1.5 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-hover,rgba(114,46,209,0.06))] hover:text-[var(--kaypal-v3-ink)]"
                    onClick={() => ops.cancelLogin(true).catch(() => undefined)}
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              <div className="mt-5 flex flex-col gap-4">
                {/* 账号主体 */}
                <div>
                  <p className="mb-1.5 text-[13px] font-medium text-[var(--kaypal-v3-soft-ink)]">
                    账号主体
                  </p>
                  <div className="relative">
                    <UserCheck className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--kaypal-v3-muted)]" />
                    <input
                      className="h-10 w-full rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-field-border)] bg-[var(--kaypal-v3-field-bg)] pl-9 pr-3 text-sm text-[var(--kaypal-v3-ink)] outline-none transition placeholder:text-[var(--kaypal-v3-muted)] focus:border-[var(--kaypal-v3-accent)] disabled:opacity-50"
                      placeholder="例如：矩阵账号01"
                      disabled={ops.loginConnecting}
                      value={ops.loginProfileName}
                      onChange={(e) => ops.setLoginProfileName(e.target.value)}
                    />
                  </div>
                </div>

                {/* 登录平台：品牌色标识胶囊 */}
                <div>
                  <p className="mb-1.5 text-[13px] font-medium text-[var(--kaypal-v3-soft-ink)]">
                    登录平台
                  </p>
                  <div className="grid grid-cols-5 gap-2">
                    {PLATFORMS.map((p) => {
                      const active = ops.loginPlatformType === p.type;
                      return (
                        <button
                          key={p.type}
                          type="button"
                          className={`flex flex-col items-center gap-1.5 rounded-[12px] border px-1 py-2.5 text-[13px] font-semibold transition disabled:opacity-50 ${
                            active
                              ? "border-transparent"
                              : "border-[var(--kaypal-v3-border)] text-[var(--kaypal-v3-soft-ink)] hover:border-[var(--kaypal-v3-border-strong)] hover:bg-[var(--kaypal-v3-hover,rgba(114,46,209,0.06))]"
                          }`}
                          style={
                            active
                              ? {
                                  background: `${p.brand}2b`,
                                  boxShadow: `0 0 0 2px ${p.brand}66, 0 4px 10px -4px ${p.brand}59`,
                                  color: p.brand,
                                }
                              : undefined
                          }
                          disabled={ops.loginConnecting}
                          onClick={() => ops.setLoginPlatformType(p.type)}
                        >
                          <span
                            className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full"
                            style={{
                              background: active ? p.brand : `${p.brand}99`,
                              boxShadow: active
                                ? `0 2px 6px -1px ${p.brand}99`
                                : undefined,
                            }}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              alt={p.label}
                              src={p.logo}
                              className="h-[18px] w-[18px] object-contain"
                              draggable={false}
                            />
                          </span>
                          <span>{p.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 登录状态区 */}
                {ops.loginPhase !== "idle" && (
                  <div className="flex flex-col items-center gap-3 overflow-hidden rounded-[var(--kaypal-v3-radius)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-surface-soft, var(--kaypal-v3-field-bg))] p-5 text-center">
                    {ops.loginPhase === "connecting" && (
                      <div className="flex flex-col items-center gap-3 py-3">
                        <Loader2 className="h-6 w-6 animate-spin text-[var(--kaypal-v3-accent)]" />
                        <p className="text-sm text-[var(--kaypal-v3-muted)]">
                          正在建立本地登录通道…
                        </p>
                      </div>
                    )}

                    {ops.loginPhase === "qr" && ops.loginQrCode && (
                      <div className="flex flex-col items-center gap-3">
                        <p className="text-sm font-medium text-[var(--kaypal-v3-soft-ink)]">
                          请使用对应平台 APP 扫码登录
                        </p>
                        <div className="rounded-[14px] border border-[var(--kaypal-v3-border)] bg-white p-3 shadow-sm">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            alt="登录二维码"
                            className="h-48 w-48 rounded-lg"
                            src={ops.loginQrCode}
                          />
                        </div>
                        <p className="flex items-center gap-1.5 text-xs text-[var(--kaypal-v3-muted)]">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          {ops.loginStatus || "扫码后稍等片刻，系统会自动识别登录结果"}
                        </p>
                      </div>
                    )}

                    {ops.loginPhase === "manual" && (
                      <div className="flex flex-col items-center gap-2 py-2">
                        <LogIn className="h-6 w-6 text-[var(--kaypal-v3-amber)]" />
                        <p className="text-sm font-medium text-[var(--kaypal-v3-amber)]">
                          {ops.loginStatus || "请在打开的浏览器页面中完成登录"}
                        </p>
                        <p className="text-xs text-[var(--kaypal-v3-muted)]">
                          完成后无需操作，系统会自动识别并同步账号
                        </p>
                      </div>
                    )}

                    {ops.loginPhase === "detecting" && (
                      <div className="flex flex-col items-center gap-2 py-2">
                        <CheckCircle2 className="h-6 w-6 text-[var(--kaypal-v3-success)]" />
                        <p className="text-sm font-medium text-[var(--kaypal-v3-success)]">
                          已检测到登录，正在同步账号…
                        </p>
                      </div>
                    )}

                    {ops.loginPhase === "reconnecting" && (
                      <div className="flex flex-col items-center gap-3 py-1">
                        <p className="text-sm text-[var(--kaypal-v3-amber)]">
                          {ops.loginError || "连接不稳定，正在确认登录状态…"}
                        </p>
                        <V2GhostButton
                          icon={RefreshCw}
                          onClick={() => void ops.checkLoginNow()}
                        >
                          我已登录，同步状态
                        </V2GhostButton>
                      </div>
                    )}

                    {ops.loginPhase === "failed" && (
                      <div className="flex flex-col items-center gap-3 py-1">
                        <p className="text-sm text-[var(--kaypal-v3-danger)]">
                          {ops.loginError || "绑定失败，请稍后重试"}
                        </p>
                        <V2GhostButton
                          icon={RefreshCw}
                          onClick={() => void ops.checkLoginNow()}
                        >
                          我已登录，同步状态
                        </V2GhostButton>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-6 flex justify-end gap-2">
                <V2GhostButton
                  onClick={() => ops.cancelLogin(true).catch(() => undefined)}
                >
                  取消
                </V2GhostButton>
                <V2PrimaryButton
                  loading={ops.loginConnecting}
                  disabled={ops.loginConnecting}
                  onClick={ops.startLogin}
                >
                  开始登录
                </V2PrimaryButton>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 删除确认 */}
      <RiskConfirmationDialog
        checklist={[
          "确认该账号不在发布任务、互动任务或自动化任务中使用。",
          "删除后会移除本机账号记录和登录文件，需要重新绑定才能恢复。",
        ]}
        confirmLabel="确认删除"
        description="删除平台账号会影响发布、互动和登录态检查。"
        impactItems={[
          { label: "平台", value: ops.accountToDelete?.platform || "-" },
          {
            label: "账号",
            value:
              ops.accountToDelete?.profileName ||
              ops.accountToDelete?.userName ||
              (ops.accountToDelete ? `账号 ${ops.accountToDelete.id}` : "-"),
          },
          { label: "操作结果", value: "移除本机账号记录和登录文件" },
        ]}
        isLoading={ops.deleting}
        isOpen={Boolean(ops.accountToDelete)}
        riskLevel="high"
        title="确认删除账号"
        onCancel={() => ops.setAccountToDelete(null)}
        onConfirm={ops.handleDeleteAccount}
      />
    </V2Section>
    </div>
  );
}
