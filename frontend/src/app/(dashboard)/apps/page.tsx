import { HybridRoute } from "@/components/v2/hybrid-route";
import { AppsCenter } from "./apps-center";
import LegacyPage from "./page-legacy";
export default function Page() {
  return <HybridRoute v2={<AppsCenter />} legacy={<LegacyPage />} />;
}
