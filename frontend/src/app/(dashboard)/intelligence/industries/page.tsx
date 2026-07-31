import { HybridRoute } from "@/components/v2/hybrid-route";
import { IndustryCenter } from "../_components/industry-center";
import LegacyPage from "./page-legacy";

export default function Page() {
  return <HybridRoute v2={<IndustryCenter />} legacy={<LegacyPage />} />;
}
