"use client";

import { DesktopOnlyGate } from "@/components/v2/desktop-only-gate";
import { WechatTaskCenter } from "../../workbench/wechat/wechat-task-center";

export default function EngagementWechatPage() {
  return (
    <DesktopOnlyGate
      title="微信互动需在电脑端使用"
      desc="微信联系人/群定位、消息互动依赖电脑端桌面微信客户端，手机端暂不支持。你可以先用「微信 OCR」识别截图内容。"
      backHref="/workbench/wechat-v2"
    >
      <WechatTaskCenter />
    </DesktopOnlyGate>
  );
}
