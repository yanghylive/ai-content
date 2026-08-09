import { HybridRoute } from "@/components/v2/hybrid-route";
import { CrmCenter } from "../crm/crm-center";
import LegacyPage from "./page-legacy";

export default function Page() {
  return <HybridRoute v2={<CrmCenter />} legacy={<LegacyPage />} />;
}
