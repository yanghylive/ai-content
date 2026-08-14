import { redirect } from "next/navigation";

/** 旧客户详情 v2 入口：详情功能已走 /crm/customer?id=（2026-08-11 路由归一） */
export default function CustomerDetailV2Page() {
  redirect("/crm/customer");
}
