import { WechatWorkbenchClient } from "../wechat/wechat-workbench-client";

export default function WechatGroupsPage() {
  return <WechatWorkbenchClient initialModule="mass-send" />;
}
