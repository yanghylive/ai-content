import { Suspense } from "react";
import { WechatMomentsPlanDetailLoading } from "../[id]/wechat-moments-plan-detail-client";
import { WechatMomentsPlanDetailQueryClient } from "./wechat-moments-plan-detail-query-client";

export default function WechatMomentsPlanDetailPage() {
  return (
    <Suspense fallback={<WechatMomentsPlanDetailLoading />}>
      <WechatMomentsPlanDetailQueryClient />
    </Suspense>
  );
}
