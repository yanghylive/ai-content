import { QueryPreservingRedirect } from "@/lib/redirect-with-query";

/**
 * 结果留存去重（2026-08-26）：唯一正式路径为 /tasks/evidence，本页仅做兼容跳转。
 * 兼容跳转：客户端保留查询参数，不丢上下文（静态导出安全）。
 */
export default function Page() {
  return <QueryPreservingRedirect target="/tasks/evidence" />;
}
