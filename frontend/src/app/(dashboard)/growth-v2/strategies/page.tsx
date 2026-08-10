"use client";

import { GrowthStrategies } from "../../growth/growth-strategies";
import { GrowthMobileConsole } from "@/components/growth/growth-mobile-console";
import { useIsMobile } from "@/lib/hooks/use-media-query";

export default function GrowthStrategiesPage() {
  const isMobile = useIsMobile();
  // 移动端（<768px）：只读策略列表（生成/应用请用电脑端）
  if (isMobile) return <GrowthMobileConsole view="strategies" />;
  return <GrowthStrategies />;
}
