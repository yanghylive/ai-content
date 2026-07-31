import { HybridRoute } from "@/components/v2/hybrid-route";
import { WechatOfficialCenter } from "./wechat-official-center";
import LegacyPage from "./page-legacy";

export default function Page() {
  return (
    <HybridRoute
      v2={<WechatOfficialCenter />}
      legacy={<LegacyPage />}
    />
  );
}
