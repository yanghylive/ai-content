import { HybridRoute } from "@/components/v2/hybrid-route";
import { MaterialsCenter } from "./materials-center";
import LegacyPage from "./page-legacy";
export default function Page() {
  // open 参数由 v2 新版自消费（?open=download 直达去水印弹层），不能触发 legacy 切换
  return <HybridRoute
    v2={<MaterialsCenter />}
    legacy={<LegacyPage />}
    ignoreParams={["open"]}
  />;
}
