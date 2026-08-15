import { redirect } from "next/navigation";

/** RedFox 技能管理 · 运维隐藏入口(/admin 体系,用户端无入口) */
export default function Page() {
  redirect("/redfox-skills");
}
