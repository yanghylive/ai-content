"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ExternalLink,
  KeyRound,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserCheck,
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
import { useAccountOperations } from "./use-account-operations";
import {
  accountIdentityKey,
  accountRowKey,
  cdpSessionChip,
  findAccountCdpSession,
} from "./account-utils";

const PLATFORMS = [
  { type: 3, label: "抖音" },
  { type: 1, label: "小红书" },
  { type: 2, label: "视频号" },
  { type: 4, label: "快手" },
  { type: 5, label: "B站" },
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
    <V2Section
      title="平台账号"
      description="账号、登录状态和平台后台统一在这里管理"
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
            发布 API 账号
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
                      <V2StatusChip tone="accent">{account.platform}</V2StatusChip>
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => {
            if (!ops.loginConnecting) ops.cancelLogin(true).catch(() => undefined);
          }}
        >
          <div
            className="kaypal-v3-panel w-full max-w-md p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-[var(--kaypal-v3-ink)]">
              {ops.loginRecord ? "重新登录平台账号" : "绑定平台账号"}
            </h2>

            <div className="mt-4 flex flex-col gap-3">
              <div>
                <p className="mb-1 text-sm text-[var(--kaypal-v3-muted)]">
                  账号主体
                </p>
                <input
                  className="h-10 w-full rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-field-border)] bg-[var(--kaypal-v3-field-bg)] px-3 text-sm text-[var(--kaypal-v3-ink)] outline-none disabled:opacity-50"
                  placeholder="例如：矩阵账号01"
                  disabled={ops.loginConnecting}
                  value={ops.loginProfileName}
                  onChange={(e) => ops.setLoginProfileName(e.target.value)}
                />
              </div>

              <div>
                <p className="mb-1 text-sm text-[var(--kaypal-v3-muted)]">
                  登录平台
                </p>
                <div className="flex flex-wrap gap-2">
                  {PLATFORMS.map((p) => (
                    <button
                      key={p.type}
                      type="button"
                      className={`rounded-full border px-3 py-1 text-sm font-medium transition ${
                        ops.loginPlatformType === p.type
                          ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]"
                          : "border-[var(--kaypal-v3-border)] text-[var(--kaypal-v3-soft-ink)]"
                      }`}
                      disabled={ops.loginConnecting}
                      onClick={() => ops.setLoginPlatformType(p.type)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {ops.loginConnecting || ops.loginQrCode || ops.loginStatus ? (
                <div className="flex flex-col items-center gap-3 rounded-[var(--kaypal-v3-radius)] border border-[var(--kaypal-v3-border)] p-4">
                  {ops.loginQrCode && !ops.loginStatus ? (
                    <>
                      <p className="text-sm text-[var(--kaypal-v3-muted)]">
                        请使用对应平台 APP 扫码登录
                      </p>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        alt="登录二维码"
                        className="h-48 w-48 rounded-lg"
                        src={ops.loginQrCode}
                      />
                    </>
                  ) : !ops.loginQrCode && !ops.loginStatus ? (
                    <p className="py-6 text-sm text-[var(--kaypal-v3-muted)]">
                      正在获取登录二维码...
                    </p>
                  ) : null}
                  {ops.loginStatus === "manual" && (
                    <p className="text-sm text-[var(--kaypal-v3-amber)]">
                      请在打开的登录页中手动完成登录
                    </p>
                  )}
                  {ops.loginStatus === "500" && (
                    <p className="text-sm text-[var(--kaypal-v3-danger)]">
                      {ops.loginError || "绑定失败，请稍后重试"}
                    </p>
                  )}
                </div>
              ) : null}
            </div>

            <div className="mt-5 flex justify-end gap-2">
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
  );
}
