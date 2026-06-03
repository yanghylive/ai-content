"use client";

import React from "react";
import {
  Button,
  Card,
  CardBody,
  Chip,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Spinner,
  useDisclosure,
} from "@heroui/react";
import { SimpleFeaturePage } from "../../agent-workbench/agent-workbench-client";
import { kaypalApi, type KaypalProfile, type KaypalDevice, type KaypalSubscription } from "@/lib/api/auth";

function KaypalLinkPanel({ onLinked }: { onLinked: () => void }) {
    const [mode, setMode] = React.useState<"credentials" | "userId">(
        "credentials",
    );
    const [identifier, setIdentifier] = React.useState("");
    const [password, setPassword] = React.useState("");
    const [kaypalUserId, setKaypalUserId] = React.useState("");
    const [submitting, setSubmitting] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [success, setSuccess] = React.useState<string | null>(null);

    const handleBindByCredentials = async () => {
        if (!identifier.trim() || !password) {
            setError("请输入 Kaypal 邮箱/手机号和密码");
            return;
        }
        try {
            setSubmitting(true);
            setError(null);
            setSuccess(null);
            const result = await kaypalApi.bindWithCredentials(
                identifier.trim(),
                password,
            );
            setSuccess(
                `已绑定 Kaypal 账号（${result.email || result.kaypalUserId}）。`,
            );
            setIdentifier("");
            setPassword("");
            onLinked();
        } catch (err) {
            setError(err instanceof Error ? err.message : "绑定失败");
        } finally {
            setSubmitting(false);
        }
    };

    const handleBindByUserId = async () => {
        if (!kaypalUserId.trim()) {
            setError("请输入 Kaypal userId");
            return;
        }
        try {
            setSubmitting(true);
            setError(null);
            setSuccess(null);
            const result = await kaypalApi.linkKaypalAccount(kaypalUserId.trim());
            setSuccess(`已绑定 Kaypal 账号（${result.kaypalUserId}）。`);
            setKaypalUserId("");
            onLinked();
        } catch (err) {
            setError(err instanceof Error ? err.message : "绑定失败");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Card className="border-small border-warning-200 bg-warning-50/40">
            <CardBody className="gap-3 py-3">
                <div className="flex items-center justify-between gap-2">
                    <p className="text-tiny uppercase tracking-wider text-warning-700">
                      绑定 Kaypal 账号
                    </p>
                    <div className="flex gap-1 text-tiny">
                        <Button
                            size="sm"
                            variant={mode === "credentials" ? "solid" : "light"}
                            color={mode === "credentials" ? "primary" : "default"}
                            onPress={() => setMode("credentials")}
                        >
                            用账号密码
                        </Button>
                        <Button
                            size="sm"
                            variant={mode === "userId" ? "solid" : "light"}
                            color={mode === "userId" ? "primary" : "default"}
                            onPress={() => setMode("userId")}
                        >
                            手填 userId
                        </Button>
                    </div>
                </div>
                <p className="text-small text-default-600">
                  当前本地账号未绑定 Kaypal userId，无法读取套餐、设备、订阅等云端信息。
                </p>
                {mode === "credentials" ? (
                    <div className="flex flex-wrap items-center gap-2">
                        <Input
                            size="sm"
                            value={identifier}
                            onValueChange={setIdentifier}
                            placeholder="Kaypal 邮箱或手机号"
                            className="min-w-[220px]"
                            isDisabled={submitting}
                            autoComplete="username"
                        />
                        <Input
                            size="sm"
                            value={password}
                            onValueChange={setPassword}
                            placeholder="Kaypal 密码"
                            type="password"
                            className="min-w-[200px]"
                            isDisabled={submitting}
                            autoComplete="current-password"
                        />
                        <Button
                            size="sm"
                            color="primary"
                            isLoading={submitting}
                            onPress={handleBindByCredentials}
                        >
                            登录并绑定
                        </Button>
                    </div>
                ) : (
                    <div className="flex flex-wrap items-center gap-2">
                        <Input
                            size="sm"
                            value={kaypalUserId}
                            onValueChange={setKaypalUserId}
                            placeholder="Kaypal userId（云端 cu id）"
                            className="min-w-[260px]"
                            isDisabled={submitting}
                        />
                        <Button
                            size="sm"
                            color="primary"
                            isLoading={submitting}
                            onPress={handleBindByUserId}
                        >
                            绑定
                        </Button>
                    </div>
                )}
                {error ? (
                    <p className="text-tiny text-danger">{error}</p>
                ) : null}
                {success ? (
                    <p className="text-tiny text-success">{success}</p>
                ) : null}
            </CardBody>
        </Card>
    );
}

function KaypalAccountSections() {
    const [profile, setProfile] = React.useState<KaypalProfile | null>(null);
    const [devices, setDevices] = React.useState<KaypalDevice[] | null>(null);
    const [subscription, setSubscription] = React.useState<KaypalSubscription | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [needsLink, setNeedsLink] = React.useState(false);
    const [forceLinkPanel, setForceLinkPanel] = React.useState(false);
    const [reloadKey, setReloadKey] = React.useState(0);
    const [unlinking, setUnlinking] = React.useState(false);
    const [unlinkError, setUnlinkError] = React.useState<string | null>(null);
    const unlinkModal = useDisclosure();

    React.useEffect(() => {
        let alive = true;
        setLoading(true);
        Promise.all([
            kaypalApi.profile().catch((err) => {
                const msg = err instanceof Error ? err.message : String(err || "");
                if (alive && /未绑定|未登录|unauthorized/i.test(msg)) {
                    setNeedsLink(true);
                }
                return null;
            }),
            kaypalApi.devices().catch(() => null),
            kaypalApi.subscription().catch(() => null),
        ]).then(([p, d, s]) => {
            if (!alive) return;
            setProfile(p);
            setDevices(d);
            setSubscription(s);
            if (p) setNeedsLink(false);
            setLoading(false);
        });
        return () => {
            alive = false;
        };
    }, [reloadKey]);

    if (loading) {
        return (
            <div className="flex items-center gap-2 py-6 justify-center">
                <Spinner size="sm" />
                <span className="text-small text-default-500">加载 Kaypal 信息...</span>
            </div>
        );
    }

    if (needsLink || forceLinkPanel) {
        return (
            <div className="grid gap-4">
                <KaypalLinkPanel onLinked={() => {
                    setForceLinkPanel(false);
                    setReloadKey((k) => k + 1);
                }} />
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
            setNeedsLink(true);
            unlinkModal.onClose();
        } catch (err) {
            setUnlinkError(err instanceof Error ? err.message : "解绑失败");
        } finally {
            setUnlinking(false);
        }
    };

    const planColor = (plan: string): "default" | "primary" | "secondary" | "success" | "warning" | "danger" => {
        if (plan === "PRO" || plan === "ENTERPRISE") return "primary";
        if (plan === "FREE") return "default";
        return "secondary";
    };

    return (
        <div className="grid gap-4">
            <Card className="border-small border-divider bg-content1/60 shadow-sm">
                <CardBody className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="flex flex-wrap items-center gap-2 text-tiny text-default-600">
                        <Chip size="sm" color="success" variant="flat">Kaypal 已绑定</Chip>
                        {profile?.email ? (
                            <span>账号：{profile.email}</span>
                        ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                        {unlinkError ? (
                            <span className="text-tiny text-danger">{unlinkError}</span>
                        ) : null}
                        <Button
                            size="sm"
                            variant="flat"
                            onPress={() => setForceLinkPanel(true)}
                        >
                            重新绑定
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
                            解绑
                        </Button>
                    </div>
                </CardBody>
            </Card>
            <div className="grid gap-4 md:grid-cols-3">
            <Card className="border-small border-divider bg-background shadow-sm">
                <CardBody>
                    <p className="text-small font-semibold text-default-800">套餐与权限</p>
                    {profile ? (
                        <div className="mt-3 space-y-2">
                            <div className="flex items-center gap-2">
                                <span className="text-tiny text-default-500">套餐</span>
                                <Chip color={planColor(profile.subscriptionPlan ?? "")} size="sm" variant="flat">
                                    {profile.subscriptionPlan || "未配置"}
                                </Chip>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-tiny text-default-500">角色</span>
                                <span className="text-small text-default-700">{profile.role || "-"}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-tiny text-default-500">平台角色</span>
                                <span className="text-small text-default-700">{profile.platformRole || profile.platformRoleName || "-"}</span>
                            </div>
                            {profile.permissions && profile.permissions.length > 0 ? (
                                <div className="flex flex-wrap gap-1 pt-1">
                                    {profile.permissions.map((perm) => (
                                        <Chip key={perm} size="sm" variant="bordered">
                                            {perm}
                                        </Chip>
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    ) : (
                        <p className="mt-2 text-small text-default-400">无法获取账号信息</p>
                    )}
                </CardBody>
            </Card>

            <Card className="border-small border-divider bg-background shadow-sm">
                <CardBody>
                    <p className="text-small font-semibold text-default-800">订阅状态</p>
                    {subscription ? (
                        <div className="mt-3 space-y-2">
                            <div className="flex items-center gap-2">
                                <span className="text-tiny text-default-500">计划</span>
                                <Chip color={planColor(subscription.plan)} size="sm" variant="flat">
                                    {subscription.plan}
                                </Chip>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-tiny text-default-500">到期时间</span>
                                <span className="text-small text-default-700">
                                    {subscription.periodEnd ? new Date(subscription.periodEnd).toLocaleDateString() : "-"}
                                </span>
                            </div>
                            {subscription.expired ? (
                                <div className="mt-2 rounded-[10px] border-small border-danger-200 bg-danger-50 px-3 py-2">
                                    <p className="text-small text-danger-600 font-semibold">套餐已过期，请续费</p>
                                </div>
                            ) : null}
                        </div>
                    ) : (
                        <p className="mt-2 text-small text-default-400">无法获取订阅信息</p>
                    )}
                </CardBody>
            </Card>

            <Card className="border-small border-divider bg-background shadow-sm">
                <CardBody>
                    <p className="text-small font-semibold text-default-800">设备列表</p>
                    {devices && devices.length > 0 ? (
                        <div className="mt-3 space-y-2">
                            {devices.map((device) => (
                                <div key={device.id} className="rounded-small border-small border-divider bg-default-50 p-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-small font-medium text-default-800">{device.name}</span>
                                        <Chip
                                            color={device.status === "online" ? "success" : "default"}
                                            size="sm"
                                            variant="flat"
                                        >
                                            {device.status}
                                        </Chip>
                                    </div>
                                    <div className="mt-1 flex items-center gap-3 text-tiny text-default-500">
                                        <span>{device.platform}</span>
                                        <span>
                                            最后在线：{device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : "-"}
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
                                确认解绑 Kaypal 账号
                            </ModalHeader>
                            <ModalBody>
                                <p className="text-small text-default-600">
                                    解绑后将无法读取套餐、设备、订阅等云端信息。
                                    后续仍可重新绑定。
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
                                    确认解绑
                                </Button>
                            </ModalFooter>
                        </>
                    )}
                </ModalContent>
            </Modal>
        </div>
    );
}

export default function Page() {
    return (
        <SimpleFeaturePage
            title="Kaypal账号与设备"
            description="查看账号、订阅套餐和设备绑定关系。"
            icon="solar:devices-linear"
            capabilityKey="browser-control"
            localEngineTab="browser"
            primaryAction={{ label: "检查账号", href: "/local-engine?tab=browser", icon: "solar:user-check-linear" }}
            items={[
                "使用线上 Kaypal 账号体系登录，不在本机保存主账号密码。",
                "展示当前设备授权、套餐权限和服务连接状态。",
                "管理本机执行令牌、设备名称、最近心跳和可用能力。",
                "账号过期或设备不在线时，阻止真实发布和发送动作。",
            ]}
        >
            <KaypalAccountSections />
        </SimpleFeaturePage>
    );
}
