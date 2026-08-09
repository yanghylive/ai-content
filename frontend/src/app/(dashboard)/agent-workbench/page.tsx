import { HybridRoute } from "@/components/v2/hybrid-route";
import { AgentWorkbenchCenter } from "./agent-workbench-center";
import LegacyPage from "./page-legacy";

export default function Page() {
  return <HybridRoute v2={<AgentWorkbenchCenter />} legacy={<LegacyPage />} />;
}
