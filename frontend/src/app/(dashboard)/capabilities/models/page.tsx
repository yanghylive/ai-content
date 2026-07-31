import { HybridRoute } from "@/components/v2/hybrid-route";
import { ModelsCenter } from "./models-center";
import LegacyPage from "./page-legacy";
export default function Page() {
  return <HybridRoute v2={<ModelsCenter />} legacy={<LegacyPage />} />;
}
