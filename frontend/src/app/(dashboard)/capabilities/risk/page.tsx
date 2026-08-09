import { HybridRoute } from "@/components/v2/hybrid-route";
import { RiskCenter } from "./risk-center";
import LegacyPage from "./page-legacy";

export default function Page() {
  return <HybridRoute v2={<RiskCenter />} legacy={<LegacyPage />} />;
}
