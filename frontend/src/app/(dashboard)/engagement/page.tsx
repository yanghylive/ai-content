"use client";

import { useState } from "react";
import { Bot, Inbox } from "lucide-react";
import { CustomerServiceConfig } from "../workbench/customer-service-config";
import { UnifiedInbox } from "./unified-inbox";

/**
 * 互动顶层（报告 5.1 节）：首屏先展示统一收件箱，客服机器人设置
 * 作为并列 Tab，不再阻塞收件箱。
 */
export default function EngagementPage() {
  const [tab, setTab] = useState<"inbox" | "bot">("inbox");

  return (
    <div className="kx-view flex flex-col gap-4">
      {/* Tab 切换 */}
      <div className="flex items-center gap-1 rounded-[var(--kaypal-v3-radius)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-1">
        <button
          type="button"
          onClick={() => setTab("inbox")}
          className={`inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] px-4 py-2 text-sm font-medium transition ${
            tab === "inbox"
              ? "bg-[var(--kaypal-v3-accent)] text-white"
              : "text-[var(--kaypal-v3-soft-ink)] hover:bg-[var(--kaypal-v3-paper-muted)]"
          }`}
        >
          <Inbox className="h-4 w-4" />
          统一收件箱
        </button>
        <button
          type="button"
          onClick={() => setTab("bot")}
          className={`inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] px-4 py-2 text-sm font-medium transition ${
            tab === "bot"
              ? "bg-[var(--kaypal-v3-accent)] text-white"
              : "text-[var(--kaypal-v3-soft-ink)] hover:bg-[var(--kaypal-v3-paper-muted)]"
          }`}
        >
          <Bot className="h-4 w-4" />
          客服机器人设置
        </button>
      </div>

      {tab === "inbox" ? <UnifiedInbox /> : <CustomerServiceConfig />}
    </div>
  );
}
