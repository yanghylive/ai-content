"use client";

import { GrowthAccountHealthPage } from "../../growth/growth-account-health";
import { GrowthMobileConsole } from "@/components/growth/growth-mobile-console";
import { useIsMobile } from "@/lib/hooks/use-media-query";

export default function GrowthAccountHealthV2Page() {
  const isMobile = useIsMobile();
  // 移动端（<768px）：只读账号健康
  if (isMobile) return <GrowthMobileConsole view="account-health" />;
  return <GrowthAccountHealthPage />;
}
