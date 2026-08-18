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

// output:export 要求动态路由段提供 generateStaticParams。
// 构建期从后端公开 API 枚举已发布案例 slug，为每个真实案例生成静态详情页（SEO 友好）。
// 若构建期后端不可达或暂无案例，回退占位 slug 满足构建契约。
export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:3011";
  try {
    const res = await fetch(`${apiBase}/api/v1/cases?limit=500`, {
      cache: "no-store",
    });
    if (!res.ok) {
      return [{ slug: "case-placeholder" }];
    }
    const json = (await res.json()) as {
      data?: { data?: Array<{ slug?: string }> };
    };
    const slugs = (json?.data?.data ?? [])
      .map((c) => c.slug)
      .filter((s): s is string => typeof s === "string" && s.length > 0)
      .map((slug) => ({ slug }));
    return slugs.length > 0 ? slugs : [{ slug: "case-placeholder" }];
  } catch {
    return [{ slug: "case-placeholder" }];
  }
}

export default async function CaseDetailPage({ params }: DetailPageProps) {
  const { slug } = await params;
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <CaseDetailClient slug={slug} />
    </div>
  );
}
