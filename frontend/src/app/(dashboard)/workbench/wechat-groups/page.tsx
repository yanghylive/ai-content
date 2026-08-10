"use client";

import { FeatureRoadmap } from "@/components/v2/feature-roadmap";

export default function Page() {
  return (
    <FeatureRoadmap
      title="微信群发"
      desc="向指定微信群批量发送消息，支持定时与个性化内容。这是商家维护老客、激活沉默群的高频需求。"
      status="路线图中（暂未开放）"
      eta="随桌面端微信 RPA 能力（C2）落地后开放"
      blocker="群发自动化依赖电脑端微信客户端的界面操控（RPA），且高频群发容易触发微信平台风控，需要可靠的防封策略后才会上线。"
      workaround="先在电脑端用「微信互动」手工发送重要消息；批量触达建议先用「微信群发计划」功能在桌面端规划发送节奏（同样待 RPA 落地）。"
      backHref="/workbench/wechat-v2"
    />
  );
}
