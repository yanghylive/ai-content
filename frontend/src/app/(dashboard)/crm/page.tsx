import { HybridRoute } from "@/components/v2/hybrid-route";
import { CrmCenter } from "../crm/crm-center";
import LegacyPage from "./page-legacy";

export default function Page() {
  // ?filter=follow-up 由 v2 CrmCenter 客户端自消费（ignoreParams 避免误切 legacy 旧版）
  return (
    <HybridRoute
      v2={<CrmCenter />}
      legacy={<LegacyPage />}
      ignoreParams={["filter"]}
    />
  );
}
