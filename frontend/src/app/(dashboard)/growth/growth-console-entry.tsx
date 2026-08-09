"use client";

import { useSearchParams } from "next/navigation";
import { GrowthConsole } from "@/components/growth/growth-console";

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

  return <GrowthConsole view={view} />;
}
