"use client";

import React from "react";
import {
  Button, Card, CardBody, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, useDisclosure,
} from "@heroui/react";
import {
  kaypalApi,
  type KaypalProfile,
  type KaypalDevice,
  type KaypalSubscription,
  type KaypalBillingSnapshot,
} from "@/lib/api/auth";
import { commercialDisplayText } from "@/lib/commercial-display-text";
import { toPublicError } from "@/lib/public-error";
import { settingsApi, type KaypalModelSyncStatus } from "@/lib/api/settings";
import {
  describeSyncError,
  isSessionAuthIssue,
} from "@/lib/kaypal-sync-error";
import { SkeletonList } from "@/components/skeleton";
import {
  Clock,
  Logout,
  Monitor,
  RefreshCcw,
  ShieldCheck,
  UserRoundCheck,
  UserRoundPlus,
  Wallet,
} from "@/components/iconpark";
import {
  V2DangerButton,
  V2GhostButton,
  V2PrimaryButton,
  V2StatusChip,
} from "@/components/v2/ui-kit";

function formatCredits(value?: number | null) {
  if (value == null) return "同步中";
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatPlan(value?: string | null) {
  const normalized = String(value || "").trim().toUpperCase();
  const labels: Record<string, string> = {
    FREE: "免费版",
    PRO: "专业版",
    ADVANCED: "高级版",
    ENTERPRISE: "企业版",
  };
  return labels[normalized] || commercialDisplayText(value, "未配置");
}

function formatAccountRole(value?: string | null) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["admin", "administrator", "owner"].includes(normalized)) return "管理员";
  if (["member", "user"].includes(normalized)) return "成员";
  return commercialDisplayText(value, "普通成员");
}

function formatDevicePlatform(value?: string | null) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized.includes("win")) return "Windows";
  if (normalized.includes("darwin") || normalized.includes("mac")) return "macOS";
  if (normalized.includes("linux")) return "Linux";
  return commercialDisplayText(value, "当前设备");
}

function formatDeviceStatus(value?: string | null) {
  if (value === "online") return "在线";
  if (value === "offline") return "离线";
  return commercialDisplayText(value, "状态未知");
}

type AiServiceBadge = {
  tone: "success" | "danger" | "warning" | "muted";
  label: string;
};

/** AI 服务就绪徽章（与设置页 AI 服务同一语义，V2 StatusChip tone） */
function aiServiceBadge(
  state: "loading" | "ready" | "unavailable",
  configured: boolean,
  syncError: string | null,
): AiServiceBadge {
  if (state === "loading")
    return { tone: "muted", label: "AI 服务检查中" };
  if (state === "unavailable")
    return { tone: "warning", label: "AI 服务状态读取失败" };
  if (configured) return { tone: "success", label: "AI 服务已就绪" };
  if (isSessionAuthIssue(syncError))
    return { tone: "danger", label: "登录失效" };
  if (syncError) return { tone: "warning", label: "AI 服务同步未完成" };
  return { tone: "warning", label: "AI 服务待同步" };
}

function getBillingPlan(billing: KaypalBillingSnapshot | null) {
  const raw = billing?.subscription;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const data =
    record.data &&
    typeof record.data === "object" &&
    !Array.isArray(record.data)
      ? (record.data as Record<string, unknown>)
      : record;
  const subscription =
    data.subscription &&
    typeof data.subscription === "object" &&
    !Array.isArray(data.subscription)
      ? (data.subscription as Record<string, unknown>)
      : data;
  const plan = subscription.plan;
  if (typeof plan === "string") return plan;
  if (plan && typeof plan === "object" && !Array.isArray(plan)) {
    const planRecord = plan as Record<string, unknown>;
    const legacyId = planRecord.legacyId;
    const code = planRecord.code;
    if (typeof legacyId === "string") return legacyId;
    if (typeof code === "string") return code;
  }
  const subscriptionPlan = subscription.subscriptionPlan;
  return typeof subscriptionPlan === "string" ? subscriptionPlan : null;
}

