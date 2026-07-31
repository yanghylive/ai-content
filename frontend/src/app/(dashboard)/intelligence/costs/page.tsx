import { HybridRoute } from "@/components/v2/hybrid-route";
import { CostsCenter } from "../_components/costs-center";
import LegacyPage from "./page-legacy";

export default function Page() {
  return <HybridRoute v2={<CostsCenter />} legacy={<LegacyPage />} />;
}
