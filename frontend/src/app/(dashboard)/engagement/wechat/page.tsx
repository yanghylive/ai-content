import { HybridRoute } from "@/components/v2/hybrid-route";
import { WechatTaskCenter } from "./wechat-task-center";
import { WechatWorkbenchClient } from "./wechat-workbench-client";
import { GrayTestOverlay } from "@/components/v2/gray-test-overlay";

export default function WechatWorkbenchPage() {
  return (
    <GrayTestOverlay feature="微信获客">
      <div>
        <div className="mx-container" style={{ maxWidth: 1100, margin: "0 auto", padding: "16px 20px 0" }} />
        <HybridRoute v2={<WechatTaskCenter />} legacy={<WechatWorkbenchClient />} />
      </div>
    </GrayTestOverlay>
  );
}
