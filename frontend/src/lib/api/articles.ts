import { api, PaginatedData } from "./client";

export type ArticleWorkspaceStep =
  | "brief"
  | "outline"
  | "draft"
  | "versions"
  | "review";

export type ArticleWorkspaceBriefField =
  | "goal"
  | "audience"
  | "platforms"
  | "deadline"
  | "action"
  | "constraints";

export type ArticleWorkspaceBriefFieldSource = {
  source: string;
  label: string;
  edited: boolean;
};

export type ArticleWorkspaceBrief = {
  goal: string;
  audience: string;
  platforms: string[];
  deadline: string | null;
  action: string;
  constraints: string;
  fieldSources?: Partial<
    Record<ArticleWorkspaceBriefField, ArticleWorkspaceBriefFieldSource>
  >;
};

export type ArticleWorkspaceOutlineItem = {
  id: string;
  title: string;
  summary: string;
};

export type ArticleWorkspaceOutline = {
  items: ArticleWorkspaceOutlineItem[];
  confirmedAt: string | null;
  confirmedItemsHash?: string | null;
  legacyBodyWithoutOutline?: true;
};

export interface Article {
  id: string;
  topicId: string | null;
  title: string;
  content: string;
  workspaceBrief?: ArticleWorkspaceBrief | null;
  workspaceOutline?: ArticleWorkspaceOutline | null;
  workspaceStep?: ArticleWorkspaceStep | null;
  workspaceRevision?: number | null;
  contentType: "article" | "xiaohongshu";
  contentFormat: "markdown" | "html";
  xiaohongshuData?: {
    title: string;
    caption: string;
    hashtags: string[];
    slides: Array<{
      role?:
        | "cover"
        | "hook"
        | "problem"
        | "solution"
        | "method"
        | "summary"
        | "cta";
      template?:
        | "cover-poster"
        | "insight-card"
        | "bullet-list"
        | "checklist-card"
        | "summary-card";
      title?: string;
      body?: string;
      bullets?: string[];
      highlight?: string;
      coverText: string;
      bodyText: string;
      imagePrompt: string;
      imageType: "real" | "ai" | "none";
      imageUrl: string | null;
      backgroundImageUrl?: string | null;
      cardImageUrl?: string | null;
    }>;
  } | null;
  wechatData?: {
    channel: "wechat-official-account";
    digest?: string;
    author?: string;
    coverPrompt?: string;
    sourceUrl?: string | null;
    sourceLedger?: Array<{ title: string; url: string; evidence: string }>;
    preview?: {
      visibility?: string;
      assetGate?: string;
      integratedRenderGate?: string;
      remoteRenderGate?: string;
    };
  } | null;
  rawHtml: string | null;
  finalHtml: string | null;
  coverImage: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  template?: {
    id: string;
    name: string;
  };
  topic?: {
    title: string;
    keywords: string[];
  };
}

export interface ArticleQuery {
  page?: number;
  limit?: number;
  keyword?: string;
  status?: string;
  contentType?: "article" | "xiaohongshu";
}

export type ArticleWorkspaceIntentTask =
  "create" | "rewrite" | "multiplatform" | "prepare";

export type ArticleWorkspaceIntentPlatform =
  "xiaohongshu" | "douyin" | "wechat" | "bilibili" | "tiktok";

export type ArticleWorkspaceIntentInput = {
  task: ArticleWorkspaceIntentTask;
  goal?: string;
  platforms?: ArticleWorkspaceIntentPlatform[];
};

export interface CreateArticleDraftInput {
  title?: string;
  content?: string;
  contentType?: "article" | "xiaohongshu";
  contentFormat?: "markdown" | "html";
  workspaceIntent?: ArticleWorkspaceIntentInput;
}

function buildQuery(params: Record<string, unknown>): string {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== "",
  );
  if (entries.length === 0) return "";
  return (
    "?" +
    entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&")
  );
}

export const articlesApi = {
  // 获取文章列表
  list(query: ArticleQuery = {}) {
    return api.get<PaginatedData<Article>>(
      `/articles${buildQuery(query as Record<string, unknown>)}`,
    );
  },

  // 获取详情
  getById(id: string) {
    return api.get<Article>(`/articles/${id}`);
  },

  createDraft(input: CreateArticleDraftInput = {}) {
    return api.post<Article>("/articles/drafts", input);
  },

  // 一键自动化生成图文文章
  generate(
    topicId: string,
    force = false,
    contentType: "article" | "xiaohongshu" = "article",
  ) {
    const params = new URLSearchParams();
    if (force) {
      params.set("force", "true");
    }
    if (contentType !== "article") {
      params.set("contentType", contentType);
    }
    const qs = params.toString() ? `?${params.toString()}` : "";
    return api.post<Article>(`/articles/${topicId}/generate${qs}`);
  },

  // 删除文章
  remove(id: string) {
    return api.delete<Article>(`/articles/${id}`);
  },

  // 更新文章内容
  update(id: string, data: Partial<Article>) {
    return api.put<Article>(`/articles/${id}`, data);
  },
};
