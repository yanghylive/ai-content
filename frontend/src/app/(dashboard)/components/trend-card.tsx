import React from "react";
import { Card, Chip, cn } from "@heroui/react";
import { Icon } from "@iconify/react";

export type TrendCardProps = {
    title: string;
    value: string | number;
    change: string;
    changeType: "positive" | "neutral" | "negative";
    trendType: "up" | "neutral" | "down";
    trendChipPosition?: "top" | "bottom";
    trendChipVariant?: "flat" | "light";
};

export const TrendCard = ({
    title,
    value,
    change,
    changeType,
    trendType,
    trendChipPosition = "top",
    trendChipVariant = "light",
}: TrendCardProps) => {
    return (
        <Card className="border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] shadow-[var(--kaypal-v3-card-shadow)]">
            <div className="relative flex min-h-[88px] p-4">
                <div className="flex flex-col gap-y-2">
                    <dt className="text-[11px] font-bold leading-4 text-[var(--kaypal-v3-muted)]">{title}</dt>
                    <dd className="text-[26px] font-bold leading-8 text-[var(--kaypal-v3-ink)]">{value}</dd>
                </div>
                <Chip
                    className={cn("absolute right-4", {
                        "top-4": trendChipPosition === "top",
                        "bottom-4": trendChipPosition === "bottom",
                    })}
                    classNames={{
                        base: "h-6 rounded-[8px]",
                        content: "font-bold text-[11px] leading-4",
                    }}
                    color={
                        changeType === "positive" ? "success" : changeType === "neutral" ? "warning" : "danger"
                    }
                    radius="sm"
                    size="sm"
                    startContent={
                        trendType === "up" ? (
                            <Icon height={12} icon={"solar:arrow-right-up-linear"} width={12} />
                        ) : trendType === "neutral" ? (
                            <Icon height={12} icon={"solar:arrow-right-linear"} width={12} />
                        ) : (
                            <Icon height={12} icon={"solar:arrow-right-down-linear"} width={12} />
                        )
                    }
                    variant={trendChipVariant}
                >
                    {change}
                </Chip>
            </div>
        </Card>
    );
};
