"use client";

import { GrowthAcquisitionTasks } from "../../growth/growth-acquisition-tasks";
import { GrowthMobileConsole } from "@/components/growth/growth-mobile-console";
import { useIsMobile } from "@/lib/hooks/use-media-query";

export default function GrowthAcquisitionPage() {
  const isMobile = useIsMobile();
  // 移动端（<768px）：只读工作台（创建/编辑/批量请用电脑端）
  if (isMobile) return <GrowthMobileConsole view="acquisition" />;
  return <GrowthAcquisitionTasks />;
}
