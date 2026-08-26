import { QueryPreservingRedirect } from "@/lib/redirect-with-query";

/**
 * RedFox 功能模板（原指向已删除的 /redfox-skills 死链，2026-08-26 修复）。
 * 兼容跳转：客户端保留查询参数，不丢上下文（静态导出安全）。
 */
export default function Page() {
  return <QueryPreservingRedirect target="/intelligence/skills" />;
}
