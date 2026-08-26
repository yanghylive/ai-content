import { QueryPreservingRedirect } from "@/lib/redirect-with-query";

/**
 * 企业微信助手路由收敛（2026-08-24 P1-2）：旧深链统一到互动中心规范路径。
 * 兼容跳转：客户端保留查询参数，不丢上下文（静态导出安全）。
 */
export default function Page() {
  return <QueryPreservingRedirect target="/engagement/wecom-assistant" />;
}
