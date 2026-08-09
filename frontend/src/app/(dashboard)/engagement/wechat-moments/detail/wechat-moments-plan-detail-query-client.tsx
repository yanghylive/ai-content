"use client";

import { useSearchParams } from "next/navigation";
import { WechatMomentsPlanDetailClient } from "../[id]/wechat-moments-plan-detail-client";

export function WechatMomentsPlanDetailQueryClient() {
  const searchParams = useSearchParams();
  return (
    <WechatMomentsPlanDetailClient
      planId={searchParams.get("planId")?.trim() || ""}
    />
  );
}
