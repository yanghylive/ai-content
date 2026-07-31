import { HybridRoute } from "@/components/v2/hybrid-route";
import { StrategiesCenter } from "./strategies-center";
import LegacyPage from "./page-legacy";
export default function Page() {
  return <HybridRoute v2={<StrategiesCenter />} legacy={<LegacyPage />} />;
}
