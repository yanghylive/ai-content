import { redirect } from "next/navigation";

/**
 * 自动获客收敛：/apps/auto-acquisition → /growth/acquisition（Sprint 5 T5.6）
 * 保留深链能力：带参数访问时仍重定向到统一入口，不丢上下文。
 */
export default function Page() {
  redirect("/growth/acquisition");
}
