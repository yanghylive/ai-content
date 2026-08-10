"use client";

import { DesktopOnlyGate } from "@/components/v2/desktop-only-gate";
import { EngineBrowserAccounts } from "../../local-engine/engine-browser-accounts";

export default function EngineBrowserPage() {
  return (
    <DesktopOnlyGate
      title="浏览器自动化控制台需在电脑端使用"
      desc="浏览器账号管理与自动化操控依赖电脑端浏览器环境，手机端暂不支持。你可以在手机上查看任务记录。"
      backHref="/local-engine/tasks"
    >
      <EngineBrowserAccounts />
    </DesktopOnlyGate>
  );
}
