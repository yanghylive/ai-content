"use client";

import {
  CheckCircle2,
  Inbox,
  MessageSquareText,
  Users,
} from "lucide-react";
import { WorkbenchCenter } from "@/components/v2/workbench-center";

export function InboxCenter() {
  return (
    <WorkbenchCenter
      title="线索收件箱"
      subtitle="各平台来的客户线索，统一在这里处理"
      icon={Inbox}
      stats={[
        { label: "待处理线索", value: 15, tone: "warning" },
        { label: "今日已处理", value: 9, tone: "success" },
        { label: "已转客户", value: 6, tone: "accent" },
      ]}
      statsNote="示例数据，接口接入后显示真实值"
      primaryAction={{ label: "处理线索", href: "/intelligence/inbox?filter=pending" }}
      quickActions={[
        {
          key: "pending",
          title: "待处理",
          description: "新进来的客户线索",
          icon: Inbox,
          href: "/intelligence/inbox?filter=pending",
          badge: "15",
        },
        {
          key: "replied",
          title: "已回复",
          description: "已回复的线索",
          icon: MessageSquareText,
          href: "/intelligence/inbox?filter=replied",
        },
        {
          key: "converted",
          title: "已转客户",
          description: "已加为好友的线索",
          icon: Users,
          href: "/intelligence/inbox?filter=converted",
        },
      ]}
      advancedLinks={[
        { key: "rules", title: "线索规则", icon: CheckCircle2, href: "/intelligence/rules" },
      ]}
    />
  );
}
