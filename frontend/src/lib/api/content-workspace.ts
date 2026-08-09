import { kaypalApi } from "@/lib/api/auth";
import { type Article, articlesApi } from "@/lib/api/articles";
import { api, ApiError } from "@/lib/api/client";
import {
  createPublishPreparation,
  listContentOptimizationVersions,
  saveContentOptimizationVersion,
  setOfficialContentVersion,
} from "@/lib/api/content-optimization";
import { materialsApi } from "@/lib/api/materials";
import type {
  ContentWorkspaceArticleUpdate,
  ContentWorkspaceCapabilities,
  ContentWorkspaceComplianceCheckInput,
  ContentWorkspaceComplianceCheckResult,
  ContentWorkspaceCreateDraftInput,
  ContentWorkspaceCreateDraftResult,
  ContentWorkspaceDocument,
  ContentWorkspaceFailure,
  ContentWorkspaceKnowledgeQuery,
  ContentWorkspaceKnowledgeResult,
  ContentWorkspaceMaterial,
  ContentWorkspaceMaterialQuery,
  ContentWorkspacePage,
  ContentWorkspacePreparePublishInput,
  ContentWorkspacePublishPreparation,
  ContentWorkspaceQueueItem,
  ContentWorkspaceQueueQuery,
  ContentWorkspaceSaveVersionInput,
  ContentWorkspaceVersion,
  ContentWorkspaceVersionList,
  ContentWorkspaceVersionQuery,
} from "@/lib/content-workspace-types";
import {
  completeWorkspaceBriefFieldSources,
  createEmptyWorkspaceOutline,
} from "@/lib/content-workspace-types";

const capabilities: ContentWorkspaceCapabilities = {
  contractVersion: 1,
  queue: { available: true, source: "articles" },
  articleDetails: { available: true, source: "articles" },
  articleUpdate: {
    available: true,
    requiresPersistedArticle: true,
    source: "articles",
  },
  blankDraftCreation: {
    available: true,
    persistentCreate: true,
    persistence: "server",
    endpoint: "POST /articles/drafts",
    fallback: "none",
    failureContract: "explicit_result",
  },
  materials: { available: true, source: "materials" },
  versions: {
    available: true,
    source: "content-optimization",
    lookupKey: "optimization_draft_id",
    articleAssociation: "source_reference_on_first_save",
  },
  knowledge: { available: true, source: "kaypal-knowledge" },
  publishPreparation: {
    available: true,
    requiresPersistedVersion: true,
    executesPublish: false,
    source: "content-optimization",
    preconditions: [
      "official_version",
      "compliance_check",
      "manual_review_when_required",
    ],
  },
};

function normalizedExcerpt(value: string | undefined, limit = 120) {
  const normalized = (value || "").replace(/\s+/g, " ").trim();
  return normalized.length > limit
    ? `${normalized.slice(0, limit).trimEnd()}...`
    : normalized;
}

function toQueueItem(article: Article): ContentWorkspaceQueueItem {
  return {
    id: article.id,
    source: "article",
    persisted: true,
    title: article.title,
    summary: normalizedExcerpt(article.content),
    status: article.status,
    contentType: article.contentType,
    contentFormat: article.contentFormat,
    topic: article.topic
      ? {
          id: article.topicId,
          title: article.topic.title,
          keywords: article.topic.keywords,
        }
      : null,
    coverImage: article.coverImage,
    createdAt: article.createdAt,
    updatedAt: article.updatedAt,
  };
}

