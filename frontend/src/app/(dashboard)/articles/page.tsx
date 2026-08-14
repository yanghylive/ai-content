import { redirect } from "next/navigation";

/** 旧文章库路由：已收口到 /content/articles（2026-08-11 路由归一） */
export default function ArticlesPage() {
  redirect("/content/articles");
}
