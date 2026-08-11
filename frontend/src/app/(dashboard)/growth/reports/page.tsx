"use client";

import { GrowthReportsPage } from "../growth-reports";
import { GrowthMobileConsole } from "@/components/growth/growth-mobile-console";
import { useIsMobile } from "@/lib/hooks/use-media-query";

export default function GrowthReportsV2Page() {
  const isMobile = useIsMobile();
  // 移动端（<768px）：只读报告摘要
  if (isMobile) return <GrowthMobileConsole view="reports" />;
  return <GrowthReportsPage />;
}
