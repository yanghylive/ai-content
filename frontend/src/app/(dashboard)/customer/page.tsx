import { redirectPreservingQuery, type ServerSearchParams } from "@/lib/redirect-with-query";

/**
 * 客户场景收敛：/customer → /crm（Sprint 5 T5.6，唯一客户入口）。
 * 兼容跳转：保留查询参数，不丢上下文。
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<ServerSearchParams>;
}) {
  redirectPreservingQuery("/crm", await searchParams);
}
