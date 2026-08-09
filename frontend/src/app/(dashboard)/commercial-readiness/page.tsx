import { HybridRoute } from "@/components/v2/hybrid-route";
import { CommercialReadinessCenter } from "./commercial-readiness-center";
import LegacyPage from "./page-legacy";

export default function Page() {
  return <HybridRoute v2={<CommercialReadinessCenter />} legacy={<LegacyPage />} />;
}
