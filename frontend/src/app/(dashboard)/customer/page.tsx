import { QueryPreservingRedirect } from "@/lib/redirect-with-query";

/**
 * 客户场景收敛：/customer → /crm（Sprint 5 T5.6，唯一客户入口）。
 * 兼容跳转：客户端保留查询参数，不丢上下文（静态导出安全）。
 */
export default function Page() {
  return <QueryPreservingRedirect target="/crm" />;
}
