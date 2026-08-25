import { redirect } from "next/navigation";

/**
 * 合规检查路由收敛（2026-08-25，大王拍板）：
 * 全站唯一真页面为 /compliance（发布前内容合规检查 · 完整版：
 * handoff 带入 / 版本联动 / 发布准备 / 历史·评论·反馈复盘）。
 * 本地址原为简版 CheckFlow（无 handoff/版本联动），降级体验断档，
 * 收敛为 redirect；旧深链自动落到完整版。
 */
export default function ComplianceCheckV2Page() {
  redirect("/compliance");
}
