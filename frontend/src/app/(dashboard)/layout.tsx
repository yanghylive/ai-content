"use client";

import React from "react";
import { Avatar, Button, ScrollShadow, Spacer, Spinner, Tooltip, cn } from "@heroui/react";
import { ChevronDown, LogOut } from "lucide-react";
import { useMediaQuery } from "usehooks-ts";
import Sidebar from "@/components/application/sidebars/Sidebar Responsive/ts/sidebar";
import { sectionItems } from "./sidebar-items";
import { ThemeToggle } from "@/components/ThemeToggle";
import { usePathname, useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { authApi, kaypalApi, type AuthUser, type KaypalBillingSnapshot, type KaypalProfile, type KaypalSubscription } from "@/lib/api/auth";
import { ElectronUpdateBanner } from "@/components/electron-update-banner";

const AUTH_PENDING_KEY = "ai-content-auth-pending";

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function formatPlanLabel(value?: string | null) {
    const normalized = String(value || "").trim();
    if (!normalized) return "需登录";
    const labels: Record<string, string> = {
        FREE: "免费版",
        PRO: "专业版",
        ADVANCED: "高级版",
        ENTERPRISE: "企业版",
    };
    return labels[normalized.toUpperCase()] || normalized;
}

function formatCredits(value: number | null | undefined) {
    if (typeof value !== "number" || !Number.isFinite(value)) return "未同步";
    return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
}

function getBillingPlan(billing: KaypalBillingSnapshot | null) {
    const raw = billing?.subscription;
    const record = asRecord(raw);
    if (!record) return null;
    const data = asRecord(record.data) || record;
    const subscription = asRecord(data.subscription) || data;
    const plan = subscription.plan;
    if (typeof plan === "string") return plan;
    const planRecord = asRecord(plan);
    if (planRecord) {
        return String(planRecord.legacyId || planRecord.code || planRecord.name || "").trim() || null;
    }
    const subscriptionPlan = subscription.subscriptionPlan;
    return typeof subscriptionPlan === "string" ? subscriptionPlan : null;
}

function hasKaypalDesktopSession(user: AuthUser | null | undefined) {
    return Boolean(user?.kaypalUserId && (user.kaypalDesktopAccessToken || user.kaypalDesktopRefreshToken));
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
    const isCompact = useMediaQuery("(max-width: 768px)", { initializeWithValue: false });
    const pathname = usePathname();
    const router = useRouter();
    const [mounted, setMounted] = React.useState(false);
    const [authLoading, setAuthLoading] = React.useState(true);
    const [loggingOut, setLoggingOut] = React.useState(false);
    const [currentUser, setCurrentUser] = React.useState<AuthUser | null>(null);
    const [kaypalProfile, setKaypalProfile] = React.useState<KaypalProfile | null>(null);
    const [kaypalSubscription, setKaypalSubscription] = React.useState<KaypalSubscription | null>(null);
    const [kaypalBilling, setKaypalBilling] = React.useState<KaypalBillingSnapshot | null>(null);
    const [kaypalSyncRequired, setKaypalSyncRequired] = React.useState(false);
    const [showAccountMenu, setShowAccountMenu] = React.useState(false);
    const selectedKeys = React.useMemo(() => [pathname], [pathname]);

    React.useEffect(() => {
        setMounted(true);
    }, []);

    React.useEffect(() => {
        let active = true;

        const hasRecentAuthPending = () => {
            if (typeof window === "undefined") {
                return false;
            }

            const pendingAt = Number(window.sessionStorage.getItem(AUTH_PENDING_KEY) || "0");
            if (!pendingAt) {
                return false;
            }

            return Date.now() - pendingAt < 10000;
        };

        const clearAuthPending = () => {
            if (typeof window === "undefined") {
                return;
            }

            window.sessionStorage.removeItem(AUTH_PENDING_KEY);
        };

        const wait = (ms: number) =>
            new Promise((resolve) => {
                window.setTimeout(resolve, ms);
            });

        const fetchCurrentUser = async () => {
            const attempts = hasRecentAuthPending() ? [0, 250, 500, 1000, 1500] : [0, 250];

            for (const delay of attempts) {
                if (delay > 0) {
                    await wait(delay);
                }

                try {
                    const user = await authApi.me();
                    if (hasKaypalDesktopSession(user)) {
                        clearAuthPending();
                        return user;
                    }
                } catch {
                    // 继续重试，直到耗尽次数
                }
            }

            clearAuthPending();
            throw new Error("auth-check-failed");
        };

        const ensureAuth = async () => {
            try {
                const user = await fetchCurrentUser();
                if (!active) {
                    return;
                }
                setCurrentUser(user);
            } catch {
                if (!active) {
                    return;
                }
                const next = pathname ? `?next=${encodeURIComponent(pathname)}` : "";
                router.replace(`/login${next}`);
                return;
            } finally {
                if (active) {
                    setAuthLoading(false);
                }
            }
        };

        ensureAuth();

        return () => {
            active = false;
        };
    }, [pathname, router]);

    React.useEffect(() => {
        let active = true;
        if (!currentUser) {
            setKaypalProfile(null);
            setKaypalSubscription(null);
            setKaypalBilling(null);
            setKaypalSyncRequired(false);
            return () => {
                active = false;
            };
        }

        Promise.all([
            kaypalApi.profile().then((value) => ({ value, error: null })).catch((error) => ({ value: null, error })),
            kaypalApi.subscription().then((value) => ({ value, error: null })).catch((error) => ({ value: null, error })),
            kaypalApi.billing().then((value) => ({ value, error: null })).catch((error) => ({ value: null, error })),
        ]).then(([profile, subscription, billing]) => {
            if (!active) return;
            setKaypalProfile(profile.value);
            setKaypalSubscription(subscription.value);
            setKaypalBilling(billing.value);
            const errors = [profile.error, subscription.error, billing.error]
                .map((error) => error instanceof Error ? error.message : String(error || ""))
                .join(" ");
            setKaypalSyncRequired(/授权|过期|失效|未登录|unauthorized|401/i.test(errors));
        });

        return () => {
            active = false;
        };
    }, [currentUser]);

    const handleLogout = async () => {
        try {
            setLoggingOut(true);
            await authApi.logout();
            toast.success("已退出登录");
        } catch {
            toast.error("退出失败，请稍后重试");
        } finally {
            setLoggingOut(false);
            router.replace("/login");
            router.refresh();
        }
    };
    const displayName = kaypalProfile?.displayName || currentUser?.name || currentUser?.username || "当前用户";
    const displayAccount = kaypalProfile?.email || currentUser?.email || currentUser?.username || "JIUZHANG AI 账号";
    const planLabel = kaypalSyncRequired
        ? "需登录"
        : formatPlanLabel(kaypalSubscription?.plan || getBillingPlan(kaypalBilling));
    const creditLabel = kaypalSyncRequired
        ? "需登录"
        : formatCredits(kaypalBilling?.balance?.balance);

    if (authLoading) {
        return (
            <div className="flex min-h-dvh items-center justify-center bg-background">
                <div className="flex items-center gap-3 rounded-[14px] border border-divider bg-content1 px-4 py-3 shadow-sm">
                    <Spinner size="sm" />
                    <span className="text-[14px] leading-[22px] text-default-500">正在验证登录状态...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-dvh w-full">
            <div
                className={cn(
                    "relative flex h-full w-72 flex-col border-r transition-width",
                    "border-divider bg-background/70 p-5 shadow-sm backdrop-blur-[20px]",
                    {
                        "w-16 items-center px-2 py-5": isCompact,
                    }
                )}
            >
                <div
                    className={cn(
                        "flex items-center gap-3 px-2",
                        {
                            "justify-center gap-0": isCompact,
                        }
                    )}
                >
                    {/* eslint-disable-next-line @next/next/no-img-element -- Static export cannot use next/image optimization. */}
                    <img
                        alt="Kaypal"
                        className="h-9 w-9 shrink-0 rounded-[10px] object-cover shadow-sm"
                        src="/brand/kaypal-logo.png"
                    />
                    <span
                        className={cn("flex flex-col leading-tight opacity-100", {
                            "w-0 opacity-0 hidden": isCompact,
                        })}
                    >
                        <span className="text-[15px] font-bold leading-[22px] text-foreground">Kaypal</span>
                        <span className="text-[11px] font-semibold leading-4 text-default-500">内容工作台</span>
                    </span>
                </div>
                <Spacer y={6} />
                <ScrollShadow className="-mr-5 h-full max-h-full py-5 pr-5">
                    {mounted ? (
                        <Sidebar
                            isCompact={isCompact}
                            items={sectionItems}
                            defaultSelectedKey={pathname}
                            selectedKeys={selectedKeys}
                            onSelect={(key) => {
                                const target = key as string;
                                router.push(target);
                            }}
                        />
                    ) : (
                        <div className="w-full h-full" />
                    )}
                </ScrollShadow>
                <Spacer y={2} />

                <div
                    className={cn("mt-auto flex flex-col gap-2 border-t border-divider pt-3", {
                        "items-center": isCompact,
                    })}
                >
                    {isCompact ? (
                        <>
                            <Tooltip content={`${displayName} · ${creditLabel} 积分`} placement="right">
                                <Avatar isBordered className="flex-none" size="sm" name={displayName} src={kaypalProfile?.avatarUrl || undefined} />
                            </Tooltip>
                            <ThemeToggle isCompact />
                            <Tooltip content="退出登录" placement="right">
                                <Button
                                    className="h-9 w-9 min-w-9 rounded-[14px] text-default-500 data-[hover=true]:text-foreground"
                                    isIconOnly
                                    isLoading={loggingOut}
                                    onPress={handleLogout}
                                    variant="light"
                                >
                                    <LogOut aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.75} />
                                </Button>
                            </Tooltip>
                        </>
                    ) : (
                        <div className="rounded-[14px] border border-divider bg-content1/90 p-1.5 shadow-sm backdrop-blur-xl">
                            <div className="flex items-center gap-2">
                                <button
                                    className="flex min-w-0 flex-1 items-center gap-2 rounded-[10px] px-1 py-1 text-left transition-colors hover:bg-default-100"
                                    type="button"
                                    onClick={() => setShowAccountMenu((value) => !value)}
                                >
                                    <Avatar
                                        className="h-8 w-8 flex-none rounded-[10px] bg-foreground text-background"
                                        size="sm"
                                        name={displayName}
                                        src={kaypalProfile?.avatarUrl || undefined}
                                    />
                                    <span className="min-w-0 flex-1">
                                        <span className="flex min-w-0 items-center gap-1.5">
                                            <span className="truncate text-[12px] font-bold leading-4 text-foreground">{displayName}</span>
                                            <span className="flex-none rounded-full bg-success-50 px-1.5 py-0.5 text-[10px] font-semibold leading-3 text-success-700">{planLabel}</span>
                                        </span>
                                        <span className="block truncate text-[10px] leading-3 text-default-500">{displayAccount}</span>
                                    </span>
                                </button>
                                <div className="flex flex-none items-center gap-0.5">
                                    <ThemeToggle isCompact />
                                    <Tooltip content="退出登录" placement="top">
                                        <Button
                                            className="h-7 w-7 min-w-7 rounded-[8px] text-default-500 data-[hover=true]:text-danger"
                                            isIconOnly
                                            isLoading={loggingOut}
                                            onPress={handleLogout}
                                            variant="light"
                                        >
                                            <LogOut aria-hidden="true" className="h-[14px] w-[14px]" strokeWidth={1.75} />
                                        </Button>
                                    </Tooltip>
                                    <button
                                        aria-label="展开账号菜单"
                                        className="flex h-7 w-7 items-center justify-center rounded-[8px] text-default-400 transition-colors hover:bg-default-100"
                                        type="button"
                                        onClick={() => setShowAccountMenu((value) => !value)}
                                    >
                                        <ChevronDown
                                            aria-hidden="true"
                                            className={cn("h-4 w-4 transition-transform", {
                                                "rotate-180": showAccountMenu,
                                            })}
                                            strokeWidth={1.75}
                                        />
                                    </button>
                                </div>
                            </div>
                            <div className="mt-1 flex items-center justify-between gap-2 rounded-[10px] bg-success-50/70 px-2 py-1">
                                <span className="truncate text-[10px] font-semibold leading-3 text-success-700">熵能余额</span>
                                <span className="truncate text-[11px] font-bold leading-3 text-success-700">{creditLabel}</span>
                            </div>
                            {showAccountMenu ? (
                                <div className="mt-1 rounded-[12px] border border-divider bg-background/90 p-1">
                                    <Button
                                        className="h-7 w-full justify-start rounded-[9px] px-2 text-[12px] font-semibold text-default-600"
                                        onPress={() => {
                                            setShowAccountMenu(false);
                                            router.push("/capabilities/account");
                                        }}
                                        variant="light"
                                    >
                                        账号与设备
                                    </Button>
                                    <Button
                                        className="h-7 w-full justify-start rounded-[9px] px-2 text-[12px] font-semibold text-default-600"
                                        onPress={() => {
                                            setShowAccountMenu(false);
                                            router.push("/capabilities/risk");
                                        }}
                                        variant="light"
                                    >
                                        权限与额度
                                    </Button>
                                </div>
                            ) : null}
                        </div>
                    )}
                </div>
            </div>
            <div className="w-full flex-1 flex-col overflow-y-auto px-4 py-4 md:px-6 md:py-6">
                <main className="h-full w-full text-[14px] leading-[22px] text-foreground">
                    {children}
                </main>
            </div>
            <ElectronUpdateBanner />
        </div>
    );
}
