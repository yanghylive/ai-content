"use client";

import { UnderConstruction } from "@/components/under-construction";

export default function Page() {
  return (
    <UnderConstruction
      title="朋友圈营销暂不支持"
      desc="朋友圈自动化营销触发微信平台风控，可能导致账号封禁。该功能已下线。"
      backHref="/workbench/wechat-v2"
    />
  );
}
