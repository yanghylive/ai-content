"use client";

import {
  Bot,
  History,
  MessageSquareText,
  Plus,
  Settings2,
} from "lucide-react";
import { WorkbenchCenter } from "@/components/v2/workbench-center";

export function AgentWorkbenchCenter() {
  return (
    <WorkbenchCenter
      title="智能体工作台"
      subtitle="和你的 AI 智能体对话，让它帮你完成任务"
      icon={Bot}
      primaryAction={{ label: "开始对话", href: "/agent-workbench?action=new" }}
      quickActions={[
        {
          key: "new-chat",
          title: "新对话",
          description: "开始一个全新的智能体会话",
          icon: Plus,
          href: "/agent-workbench?action=new",
        },
        {
          key: "continue",
          title: "继续上次",
          description: "回到你上次的会话",
          icon: MessageSquareText,
          href: "/agent-workbench?action=continue",
        },
      ]}
      advancedLinks={[
        { key: "sessions", title: "历史会话", icon: History, href: "/agent-workbench?tab=sessions" },
        { key: "settings", title: "智能体设置", icon: Settings2, href: "/agent-workbench?tab=settings" },
      ]}
    />
  );
}
