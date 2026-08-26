import { QueryPreservingRedirect } from "@/lib/redirect-with-query";

/**
 * 自动获客收敛：/apps/auto-acquisition → /growth/acquisition（Sprint 5 T5.6）。
 * 兼容跳转：客户端保留查询参数，不丢上下文（静态导出安全）。
 */
export default function Page() {
  return <QueryPreservingRedirect target="/growth/acquisition" />;
}
