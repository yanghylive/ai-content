import { HybridRoute } from "@/components/v2/hybrid-route";
import { ContentWorkspaceCenter } from "./content-workspace-center";
import LegacyPage from "./page-legacy";

export default function Page() {
  return (
    <HybridRoute
      v2={<ContentWorkspaceCenter />}
      legacy={<LegacyPage />}
    />
  );
}
