import { HybridRoute } from "@/components/v2/hybrid-route";
import { ContentOptimizationCenter } from "./content-optimization-center";
import LegacyPage from "./page-legacy";

export default function Page() {
  return <HybridRoute v2={<ContentOptimizationCenter />} legacy={<LegacyPage />} />;
}
