"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BellRing,
  Clock,
  FileText,
  MessageSquareText,
  TrendingUp,
} from "lucide-react";
import { WorkbenchCenter } from "@/components/v2/workbench-center";
import { dashboardApi, type DashboardStats } from "@/lib/api/dashboard";
import { toPublicError } from "@/lib/public-error";

export function HomeCenter() {
  const [stats, setStats] = useState<DashboardStats | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const data = await dashboardApi.stats();
      setStats(data);
    } catch (error: unknown) {
      console.error(toPublicError(error, "加载工作台统计失败"));
    }
  }, []);

  useEffect(() => {
    void fetchStats();
  }, [fetchStats]);

  return (
    <WorkbenchCenter
      title="工作台总览"
      subtitle={
        stats?.topKeyword
          ? `今日热门关键词：${stats.topKeyword}`
          : "你今天该做的事，都聚合在这里"
      }
      icon={TrendingUp}
      stats={[
        {
          label: "今日采集",
          value: stats?.collection.todayCount ?? "-",
          tone: "accent",
        },
        {
          label: "采集成功率",
          value: stats?.collection.successRate ?? "-",
          tone: "success",
        },
        {
          label: "待发布草稿",
          value: stats?.pendingDraftArticles ?? "-",
          tone: "warning",
        },
        {
          label: "文章总数",
          value: stats?.articles.totalCount ?? "-",
        },
      ]}
      primaryAction={{ label: "去发布", href: "/distribution" }}
      quickActions={[
        {
          key: "drafts",
          title: "待发布草稿",
          description: "确认后即可发布",
          icon: FileText,
          href: "/distribution",
          badge: stats?.pendingDraftArticles
            ? String(stats.pendingDraftArticles)
            : undefined,
        },
        {
          key: "messages",
          title: "客户互动",
          description: "待回复的评论和私信",
          icon: MessageSquareText,
          href: "/workbench",
        },
        {
          key: "alerts",
          title: "情报提醒",
          description: "监控抓到的新情报",
          icon: BellRing,
          href: "/intelligence/monitors",
        },
        {
          key: "growth",
          title: "获客进展",
          description: "今日获客和线索",
          icon: TrendingUp,
          href: "/growth",
        },
      ]}
      advancedLinks={[
        { key: "publish", title: "发布中心", icon: Clock, href: "/distribution" },
        { key: "engine", title: "设备状态", icon: TrendingUp, href: "/local-engine" },
        { key: "wechat", title: "微信工作台", icon: MessageSquareText, href: "/workbench/wechat" },
        { key: "crm", title: "客户管理", icon: TrendingUp, href: "/crm" },
      ]}
    />
  );
}
