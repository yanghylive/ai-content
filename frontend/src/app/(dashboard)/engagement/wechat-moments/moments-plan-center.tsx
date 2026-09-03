"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api/client";

import {
  CalendarClock,
  History,
  Image as ImageIcon,
  Plus,
} from "@/components/iconpark";
import { WorkbenchCenter } from "@/components/v2/workbench-center";

export function MomentsPlanCenter() {
  const [stats, setStats] = useState({ active: 0, total: 0 });
  useEffect(() => {
    let active = true;
    api
      .get("/local-engine/groups/plans")
      .then((result) => {
        if (!active) return;
        const items = Array.isArray((result as { data?: unknown[] })?.data)
          ? (result as { data: unknown[] }).data
          : Array.isArray(result) ? (result as unknown[]) : [];
        setStats({
          total: items.length,
          active: items.filter((p) => (p as { status?: string }).status === "active" || (p as { status?: string }).status === "running").length,
        });
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);
  return (
    <WorkbenchCenter
      title="朋友圈计划"
      subtitle="查看和管理你的朋友圈发布计划"
      icon={CalendarClock}
      stats={[
        { label: "进行中计划", value: stats.active, tone: "accent" },
        { label: "全部计划", value: stats.total },
      ]}
      primaryAction={{ label: "新建计划", href: "/engagement/wechat/moments-publish" }}
      quickActions={[
        {
          key: "new",
          title: "新建计划",
          description: "创建新的朋友圈发布计划",
          icon: Plus,
          href: "/engagement/wechat/moments-publish",
        },
        {
          key: "active",
          title: "进行中",
          description: "查看正在执行的计划",
          icon: CalendarClock,
          href: "/engagement/wechat-moments?filter=active",
          badge: "3",
        },
        {
          key: "pending",
          title: "待确认",
          description: "等待确认的计划",
          icon: History,
          href: "/engagement/wechat-moments?filter=pending",
          badge: "2",
        },
      ]}
      advancedLinks={[
        { key: "records", title: "发布记录", icon: ImageIcon, href: "/engagement/wechat-moments?filter=all" },
      ]}
    />
  );
}
