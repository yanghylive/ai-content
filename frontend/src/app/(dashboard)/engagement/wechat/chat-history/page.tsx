import { WechatChatHistory } from "../../wechat/wechat-chat-history";
import { GrayTestOverlay } from "@/components/v2/gray-test-overlay";

export default function ChatHistoryPage() {
  return (
    <GrayTestOverlay feature="微信聊天记录同步">
      <div>
        <div className="mx-container" style={{ maxWidth: 1100, margin: "0 auto", padding: "16px 20px 0" }} />
        <WechatChatHistory />
      </div>
    </GrayTestOverlay>
  );
}
