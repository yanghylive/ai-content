import { HybridRoute } from "@/components/v2/hybrid-route";
import { MaterialsCenter } from "./materials-center";
import LegacyPage from "./page-legacy";
export default function Page() {
  return <HybridRoute v2={<MaterialsCenter />} legacy={<LegacyPage />} />;
}
