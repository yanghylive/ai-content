"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Clock,
  MessageSquareText,
  Users,
} from "lucide-react";
import { WorkbenchCenter } from "@/components/v2/workbench-center";
import { localEngineApi } from "@/lib/api/local-engine";
import { toPublicError } from "@/lib/public-error";

function isToday(dateStr?: string) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export function WorkbenchHomeCenter() {
  const [stats, setStats] = useState({
    pending: 0,
    doneToday: 0,
    onlineAccounts: 0,
  });
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [tasksResult, browserResult] = await Promise.allSettled([
        localEngineApi.tasks(80),
        localEngineApi.browserStatus(),
      ]);

      const tasks = tasksResult.status === "fulfilled" ? tasksResult.value : [];
      const pending = tasks.filter(
        (t) => t.status === "waiting_for_send_confirmation",
      ).length;
      const doneToday = tasks.filter(
        (t) => t.status === "completed" && isToday(t.updatedAt),
      ).length;
      const onlineAccounts =
        browserResult.status === "fulfilled"
          ? browserResult.value.readyAccounts
          : 0;

      setStats({ pending, doneToday, onlineAccounts });
    } catch (error: unknown) {
      console.error(toPublicError(error, "加载互动工作台失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return (
    <WorkbenchCenter
      title="互动工作台"
      subtitle="各平台的客户互动，统一在这里处理"
      icon={MessageSquareText}
      stats={[
        {
          label: "待处理互动",
          value: loading ? "-" : stats.pending,
          tone: stats.pending > 0 ? "warning" : "default",
        },
        {
          label: "今日已处理",
          value: loading ? "-" : stats.doneToday,
          tone: "success",
        },
        {
          label: "在线账号",
          value: loading ? "-" : stats.onlineAccounts,
          tone: "accent",
        },
      ]}
      primaryAction={{ label: "处理互动", href: "/workbench?filter=pending" }}
      quickActions={[
        {
          key: "pending",
          title: "待处理",
          description: "评论和私信等待回复",
          icon: Clock,
          href: "/workbench?filter=pending",
          badge: stats.pending > 0 ? String(stats.pending) : undefined,
        },
        {
          key: "done",
          title: "已处理",
          description: "今日已处理的互动",
          icon: CheckCircle2,
          href: "/workbench?filter=done",
        },
        {
          key: "accounts",
          title: "在线账号",
          description: "查看各平台账号状态",
          icon: Users,
          href: "/local-engine",
        },
      ]}
      advancedLinks={[
        { key: "wechat", title: "微信工作台", icon: MessageSquareText, href: "/workbench/wechat" },
        { key: "douyin", title: "抖音私信", icon: MessageSquareText, href: "/workbench/douyin-messages" },
      ]}
    />
  );
}
