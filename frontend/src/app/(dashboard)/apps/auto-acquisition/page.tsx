import { redirectPreservingQuery, type ServerSearchParams } from "@/lib/redirect-with-query";

/**
 * 自动获客收敛：/apps/auto-acquisition → /growth/acquisition（Sprint 5 T5.6）。
 * 兼容跳转：保留查询参数，不丢上下文。
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<ServerSearchParams>;
}) {
  redirectPreservingQuery("/growth/acquisition", await searchParams);
}
