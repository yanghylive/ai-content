import { HybridRoute } from "@/components/v2/hybrid-route";
import { XiaohongshuCenter } from "./xiaohongshu-center";
import LegacyPage from "./page-legacy";

export default function Page() {
  return (
    <HybridRoute
      v2={<XiaohongshuCenter />}
      legacy={<LegacyPage />}
    />
  );
}
