"use client";

import { LeadsPool } from "../leads-pool";
import { GrowthMobileConsole } from "@/components/growth/growth-mobile-console";
import { useIsMobile } from "@/lib/hooks/use-media-query";

export default function LeadsPoolPage() {
  const isMobile = useIsMobile();
  // 移动端（<768px）：只读线索列表（批量改状态请用电脑端）
  if (isMobile) return <GrowthMobileConsole view="leads" />;
  return (
    <div className="kx-view">
      <LeadsPool />
    </div>
  );
}
