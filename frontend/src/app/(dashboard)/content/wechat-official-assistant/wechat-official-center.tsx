"use client";

import {
  FileText,
  History,
  PenLine,
  Send,
  Settings2,
} from "lucide-react";
import { WorkbenchCenter } from "@/components/v2/workbench-center";

export function WechatOfficialCenter() {
  return (
    <WorkbenchCenter
      title="公众号助手"
      subtitle="写文章、排版、发布到公众号，一站式完成"
      icon={PenLine}
      primaryAction={{ label: "写新文章", href: "/content/wechat-official-assistant?action=new" }}
      quickActions={[
        {
          key: "new-article",
          title: "写文章",
          description: "从空白或 AI 生成开始",
          icon: PenLine,
          href: "/content/wechat-official-assistant?action=new",
        },
        {
          key: "drafts",
          title: "草稿箱",
          description: "继续编辑未完成的文章",
          icon: FileText,
          href: "/content/wechat-official-assistant?tab=drafts",
        },
        {
          key: "publish",
          title: "待发布",
          description: "确认后发布到公众号",
          icon: Send,
          href: "/content/wechat-official-assistant?tab=publish",
        },
      ]}
      advancedLinks={[
        { key: "records", title: "发布记录", icon: History, href: "/content/wechat-official-assistant?tab=records" },
        { key: "settings", title: "账号设置", icon: Settings2, href: "/content/wechat-official-assistant?tab=settings" },
      ]}
    />
  );
}
