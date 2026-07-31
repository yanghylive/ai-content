import { HybridRoute } from "@/components/v2/hybrid-route";
import { SettingsDetail } from "./settings-detail";
import LegacyPage from "./page-legacy";

export default function Page() {
  return <HybridRoute v2={<SettingsDetail />} legacy={<LegacyPage />} />;
}
