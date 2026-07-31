import { HybridRoute } from "@/components/v2/hybrid-route";
import { CrmImportCenter } from "./crm-import-center";
import LegacyPage from "./page-legacy";

export default function Page() {
  return <HybridRoute v2={<CrmImportCenter />} legacy={<LegacyPage />} />;
}
