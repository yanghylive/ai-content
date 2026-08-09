import { HybridRoute } from "@/components/v2/hybrid-route";
import { KnowledgeBaseCenter } from "./knowledge-base-center";
import LegacyPage from "./page-legacy";
export default function Page() {
  return <HybridRoute v2={<KnowledgeBaseCenter />} legacy={<LegacyPage />} />;
}
