import { HybridRoute } from "@/components/v2/hybrid-route";
import { RedfoxSkillsCenter } from "../_components/redfox-skills-center";
import LegacyPage from "./page-legacy";

export default function Page() {
  return <HybridRoute v2={<RedfoxSkillsCenter />} legacy={<LegacyPage />} />;
}