function KaypalLinkPanel({ onLinked }: { onLinked: () => void }) {
  const [connectionCode, setConnectionCode] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);

  const handleBindByUserId = async () => {
    if (!connectionCode.trim()) {
      setError("请输入账号连接码");
      return;
    }
    try {
      setSubmitting(true);
      setError(null);
      setSuccess(null);
      await kaypalApi.linkKaypalAccount(connectionCode.trim());
      setSuccess("JIUZHANG AI 账号已连接。");
      setConnectionCode("");
      onLinked();
    } catch (err) {
      setError(toPublicError(err, "账号连接失败，请重新登录后再试。"));
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <Card className="border-small border-warning-200 bg-warning-50/40">
      <CardBody className="gap-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-small font-semibold text-warning-700">
            连接 JIUZHANG AI 账号
          </p>
          <Button
            size="sm"
            as="a"
            href="/login?reauth=1&next=%2Fcapabilities%2Faccount"
            variant="flat"
          >
            重新连接
          </Button>
        </div>
        <p className="text-small text-default-600">
          重新登录会自动完成连接。仅在客户支持提供连接码时手动填写。
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="账号连接码"
            size="sm"
            value={connectionCode}
            onValueChange={setConnectionCode}
            placeholder="账号连接码"
            className="min-w-0 flex-1 basis-[220px]"
            isDisabled={submitting}
          />
          <Button
            size="sm"
            color="primary"
            isLoading={submitting}
            onPress={handleBindByUserId}
          >
            连接
          </Button>
        </div>
        {error ? <p className="text-tiny text-danger">{error}</p> : null}
        {success ? <p className="text-tiny text-success">{success}</p> : null}
      </CardBody>
    </Card>
  );
}

