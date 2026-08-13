"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Clock,
  MessageSquareText,
  Play,
  Settings2,
  TrendingUp,
  Users,
} from "lucide-react";
import { WorkbenchCenter } from "@/components/v2/workbench-center";
import { growthApi } from "@/lib/api/growth";
import { toPublicError } from "@/lib/public-error";

export function AutoAcquisitionCenter() {
  const [stats, setStats] = useState({ leads: 0, contacted: 0, tasks: 0 });
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [overview, configs] = await Promise.allSettled([
        growthApi.overview(),
        growthApi.listConfigs(),
      ]);
      const o = overview.status === "fulfilled" ? overview.value : null;
      const c = configs.status === "fulfilled" && Array.isArray(configs.value) ? configs.value : [];
      setStats({
        leads: o?.todayLeadCount ?? 0,
        contacted: o?.todayContactedCount ?? 0,
        tasks: c.filter((x) => x.status === "enabled").length,
      });
    } catch (err: unknown) {
      console.error(toPublicError(err, "加载获客数据失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return (
    <WorkbenchCenter
      backHref="/apps"
            title="自动获客"
      subtitle="设置好规则，系统自动帮你找客户、加好友"
      icon={TrendingUp}
      stats={[
        {
          label: "今日新增线索",
          value: loading ? "-" : stats.leads,
          tone: "accent",
        },
        {
          label: "今日已触达",
          value: loading ? "-" : stats.contacted,
          tone: "success",
        },
        {
          label: "运行中的任务",
          value: loading ? "-" : stats.tasks,
          tone: stats.tasks > 0 ? "success" : "default",
        },
      ]}
      primaryAction={{ label: "创建获客任务", href: "/auto-acquisition/create" }}
      quickActions={[
        {
          key: "tasks",
          title: "获客任务",
          description: "管理和启停你的获客任务",
          icon: Play,
          href: "/growth/acquisition",
          badge: stats.tasks > 0 ? String(stats.tasks) : undefined,
        },
        {
          key: "leads",
          title: "线索池",
          description: "系统抓到的潜在客户",
          icon: Users,
          href: "/growth/leads",
          badge: stats.leads > 0 ? String(stats.leads) : undefined,
        },
        {
          key: "messages",
          title: "待回复",
          description: "客户消息等待处理",
          icon: MessageSquareText,
          href: "/engagement",
        },
      ]}
      advancedLinks={[
        { key: "rules", title: "获客策略", icon: Settings2, href: "/growth/strategies" },
        { key: "schedule", title: "增长复盘", icon: Clock, href: "/growth/reports" },
      ]}
    />
  );
}
