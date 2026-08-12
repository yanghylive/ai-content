import { HybridRoute } from "@/components/v2/hybrid-route";
import { CommercialReadinessCenter } from "./commercial-readiness-center";
import LegacyPage from "./page-legacy";
import { V2BackButton } from "@/components/v2/v2-back-button";

export default function Page() {
  // ?filter=pending|done 由 v2 center 客户端自消费（ignoreParams 避免误切 legacy）
  return (
    <div>
      <V2BackButton />
      <HybridRoute
        v2={<CommercialReadinessCenter />}
        legacy={<LegacyPage />}
        ignoreParams={["filter"]}
      />
    </div>
  );
}
