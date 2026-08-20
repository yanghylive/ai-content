import { HybridRoute } from "@/components/v2/hybrid-route";
import { WechatTaskCenter } from "./wechat-task-center";
import { WechatWorkbenchClient } from "./wechat-workbench-client";
import { GrayTestBanner } from "@/components/v2/gray-test-banner";

export default function WechatWorkbenchPage() {
  return (
    <div>
      <div className="mx-container" style={{ maxWidth: 1100, margin: "0 auto", padding: "16px 20px 0" }}>
        <GrayTestBanner feature="微信获客（桌面客户端）" />
      </div>
      <HybridRoute v2={<WechatTaskCenter />} legacy={<WechatWorkbenchClient />} />
    </div>
  );
}
