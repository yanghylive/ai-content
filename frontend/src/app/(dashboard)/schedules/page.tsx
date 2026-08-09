import { HybridRoute } from "@/components/v2/hybrid-route";
import { SchedulesCenter } from "./schedules-center";
import LegacyPage from "./page-legacy";
export default function Page() {
  return <HybridRoute v2={<SchedulesCenter />} legacy={<LegacyPage />} />;
}
