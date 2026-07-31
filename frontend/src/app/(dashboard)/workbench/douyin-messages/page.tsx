import { HybridRoute } from "@/components/v2/hybrid-route";
import { DouyinMessagesCenter } from "./douyin-messages-center";
import LegacyPage from "./page-legacy";

export default function Page() {
  return <HybridRoute v2={<DouyinMessagesCenter />} legacy={<LegacyPage />} />;
}
