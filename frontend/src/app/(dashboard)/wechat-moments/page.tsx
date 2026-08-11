"use client";

import { FeatureRoadmap } from "@/components/v2/feature-roadmap";

export default function Page() {
  return (
    <FeatureRoadmap
      title="朋友圈发布"
      desc="自动化发布朋友圈图文/视频内容，配合内容中心做朋友圈运营。"
      status="已下线（风控原因）"
      eta="待桌面端微信 RPA 能力（C2）落地并沉淀可靠防封策略后重新评估"
      blocker="朋友圈自动化发布触发微信平台风控，可能导致账号被封禁，该能力已主动下线，暂不提供自动化发布。"
      workaround="先用「去水印采集」准备素材、用「AI 文案」写好朋友圈文案，然后在电脑端微信手动发布；朋友圈运营建议以低频、精品内容为主。"
      backHref="/engagement/wechat"
    />
  );
}
