import { QueryPreservingRedirect } from "@/lib/redirect-with-query";

/**
 * 路由收敛（2026-09-01 UX 审计 P0）：策略中心 已并入 获客策略，
 * 保留旧深链兼容跳转（静态导出安全，不丢查询参数）。
 */
export default function Page() {
  return <QueryPreservingRedirect target="/growth/strategies" />;
}
