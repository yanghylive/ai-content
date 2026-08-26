"use client";

import React from "react";
import {
  Button, Card, CardBody, Chip, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Spinner, useDisclosure,
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
import { SkeletonList, SkeletonText, SkeletonCard, SkeletonLine, SkeletonCircle } from "@/components/skeleton";

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
      setSuccess("Kaypal 账号已连接。");
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
            连接 Kaypal 账号
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

  const planColor = (
    plan: string,
  ): "default" | "primary" | "secondary" | "success" | "warning" | "danger" => {
    const normalizedPlan = plan.toUpperCase();
    if (
      normalizedPlan === "PRO" ||
      normalizedPlan === "ENTERPRISE" ||
      normalizedPlan === "ADVANCED"
    )
      return "primary";
    if (normalizedPlan === "FREE") return "default";
    return "secondary";
  };
  const syncedPlan =
    profile?.subscriptionPlan || subscription?.plan || getBillingPlan(billing);
  return (
    <div className="grid gap-4">
      <Card className="border-small border-divider bg-content1 shadow-sm">
        <CardBody className="flex flex-wrap items-center justify-between gap-2 py-2">
          <div className="flex flex-wrap items-center gap-2 text-tiny text-default-600">
            <Chip size="sm" color="success" variant="flat">
              Kaypal 已连接
            </Chip>
            {profile?.email ? (
              <span className="break-all">账号：{profile.email}</span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {unlinkError ? (
              <span className="text-tiny text-danger">{unlinkError}</span>
            ) : null}
            <Button
              as="a"
              href="/login?reauth=1&next=%2Fcapabilities%2Faccount"
              size="sm"
              variant="flat"
            >
              重新连接
            </Button>
            <Button
              size="sm"
              variant="flat"
              color="danger"
              onPress={() => {
                setUnlinkError(null);
                unlinkModal.onOpen();
              }}
            >
              断开连接
            </Button>
          </div>
        </CardBody>
      </Card>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="border-small border-divider bg-background shadow-sm">
          <CardBody>
            <p className="text-small font-semibold text-default-800">
              套餐与权限
            </p>
            {profile ? (
              <div className="mt-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-tiny text-default-500">套餐</span>
                  <Chip
                    color={planColor(syncedPlan ?? "")}
                    size="sm"
                    variant="flat"
                  >
                    {formatPlan(syncedPlan)}
                  </Chip>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-tiny text-default-500">使用权限</span>
                  <span className="text-small text-default-700">
                    {profile.platformRoleName || formatAccountRole(profile.role)}
                  </span>
                </div>
                {profile.permissions && profile.permissions.length > 0 ? (
                  <p className="pt-1 text-tiny text-default-500">
                    已同步 {profile.permissions.length} 项账号权限
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="mt-2 text-small text-default-400">
                无法获取账号信息
              </p>
            )}
          </CardBody>
        </Card>
        <Card className="border-small border-divider bg-background shadow-sm">
          <CardBody>
            <p className="text-small font-semibold text-default-800">
              积分余额
            </p>
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-2xl font-semibold text-default-900">
                  {formatCredits(billing?.balance?.balance)}
                </span>
                <Chip
                  color={
                    billing?.balance?.balance != null ? "success" : "default"
                  }
                  size="sm"
                  variant="flat"
                >
                  {billing?.balance?.balance != null ? "已更新" : "读取中"}
                </Chip>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  color="primary"
                  variant="flat"
                  onPress={() => {
                    window.open(
                      "https://kaypal.cn/zh-CN/dashboard/billing/topup",
                      "_blank",
                      "noopener,noreferrer",
                    );
                  }}
                >
                  充值积分
                </Button>
                <Button
                  size="sm"
                  variant="bordered"
                  className="border-[var(--kaypal-v3-border)] text-[var(--kaypal-v3-soft-ink)] hover:bg-[var(--kaypal-v3-paper-soft)]"
                  onPress={() => setReloadKey((k) => k + 1)}
                >
                  刷新余额
                </Button>
              </div>
              {billing?.balance?.message ? (
                <p className="text-tiny text-default-500">
                  {commercialDisplayText(
                    billing.balance.message,
                    "余额已从当前账号更新。",
                  )}
                </p>
              ) : (
                <p className="text-tiny text-default-500">
                  余额来自当前 Kaypal 账号
                </p>
              )}
            </div>
          </CardBody>
        </Card>
        <Card className="border-small border-divider bg-background shadow-sm">
          <CardBody>
            <p className="text-small font-semibold text-default-800">
              订阅状态
            </p>
            {subscription ? (
              <div className="mt-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-tiny text-default-500">计划</span>
                  <Chip
                    color={planColor(subscription.plan)}
                    size="sm"
                    variant="flat"
                  >
                    {formatPlan(subscription.plan)}
                  </Chip>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-tiny text-default-500">到期时间</span>
                  <span className="text-small text-default-700">
                    {subscription.periodEnd
                      ? new Date(subscription.periodEnd).toLocaleDateString()
                      : "-"}
                  </span>
                </div>
                {subscription.expired ? (
                  <div className="mt-2 rounded-[8px] border-small border-danger-200 bg-danger-50 px-3 py-2">
                    <p className="text-small text-danger-600 font-semibold">
                      套餐已过期，请续费
                    </p>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="mt-2 text-small text-default-400">
                无法获取订阅信息
              </p>
            )}
          </CardBody>
        </Card>
        <Card className="border-small border-divider bg-background shadow-sm">
          <CardBody>
            <p className="text-small font-semibold text-default-800">
              设备列表
            </p>
            {devices && devices.length > 0 ? (
              <div className="mt-3 space-y-2">
                {devices.map((device) => (
                  <div
                    key={device.id}
                    className="min-w-0 rounded-small border-small border-divider bg-default-50 p-2"
                  >
                    <div className="flex min-w-0 items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-small font-medium text-default-800">
                        {device.name}
                      </span>
                      <Chip
                        color={
                          device.status === "online" ? "success" : "default"
                        }
                        size="sm"
                        variant="flat"
                      >
                        {formatDeviceStatus(device.status)}
                      </Chip>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-tiny text-default-500">
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
              <p className="mt-2 text-small text-default-400">暂无绑定设备</p>
            )}
          </CardBody>
        </Card>
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
                确认断开 Kaypal 账号
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
