import { redirect } from "next/navigation";

/**
 * 合规检查路由收敛（2026-08-25，大王拍板）：
 * 与 /compliance 渲染同一 ComplianceWorkbench，纯重复地址，
 * 收敛为 redirect；旧深链保底。
 */
export default function DistributionCompliancePage() {
  redirect("/compliance");
}
