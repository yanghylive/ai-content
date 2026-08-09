import { HybridRoute } from "@/components/v2/hybrid-route";
import { ViralAnalysisCenter } from "../_components/viral-analysis-center";
import LegacyPage from "./page-legacy";

export default function Page() {
  return <HybridRoute v2={<ViralAnalysisCenter />} legacy={<LegacyPage />} />;
}
