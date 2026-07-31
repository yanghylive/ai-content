import { HybridRoute } from "@/components/v2/hybrid-route";
import { VideoWorkshopCenter } from "./video-workshop-center";
import LegacyPage from "./page-legacy";

export default function Page() {
  return (
    <HybridRoute
      v2={<VideoWorkshopCenter />}
      legacy={<LegacyPage />}
    />
  );
}
