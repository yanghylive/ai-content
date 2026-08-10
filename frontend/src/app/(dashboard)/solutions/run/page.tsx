"use client";

import { useEffect, useState } from "react";
import { EditEntryHint } from "@/components/edit-entry-hint";
import { DesktopOnlyGate } from "@/components/v2/desktop-only-gate";
import { SolutionRunDetail } from "../solution-run-detail";

export default function SolutionRunPage() {
  const [id, setId] = useState<string | null>(null);

  useEffect(() => {
    setId(new URLSearchParams(window.location.search).get("id"));
  }, []);

  if (id === null) return <EditEntryHint />;
  return (
    <DesktopOnlyGate
      title="方案运行详情需在电脑端查看"
      desc="方案执行与运行操控依赖电脑端运行环境，手机端暂不支持。"
      backHref="/solutions"
    >
      <SolutionRunDetail runId={id || ""} />
    </DesktopOnlyGate>
  );
}
