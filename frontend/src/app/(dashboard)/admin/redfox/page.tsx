import { redirect } from "next/navigation";

/** RedFox 连接配置 · 运维隐藏入口(/admin 体系,用户端无入口) */
export default function Page() {
  redirect("/redfox-connection");
}
