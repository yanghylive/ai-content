import { HybridRoute } from "@/components/v2/hybrid-route";
import { FaceSwapCenter } from "./face-swap-center";
import LegacyPage from "./page-legacy";

export default function Page() {
  return <HybridRoute v2={<FaceSwapCenter />} legacy={<LegacyPage />} />;
}
