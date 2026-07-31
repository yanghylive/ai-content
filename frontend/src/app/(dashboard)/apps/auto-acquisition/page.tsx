import { HybridRoute } from "@/components/v2/hybrid-route";
import { AutoAcquisitionCenter } from "./auto-acquisition-center";
import LegacyPage from "./page-legacy";

export default function Page() {
  return <HybridRoute v2={<AutoAcquisitionCenter />} legacy={<LegacyPage />} />;
}
