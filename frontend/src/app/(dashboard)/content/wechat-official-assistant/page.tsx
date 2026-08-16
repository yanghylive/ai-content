import { WechatOfficialAssistantClient } from "./wechat-official-assistant-client";
import { V2BackButton } from "@/components/v2/v2-back-button";

export default function Page() {
  return (
    <div>
      <V2BackButton />
      <WechatOfficialAssistantClient />
    </div>
  );
}
