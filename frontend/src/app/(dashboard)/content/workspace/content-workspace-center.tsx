"use client";

import { useEffect, useState } from "react";
import {
  Clock,
  FileEdit,
  FileText,
  FolderOpen,
  Send,
} from "lucide-react";
import { WorkbenchCenter } from "@/components/v2/workbench-center";
import { api } from "@/lib/api/client";

interface ArticleRow {
  id: string;
  status?: string;
  publishedAt?: string | null;
  updatedAt?: string;
}

export function ContentWorkspaceCenter() {
  const [stats, setStats] = useState({ draft: 0, ready: 0, published: 0 });

  // 真实文章统计（替代写死的示例数字）
  useEffect(() => {
    let active = true;
    api
      .get("/articles?limit=100")
      .then((result) => {
        if (!active) return;
        const data = result as { items?: ArticleRow[] } | ArticleRow[] | null;
        const items = (Array.isArray(data) ? data : data?.items || []) as ArticleRow[];
        const weekAgo = Date.now() - 7 * 86400000;
        setStats({
          draft: items.filter((a) => a.status === "draft").length,
          ready: items.filter((a) => a.status === "ready" || a.status === "reviewed").length,
          published: items.filter(
            (a) =>
              (a.status === "published" || a.publishedAt) &&
              new Date(a.publishedAt || a.updatedAt || 0).getTime() > weekAgo,
          ).length,
        });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  return (
    <WorkbenchCenter
      backHref="/content"
            title="内容工作区"
      subtitle="所有内容的统一入口：写文章、做笔记、管素材"
      icon={FileEdit}
      stats={[
        { label: "草稿", value: stats.draft },
        { label: "待发布", value: stats.ready, tone: stats.ready > 0 ? "warning" : "default" },
        { label: "本周已发", value: stats.published, tone: "success" },
      ]}
      primaryAction={{ label: "新建内容", href: "/content/workspace?action=new" }}
      quickActions={[
        {
          key: "write",
          title: "写文章",
          description: "从空白或模板开始",
          icon: FileEdit,
          href: "/content/workspace?type=article",
        },
        {
          key: "drafts",
          title: "继续草稿",
          description: "接着上次的内容写",
          icon: Clock,
          href: "/content/workspace?filter=draft",
          badge: stats.draft > 0 ? String(stats.draft) : undefined,
        },
        {
          key: "publish",
          title: "去发布",
          description: "确认并发布待发的内容",
          icon: Send,
          href: "/distribution",
          badge: stats.ready > 0 ? String(stats.ready) : undefined,
        },
      ]}
      advancedLinks={[
        { key: "articles", title: "全部文章", icon: FileText, href: "/content/articles" },
        { key: "materials", title: "素材库", icon: FolderOpen, href: "/materials" },
      ]}
    />
  );
}
