"use client";

import { FeatureRoadmap } from "@/components/v2/feature-roadmap";

export default function Page() {
  return (
    <FeatureRoadmap
      title="朋友圈发布"
      desc="自动化发布朋友圈图文/视频内容，配合内容中心做朋友圈内容运营。"
      status="路线图中（暂未开放）"
      eta="随桌面端微信 RPA 能力（C2）落地后开放"
      blocker="朋友圈自动化发布需要操控电脑端微信客户端界面（RPA），且发布行为受微信平台风控约束，需先沉淀可靠的发布节奏与防封策略。"
      workaround="先用「去水印采集」准备素材、用「AI 文案」写好朋友圈文案，然后在电脑端微信手工发布；或使用「朋友圈营销日历」在桌面端规划发布计划。"
      backHref="/workbench/wechat-v2"
    />
  );
}
