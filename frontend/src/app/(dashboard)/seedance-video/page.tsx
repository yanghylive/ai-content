import { QueryPreservingRedirect } from "@/lib/redirect-with-query";

/**
 * 路由收敛（2026-09-01 UX 审计 P1）：Seedance 快速生成已并入内容运营的「AI 生视频」
 * （/content/ai-video-gen），保留旧深链兼容跳转。
 */
export default function Page() {
  return <QueryPreservingRedirect target="/content/ai-video-gen" />;
}
