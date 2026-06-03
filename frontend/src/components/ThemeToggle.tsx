"use client";

import React from "react";
import { Button, Tooltip, cn } from "@heroui/react";
import { Icon } from "@iconify/react";
import { useTheme } from "next-themes";

interface ThemeToggleProps {
    isCompact?: boolean;
}

const noopSubscribe = () => () => undefined;

export function ThemeToggle({ isCompact }: ThemeToggleProps) {
    const mounted = React.useSyncExternalStore(noopSubscribe, () => true, () => false);
    const { theme, setTheme } = useTheme();
    const isDark = mounted && theme === "dark";

    return (
        <Tooltip content={isDark ? "切换为浅色模式" : "切换为深色模式"} isDisabled={!isCompact} placement="right">
            <Button
                className={cn(
                    "h-9 justify-start truncate rounded-[10px] px-3 text-[13px] font-semibold text-[var(--kaypal-v3-muted)] data-[hover=true]:bg-[var(--kaypal-v3-paper-soft)] data-[hover=true]:text-[var(--kaypal-v3-ink)]",
                    {
                        "justify-center": isCompact,
                    }
                )}
                isIconOnly={isCompact}
                startContent={
                    isCompact ? null : (
                        <Icon
                            className="flex-none text-[var(--kaypal-v3-muted)]"
                            icon={isDark ? "solar:sun-bold" : "solar:moon-bold"}
                            width={18}
                        />
                    )
                }
                variant="light"
                onClick={() => setTheme(isDark ? "light" : "dark")}
            >
                {isCompact ? (
                    <Icon
                        className="text-[var(--kaypal-v3-muted)]"
                        icon={isDark ? "solar:sun-bold" : "solar:moon-bold"}
                        width={18}
                    />
                ) : (
                    isDark ? "浅色模式" : "深色模式"
                )}
            </Button>
        </Tooltip>
    );
}
