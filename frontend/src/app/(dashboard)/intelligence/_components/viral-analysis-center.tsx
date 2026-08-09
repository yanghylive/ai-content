"use client";

import {
  Flame,
  History,
  Search,
  TrendingUp,
} from "lucide-react";
import { WorkbenchCenter } from "@/components/v2/workbench-center";

export function ViralAnalysisCenter() {
  return (
    <WorkbenchCenter
      title="爆款分析"
      subtitle="拆解爆款内容的套路，复用到你的创作"
      icon={Flame}
      primaryAction={{ label: "分析新内容", href: "/intelligence/viral?action=new" }}
      quickActions={[
        {
          key: "analyze",
          title: "粘贴链接分析",
          description: "粘贴爆款链接，AI 拆解",
          icon: Search,
          href: "/intelligence/viral?action=analyze",
        },
        {
          key: "trending",
          title: "本周热门",
          description: "看你行业的热门爆款",
          icon: TrendingUp,
          href: "/intelligence/viral?filter=week",
        },
      ]}
      advancedLinks={[
        { key: "history", title: "分析记录", icon: History, href: "/intelligence/viral?tab=history" },
      ]}
    />
  );
}
