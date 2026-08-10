"use client";

import { FeatureRoadmap } from "@/components/v2/feature-roadmap";

export default function Page() {
  return (
    <FeatureRoadmap
      title="微信群发"
      desc="向指定微信群批量发送消息，是商家维护老客、激活沉默群的高频需求。"
      status="已下线（风控原因）"
      eta="待桌面端微信 RPA 能力（C2）落地并沉淀可靠防封策略后重新评估"
      blocker="微信群发自动化触发微信平台风控，可能导致账号被封禁，该能力已主动下线，暂不提供自动化群发。"
      workaround="重要消息请在电脑端微信中手动发送；如需批量触达，可先用「自动获客」沉淀线索、用「AI 文案」准备好话术，再由人工逐个发送。"
      backHref="/engagement/wechat"
    />
  );
}
