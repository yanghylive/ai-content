"use client";

import { useCallback, useEffect, useState } from "react";
import { Lightbulb, MessageCircle, Search, Settings2 } from "lucide-react";
import { WorkbenchCenter } from "@/components/v2/workbench-center";
import { localEngineApi } from "@/lib/api/local-engine";

export function CommentInsightsCenter() {
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
      title="评论线索"
      subtitle="把评论变成痛点、需求和商机，沉淀成回复规则"
      icon={MessageCircle}
      stats={[
        { label: "待处理回复", value: pending === null ? "-" : pending, tone: pending ? "warning" : "success" },
      ]}
      primaryAction={{ label: "处理评论线索", href: "/engagement/comment-insights?legacy=1" }}
      quickActions={[
        {
          key: "insights",
          title: "评论洞察工作台",
          description: "把评论转成痛点、需求和回复建议",
          icon: Lightbulb,
          href: "/engagement/comment-insights?legacy=1",
        },
        {
          key: "rules",
          title: "回复规则",
          description: "把好的回复沉淀成规则",
          icon: Settings2,
          href: "/engagement/rules",
        },
        {
          key: "records",
          title: "互动记录",
          description: "查看历史互动",
          icon: Search,
          href: "/engagement/records",
        },
      ]}
    />
  );
}
