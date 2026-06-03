"use client";

import React from "react";
import { Avatar, Button, ScrollShadow, Spacer, Spinner, Tooltip, cn } from "@heroui/react";
import { LogOut } from "lucide-react";
import { useMediaQuery } from "usehooks-ts";
import Sidebar from "@/components/application/sidebars/Sidebar Responsive/ts/sidebar";
import { sectionItems } from "./sidebar-items";
import { ThemeToggle } from "@/components/ThemeToggle";
import { usePathname, useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { authApi, type AuthUser } from "@/lib/api/auth";
import { ElectronUpdateBanner } from "@/components/electron-update-banner";

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
                <div className="flex items-center gap-3 rounded-[14px] border border-divider bg-content1/70 px-3 py-3">
                    <Avatar
                        isBordered
                        className="flex-none"
                        size="sm"
                        name={currentUser?.name || "管理员"}
                    />
                    <div className={cn("flex max-w-full flex-col", { hidden: isCompact })}>
                        <p className="truncate text-[13px] font-bold leading-5 text-default-600">{currentUser?.name || "管理员"}</p>
                        <p className="truncate text-[11px] leading-4 text-default-400">{currentUser?.username || "未登录"}</p>
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
                    className={cn("mt-auto flex flex-col gap-1 border-t border-divider pt-3", {
                        "items-center": isCompact,
                    })}
                >
                    <ThemeToggle isCompact={isCompact} />
                    <Tooltip content="退出登录" isDisabled={!isCompact} placement="right">
                        <Button
                            className={cn("h-9 justify-start rounded-[10px] px-3 text-[13px] font-semibold text-default-500 data-[hover=true]:text-foreground", {
                                "justify-center": isCompact,
                            })}
                            isLoading={loggingOut}
                            isIconOnly={isCompact}
                            startContent={
                                isCompact ? null : (
                                    <LogOut
                                        aria-hidden="true"
                                        className="h-[18px] w-[18px] flex-none text-default-500"
                                        strokeWidth={1.75}
                                    />
                                )
                            }
                            onPress={handleLogout}
                            variant="light"
                        >
                            {isCompact ? (
                                <LogOut
                                    aria-hidden="true"
                                    className="h-[18px] w-[18px] text-default-500"
                                    strokeWidth={1.75}
                                />
                            ) : (
                                "退出登录"
                            )}
                        </Button>
                    </Tooltip>
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
