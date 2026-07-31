import { HybridRoute } from "@/components/v2/hybrid-route";
import { PlatformAccounts } from "./platform-accounts";
import LegacyPage from "./page-legacy";

export default function Page() {
  return <HybridRoute v2={<PlatformAccounts />} legacy={<LegacyPage />} />;
}
