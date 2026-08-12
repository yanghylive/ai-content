"use client";

import { Suspense, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";

function HybridRouteInner({
  legacy,
  v2,
  ignoreParams = [],
}: {
  legacy: ReactNode;
  v2: ReactNode;
  /** 由 v2 页面自消费、不应触发 legacy 切换的查询参数名 */
  ignoreParams?: string[];
}) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const params = Array.from(searchParams.entries());
  const meaningfulParams = params.filter(([key]) => !ignoreParams.includes(key));
  const hasParams = meaningfulParams.length > 0;

  if (!hasParams) return <>{v2}</>;

  // 掉进旧版完整功能页时，只给一个低调的返回入口，不暴露「旧版/新版」割裂
  return (
    <div className="kx-legacy-switch">
      <div className="kx-legacy-switch-bar">
        <button
          type="button"
          className="kx-legacy-switch-back"
          onClick={() => router.push(pathname)}
        >
          <ArrowLeft className="h-4 w-4" />
          返回
        </button>
      </div>
      <div className="kx-legacy-content">{legacy}</div>
    </div>
  );
}

/**
 * 混合路由：无查询参数时渲染 v2 新首页，带参数时渲染旧版完整功能页。
 * 这样 v2 里的"高级功能/详情"链接（?tab=xxx / ?edit=id 等）会自然落到旧版，
 * 既不破坏现有功能，又让首屏变成零成本学习的新体验。
 *
 * ignoreParams：v2 页面自消费的参数（如 ?filter=pending 由 v2 内过滤），
 * 传入后即使 URL 带这些参数也仍渲染 v2，不会误切到 legacy。
 */
export function HybridRoute({
  legacy,
  v2,
  ignoreParams,
}: {
  legacy: ReactNode;
  v2: ReactNode;
  ignoreParams?: string[];
}) {
  return (
    <Suspense fallback={null}>
      <HybridRouteInner legacy={legacy} v2={v2} ignoreParams={ignoreParams} />
    </Suspense>
  );
}
