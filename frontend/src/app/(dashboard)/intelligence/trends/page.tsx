import { HybridRoute } from "@/components/v2/hybrid-route";
import { TrendsRadarCenter } from "../_components/trends-radar-center";
import LegacyPage from "./page-legacy";

export default function Page() {
  return <HybridRoute v2={<TrendsRadarCenter />} legacy={<LegacyPage />} />;
}
