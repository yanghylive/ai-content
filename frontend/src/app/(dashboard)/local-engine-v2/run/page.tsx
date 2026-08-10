"use client";

import { DesktopOnlyGate } from "@/components/v2/desktop-only-gate";
import { EngineRunDetail } from "../../local-engine/engine-run-detail";

export default function EngineRunPage() {
  return (
    <DesktopOnlyGate
      title="运行详情需在电脑端查看"
      desc="本地引擎运行详情与执行操控依赖电脑端环境，手机端暂不支持。你可以在手机上查看任务记录。"
      backHref="/local-engine-v2/tasks"
    >
      <EngineRunDetail />
    </DesktopOnlyGate>
  );
}
