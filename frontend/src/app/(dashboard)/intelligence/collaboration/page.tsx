import { HybridRoute } from "@/components/v2/hybrid-route";
import { CollaborationCenter } from "../_components/collaboration-center";
import LegacyPage from "./page-legacy";

export default function Page() {
  return <HybridRoute v2={<CollaborationCenter />} legacy={<LegacyPage />} />;
}
