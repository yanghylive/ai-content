"use client";

import { useEffect, useState } from "react";
import { localEngineApi } from "@/lib/api/local-engine";

import {
  Download,
  History,
  MessageSquareText,
  Search,
} from "lucide-react";
import { WorkbenchCenter } from "@/components/v2/workbench-center";

export function DouyinMessagesCenter() {
  const [stats, setStats] = useState({ waiting: 0, doneToday: 0 });
  useEffect(() => {
    let active = true;
    localEngineApi
      .tasks(50)
      .then((tasks) => {
        if (!active) return;
        const list = Array.isArray(tasks) ? tasks : [];
        const today = new Date().toDateString();
        setStats({
          waiting: list.filter((t) => t.status === "waiting_for_send_confirmation").length,
          doneToday: list.filter(
            (t) => t.status === "completed" && new Date(t.updatedAt || t.createdAt || 0).toDateString() === today,
          ).length,
        });
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);
  return (
    <WorkbenchCenter
      title="抖音私信"
      subtitle="查看和回复抖音的私信消息"
      icon={MessageSquareText}
      stats={[
        { label: "待确认回复", value: stats.waiting, tone: stats.waiting > 0 ? "warning" : "default" },
        { label: "今日已回", value: stats.doneToday, tone: "success" },
      ]}
      primaryAction={{ label: "回复消息", href: "/workbench/douyin-messages?filter=pending" }}
      quickActions={[
        {
          key: "pending",
          title: "待回复",
          description: "未回复的私信",
          icon: MessageSquareText,
          href: "/workbench/douyin-messages?filter=pending",
          badge: "7",
        },
        {
          key: "search",
          title: "搜索会话",
          description: "按昵称或内容搜索",
          icon: Search,
          href: "/workbench/douyin-messages?action=search",
        },
      ]}
      advancedLinks={[
        { key: "export", title: "导出记录", icon: Download, href: "/workbench/douyin-messages?action=export" },
        { key: "history", title: "历史消息", icon: History, href: "/workbench/douyin-messages?filter=all" },
      ]}
    />
  );
}
