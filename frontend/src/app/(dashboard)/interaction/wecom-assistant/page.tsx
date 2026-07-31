import { HybridRoute } from "@/components/v2/hybrid-route";
import { WecomAssistantCenter } from "./wecom-assistant-center";
import LegacyPage from "./page-legacy";

export default function Page() {
  return <HybridRoute v2={<WecomAssistantCenter />} legacy={<LegacyPage />} />;
}
