import type {
  Article,
  ArticleWorkspaceBrief,
  ArticleWorkspaceBriefField,
  ArticleWorkspaceOutline,
  ArticleWorkspaceOutlineItem,
  ArticleWorkspaceStep,
  CreateArticleDraftInput,
} from "@/lib/api/articles";
import type {
  ContentOptimizationVersion,
  ContentWorkflowPlatform,
  ContentWorkflowTargetType,
  PublishPreparation,
} from "@/lib/api/content-optimization";
import type {
  KaypalKnowledgeSearchHit,
  KaypalKnowledgeSearchResult,
} from "@/lib/api/auth";
import type { Material } from "@/lib/api/materials";

export type ContentWorkspaceContentType = Article["contentType"];
export type ContentWorkspaceContentFormat = Article["contentFormat"];
export type ContentWorkspaceStep = ArticleWorkspaceStep;
export type ContentWorkspaceBrief = ArticleWorkspaceBrief;
export type ContentWorkspaceOutlineItem = ArticleWorkspaceOutlineItem;
export type ContentWorkspaceOutline = ArticleWorkspaceOutline;

const WORKSPACE_BRIEF_FIELDS: ArticleWorkspaceBriefField[] = [
  "goal",
  "audience",
  "platforms",
  "deadline",
  "action",
  "constraints",
];

export function completeWorkspaceBriefFieldSources(
  brief: ContentWorkspaceBrief,
): ContentWorkspaceBrief {
  const fieldSources = { ...(brief.fieldSources || {}) };
  for (const field of WORKSPACE_BRIEF_FIELDS) {
    if (fieldSources[field]) continue;
    const value = brief[field];
    const hasValue = Array.isArray(value) ? value.length > 0 : Boolean(value);
    fieldSources[field] = hasValue
      ? {
          source: "legacy_unknown",
          label: "历史简报，来源未记录",
          edited: false,
        }
      : {
          source: "unavailable",
          label: "尚未关联来源",
          edited: false,
        };
  }
  return { ...brief, fieldSources };
}

export function createEmptyWorkspaceBrief(): ContentWorkspaceBrief {
  return {
    goal: "",
    audience: "",
    platforms: [],
    deadline: null,
    action: "",
    constraints: "",
  };
}

export function createEmptyWorkspaceOutline(): ContentWorkspaceOutline {
  return { items: [], confirmedAt: null, confirmedItemsHash: null };
}

