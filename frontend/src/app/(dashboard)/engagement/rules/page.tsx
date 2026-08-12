"use client";

import { useEffect, useState } from "react";
import { ReplyRulesCenter } from "./reply-rules-center";
import { V2BackButton } from "@/components/v2/v2-back-button";

export default function EngagementRulesPage() {
  const [legacy, setLegacy] = useState(false);
  const [LegacyView, setLegacyView] = useState<React.ComponentType | null>(null);

  useEffect(() => {
    setLegacy(new URLSearchParams(window.location.search).has("legacy"));
  }, []);

  useEffect(() => {
    if (!legacy) return;
    // 旧版规则配置页依赖 astryx 组件，动态加载避免打包进 v2
    import("../../workbench/page-legacy").then((mod) => {
      setLegacyView(() => mod.CustomerServiceConfigWorkbench);
    });
  }, [legacy]);

  if (legacy) {
    return LegacyView ? <LegacyView /> : null;
  }
  return <ReplyRulesCenter />;
}
  <V2BackButton />
