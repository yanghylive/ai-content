import { redirectPreservingQuery, type ServerSearchParams } from "@/lib/redirect-with-query";

/**
 * 账号中心收敛（报告 4.6）：/platforms 列表页重定向到统一平台账号中心。
 * 兼容跳转：保留查询参数，不丢上下文。
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<ServerSearchParams>;
}) {
  redirectPreservingQuery("/distribution/accounts", await searchParams);
}
