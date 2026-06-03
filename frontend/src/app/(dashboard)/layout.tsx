"use client";

import React from "react";
import { Avatar, Button, ScrollShadow, Spacer, Spinner, Tooltip, cn } from "@heroui/react";
import { Icon } from "@iconify/react";
import { useMediaQuery } from "usehooks-ts";
import Sidebar from "@/components/application/sidebars/Sidebar Responsive/ts/sidebar";
import { sectionItems } from "./sidebar-items";
import { ThemeToggle } from "@/components/ThemeToggle";
import { usePathname, useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { authApi, type AuthUser } from "@/lib/api/auth";

const AUTH_PENDING_KEY = "ai-content-auth-pending";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
    const isCompact = useMediaQuery("(max-width: 768px)", { initializeWithValue: false });
    const pathname = usePathname();
    const router = useRouter();
    const [mounted, setMounted] = React.useState(false);
    const [authLoading, setAuthLoading] = React.useState(true);
    const [loggingOut, setLoggingOut] = React.useState(false);
    const [currentUser, setCurrentUser] = React.useState<AuthUser | null>(null);
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
                    clearAuthPending();
                    return user;
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

    if (authLoading) {
        return (
            <div className="kaypal-v3-shell flex min-h-dvh items-center justify-center">
                <div className="kaypal-v3-panel flex items-center gap-3 px-4 py-3">
                    <Spinner size="sm" />
                    <span className="kaypal-v3-body">正在验证登录状态...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="kaypal-v3-shell flex h-dvh w-full">
            <div
                className={cn(
                    "relative flex h-full w-72 flex-col border-r transition-width",
                    "border-[var(--kaypal-v3-border)] bg-[color-mix(in_oklch,var(--kaypal-v3-paper)_86%,transparent)] p-5 shadow-[var(--kaypal-v3-card-shadow)] backdrop-blur-[18px]",
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
                    <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[var(--kaypal-v3-ink)] text-sm font-extrabold text-white shadow-[var(--kaypal-v3-card-shadow)]">
                        K
                    </div>
                    <span
                        className={cn("flex flex-col leading-tight opacity-100", {
                            "w-0 opacity-0 hidden": isCompact,
                        })}
                    >
                        <span className="text-[15px] font-bold leading-[22px] text-[var(--kaypal-v3-ink)]">Kaypal</span>
                        <span className="text-[11px] font-semibold leading-4 text-[var(--kaypal-v3-muted)]">内容工作台</span>
                    </span>
                </div>
                <Spacer y={6} />
                <div className="flex items-center gap-3 rounded-[14px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] px-3 py-3">
                    <Avatar
                        isBordered
                        className="flex-none"
                        size="sm"
                        name={currentUser?.name || "管理员"}
                    />
                    <div className={cn("flex max-w-full flex-col", { hidden: isCompact })}>
                        <p className="truncate text-[13px] font-bold leading-5 text-[var(--kaypal-v3-soft-ink)]">{currentUser?.name || "管理员"}</p>
                        <p className="truncate text-[11px] leading-4 text-[var(--kaypal-v3-muted)]">{currentUser?.username || "未登录"}</p>
                    </div>
                </div>
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
                    className={cn("mt-auto flex flex-col gap-1 border-t border-[var(--kaypal-v3-border)] pt-3", {
                        "items-center": isCompact,
                    })}
                >
                    <ThemeToggle isCompact={isCompact} />
                    <Tooltip content="退出登录" isDisabled={!isCompact} placement="right">
                        <Button
                            className={cn("h-9 justify-start rounded-[10px] px-3 text-[13px] font-semibold text-[var(--kaypal-v3-muted)] data-[hover=true]:bg-[var(--kaypal-v3-paper-soft)] data-[hover=true]:text-[var(--kaypal-v3-ink)]", {
                                "justify-center": isCompact,
                            })}
                            isLoading={loggingOut}
                            isIconOnly={isCompact}
                            startContent={
                                isCompact ? null : (
                                    <Icon
                                        className="flex-none rotate-180 text-[var(--kaypal-v3-muted)]"
                                        icon="solar:logout-2-outline"
                                        width={18}
                                    />
                                )
                            }
                            onPress={handleLogout}
                            variant="light"
                        >
                            {isCompact ? (
                                <Icon
                                    className="text-default-500 rotate-180"
                                    icon="solar:logout-2-outline"
                                    width={24}
                                />
                            ) : (
                                "退出登录"
                            )}
                        </Button>
                    </Tooltip>
                </div>
            </div>
            <div className="w-full flex-1 flex-col overflow-y-auto px-4 py-4 md:px-6 md:py-6">
                <main className="h-full w-full text-[14px] leading-[22px] text-[var(--kaypal-v3-soft-ink)]">
                    {children}
                </main>
            </div>
        </div>
    );
}
