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
              icon: "users",
              text: `今日新增 ${leadCount} 条线索${highIntent > 0 ? `，${highIntent} 条高意向` : ""}，建议优先跟进`,
              actionLabel: "去跟进",
              href: "/growth/leads",
            }
          : undefined
      }
      cards={[
        {
          icon: "users",
          tint: "kx-t-slate",
          title: "线索池",
          desc: "系统抓到的潜在客户，高意向一键转客户",
          href: "/growth/leads",
          badge: leadCount > 0 ? `${leadCount} 新` : undefined,
          group: "线索与获客",
        },
        {
          icon: "megaphone",
          tint: "kx-t-rose",
          title: "评论获客",
          desc: "扫描平台评论 → AI 识别潜客 → 真人感回复",
          href: "/engagement/comment-acquisition",
          group: "线索与获客",
        },
        {
          icon: "cpu",
          tint: "kx-t-slate",
          title: "获客任务",
          desc: "自动帮你找客户的任务，随时启停",
          href: "/growth/acquisition",
          badge: runningCount > 0 ? `${runningCount} 运行中` : undefined,
          group: "线索与获客",
        },
        {
          icon: "trending",
          tint: "kx-t-amber",
          title: "获客策略",
          desc: "按行业的获客打法，选一个直接用",
          href: "/growth/strategies",
          group: "线索与获客",
        },
        {
          icon: "download",
          tint: "kx-t-green",
          title: "导入客户",
          desc: "从 Excel 批量导入，智能识别字段",
          href: "/crm-import",
          group: "线索与获客",
        },
        {
          icon: "briefcase",
          tint: "kx-t-blue",
          title: "客户管理",
          desc: "客户档案、跟进记录、成交状态",
          href: "/crm",
          group: "客户与增长",
        },
        {
          icon: "chart",
          tint: "kx-t-cyan",
          title: "增长复盘",
          desc: "漏斗、高效话术、趋势，看哪种打法有效",
          href: "/growth/reports",
          group: "客户与增长",
        },
        {
          icon: "briefcase",
          tint: "kx-t-blue",
          title: "BOSS 招聘",
          desc: "招聘线索与跟进",
          href: "/boss-recruit",
          group: "客户与增长",
        },
        {
          icon: "bulb",
          tint: "kx-t-amber",
          title: "账号健康",
          desc: "账号状态与健康度",
          href: "/growth/account-health",
          group: "客户与增长",
        },
        {
          icon: "cpu",
          tint: "kx-t-violet",
          title: "增长工作流",
          desc: "自动获客流程编排",
          href: "/growth/workflows",
          group: "客户与增长",
        },
        {
          icon: "rocket",
          tint: "kx-t-amber",
          title: "商业就绪",
          desc: "上线能力自检",
          href: "/commercial-readiness",
          group: "客户与增长",
        },
      ]}
    />
  );
}