function suggestedWorkspaceBrief(article: Article) {
  const topicTitle = article.topic?.title?.trim();
  const articleTitle = article.title.trim();
  const subject = topicTitle || (articleTitle !== "未命名内容" ? articleTitle : "");
  const keywords = article.topic?.keywords?.filter(Boolean).slice(0, 3) || [];
  const isXiaohongshu = article.contentType === "xiaohongshu";
  return {
    goal: subject
      ? `围绕「${subject.slice(0, 80)}」形成可审核主稿`
      : "形成一篇可审核、可交接的内容主稿",
    audience: keywords.length
      ? `关注${keywords.join("、")}的目标读者`
      : "当前品牌的目标读者",
    platforms: isXiaohongshu ? ["xiaohongshu"] : [],
    deadline: null,
    action: "阅读后完成与内容目标一致的下一步行动",
    constraints: "仅使用可验证事实；避免绝对化承诺",
    fieldSources: {
      goal: {
        source: topicTitle ? "topic" : subject ? "article_title" : "workflow_default",
        label: topicTitle
          ? "根据关联选题预填"
          : subject
            ? "根据草稿标题预填"
            : "工作流默认，可修改",
        edited: false,
      },
      audience: {
        source: keywords.length ? "topic_keywords" : "workflow_default",
        label: keywords.length ? "根据选题关键词建议" : "工作流默认，可修改",
        edited: false,
      },
      platforms: {
        source: isXiaohongshu ? "content_type" : "unavailable",
        label: isXiaohongshu ? "根据内容类型预填" : "未指定发布平台",
        edited: false,
      },
      deadline: {
        source: "unavailable",
        label: "未关联营销任务，可选填",
        edited: false,
      },
      action: {
        source: "workflow_default",
        label: "工作流默认，可修改",
        edited: false,
      },
      constraints: {
        source: "compliance_default",
        label: "内容合规默认约束",
        edited: false,
      },
    },
  };
}

function toDocument(article: Article): ContentWorkspaceDocument {
  const legacyBodyEditable = Boolean(
    article.content.trim() &&
      ((article.workspaceBrief == null && article.workspaceOutline == null) ||
        article.workspaceOutline?.legacyBodyWithoutOutline === true),
  );
  return {
    id: article.id,
    source: "article",
    persisted: true,
    topicId: article.topicId,
    title: article.title,
    content: article.content,
    workspaceBrief:
      article.workspaceBrief == null
        ? suggestedWorkspaceBrief(article)
        : completeWorkspaceBriefFieldSources(article.workspaceBrief),
    workspaceOutline: article.workspaceOutline ?? createEmptyWorkspaceOutline(),
    workspaceStep: article.workspaceStep ?? "brief",
    workspaceRevision: article.workspaceRevision ?? 1,
    legacyBodyEditable,
    contentType: article.contentType,
    contentFormat: article.contentFormat,
    xiaohongshuData: article.xiaohongshuData,
    wechatData: article.wechatData,
    rawHtml: article.rawHtml,
    finalHtml: article.finalHtml,
    coverImage: article.coverImage,
    status: article.status,
    template: article.template ?? null,
    topic: article.topic ?? null,
    createdAt: article.createdAt,
    updatedAt: article.updatedAt,
  };
}

function toFailure(error: unknown): ContentWorkspaceFailure {
  if (error instanceof ApiError) {
    const endpointUnavailable = error.status === 404 || error.status === 405;
    const networkError = error.code === "NETWORK_ERROR";
    const timeout = error.code === "TIMEOUT";
    const code = endpointUnavailable
      ? "endpoint_unavailable"
      : networkError
        ? "network_error"
        : timeout
          ? "timeout"
          : "request_rejected";

    return {
      code,
      message: error.message,
      retryable:
        networkError || timeout || error.status === 408 || error.status >= 500,
      httpStatus: error.status || null,
      serverCode: error.errorCode,
      requestId: error.requestId,
      details: error.details,
    };
  }

  return {
    code: "unknown",
    message: error instanceof Error ? error.message : "创建草稿失败",
    retryable: false,
    httpStatus: null,
    serverCode: null,
    requestId: null,
    details: null,
  };
}

function toVersion(
  version: Awaited<ReturnType<typeof listContentOptimizationVersions>>["items"][number],
): ContentWorkspaceVersion {
  return {
    ...version,
    source: "content-optimization",
    persisted: true,
  };
}

