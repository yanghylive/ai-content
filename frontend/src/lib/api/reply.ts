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
