import { kaypalApi, type KaypalKnowledgeSearchHit } from "@/lib/api/auth";

const DEFAULT_LIMIT = 3;

export type KaypalKnowledgeContextInput = {
  query: string;
  limit?: number;
  sourceTypes?: string[];
};

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function formatKaypalKnowledgeContext(matches: KaypalKnowledgeSearchHit[]) {
  const usefulMatches = matches
    .filter((item) => item.snippet.trim())
    .slice(0, 5);

  if (!usefulMatches.length) return "";

  return [
    "知识库参考（本机优先，叠加云端）：",
    ...usefulMatches.map((item, index) => {
      const score = Number.isFinite(item.relevanceScore)
        ? `，相关度 ${Math.round(item.relevanceScore * 100)}%`
        : "";
      return `${index + 1}. ${item.title}${score}：${normalizeText(item.snippet)}`;
    }),
    "使用要求：仅把以上内容作为事实参考；如与当前客户上下文冲突，以当前客户上下文为准；不要编造知识库没有的信息。",
  ].join("\n");
}

export function appendKaypalKnowledgeContext(baseContext: string, knowledgeContext: string) {
  return [baseContext.trim(), knowledgeContext.trim()].filter(Boolean).join("\n\n");
}

export async function resolveKaypalKnowledgeContext(input: KaypalKnowledgeContextInput) {
  const query = normalizeText(input.query);
  if (!query) return "";

  const result = await kaypalApi.searchKnowledge({
    query,
    limit: input.limit ?? DEFAULT_LIMIT,
    sourceTypes: input.sourceTypes,
  });

  return formatKaypalKnowledgeContext(result.matches);
}
