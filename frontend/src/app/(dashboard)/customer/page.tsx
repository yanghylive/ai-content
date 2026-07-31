"use client";

import React from "react";
import { ScenePage } from "@/components/shell/scene-page";
import { growthApi } from "@/lib/api/growth";

export default function CustomerScene() {
  const [leadCount, setLeadCount] = React.useState(0);
  const [highIntent, setHighIntent] = React.useState(0);
  const [runningCount, setRunningCount] = React.useState(0);

  React.useEffect(() => {
    let active = true;
    Promise.all([
      growthApi.overview().catch(() => null),
      growthApi.listConfigs().catch(() => []),
    ]).then(([overview, configs]) => {
      if (!active) return;
      const ov = overview as {
        todayLeadCount?: number;
        highIntentLeadCount?: number;
      } | null;
      setLeadCount(ov?.todayLeadCount ?? 0);
      setHighIntent(ov?.highIntentLeadCount ?? 0);
      const list = Array.isArray(configs) ? configs : [];
      setRunningCount(
        list.filter(
          (c) => (c as { status?: string }).status === "running",
        ).length,
      );
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <ScenePage
      title="客户"
      sub="找客户、管客户，都在这一页"
      hint={
        leadCount > 0
          ? {
              icon: "bulb",
              text: `今日新增 ${leadCount} 条线索${highIntent > 0 ? `，${highIntent} 条高意向` : ""}，建议优先跟进`,
              actionLabel: "去跟进",
              href: "/growth-v2/leads",
            }
          : undefined
      }
      cards={[
        {
          icon: "target",
          tint: "kx-t-rose",
          title: "线索池",
          desc: "系统抓到的潜在客户，高意向一键转客户",
          href: "/growth-v2/leads",
          badge: leadCount > 0 ? `${leadCount} 新` : undefined,
        },
        {
          icon: "users",
          tint: "kx-t-blue",
          title: "客户管理",
          desc: "客户档案、跟进记录、成交状态",
          href: "/crm",
        },
        {
          icon: "bot",
          tint: "kx-t-violet",
          title: "获客任务",
          desc: "自动帮你找客户的任务，随时启停",
          href: "/growth-v2/acquisition",
          badge: runningCount > 0 ? `${runningCount} 运行中` : undefined,
        },
        {
          icon: "clipboard",
          tint: "kx-t-amber",
          title: "获客策略",
          desc: "按行业的获客打法，选一个直接用",
          href: "/growth-v2/strategies",
        },
        {
          icon: "download",
          tint: "kx-t-green",
          title: "导入客户",
          desc: "从 Excel 批量导入，智能识别字段",
          href: "/crm-import-v2",
        },
        {
          icon: "trending",
          tint: "kx-t-cyan",
          title: "增长复盘",
          desc: "漏斗、高效话术、趋势，看哪种打法有效",
          href: "/growth-v2/reports",
        },
      ]}
    />
  );
}
