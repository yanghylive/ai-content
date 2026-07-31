import { HybridRoute } from "@/components/v2/hybrid-route";
import { ComplianceCenter } from "./compliance-center";
import LegacyPage from "./page-legacy";

export default function Page() {
  return <HybridRoute v2={<ComplianceCenter />} legacy={<LegacyPage />} />;
}
