import { redirect } from "next/navigation";

/**
 * 账号中心收敛（报告 4.6，大王拍板）：/platforms 列表页重定向到
 * /distribution/accounts（统一平台账号中心）。API token 账号的创建/编辑
 * 表单保留在 /platforms/new、/platforms/edit，从账号中心的「发布 API 账号」入口进入。
 */
export default function Page() {
  redirect("/distribution/accounts");
}