export type ContentWorkspacePage<T> = {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

export type ContentWorkspaceQueueQuery = {
  page?: number;
  limit?: number;
  keyword?: string;
  status?: string;
  contentType?: ContentWorkspaceContentType;
};

export type ContentWorkspaceQueueItem = {
  id: string;
  source: "article";
  persisted: true;
  title: string;
  summary: string;
  status: string;
  contentType: ContentWorkspaceContentType;
  contentFormat: ContentWorkspaceContentFormat;
  topic: {
    id: string | null;
    title: string;
    keywords: string[];
  } | null;
  coverImage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ContentWorkspaceDocument = {
  id: string;
  source: "article";
  persisted: true;
  topicId: string | null;
  title: string;
  content: string;
  workspaceBrief: ContentWorkspaceBrief;
  workspaceOutline: ContentWorkspaceOutline;
  workspaceStep: ContentWorkspaceStep;
  workspaceRevision: number;
  legacyBodyEditable: boolean;
  contentType: ContentWorkspaceContentType;
  contentFormat: ContentWorkspaceContentFormat;
  xiaohongshuData: Article["xiaohongshuData"];
  wechatData: Article["wechatData"];
  rawHtml: string | null;
  finalHtml: string | null;
  coverImage: string | null;
  status: string;
  template: Article["template"] | null;
  topic: Article["topic"] | null;
  createdAt: string;
  updatedAt: string;
};

export type ContentWorkspaceCreateDraftInput = CreateArticleDraftInput;

export type ContentWorkspaceArticleUpdate = Partial<
  Pick<
    Article,
    | "title"
    | "content"
    | "workspaceBrief"
    | "workspaceOutline"
    | "workspaceStep"
    | "contentType"
    | "contentFormat"
    | "xiaohongshuData"
    | "wechatData"
    | "rawHtml"
    | "finalHtml"
    | "coverImage"
    | "status"
  >
> & {
  confirmWorkspaceOutline?: boolean;
};

export type ContentWorkspaceFailureCode =
  | "endpoint_unavailable"
  | "network_error"
  | "timeout"
  | "request_rejected"
  | "unknown";

export type ContentWorkspaceFailure = {
  code: ContentWorkspaceFailureCode;
  message: string;
  retryable: boolean;
  httpStatus: number | null;
  serverCode: string | null;
  requestId: string | null;
  details: unknown;
};

export type ContentWorkspaceCreateDraftResult =
  | {
      ok: true;
      persistence: "server";
      persisted: true;
      document: ContentWorkspaceDocument;
    }
  | {
      ok: false;
      persistence: "none";
      persisted: false;
      failure: ContentWorkspaceFailure;
      recovery: {
        retainUnsavedInput: true;
        retryable: boolean;
      };
    };

export type ContentWorkspaceMaterialQuery = {
  page?: number;
  limit?: number;
  keyword?: string;
  status?: Material["status"];
  platform?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
};

export type ContentWorkspaceMaterial = Material & {
  source: "material";
  persisted: true;
  excerpt: string;
};

export type ContentWorkspaceVersionQuery = {
  draftId?: string;
  documentId?: string;
  sourceType?: string;
  sourceId?: string;
  platform?: ContentWorkflowPlatform;
  status?: string;
};

export type ContentWorkspaceVersion = ContentOptimizationVersion & {
  source: "content-optimization";
  persisted: true;
};

export type ContentWorkspaceVersionList = {
  items: ContentWorkspaceVersion[];
  total: number;
};

export type ContentWorkspaceSaveVersionInput = {
  draftId?: string;
  documentId?: string;
  sourceType?: string;
  sourceId?: string;
  mode: "title" | "rewrite" | "xhs";
  modeLabel: string;
  title: string;
  content: string;
  originalTitle?: string;
  originalContent?: string;
  platform: ContentWorkflowPlatform;
  targetType: ContentWorkflowTargetType;
  sourceWorkflowId?: string;
  sourceSummary?: string;
};

export type ContentWorkspacePreparePublishInput = {
  versionId: string;
  platform?: ContentWorkflowPlatform;
  scheduledAt?: string;
};

export type ContentWorkspaceComplianceRiskLevel =
  | "pass"
  | "low"
  | "medium"
  | "high";

export type ContentWorkspaceComplianceCheckInput = {
  content: string;
  platform: ContentWorkflowPlatform;
  targetType: ContentWorkflowTargetType;
  targetId: string;
  title?: string;
  scenario: "pre_publish";
};

export type ContentWorkspaceComplianceCheckResult = {
  checkId: string;
  targetType: ContentWorkflowTargetType;
  targetId?: string;
  platform: ContentWorkflowPlatform;
  riskLevel: ContentWorkspaceComplianceRiskLevel;
  riskScore: number;
  summary: string;
  findings: Array<{
    id: string;
    category: string;
    riskLevel: ContentWorkspaceComplianceRiskLevel;
    matchedText: string;
    reason: string;
    suggestion: string;
    replacement?: string;
    startIndex?: number;
  }>;
  suggestions: string[];
  gate: {
    publishAllowed: boolean;
    manualReviewRequired: boolean;
    reason: string;
    nextActions: string[];
  };
};

export type ContentWorkspacePublishPreparation = PublishPreparation & {
  source: "content-optimization";
  persisted: true;
  executionStarted: false;
};

export type ContentWorkspaceKnowledgeQuery = {
  query: string;
  limit?: number;
  sourceTypes?: string[];
  includeCloud?: boolean;
};

export type ContentWorkspaceKnowledgeMatch = KaypalKnowledgeSearchHit;

export type ContentWorkspaceKnowledgeResult = Omit<
  KaypalKnowledgeSearchResult,
  "matches"
> & {
  source: "kaypal-knowledge";
  matches: ContentWorkspaceKnowledgeMatch[];
};

export type ContentWorkspaceCapabilities = {
  contractVersion: 1;
  queue: {
    available: true;
    source: "articles";
  };
  articleDetails: {
    available: true;
    source: "articles";
  };
  articleUpdate: {
    available: true;
    requiresPersistedArticle: true;
    source: "articles";
  };
  blankDraftCreation: {
    available: true;
    persistentCreate: true;
    persistence: "server";
    endpoint: "POST /articles/drafts";
    fallback: "none";
    failureContract: "explicit_result";
  };
  materials: {
    available: true;
    source: "materials";
  };
  versions: {
    available: true;
    source: "content-optimization";
    lookupKey: "optimization_draft_id";
    articleAssociation: "source_reference_on_first_save";
  };
  knowledge: {
    available: true;
    source: "kaypal-knowledge";
  };
  publishPreparation: {
    available: true;
    requiresPersistedVersion: true;
    executesPublish: false;
    source: "content-optimization";
    preconditions: readonly [
      "official_version",
      "compliance_check",
      "manual_review_when_required",
    ];
  };
};
