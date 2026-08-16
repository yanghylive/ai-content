"use client";

import { useState } from "react";
import { Bot, Target } from "lucide-react";
import { CrmCloserCenter } from "./crm-closer-center";
import { CloserAdviceWorkbench } from "./closer-advice-workbench";

type CloserTab = "follow" | "advice";

export function CloserPage() {
  const [tab, setTab] = useState<CloserTab>("follow");

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <button
          type="button"
          className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition ${
            tab === "follow"
              ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]"
              : "border-[var(--kaypal-v3-border)] text-[var(--kaypal-v3-soft-ink)] hover:border-[var(--kaypal-v3-border-strong)]"
          }`}
          onClick={() => setTab("follow")}
        >
          <Target className="h-4 w-4" />
          成交跟进
        </button>
        <button
          type="button"
          className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition ${
            tab === "advice"
              ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]"
              : "border-[var(--kaypal-v3-border)] text-[var(--kaypal-v3-soft-ink)] hover:border-[var(--kaypal-v3-border-strong)]"
          }`}
          onClick={() => setTab("advice")}
        >
          <Bot className="h-4 w-4" />
          AI 成交建议
        </button>
      </div>

      {tab === "follow" ? <CrmCloserCenter /> : <CloserAdviceWorkbench />}
    </div>
  );
}
