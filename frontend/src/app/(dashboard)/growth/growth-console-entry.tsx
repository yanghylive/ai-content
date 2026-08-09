"use client";

import { useSearchParams } from "next/navigation";
import { GrowthConsole } from "@/components/growth/growth-console";
import { GrowthMobileConsole } from "@/components/growth/growth-mobile-console";
import { useIsMobile } from "@/lib/hooks/use-media-query";

const growthViews = [
  "overview",
  "acquisition",
  "strategies",
  "leads",
  "account-health",
  "reports",
  "workflows",
] as const;

type GrowthPageView = (typeof growthViews)[number];

function resolveGrowthView(value?: string | null) {
  return growthViews.includes(value as GrowthPageView)
    ? (value as GrowthPageView)
    : "overview";
}

type GrowthConsoleEntryProps = {
  view?: GrowthPageView;
};

export function GrowthConsoleEntry({ view: fixedView }: GrowthConsoleEntryProps) {
  const searchParams = useSearchParams();
  const view = fixedView ?? resolveGrowthView(searchParams.get("view"));
  const isMobile = useIsMobile();

  // 移动端（<768px）：只读工作台降级（桌面完整能力保留在 GrowthConsole）
  if (isMobile) {
    return <GrowthMobileConsole view={view} />;
  }

  return <GrowthConsole view={view} />;
}
