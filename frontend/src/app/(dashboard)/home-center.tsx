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
import { LoadErrorBanner, useLoadError } from "@/components/load-error-banner";
import { dashboardApi, type DashboardStats } from "@/lib/api/dashboard";
import { toPublicError } from "@/lib/public-error";

export function HomeCenter() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const { loadError, reportLoadError, clearLoadError } = useLoadError();

  const fetchStats = useCallback(async () => {
    try {
      const data = await dashboardApi.stats();
      setStats(data);
      clearLoadError();
    } catch (error: unknown) {
      // 2026-09-01 审计修复：加载失败不再静默（原只 console），banner 上屏
      console.error(toPublicError(error, "加载工作台统计失败"));
      reportLoadError(error, "工作台统计暂时无法读取，各卡片显示为占位");
    }
  }, [clearLoadError, reportLoadError]);

  useEffect(() => {
    void fetchStats();
  }, [fetchStats]);

  return (
    <div className="flex flex-col gap-3">
      {loadError ? (
        <LoadErrorBanner message={loadError} onRetry={() => void fetchStats()} />
      ) : null}
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
          href: "/engagement",
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
          title: "今日增长",
          description: "今日获客与线索总览",
          icon: TrendingUp,
          href: "/today",
        },
      ]}
      advancedLinks={[
        { key: "publish", title: "发布中心", icon: Clock, href: "/distribution" },
        { key: "engine", title: "设备状态", icon: TrendingUp, href: "/local-engine" },
        { key: "wechat", title: "微信工作台", icon: MessageSquareText, href: "/engagement/wechat" },
        { key: "crm", title: "客户管理", icon: TrendingUp, href: "/crm" },
      ]}
      />
    </div>
  );
}
