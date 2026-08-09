import { HybridRoute } from "@/components/v2/hybrid-route";
import { VoiceAgentCenter } from "./voice-agent-center";
import LegacyPage from "./page-legacy";

export default function Page() {
  return <HybridRoute v2={<VoiceAgentCenter />} legacy={<LegacyPage />} />;
}
