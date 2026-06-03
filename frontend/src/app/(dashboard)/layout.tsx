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
            <div className="flex min-h-dvh items-center justify-center bg-background">
                <div className="flex items-center gap-3 rounded-full border border-divider bg-content1 px-5 py-3 shadow-sm">
                    <Spinner size="sm" />
                    <span className="text-sm text-default-500">正在验证登录状态...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-dvh w-full">
            <div
                className={cn(
                    "border-r-small border-divider transition-width relative flex h-full w-72 flex-col p-6",
                    "bg-background/70 backdrop-blur-[20px] shadow-sm",
                    {
                        "w-16 items-center px-2 py-6": isCompact,
                    }
                )}
            >
                <div
                    className={cn(
                        "flex items-center gap-3 px-3",
                        {
                            "justify-center gap-0": isCompact,
                        }
                    )}
                >
                    <div className="flex h-9 w-9 items-center justify-center rounded-medium bg-default-50 text-lg font-bold text-default-950 shadow-sm">
                        K
                    </div>
                    <span
                        className={cn("flex flex-col leading-tight opacity-100", {
                            "w-0 opacity-0 hidden": isCompact,
                        })}
                    >
                        <span className="text-medium font-bold text-foreground">Kaypal</span>
                        <span className="text-tiny font-medium text-default-500">内容工作台</span>
                    </span>
                </div>
                <Spacer y={8} />
                <div className="flex items-center gap-3 px-3">
                    <Avatar
                        isBordered
                        className="flex-none"
                        size="sm"
                        name={currentUser?.name || "管理员"}
                    />
                    <div className={cn("flex max-w-full flex-col", { hidden: isCompact })}>
                        <p className="text-small text-default-600 truncate font-medium">{currentUser?.name || "管理员"}</p>
                        <p className="text-tiny text-default-400 truncate">{currentUser?.username || "未登录"}</p>
                    </div>
                </div>
                <ScrollShadow className="-mr-6 h-full max-h-full py-6 pr-6">
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
                    className={cn("mt-auto flex flex-col", {
                        "items-center": isCompact,
                    })}
                >
                    <ThemeToggle isCompact={isCompact} />
                    <Tooltip content="退出登录" isDisabled={!isCompact} placement="right">
                        <Button
                            className={cn("text-default-500 data-[hover=true]:text-foreground justify-start", {
                                "justify-center": isCompact,
                            })}
                            isLoading={loggingOut}
                            isIconOnly={isCompact}
                            startContent={
                                isCompact ? null : (
                                    <Icon
                                        className="text-default-500 flex-none rotate-180"
                                        icon="solar:logout-2-outline"
                                        width={24}
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
            <div className="w-full flex-1 flex-col p-4 md:p-6 overflow-y-auto">
                <main className="h-full w-full">
                    {children}
                </main>
            </div>
        </div>
    );
}
