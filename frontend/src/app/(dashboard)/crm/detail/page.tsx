"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * 旧版客户详情入口（P2-9 统一）：客户详情已统一到 /crm/customer?id=。
 * 保留 /crm/detail 路由并带参数跳转，避免历史深链/书签失效。
 */
export default function CustomerDetailRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const id = searchParams.get("id");
    router.replace(id ? `/crm/customer?id=${encodeURIComponent(id)}` : "/crm");
  }, [router, searchParams]);

  return null;
}
