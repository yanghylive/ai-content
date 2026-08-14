import { redirect } from "next/navigation";

/** 旧 /interaction/* 路由：已按 routeAliases 收口规范直连 /engagement/*（2026-08-11 路由归一） */
export default function Page() {
  redirect("/engagement/wecom-assistant");
}
