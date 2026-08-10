"use client";

import {
  Download,
  History,
  Image as ImageIcon,
  Upload,
  Wand2,
} from "lucide-react";
import { WorkbenchCenter } from "@/components/v2/workbench-center";

export function FaceSwapCenter() {
  return (
    <WorkbenchCenter
      title="换脸创作"
      subtitle="上传照片和模板，AI 生成换脸视频或图片"
      icon={Wand2}
      primaryAction={{ label: "开始创作", href: "/face-swap/create" }}
      quickActions={[
        {
          key: "upload",
          title: "上传照片",
          description: "上传要换脸的照片",
          icon: Upload,
          href: "/content/face-swap?action=upload",
        },
        {
          key: "templates",
          title: "选模板",
          description: "挑一个换脸模板",
          icon: ImageIcon,
          href: "/content/face-swap?action=templates",
        },
        {
          key: "downloads",
          title: "可下载",
          description: "查看已生成的作品",
          icon: Download,
          href: "/face-swap/works",
        },
      ]}
      advancedLinks={[
        { key: "history", title: "创作记录", icon: History, href: "/content/face-swap?tab=history" },
      ]}
    />
  );
}
