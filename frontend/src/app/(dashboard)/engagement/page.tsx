"use client";

import { useEffect, useState } from "react";
import { DesktopOnlyGate } from "@/components/v2/desktop-only-gate";
import { CustomerServiceConfig } from "../workbench/customer-service-config";
import LegacyPage from "../workbench/page-legacy";

export default function EngagementPage() {
  const [legacy, setLegacy] = useState(false);

  useEffect(() => {
    setLegacy(new URLSearchParams(window.location.search).has("legacy"));
  }, []);

  if (legacy) {
    return <LegacyPage />;
  }
  return (
    <DesktopOnlyGate
      title="互动中心需在电脑端使用"
      desc="客服配置、渠道接入与互动任务管理需要配合桌面端登录态，手机端暂不支持。你可以查看互动记录与评论洞察。"
      backHref="/engagement/records"
    >
      <CustomerServiceConfig />
    </DesktopOnlyGate>
  );
}
