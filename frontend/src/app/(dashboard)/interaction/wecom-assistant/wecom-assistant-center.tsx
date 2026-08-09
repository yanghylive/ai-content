"use client";

import { useEffect, useState } from "react";
import { localEngineApi } from "@/lib/api/local-engine";

import {
  Bot,
  History,
  MessageSquareText,
  Settings2,
} from "lucide-react";
import { WorkbenchCenter } from "@/components/v2/workbench-center";

export function WecomAssistantCenter() {
  const [stats, setStats] = useState({ waiting: 0, aiDone: 0 });
  useEffect(() => {
    let active = true;
    localEngineApi
      .tasks(50)
      .then((tasks) => {
        if (!active) return;
        const list = Array.isArray(tasks) ? tasks : [];
        setStats({
          waiting: list.filter((t) => t.status === "waiting_for_send_confirmation").length,
          aiDone: list.filter((t) => t.status === "completed").length,
        });
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);
  return (
    <WorkbenchCenter
      title="企微助手"
      subtitle="企业微信的智能客服和消息管理"
      icon={Bot}
      stats={[
        { label: "待人工处理", value: stats.waiting, tone: stats.waiting > 0 ? "warning" : "default" },
        { label: "AI 已回复", value: stats.aiDone, tone: "success" },
      ]}
      primaryAction={{ label: "处理会话", href: "/interaction/wecom-assistant?filter=pending" }}
      quickActions={[
        {
          key: "pending",
          title: "待处理",
          description: "AI 无法回答，需要人工介入",
          icon: MessageSquareText,
          href: "/interaction/wecom-assistant?filter=pending",
          badge: "3",
        },
        {
          key: "history",
          title: "会话记录",
          description: "查看所有历史会话",
          icon: History,
          href: "/interaction/wecom-assistant?filter=all",
        },
      ]}
      advancedLinks={[
        { key: "settings", title: "回复规则", icon: Settings2, href: "/interaction/wecom-assistant?tab=settings" },
      ]}
    />
  );
}
