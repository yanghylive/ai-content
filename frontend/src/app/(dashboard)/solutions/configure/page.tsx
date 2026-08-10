"use client";

import { useEffect, useState } from "react";
import { EditEntryHint } from "@/components/edit-entry-hint";
import { DesktopOnlyGate } from "@/components/v2/desktop-only-gate";
import { SolutionConfigure } from "../solution-configure";

export default function SolutionConfigurePage() {
  const [pkg, setPkg] = useState<string | null>(null);

  useEffect(() => {
    setPkg(new URLSearchParams(window.location.search).get("package"));
  }, []);

  if (pkg === null) return <EditEntryHint />;
  return (
    <DesktopOnlyGate
      title="方案配置需在电脑端进行"
      desc="方案包配置与参数调整需要在电脑端操作，手机端暂不支持。你可以在手机上浏览方案列表。"
      backHref="/solutions"
    >
      <SolutionConfigure packageCode={pkg || ""} />
    </DesktopOnlyGate>
  );
}
