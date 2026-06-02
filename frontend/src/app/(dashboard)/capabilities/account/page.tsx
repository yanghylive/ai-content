"use client";

import React from "react";
import { Card, CardBody, Chip, Spinner } from "@heroui/react";
import { SimpleFeaturePage } from "../../agent-workbench/agent-workbench-client";
import { kaypalApi, type KaypalProfile, type KaypalDevice, type KaypalSubscription } from "@/lib/api/auth";

function KaypalAccountSections() {
    const [profile, setProfile] = React.useState<KaypalProfile | null>(null);
    const [devices, setDevices] = React.useState<KaypalDevice[] | null>(null);
    const [subscription, setSubscription] = React.useState<KaypalSubscription | null>(null);
    const [loading, setLoading] = React.useState(true);

    React.useEffect(() => {
        Promise.all([
            kaypalApi.profile().catch(() => null),
            kaypalApi.devices().catch(() => null),
            kaypalApi.subscription().catch(() => null),
        ]).then(([p, d, s]) => {
            setProfile(p);
            setDevices(d);
            setSubscription(s);
            setLoading(false);
        });
    }, []);

    if (loading) {
        return (
            <div className="flex items-center gap-2 py-6 justify-center">
                <Spinner size="sm" />
                <span className="text-small text-default-500">加载 Kaypal 信息...</span>
            </div>
        );
    }

    const planColor = (plan: string): "default" | "primary" | "secondary" | "success" | "warning" | "danger" => {
        if (plan === "PRO" || plan === "ENTERPRISE") return "primary";
        if (plan === "FREE") return "default";
        return "secondary";
    };

    return (
        <div className="grid gap-4 md:grid-cols-3">
            <Card className="border-small border-divider bg-background shadow-sm">
                <CardBody>
                    <p className="text-small font-semibold text-default-800">套餐与权限</p>
                    {profile ? (
                        <div className="mt-3 space-y-2">
                            <div className="flex items-center gap-2">
                                <span className="text-tiny text-default-500">套餐</span>
                                <Chip color={planColor(profile.subscriptionPlan)} size="sm" variant="flat">
                                    {profile.subscriptionPlan}
                                </Chip>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-tiny text-default-500">角色</span>
                                <span className="text-small text-default-700">{profile.role}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-tiny text-default-500">平台角色</span>
                                <span className="text-small text-default-700">{profile.platformRole}</span>
                            </div>
                            {profile.permissions?.length > 0 ? (
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
                                <div className="mt-2 rounded-medium border-small border-danger-200 bg-danger-50 px-3 py-2">
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