export const contentWorkspaceApi = {
  getCapabilities(): ContentWorkspaceCapabilities {
    return capabilities;
  },

  async createDraft(
    input: ContentWorkspaceCreateDraftInput = {},
  ): Promise<ContentWorkspaceCreateDraftResult> {
    try {
      const article = await articlesApi.createDraft(input);
      return {
        ok: true,
        persistence: "server",
        persisted: true,
        document: toDocument(article),
      };
    } catch (error) {
      const failure = toFailure(error);
      return {
        ok: false,
        persistence: "none",
        persisted: false,
        failure,
        recovery: {
          retainUnsavedInput: true,
          retryable: failure.retryable,
        },
      };
    }
  },

  async listQueue(
    query: ContentWorkspaceQueueQuery = {},
  ): Promise<ContentWorkspacePage<ContentWorkspaceQueueItem>> {
    const result = await articlesApi.list(query);
    return {
      ...result,
      items: result.items.map(toQueueItem),
    };
  },

  async getDocument(articleId: string): Promise<ContentWorkspaceDocument> {
    return toDocument(await articlesApi.getById(articleId));
  },

  async updateArticle(
    articleId: string,
    input: ContentWorkspaceArticleUpdate,
  ): Promise<ContentWorkspaceDocument> {
    return toDocument(await articlesApi.update(articleId, input));
  },

  async listMaterials(
    query: ContentWorkspaceMaterialQuery = {},
  ): Promise<ContentWorkspacePage<ContentWorkspaceMaterial>> {
    const result = await materialsApi.list(query);
    return {
      ...result,
      items: result.items.map((material) => ({
        ...material,
        source: "material" as const,
        persisted: true as const,
        excerpt: normalizedExcerpt(material.summary || material.content),
      })),
    };
  },

  async listVersions(
    query: ContentWorkspaceVersionQuery = {},
  ): Promise<ContentWorkspaceVersionList> {
    const sourceType =
      query.sourceType ?? (!query.draftId && query.documentId ? "article" : undefined);
    const sourceId =
      query.sourceId ?? (!query.draftId ? query.documentId : undefined);
    const result = await listContentOptimizationVersions({
      draftId: query.draftId,
      sourceType,
      sourceId,
      platform: query.platform,
      status: query.status,
    });
    return {
      total: result.total,
      items: result.items.map(toVersion),
    };
  },

  async saveVersion(
    input: ContentWorkspaceSaveVersionInput,
  ): Promise<ContentWorkspaceVersion> {
    const {
      documentId,
      draftId,
      sourceId,
      sourceType,
      ...versionInput
    } = input;
    const version = await saveContentOptimizationVersion({
      ...versionInput,
      draftId,
      sourceType: sourceType ?? (documentId ? "article" : undefined),
      sourceId: sourceId ?? documentId,
    });
    return {
      ...version,
      source: "content-optimization",
      persisted: true,
    };
  },

  async setOfficialVersion(versionId: string): Promise<ContentWorkspaceVersion> {
    return toVersion(await setOfficialContentVersion(versionId));
  },

  async searchKnowledge(
    input: ContentWorkspaceKnowledgeQuery,
  ): Promise<ContentWorkspaceKnowledgeResult> {
    const result = await kaypalApi.searchKnowledge(input);
    return {
      ...result,
      source: "kaypal-knowledge",
    };
  },

  async checkCompliance(
    input: ContentWorkspaceComplianceCheckInput,
  ): Promise<ContentWorkspaceComplianceCheckResult> {
    return api.post<ContentWorkspaceComplianceCheckResult>(
      "/compliance/check",
      input,
    );
  },

  async preparePublish(
    input: ContentWorkspacePreparePublishInput,
  ): Promise<ContentWorkspacePublishPreparation> {
    const preparation = await createPublishPreparation(input);
    return {
      ...preparation,
      source: "content-optimization",
      persisted: true,
      executionStarted: false,
    };
  },
};

export type {
  ContentWorkspaceArticleUpdate,
  ContentWorkspaceCapabilities,
  ContentWorkspaceComplianceCheckInput,
  ContentWorkspaceComplianceCheckResult,
  ContentWorkspaceComplianceRiskLevel,
  ContentWorkspaceContentFormat,
  ContentWorkspaceContentType,
  ContentWorkspaceCreateDraftInput,
  ContentWorkspaceCreateDraftResult,
  ContentWorkspaceDocument,
  ContentWorkspaceFailure,
  ContentWorkspaceFailureCode,
  ContentWorkspaceKnowledgeMatch,
  ContentWorkspaceKnowledgeQuery,
  ContentWorkspaceKnowledgeResult,
  ContentWorkspaceMaterial,
  ContentWorkspaceMaterialQuery,
  ContentWorkspacePage,
  ContentWorkspacePreparePublishInput,
  ContentWorkspacePublishPreparation,
  ContentWorkspaceQueueItem,
  ContentWorkspaceQueueQuery,
  ContentWorkspaceSaveVersionInput,
  ContentWorkspaceVersion,
  ContentWorkspaceVersionList,
  ContentWorkspaceVersionQuery,
} from "@/lib/content-workspace-types";
