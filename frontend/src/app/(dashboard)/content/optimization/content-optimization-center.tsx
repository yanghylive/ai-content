"use client";

import {
  Columns2,
  FileEdit,
  FileText,
  FolderOpen,
  History,
  ImagePlus,
  Sparkles,
  Wand2,
} from "lucide-react";
import { WorkbenchCenter } from "@/components/v2/workbench-center";

export function ContentOptimizationCenter() {
  return (
    <WorkbenchCenter
      title="内容优化"
      subtitle="选中一篇内容，AI 帮你改标题、改结构、提质量"
      icon={Wand2}
      primaryAction={{ label: "开始优化", href: "/content/optimization?action=new" }}
      quickActions={[
        {
          key: "image-gen",
          title: "一句话生成图文",
          description: "输入主题，AI 出大纲、逐页配图",
          icon: ImagePlus,
          href: "/content/image-gen",
        },
        {
          key: "optimize-article",
          title: "优化文章",
          description: "改写标题、结构和表达",
          icon: FileEdit,
          href: "/content/optimization?type=article",
        },
        {
          key: "from-materials",
          title: "从素材选择",
          description: "挑一篇素材直接优化",
          icon: FolderOpen,
          href: "/materials",
        },
        {
          key: "ai-rewrite",
          title: "AI 一键改写",
          description: "输入原文，AI 自动优化",
          icon: Sparkles,
          href: "/content/optimization?action=ai",
        },
        {
          key: "copy-compare",
          title: "多平台批量对比",
          description: "同一条内容，各平台版本并排对比",
          icon: Columns2,
          href: "/copy-compare",
        },
      ]}
      advancedLinks={[
        { key: "articles", title: "我的文章", icon: FileText, href: "/content/articles" },
        { key: "history", title: "优化记录", icon: History, href: "/content/optimization?tab=history" },
        { key: "topics", title: "选题库", icon: Sparkles, href: "/topics" },
      ]}
    />
  );
}
