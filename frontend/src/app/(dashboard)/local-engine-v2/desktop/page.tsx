"use client";

import { DesktopOnlyGate } from "@/components/v2/desktop-only-gate";
import { EngineDesktopCheck } from "../../local-engine/engine-desktop-check";

export default function EngineDesktopPage() {
  return (
    <DesktopOnlyGate
      title="桌面端环境检测需在电脑端使用"
      desc="桌面端登录态与运行环境检测需要在本机电脑上进行，手机端暂不支持。"
      backHref="/local-engine-v2"
    >
      <EngineDesktopCheck />
    </DesktopOnlyGate>
  );
}
