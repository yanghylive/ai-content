"use client";

import { useCallback, useEffect, useState } from "react";
import { MessageSquareText, Plus, Settings2, ShieldCheck } from "lucide-react";
import { WorkbenchCenter } from "@/components/v2/workbench-center";
import { localEngineApi } from "@/lib/api/local-engine";

export function ReplyRulesCenter() {
  const [pending, setPending] = useState<number | null>(null);

  const fetchPending = useCallback(async () => {
    try {
      const data = await localEngineApi.tasks(50);
      const count = (Array.isArray(data) ? data : []).filter(
        (t) => t.status === "waiting_for_send_confirmation",
      ).length;
      setPending(count);
    } catch {
      setPending(null);
    }
  }, []);

  useEffect(() => {
    void fetchPending();
  }, [fetchPending]);

  return (
    <WorkbenchCenter
      title="回复规则"
      subtitle="把好的回复沉淀成规则，下次 AI 直接照着回"
      icon={Settings2}
      stats={[
        { label: "待确认回复", value: pending === null ? "-" : pending, tone: pending ? "warning" : "success" },
      ]}
      primaryAction={{ label: "配置回复规则", href: "/engagement/rules?legacy=1" }}
      quickActions={[
        {
          key: "config",
          title: "规则配置",
          description: "设置自动回复的规则和话术",
          icon: Settings2,
          href: "/engagement/rules?legacy=1",
        },
        {
          key: "pending",
          title: "待确认回复",
          description: "AI 写好等你确认的回复",
          icon: MessageSquareText,
          href: "/engagement",
          badge: pending ? String(pending) : undefined,
        },
        {
          key: "risk",
          title: "风险审核",
          description: "高风险操作审核",
          icon: ShieldCheck,
          href: "/risk-confirm-v2",
        },
      ]}
      advancedLinks={[
        { key: "insights", title: "评论线索", icon: MessageSquareText, href: "/engagement/comment-insights" },
        { key: "new", title: "新建规则", icon: Plus, href: "/engagement/rules?legacy=1&action=new" },
      ]}
    />
  );
}
