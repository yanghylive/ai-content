"use client";

import { BusinessToolResultContext } from "../components/business-tool-result-context";
import { GrowthConsoleEntry } from "./growth-console-entry";
import { useIsMobile } from "@/lib/hooks/use-media-query";

type GrowthPageShellProps = {
  view?:
    | "overview"
    | "acquisition"
    | "strategies"
    | "leads"
    | "account-health"
    | "reports"
    | "workflows";
};

export function GrowthPageShell({ view }: GrowthPageShellProps) {
  const isMobile = useIsMobile();

  // 移动端（<768px）：跳过桌面 Astryx 壳，直接渲染移动只读工作台
  if (isMobile) {
    return <GrowthConsoleEntry view={view} />;
  }

  return (
    <div className="growth-page-shell flex min-w-0 max-w-full flex-col gap-4">
      <BusinessToolResultContext allowedTools={["account-diagnosis", "kol-screening"]} />
      <GrowthConsoleEntry view={view} />
    </div>
  );
}
