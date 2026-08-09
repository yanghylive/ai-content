import { HybridRoute } from "@/components/v2/hybrid-route";
import { WorkbenchHomeCenter } from "./workbench-home-center";
import LegacyPage from "./page-legacy";

export default function Page() {
  return <HybridRoute v2={<WorkbenchHomeCenter />} legacy={<LegacyPage />} />;
}
