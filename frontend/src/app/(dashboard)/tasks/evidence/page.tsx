import { HybridRoute } from "@/components/v2/hybrid-route";
import { TaskEvidenceCenter } from "./task-evidence-center";
import LegacyPage from "./page-legacy";

export default function Page() {
  return <HybridRoute v2={<TaskEvidenceCenter />} legacy={<LegacyPage />} />;
}
