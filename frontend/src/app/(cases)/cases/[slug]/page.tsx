import type { Metadata } from "next";
import { CaseDetailClient } from "../../components/case-detail-client";

interface DetailPageProps {
  params: Promise<{ slug: string }>;
}

function titleFromSlug(slug: string): string {
  const words = slug
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return words.join(" ") || "案例";
}

export async function generateMetadata({
  params,
}: DetailPageProps): Promise<Metadata> {
  const { slug } = await params;
  const title = `${titleFromSlug(slug)} - 案例详情 - 九章智能`;
  const description =
    "查看九章智能案例展示中心的公开案例详情：业务问题、解决方案、关键特性与结果证据。";

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "article",
    },
    robots: {
      index: true,
      follow: true,
      nocache: false,
      noarchive: false,
      nosnippet: false,
    },
  };
}

// output:export 要求动态路由段提供 generateStaticParams 且至少生成一条路由。
// 案例数据经客户端 API（getCase）按需拉取，构建期无法枚举真实 slug，
// 返回占位 slug 满足构建契约（Next 16 不允许空数组）；该占位页在客户端
// 命中 404 时展示"案例不存在或尚未发布"。真实案例静态页需在开发中
// 从静态数据源枚举 slug（见 /cases 列表页数据源）。
export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  return [{ slug: "case-placeholder" }];
}

export default async function CaseDetailPage({ params }: DetailPageProps) {
  const { slug } = await params;
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <CaseDetailClient slug={slug} />
    </div>
  );
}
