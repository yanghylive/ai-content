import { HybridRoute } from "@/components/v2/hybrid-route";
import { InboxProcessing } from "../_components/inbox-processing";
import LegacyPage from "./page-legacy";

export default function Page() {
  return <HybridRoute v2={<InboxProcessing />} legacy={<LegacyPage />} />;
}
