"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * 兼容跳转并保留查询参数（2026-08-26 导航复核修复）。
 *
 * 客户端实现（读取 window.location.search）而非服务端 await searchParams：
 * 本项目为 next 静态导出（output: export），服务端方案会让别名页无法预渲染。
 * 所有旧路径别名页统一渲染本组件，禁止 redirect(固定路径) 丢 query。
 */
export function QueryPreservingRedirect({ target }: { target: string }) {
  const router = useRouter();

  useEffect(() => {
    const qs = window.location.search;
    router.replace(qs ? `${target}${qs}` : target);
  }, [router, target]);

  return (
    <div
      role="status"
      aria-label="正在跳转"
      style={{
        minHeight: "40vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--kaypal-v3-muted, #64748b)",
        fontSize: 14,
      }}
    >
      正在跳转…
    </div>
  );
}
