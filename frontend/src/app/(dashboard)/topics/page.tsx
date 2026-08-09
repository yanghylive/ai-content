import { HybridRoute } from "@/components/v2/hybrid-route";
import { TopicsCenter } from "./topics-center";
import LegacyPage from "./page-legacy";
export default function Page() {
  return <HybridRoute v2={<TopicsCenter />} legacy={<LegacyPage />} />;
}
