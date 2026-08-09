import { HybridRoute } from "@/components/v2/hybrid-route";
import { SearchIntelligenceWorkbench as SearchV2 } from "../_components/search-intelligence-workbench-v2";
import { SearchIntelligenceWorkbench as SearchLegacy } from "../_components/search-intelligence-workbench";

export default function IntelligenceSearchPage() {
  return <HybridRoute v2={<SearchV2 />} legacy={<SearchLegacy />} />;
}
