"use client";

import React from "react";
import { ScenePage } from "@/components/shell/scene-page";
import { materialsApi } from "@/lib/api/materials";

export default function ContentScene() {
  const [materialCount, setMaterialCount] = React.useState(0);

  React.useEffect(() => {
    let active = true;
    materialsApi
      .collectStatus()
      .then((status) => {
        if (!active) return;
        const counts = (status as { counts?: Record<string, number> })
          ?.counts;
        setMaterialCount(counts?.total ?? counts?.new ?? 0);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  return (
    <ScenePage
      title="内容"
      sub="从选题到发布，一条流水线"
      hint={
        materialCount > 0
          ? {
              icon: "bulb",
              text: `素材库现有 ${materialCount} 条素材，可以直接拿去生成内容`,
              actionLabel: "去生成",
              href: "/content/articles",
            }
          : undefined
      }
      cards={[
        {
          icon: "bulb",
          tint: "kx-t-amber",
          title: "选题",
          desc: "AI 推荐选题，也可自己定",
          href: "/content/topics",
        },
        {
          icon: "pen",
          tint: "kx-t-blue",
          title: "内容生成",
          desc: "图文、小红书笔记、视频脚本",
          href: "/content/articles",
        },
        {
          icon: "video",
          tint: "kx-t-rose",
          title: "视频工坊",
          desc: "批量剪视频、换脸创作",
          href: "/content/video",
        },
        {
          icon: "archive",
          tint: "kx-t-violet",
          title: "素材库",
          desc: "自动采集的内容素材，可直接用",
          href: "/materials",
          badge: materialCount > 0 ? `${materialCount} 条` : undefined,
        },
        {
          icon: "download",
          tint: "kx-t-teal",
          title: "文章反抓",
          desc: "输入链接，一键提取文章内容",
          href: "/distribution-v2/scrape",
        },
        {
          icon: "sparkles",
          tint: "kx-t-cyan",
          title: "模板与风格",
          desc: "品牌风格、内容模板",
          href: "/content/templates",
        },
        {
          icon: "send",
          tint: "kx-t-green",
          title: "发布",
          desc: "一键发到各平台，发前自动合规检查",
          href: "/distribution-v2/publish-video",
        },
      ]}
    />
  );
}
