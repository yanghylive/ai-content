import { HybridRoute } from "@/components/v2/hybrid-route";
import { EngineHealthCenter } from "./engine-health-center";
import LegacyPage from "./local-engine-client";
export default function Page() {
  return <HybridRoute v2={<EngineHealthCenter />} legacy={<LegacyPage />} />;
}
