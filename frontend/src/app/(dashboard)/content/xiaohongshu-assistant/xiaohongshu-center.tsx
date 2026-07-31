"use client";

import {
  FileText,
  History,
  PenLine,
  Send,
  Sparkles,
} from "lucide-react";
import { WorkbenchCenter } from "@/components/v2/workbench-center";

export function XiaohongshuCenter() {
  return (
    <WorkbenchCenter
      title="小红书助手"
      subtitle="写笔记、做封面、发小红书，一站完成"
      icon={PenLine}
      primaryAction={{ label: "写新笔记", href: "/content/xiaohongshu-assistant?action=new" }}
      quickActions={[
        {
          key: "new-note",
          title: "写笔记",
          description: "AI 帮你写小红书风格笔记",
          icon: Sparkles,
          href: "/content/xiaohongshu-assistant?action=new",
        },
        {
          key: "drafts",
          title: "草稿箱",
          description: "继续编辑未完成的笔记",
          icon: FileText,
          href: "/content/xiaohongshu-assistant?tab=drafts",
        },
        {
          key: "publish",
          title: "去发布",
          description: "确认后发布到小红书",
          icon: Send,
          href: "/content/xiaohongshu-assistant?tab=publish",
        },
      ]}
      advancedLinks={[
        { key: "records", title: "发布记录", icon: History, href: "/content/xiaohongshu-assistant?tab=records" },
      ]}
    />
  );
}
