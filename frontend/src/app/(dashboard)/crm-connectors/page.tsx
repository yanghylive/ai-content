import { redirect } from "next/navigation";

/**
 * 连接器页收敛：/crm-connectors → /crm/connectors（Sprint 5 T5.6）
 * 保留深链能力：带参数访问时仍重定向到统一入口，不丢上下文。
 */
export default function Page() {
  redirect("/crm/connectors");
}
