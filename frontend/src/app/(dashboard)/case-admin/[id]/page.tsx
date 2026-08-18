import { EditCaseClient } from "./edit-case-client";

// output:export 要求动态路由段提供 generateStaticParams（Next 16 不允许空数组）。
// 管理后台案例编辑页经客户端 useParams 拿真实 id，构建期无法枚举，
// 返回占位 id 满足构建契约。
export async function generateStaticParams(): Promise<Array<{ id: string }>> {
  return [{ id: "placeholder" }];
}

export default async function EditCasePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <EditCaseClient id={id} />;
}
