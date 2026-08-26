import { redirect } from "next/navigation";

/** 服务端组件 searchParams 形状（Next 15+：Promise 由页面侧 await 后传入） */
export type ServerSearchParams = Record<string, string | string[] | undefined>;

/**
 * 兼容跳转并保留查询参数（2026-08-26 导航复核修复）。
 * 所有旧路径别名页统一走这里，禁止 redirect(固定路径) 丢 query。
 */
export function redirectPreservingQuery(
  target: string,
  searchParams?: ServerSearchParams,
): never {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) qs.append(key, item);
  }
  const query = qs.toString();
  redirect(query ? `${target}?${query}` : target);
}
