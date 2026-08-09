import { HybridRoute } from "@/components/v2/hybrid-route";
import { RedfoxConnectionCenter } from "../_components/redfox-connection-center";
import LegacyPage from "./page-legacy";

export default function Page() {
  return <HybridRoute v2={<RedfoxConnectionCenter />} legacy={<LegacyPage />} />;
}
