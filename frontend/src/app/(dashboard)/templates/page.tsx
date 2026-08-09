import { HybridRoute } from "@/components/v2/hybrid-route";
import { TemplatesCenter } from "./templates-center";
import LegacyPage from "./page-legacy";
export default function Page() {
  return <HybridRoute v2={<TemplatesCenter />} legacy={<LegacyPage />} />;
}
