"use client";

import { UnderConstruction } from "@/components/under-construction";

export default function Page() {
  return (
    <UnderConstruction
      title="微信群发暂不支持"
      desc="微信群发自动化触发微信平台风控，可能导致账号封禁。该功能已下线，如有需要请手动在微信中发送。"
      backHref="/workbench/wechat-v2"
    />
  );
}
