import type { Metadata } from "next";
import { CollectionClient } from "../../components/collection-client";

interface CollectionPageProps {
  params: Promise<{ slug: string }>;
}

function titleFromSlug(slug: string): string {
  const words = slug
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return words.join(" ") || "案例合集";
}

export async function generateMetadata({
  params,
}: CollectionPageProps): Promise<Metadata> {
  const { slug } = await params;
  const title = `${titleFromSlug(slug)} - 案例合集 - 九章智能`;
  const description =
    "查看九章智能案例展示中心的案例合集：按行业、客户需求或会议主题组织的公开案例。";

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
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
// 合集数据经客户端 API（getCollection）按需拉取，构建期无法枚举真实 slug，
// 返回占位 slug 满足构建契约（Next 16 不允许空数组）。
export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  return [{ slug: "collection-placeholder" }];
}

export default async function CollectionPage({ params }: CollectionPageProps) {
  const { slug } = await params;
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <CollectionClient slug={slug} />
    </div>
  );
}
