import { HybridRoute } from "@/components/v2/hybrid-route";
import { AccountCenter } from "./account-center";
import LegacyPage from "./page-legacy";

export default function Page() {
  return <HybridRoute v2={<AccountCenter />} legacy={<LegacyPage />} />;
}
