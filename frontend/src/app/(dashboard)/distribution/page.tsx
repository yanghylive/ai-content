import { HybridRoute } from "@/components/v2/hybrid-route";
import { PublishCenter } from "./publish-center";
import LegacyPage from "./page-legacy";
export default function Page() {
  return <HybridRoute v2={<PublishCenter />} legacy={<LegacyPage />} />;
}
