"use client";

import { useEffect, useState } from "react";
import { localEngineApi } from "@/lib/api/local-engine";

import {
  History,
  MessageSquareText,
  Plus,
  Settings2,
} from "lucide-react";
import { WorkbenchCenter } from "@/components/v2/workbench-center";

export function AgentConversationCenter() {
  const [stats, setStats] = useState({ total: 0, active: 0 });
  useEffect(() => {
    let active = true;
    localEngineApi
      .agentSessions(50)
      .then((sessions) => {
        if (!active) return;
        const list = Array.isArray(sessions) ? sessions : (sessions as { items?: unknown[] })?.items || [];
        const weekAgo = Date.now() - 7 * 86400000;
        setStats({
          total: list.length,
          active: list.filter((s) => new Date((s as { updatedAt?: string }).updatedAt || 0).getTime() > weekAgo).length,
        });
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);
  return (
    <WorkbenchCenter
      title="智能体会话"
      subtitle="管理你和 AI 智能体的所有对话"
      icon={MessageSquareText}
      stats={[
        { label: "会话总数", value: stats.total },
        { label: "本周活跃", value: stats.active, tone: "accent" },
      ]}
      primaryAction={{ label: "新会话", href: "/agent-workbench?action=new" }}
      quickActions={[
        {
          key: "new",
          title: "新会话",
          description: "开始新的智能体对话",
          icon: Plus,
          href: "/agent-workbench?action=new",
        },
        {
          key: "recent",
          title: "最近会话",
          description: "继续之前的对话",
          icon: History,
          href: "/agent-workbench?filter=recent",
        },
      ]}
      advancedLinks={[
        { key: "settings", title: "会话设置", icon: Settings2, href: "/agent-workbench?tab=settings" },
      ]}
    />
  );
}
