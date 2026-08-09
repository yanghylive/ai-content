import { HybridRoute } from "@/components/v2/hybrid-route";
import { MonitorsCenter } from "../_components/monitors-center";
import LegacyPage from "./page-legacy";

export default function Page() {
  return <HybridRoute v2={<MonitorsCenter />} legacy={<LegacyPage />} />;
}
