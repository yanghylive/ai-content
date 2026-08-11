"use client";

import { FeatureRoadmap } from "@/components/v2/feature-roadmap";

export default function Page() {
  return (
    <FeatureRoadmap
      title="朋友圈营销"
      desc="按营销日历自动发布朋友圈内容，配合获客与转化做私域运营。"
      status="路线图中（暂未开放）"
      eta="随桌面端微信 RPA 能力（C2）落地后开放"
      blocker="朋友圈自动化营销需要操控电脑端微信客户端（RPA）并依赖稳定账号矩阵，且受微信平台风控约束，需先沉淀可靠的发布策略。"
      workaround="先在电脑端规划营销日历与文案素材，用「去水印采集」「AI 文案」备好内容，再手工发布；批量自动化能力上线后会无缝衔接。"
      backHref="/engagement/wechat"
    />
  );
}
