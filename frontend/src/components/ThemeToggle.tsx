"use client";

import React from "react";
import { Button, Tooltip, cn } from "@heroui/react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

interface ThemeToggleProps {
    isCompact?: boolean;
}

const noopSubscribe = () => () => undefined;

export function ThemeToggle({ isCompact }: ThemeToggleProps) {
    const mounted = React.useSyncExternalStore(noopSubscribe, () => true, () => false);
    const { theme, setTheme } = useTheme();
    const isDark = mounted && theme === "dark";
    const ThemeIcon = isDark ? Sun : Moon;

    return (
        <Tooltip content={isDark ? "切换为浅色模式" : "切换为深色模式"} isDisabled={!isCompact} placement="right">
            <Button
                aria-label={isDark ? "切换为浅色模式" : "切换为深色模式"}
                className={cn(
                    "h-11 min-w-11 justify-start truncate rounded-[6px] px-3 text-[13px] font-semibold text-default-500 data-[hover=true]:bg-default-50 data-[hover=true]:text-foreground md:h-9 md:min-h-0",
                    {
                        "w-11 justify-center px-0 md:w-9 md:min-w-9": isCompact,
                    }
                )}
                isIconOnly={isCompact}
                startContent={
                    isCompact ? null : (
                        <ThemeIcon
                            aria-hidden="true"
                            className="h-[18px] w-[18px] flex-none text-default-500"
                            strokeWidth={1.75}
                        />
                    )
                }
                variant="light"
                onClick={() => setTheme(isDark ? "light" : "dark")}
            >
                {isCompact ? (
                    <ThemeIcon
                        aria-hidden="true"
                        className="h-[18px] w-[18px] text-default-500"
                        strokeWidth={1.75}
                    />
                ) : (
                    isDark ? "浅色模式" : "深色模式"
                )}
            </Button>
        </Tooltip>
    );
}
