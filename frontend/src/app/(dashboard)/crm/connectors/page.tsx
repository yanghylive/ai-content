import { HybridRoute } from "@/components/v2/hybrid-route";
import { CrmConnectorsCenter } from "./crm-connectors-center";
import LegacyPage from "./page-legacy";

export default function Page() {
  return <HybridRoute v2={<CrmConnectorsCenter />} legacy={<LegacyPage />} />;
}
