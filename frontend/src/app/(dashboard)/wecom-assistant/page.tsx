import { redirectPreservingQuery, type ServerSearchParams } from "@/lib/redirect-with-query";

/**
 * 企业微信助手路由收敛（2026-08-24 P1-2）：旧深链统一到互动中心规范路径。
 * 兼容跳转：保留查询参数，不丢上下文。
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<ServerSearchParams>;
}) {
  redirectPreservingQuery("/engagement/wecom-assistant", await searchParams);
}
