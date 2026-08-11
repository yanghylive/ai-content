import { api } from "@/lib/api/client";

/** AI 回复建议结果 */
export interface ReplySuggestionItem {
  tone: string; // friendly | formal | professional
  content: string;
}

export interface ReplySuggestResult {
  suggestions: ReplySuggestionItem[];
  source?: "ai" | "local";
  fallback?: ReplySuggestionItem[];
  fallbackMessage?: string;
  message?: string;
}

/* ---------- 评论洞察 analyze ---------- */

export interface CommentInsightItem {
  point: string;
  count: number;
  examples: string[];
}

export interface IntentKeywordItem {
  keyword: string;
  intentLevel: "purchase" | "consult" | "browse" | "unknown";
  count: number;
}

export interface TopQuestionItem {
  question: string;
  count: number;
}

export interface ReplySuggestionEntry {
  scenario: string;
  reply: string;
  tone?: string;
  source?: "rule" | "ai";
}

export interface ReplyRuleSuggestion {
  when: string;
  reply: string;
}

export interface CommentAnalyzeResult {
  insightId: string;
  platform: string;
  sourceType: string;
  sourceUrl?: string;
  workTitle?: string;
  analyzedCount: number;
  summary: string;
  painPoints: CommentInsightItem[];
  demands: CommentInsightItem[];
  objections: CommentInsightItem[];
  intentKeywords: IntentKeywordItem[];
  topQuestions: TopQuestionItem[];
  replySuggestions: ReplySuggestionEntry[];
  suggestedReplyRules: ReplyRuleSuggestion[];
  workflow?: { steps: Array<{ title: string; done: boolean }> };
}

export interface CommentInsightListItem {
  insightId: string;
  platform: string;
  sourceUrl?: string;
  workTitle?: string;
  analyzedCount: number;
  summary: string;
  createdAt: string;
}

export const commentInsightsApi = {
  /** 分析评论：痛点 / 需求 / 异议 / 意向词 / 高频问题 / 回复建议 */
  analyze(input: {
    platform?: string;
    sourceType?: string;
    sourceUrl?: string;
    workTitle?: string;
    productName?: string;
    keyword?: string;
    comments: Array<string | { id?: string; author?: string; content?: string; likedCount?: number }>;
  }) {
    return api.post<CommentAnalyzeResult>("/comment-insights/analyze", input);
  },
  /** 洞察记录列表 */
  list(params?: { platform?: string; sourceUrl?: string; keyword?: string }) {
    const qs = new URLSearchParams();
    if (params?.platform) qs.set("platform", params.platform);
    if (params?.sourceUrl) qs.set("sourceUrl", params.sourceUrl);
    if (params?.keyword) qs.set("keyword", params.keyword);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return api.get<{ items: CommentInsightListItem[]; total: number; message?: string; workflow?: unknown }>(
      `/comment-insights${suffix}`,
    );
  },
};

export const replyApi = {
  /** AI 生成单条评论的回复建议（2-3 版） */
  suggest(input: {
    comment: string;
    tone?: "formal" | "friendly" | "professional";
    productName?: string;
  }) {
    return api.post<ReplySuggestResult>("/comment-insights/reply/suggest", input);
  },
};
