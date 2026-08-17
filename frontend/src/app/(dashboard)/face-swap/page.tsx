import { redirect } from "next/navigation";

/**
 * 特效页收敛：/face-swap → /content/face-swap（Sprint 5 T5.6）
 * 保留深链能力：带参数访问时仍重定向到统一入口，不丢上下文。
 */
export default function Page() {
  redirect("/content/face-swap");
}
