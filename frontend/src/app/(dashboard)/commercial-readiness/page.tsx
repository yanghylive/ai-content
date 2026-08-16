import { CommercialReadinessCenter } from "./commercial-readiness-center";
import { V2BackButton } from "@/components/v2/v2-back-button";

export default function Page() {
  // ?filter=pending|done 由 v2 center 的 useSearchParams 自消费
  return (
    <div>
      <V2BackButton />
      <CommercialReadinessCenter />
    </div>
  );
}
