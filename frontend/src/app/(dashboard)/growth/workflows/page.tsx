"use client";

import { GrowthWorkflowsPage } from "../growth-workflows";
import { GrowthMobileConsole } from "@/components/growth/growth-mobile-console";
import { useIsMobile } from "@/lib/hooks/use-media-query";

export default function GrowthWorkflowsV2Page() {
  const isMobile = useIsMobile();
  // 移动端（<768px）：只读工作流列表（创建/控制请用电脑端）
  if (isMobile) return <GrowthMobileConsole view="workflows" />;
  return <GrowthWorkflowsPage />;
}
