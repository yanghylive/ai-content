import { redirect } from "next/navigation";

/** 旧任务控制台路由：已收口到 /agent-workbench（2026-08-11 路由归一） */
export default function Page() {
  redirect("/agent-workbench");
}
