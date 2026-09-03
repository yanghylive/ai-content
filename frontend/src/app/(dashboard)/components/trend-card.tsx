import React from "react";
import { Card, Chip, cn } from "@heroui/react";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "@/components/iconpark";

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
  const TrendIcon =
    trendType === "up"
      ? ArrowUpRight
      : trendType === "neutral"
        ? ArrowRight
        : ArrowDownRight;
  return (
    <Card className="border border-transparent bg-content1 shadow-sm dark:border-default-100">
      <div className="relative flex min-h-[88px] p-4">
        <div className="flex flex-col gap-y-2">
          <dt className="text-11 font-bold leading-4 text-default-500">
            {title}
          </dt>
          <dd className="text-2xl font-bold leading-8 text-default-700">
            {value}
          </dd>
        </div>
        <Chip
          className={cn("absolute right-4", {
            "top-4": trendChipPosition === "top",
            "bottom-4": trendChipPosition === "bottom",
          })}
          classNames={{
            base: "h-6 rounded-[8px]",
            content: "font-bold text-11 leading-4",
          }}
          color={
            changeType === "positive"
              ? "success"
              : changeType === "neutral"
                ? "warning"
                : "danger"
          }
          radius="sm"
          size="sm"
          startContent={
            <TrendIcon
              aria-hidden="true"
              className="h-3 w-3"
              strokeWidth={1.75}
            />
          }
          variant={trendChipVariant}
        >
          {change}
        </Chip>
      </div>
    </Card>
  );
};
