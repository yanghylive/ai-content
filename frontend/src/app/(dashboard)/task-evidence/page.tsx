import { redirectPreservingQuery, type ServerSearchParams } from "@/lib/redirect-with-query";

/**
 * 结果留存去重（2026-08-26）：唯一正式路径为 /tasks/evidence，本页仅做兼容跳转。
 * 兼容跳转：保留查询参数，不丢上下文。
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<ServerSearchParams>;
}) {
  redirectPreservingQuery("/tasks/evidence", await searchParams);
}
