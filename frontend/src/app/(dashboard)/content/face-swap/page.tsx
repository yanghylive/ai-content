"use client";

import { FeatureRoadmap } from "@/components/v2/feature-roadmap";

export default function Page() {
  return (
    <FeatureRoadmap
      title="AI 换脸视频"
      desc="将人物形象合成到视频素材中，用于数字人口播、真人出镜替代等场景。"
      status="暂未上线"
      eta="随 AI 视频生成能力成熟与合规评估通过后开放"
      blocker="换脸涉及肖像权与深度合成内容合规要求，需要先完成授权链路与内容安全审核机制，暂不对外提供。"
      workaround="视频内容请先用「视频工坊」做剪辑、「AI 视频生成」做文生视频；口播场景可用真人出镜或 AI 配音 + 图文形式替代。"
      backHref="/content"
    />
  );
}
