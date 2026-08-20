import { WechatChatHistory } from "../../wechat/wechat-chat-history";
import { GrayTestBanner } from "@/components/v2/gray-test-banner";

export default function ChatHistoryPage() {
  return (
    <div>
      <div className="mx-container" style={{ maxWidth: 1100, margin: "0 auto", padding: "16px 20px 0" }}>
        <GrayTestBanner feature="微信聊天记录同步（桌面客户端）" />
      </div>
      <WechatChatHistory />
    </div>
  );
}
