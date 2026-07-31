import { HybridRoute } from "@/components/v2/hybrid-route";
import { WechatTaskCenter } from "./wechat-task-center";
import { WechatWorkbenchClient } from "./wechat-workbench-client";

export default function WechatWorkbenchPage() {
  return <HybridRoute v2={<WechatTaskCenter />} legacy={<WechatWorkbenchClient />} />;
}
