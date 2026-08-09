import { HybridRoute } from "@/components/v2/hybrid-route";
import { SolutionsCenter } from "./solutions-center";
import LegacyPage from "./page-legacy";
export default function Page() {
  return <HybridRoute v2={<SolutionsCenter />} legacy={<LegacyPage />} />;
}
