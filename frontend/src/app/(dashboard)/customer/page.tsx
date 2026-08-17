import { redirect } from "next/navigation";

/**
 * 客户场景收敛：/customer → /crm（Sprint 5 T5.6，唯一客户入口）
 * 保留深链能力：带参数访问时仍重定向到统一入口，不丢上下文。
 */
export default function Page() {
  redirect("/crm");
}
