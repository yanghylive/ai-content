import { HybridRoute } from "@/components/v2/hybrid-route";
import { XiaohongshuCenter } from "./xiaohongshu-center";
import LegacyPage from "./page-legacy";
import { V2BackButton } from "@/components/v2/v2-back-button";

export default function Page() {
  return (
    <div>
      <V2BackButton />
      <HybridRoute v2={<XiaohongshuCenter />} legacy={<LegacyPage />} />
    </div>
  );
}
