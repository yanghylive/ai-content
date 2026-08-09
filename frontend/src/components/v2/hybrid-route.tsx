"use client";

import { Suspense, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";

function HybridRouteInner({
  legacy,
  v2,
}: {
  legacy: ReactNode;
  v2: ReactNode;
}) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const hasParams = Array.from(searchParams.keys()).length > 0;

  if (!hasParams) return <>{v2}</>;

  // 掉进旧版完整功能页时，统一给一条"回新版"的逃生通道 + 收编页框
  return (
    <div className="kx-legacy-switch">
      <div className="kx-legacy-switch-bar">
        <button
          type="button"
          className="kx-legacy-switch-back"
          onClick={() => router.push(pathname)}
        >
          <ArrowLeft className="h-4 w-4" />
          返回列表
        </button>
        <span className="kx-legacy-switch-note">
          你在高级功能页（旧版完整功能），新版里常用的操作都简化了
        </span>
      </div>
      <div className="kx-legacy-content">{legacy}</div>
    </div>
  );
}

/**
 * 混合路由：无查询参数时渲染 v2 新首页，带参数时渲染旧版完整功能页。
 * 这样 v2 里的"高级功能/详情"链接（?tab=xxx / ?edit=id 等）会自然落到旧版，
 * 既不破坏现有功能，又让首屏变成零学习成本的新体验。
 */
export function HybridRoute({
  legacy,
  v2,
}: {
  legacy: ReactNode;
  v2: ReactNode;
}) {
  return (
    <Suspense fallback={null}>
      <HybridRouteInner legacy={legacy} v2={v2} />
    </Suspense>
  );
}
