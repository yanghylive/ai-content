"use client";

import { UnderConstruction } from "@/components/under-construction";

export default function Page() {
  return (
    <UnderConstruction
      title="朋友圈暂不支持"
      desc="朋友圈自动化发布触发微信平台风控，可能导致账号封禁。该功能已下线，如有需要请手动在微信中发布。"
      backHref="/engagement/wechat"
    />
  );
}
