"use client";

import { SettingsDetail } from "./settings-detail";
import { SettingsHome } from "./settings-home";
import { useIsMobile } from "@/lib/hooks/use-media-query";

export default function Page() {
  const isMobile = useIsMobile();
  // 桌面端：WorkBuddy 式设置中心索引页；移动端：mx-* 列表聚合页（settings-detail）
  return isMobile ? <SettingsDetail /> : <SettingsHome />;
}