export function KaypalAccountSections() {
  const [profile, setProfile] = React.useState<KaypalProfile | null>(null);
  const [devices, setDevices] = React.useState<KaypalDevice[] | null>(null);
  const [subscription, setSubscription] =
    React.useState<KaypalSubscription | null>(null);
  const [billing, setBilling] = React.useState<KaypalBillingSnapshot | null>(
    null,
  );
  const [loading, setLoading] = React.useState(true);
  const [needsLink, setNeedsLink] = React.useState(false);
  const [syncError, setSyncError] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [unlinking, setUnlinking] = React.useState(false);
  const [unlinkError, setUnlinkError] = React.useState<string | null>(null);
  const unlinkModal = useDisclosure();

  // 默认 AI 服务就绪状态（只读；与「设置 → AI 服务」同一数据源）
  const [aiModelStatus, setAiModelStatus] =
    React.useState<KaypalModelSyncStatus | null>(null);
  const [aiModelStatusState, setAiModelStatusState] = React.useState<
    "loading" | "ready" | "unavailable"
  >("loading");
  const [aiSyncing, setAiSyncing] = React.useState(false);
  const [aiSyncError, setAiSyncError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    settingsApi
      .getKaypalModelStatus()
      .then((status) => {
        if (!alive) return;
        setAiModelStatus(status);
        setAiSyncError(null);
        setAiModelStatusState("ready");
      })
      .catch(() => {
        if (!alive) return;
        setAiModelStatus(null);
        setAiModelStatusState("unavailable");
      });
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  /** 手动从 Kaypal 同步默认 AI 服务（仅当本地未配置/用户主动触发） */
  const handleAiSync = React.useCallback(async () => {
    setAiSyncing(true);
    setAiSyncError(null);
    try {
      const result = await settingsApi.syncKaypalModel();
      setAiModelStatus(result);
      setAiModelStatusState("ready");
    } catch (error) {
      setAiSyncError(describeSyncError(error));
    } finally {
      setAiSyncing(false);
    }
  }, []);

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    setNeedsLink(false);
    setSyncError(null);
    Promise.all([
      kaypalApi
        .profile()
        .then((value) => ({ value, error: null }))
        .catch((error) => ({ value: null, error })),
      kaypalApi
        .devices()
        .then((value) => ({ value, error: null }))
        .catch((error) => ({ value: null, error })),
      kaypalApi
        .subscription()
        .then((value) => ({ value, error: null }))
        .catch((error) => ({ value: null, error })),
      kaypalApi
        .billing()
        .then((value) => ({ value, error: null }))
        .catch((error) => ({ value: null, error })),
    ]).then(([p, d, s, b]) => {
      if (!alive) return;
      setProfile(p.value);
      setDevices(d.value);
      setSubscription(s.value);
      setBilling(b.value);
      const errors = [p.error, d.error, s.error, b.error]
        .map((err) => toPublicError(err, ""))
        .filter(Boolean);
      const authError = errors.find((msg) =>
        /未绑定|未登录|unauthorized|授权|过期|失效|401/i.test(msg),
      );
      if (authError) {
        setNeedsLink(true);
        setSyncError(authError);
      } else if (errors.length > 0) {
        setSyncError(errors[0]);
      }
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [reloadKey]);
  if (loading) {
    return (
      <div className="flex items-center gap-2 py-5 justify-center">
        <SkeletonList rows={3} />
        <span className="text-small text-default-500">加载 Kaypal 信息...</span>
      </div>
    );
  }
  if (needsLink) {
    return (
      <div className="grid gap-4">
        {syncError ? (
          <div className="rounded-[8px] border-small border-warning-200 bg-warning-50 px-3 py-2 text-small text-warning-700">
            {syncError}
          </div>
        ) : null}
        <KaypalLinkPanel
          onLinked={() => {
            setReloadKey((k) => k + 1);
          }}
        />
      </div>
    );
  }

  const handleUnlink = async () => {
    try {
      setUnlinking(true);
      setUnlinkError(null);
      await kaypalApi.unlinkKaypalAccount();
      setProfile(null);
      setDevices(null);
      setSubscription(null);
      setBilling(null);
      setSyncError(null);
      setNeedsLink(true);
      unlinkModal.onClose();
    } catch (err) {
      setUnlinkError(toPublicError(err, "账号连接未断开，请稍后重试。"));
    } finally {
      setUnlinking(false);
    }
  };

  const planTone = (
    plan: string,
  ): "success" | "warning" | "danger" | "accent" | "muted" => {
    const normalizedPlan = plan.toUpperCase();
    if (
      normalizedPlan === "PRO" ||
      normalizedPlan === "ENTERPRISE" ||
      normalizedPlan === "ADVANCED"
    )
      return "accent";
    if (normalizedPlan === "FREE") return "muted";
    return "muted";
  };
  const syncedPlan =
    profile?.subscriptionPlan || subscription?.plan || getBillingPlan(billing);
  const aiBadge = aiServiceBadge(
    aiModelStatusState,
    Boolean(aiModelStatus?.configured),
    aiSyncError,
  );
  const aiDesc =
    aiModelStatusState === "loading"
      ? "正在读取默认 AI 服务…"
      : aiModelStatusState === "unavailable"
        ? "无法读取 AI 服务状态，请稍后重试。"
        : aiModelStatus?.configured
          ? `当前默认服务：${aiModelStatus.defaultModel || "已同步"}，可直接用于内容生产。`
          : aiSyncError ||
            "尚未同步默认 AI 服务，可点击右侧按钮从 Kaypal 同步。";
  return (
    <div className="grid gap-4">
      {/* 账号连接状态（2026-09-03 V2 化）：Kaypal 账号连接信息 + 重连/断开 */}
      <section className="kaypal-v3-panel flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <V2StatusChip tone="success">
            <UserRoundCheck className="h-3.5 w-3.5" />
            Kaypal 已连接
          </V2StatusChip>
          {profile?.email ? (
            <span className="break-all text-sm text-[var(--kaypal-v3-soft-ink)]">
              账号：{profile.email}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {unlinkError ? (
            <span className="text-sm text-[var(--kaypal-v3-danger)]">
              {unlinkError}
            </span>
          ) : null}
          <V2GhostButton
            onClick={() => {
              window.location.assign(
                "/login?reauth=1&next=%2Fcapabilities%2Faccount",
              );
            }}
          >
            重新连接
          </V2GhostButton>
          <V2DangerButton
            icon={Logout}
            loading={unlinking}
            disabled={unlinking}
            onClick={() => {
              setUnlinkError(null);
              unlinkModal.onOpen();
            }}
          >
            {unlinking ? "断开中…" : "断开连接"}
          </V2DangerButton>
        </div>
      </section>
      {/* AI 服务就绪状态（2026-09-03）：本地默认 AI 服务可用性 + 内联同步 */}
      <section className="kaypal-v3-panel flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <V2StatusChip tone={aiBadge.tone}>{aiBadge.label}</V2StatusChip>
          <span
            className={
              aiSyncError
                ? "text-sm text-[var(--kaypal-v3-amber)]"
                : "text-sm text-[var(--kaypal-v3-soft-ink)]"
            }
          >
            {aiDesc}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isSessionAuthIssue(aiSyncError) ? (
            <V2PrimaryButton
              icon={UserRoundPlus}
              onClick={() => {
                window.location.assign(
                  "/login?reauth=1&next=%2Fcapabilities%2Faccount",
                );
              }}
            >
              重新登录
            </V2PrimaryButton>
          ) : null}
          {aiModelStatusState === "unavailable" ? (
            <V2GhostButton
              icon={RefreshCcw}
              onClick={() => setReloadKey((k) => k + 1)}
            >
              重试
            </V2GhostButton>
          ) : null}
          {aiModelStatusState === "ready" &&
          !aiModelStatus?.configured ? (
            <V2GhostButton
              icon={RefreshCcw}
              loading={aiSyncing}
              disabled={aiSyncing}
              onClick={() => void handleAiSync()}
            >
              {aiSyncing ? "同步中…" : "从账号同步"}
            </V2GhostButton>
          ) : null}
          {aiModelStatusState === "ready" &&
          aiModelStatus?.configured ? (
            <V2PrimaryButton onClick={() => window.location.assign("/settings/ai-service")}>
              管理
            </V2PrimaryButton>
          ) : null}
        </div>
      </section>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* 套餐与权限 */}
        <section className="kaypal-v3-panel p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--kaypal-v3-ink)]">
            <ShieldCheck className="h-4 w-4 text-[var(--kaypal-v3-accent-ink)]" />
            套餐与权限
          </div>
          {profile ? (
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--kaypal-v3-muted)]">套餐</span>
                <V2StatusChip tone={planTone(syncedPlan ?? "")}>
                  {formatPlan(syncedPlan)}
                </V2StatusChip>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--kaypal-v3-muted)]">使用权限</span>
                <span className="text-sm text-[var(--kaypal-v3-soft-ink)]">
                  {profile.platformRoleName || formatAccountRole(profile.role)}
                </span>
              </div>
              {profile.permissions && profile.permissions.length > 0 ? (
                <p className="pt-1 text-xs text-[var(--kaypal-v3-muted)]">
                  已同步 {profile.permissions.length} 项账号权限
                </p>
              ) : null}
            </div>
          ) : (
            <p className="mt-2 text-sm text-[var(--kaypal-v3-muted)]">
              无法获取账号信息
            </p>
          )}
        </section>

        {/* 积分余额 */}
        <section className="kaypal-v3-panel p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--kaypal-v3-ink)]">
            <Wallet className="h-4 w-4 text-[var(--kaypal-v3-accent-ink)]" />
            积分余额
          </div>
          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">
                {formatCredits(billing?.balance?.balance)}
              </span>
              <V2StatusChip
                tone={billing?.balance?.balance != null ? "success" : "muted"}
              >
                {billing?.balance?.balance != null ? "已更新" : "读取中"}
              </V2StatusChip>
            </div>
            <div className="flex gap-2">
              <V2PrimaryButton
                onClick={() => {
                  // 2026-09-01：不用 noopener/noreferrer 第三参（规范下 window.open
                  // 恒返回 null）；_blank 默认隐式 noopener，手动剥离 opener 保持语义。
                  const popup = window.open(
                    "https://kaypal.cn/zh-CN/dashboard/billing/topup",
                    "_blank",
                  );
                  if (popup) popup.opener = null;
                }}
              >
                充值积分
              </V2PrimaryButton>
              <V2GhostButton
                icon={RefreshCcw}
                onClick={() => setReloadKey((k) => k + 1)}
              >
                刷新余额
              </V2GhostButton>
            </div>
            {billing?.balance?.message ? (
              <p className="text-xs text-[var(--kaypal-v3-muted)]">
                {commercialDisplayText(
                  billing.balance.message,
                  "余额已从当前账号更新。",
                )}
              </p>
            ) : (
              <p className="text-xs text-[var(--kaypal-v3-muted)]">
                余额来自当前 JIUZHANG AI 账号
              </p>
            )}
          </div>
        </section>

        {/* 订阅状态 */}
        <section className="kaypal-v3-panel p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--kaypal-v3-ink)]">
            <Clock className="h-4 w-4 text-[var(--kaypal-v3-accent-ink)]" />
            订阅状态
          </div>
          {subscription ? (
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--kaypal-v3-muted)]">计划</span>
                <V2StatusChip tone={planTone(subscription.plan)}>
                  {formatPlan(subscription.plan)}
                </V2StatusChip>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--kaypal-v3-muted)]">到期时间</span>
                <span className="text-sm text-[var(--kaypal-v3-soft-ink)]">
                  {subscription.periodEnd
                    ? new Date(subscription.periodEnd).toLocaleDateString()
                    : "-"}
                </span>
              </div>
              {subscription.expired ? (
                <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] px-3 py-2">
                  <p className="text-sm font-semibold text-[var(--kaypal-v3-danger)]">
                    套餐已过期，请续费
                  </p>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="mt-2 text-sm text-[var(--kaypal-v3-muted)]">
              无法获取订阅信息
            </p>
          )}
        </section>

        {/* 设备列表 */}
        <section className="kaypal-v3-panel p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--kaypal-v3-ink)]">
            <Monitor className="h-4 w-4 text-[var(--kaypal-v3-accent-ink)]" />
            设备列表
          </div>
          {devices && devices.length > 0 ? (
            <div className="mt-3 space-y-2">
              {devices.map((device) => (
                <div
                  key={device.id}
                  className="min-w-0 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-muted)] p-2"
                >
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-medium text-[var(--kaypal-v3-ink)]">
                      {device.name}
                    </span>
                    <V2StatusChip
                      tone={device.status === "online" ? "success" : "muted"}
                    >
                      {formatDeviceStatus(device.status)}
                    </V2StatusChip>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--kaypal-v3-muted)]">
                    <span>{formatDevicePlatform(device.platform)}</span>
                    <span>
                      最后在线：
                      {device.lastSeenAt
                        ? new Date(device.lastSeenAt).toLocaleString()
                        : "-"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-[var(--kaypal-v3-muted)]">暂无绑定设备</p>
          )}
        </section>
      </div>
      <Modal
        isOpen={unlinkModal.isOpen}
        onOpenChange={unlinkModal.onOpenChange}
        placement="center"
        backdrop="opaque"
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex flex-col gap-1">
                确认断开 JIUZHANG AI 账号
              </ModalHeader>
              <ModalBody>
                <p className="text-small text-default-600">
                  断开后将无法读取套餐、设备和订阅信息，后续仍可重新连接。
                </p>
                {profile?.email ? (
                  <p className="text-tiny text-default-500">
                    当前绑定账号：{profile.email}
                  </p>
                ) : null}
                {unlinkError ? (
                  <p className="text-tiny text-danger">{unlinkError}</p>
                ) : null}
              </ModalBody>
              <ModalFooter>
                <Button
                  variant="light"
                  onPress={onClose}
                  isDisabled={unlinking}
                >
                  取消
                </Button>
                <Button
                  color="danger"
                  onPress={handleUnlink}
                  isLoading={unlinking}
                >
                  确认断开
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}
