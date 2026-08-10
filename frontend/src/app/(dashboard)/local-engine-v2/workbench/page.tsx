"use client";

import { DesktopOnlyGate } from "@/components/v2/desktop-only-gate";
import { EngineInteractionConsole } from "../../local-engine/engine-interaction-console";

export default function Page() {
  return (
    <DesktopOnlyGate
      title="互动控制台需在电脑端使用"
      desc="本地引擎互动操控依赖电脑端运行环境，手机端暂不支持。你可以在手机上查看任务记录。"
      backHref="/local-engine-v2/tasks"
    >
      <EngineInteractionConsole />
    </DesktopOnlyGate>
  );
}
