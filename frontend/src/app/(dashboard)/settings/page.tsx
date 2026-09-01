"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { SettingsDetail } from "./settings-detail";
import { useIsMobile } from "@/lib/hooks/use-media-query";

/**
 * /settings 入口（2026-09-01 WorkBuddy 化改造 P2）
 *
 * 桌面端：左栏已承担全部导航，不再保留索引首页 —— 直接落到首个设置项
 * 账号与安全（/settings/account），与 WorkBuddy「点导航直接切内容」一致。
 * 移动端：继续走 settings-detail（mx-* 列表聚合页）。
 */
function DesktopRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/settings/account");
  }, [router]);
  return null;
}

export default function Page() {
  const isMobile = useIsMobile();
  return isMobile ? <SettingsDetail /> : <DesktopRedirect />;
}
