import { redirect } from "next/navigation";

/**
 * 成交跟进收敛：/crm-closer → /crm/closer（Sprint 5 T5.6）
 * 保留深链能力：带参数访问时仍重定向到统一入口，不丢上下文。
 */
export default function Page() {
  redirect("/crm/closer");
}
