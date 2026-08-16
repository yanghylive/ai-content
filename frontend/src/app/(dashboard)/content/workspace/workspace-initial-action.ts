/**
 * 内容工作区初始加载决策（P1-3：action=new 必须创建新草稿）。
 *
 * 从 content-workspace-client.tsx 的初始加载 useEffect 抽取，
 * 使路由参数 → 初始行为的映射可测试。
 */

export type WorkspaceInitialAction =
  | { type: "create-new" }
  | { type: "load"; articleId: string | null };

/**
 * 根据路由 search 参数决定工作区初始行为：
 * - action=new / create=true → 创建新草稿（优先级最高，即使带了 articleId 也新建）
 * - articleId / article（旧参数）→ 加载指定草稿
 * - 都没有 → 加载队列第一篇（articleId: null 由调用方 fallback）
 */
export function resolveWorkspaceInitialAction(
  search: string,
): WorkspaceInitialAction {
  const params = new URLSearchParams(search);
  // 报告 3.2：create=true（article-list 的「新建」入口）也必须创建新草稿，
  // 否则会被当成「无参数」fallback 到队列第一篇（打开旧文档）。
  if (params.get("action") === "new" || params.get("create") === "true") {
    return { type: "create-new" };
  }
  const articleId = params.get("articleId") || params.get("article");
  return { type: "load", articleId };
}
