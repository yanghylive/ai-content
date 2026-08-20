import { redirect } from "next/navigation";

/**
 * 能力中心顶层路由：无独立页面，重定向到模型管理
 * （/capabilities 仅提供子路由：account/models/risk 等；APK 内不渲染 admin 后台）
 */
export default function CapabilitiesIndexPage() {
  redirect("/capabilities/models");
}
