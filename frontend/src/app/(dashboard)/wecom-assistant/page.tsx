import { redirect } from "next/navigation";

/**
 * 企业微信助手路由收敛（2026-08-24 P1-2）：
 * /wecom-assistant 与 /engagement/wecom-assistant 渲染同一组件
 * WecomAssistantCenter，但前者包 GrayTestOverlay「仅可预览」遮罩、
 * 后者无遮罩——同功能双入口行为不一致。收敛到互动中心规范路径，
 * 旧深链 redirect 保底不丢上下文。
 */
export default function WecomAssistantV2Page() {
  redirect("/engagement/wecom-assistant");
}
