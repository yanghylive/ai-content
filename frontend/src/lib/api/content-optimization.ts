import { api } from "./client";

export type ContentWorkflowPlatform =
  "all" | "xiaohongshu" | "douyin" | "wechat" | "bilibili" | "tiktok";

export type ContentWorkflowTargetType =
  | "article"
  | "xiaohongshu_note"
  | "video_script"
  | "comment_reply"
  | "material";

export type ContentVersionComplianceStatus = {
  checkId: string;
  checkedAt: string;
  riskLevel: "pass" | "low" | "medium" | "high";
  riskScore: number;
  summary: string;
};

export type ContentOptimizationVersion = {
  id: string;
  draftId: string;
  mode: "title" | "rewrite" | "xhs";
  modeLabel: string;
  title: string;
  content: string;
  originalTitle?: string;
  originalContent?: string;
  platform: ContentWorkflowPlatform;
  targetType: ContentWorkflowTargetType;
  versionNo: number;
  status: "saved" | "official" | string;
  isOfficial: boolean;
  sourceWorkflowId?: string;
  sourceSummary?: string;
  createdAt: string;
  updatedAt: string;
  compliance?: ContentVersionComplianceStatus;
  manualReview?: {
    reviewed: boolean;
    note?: string;
    reviewedAt?: string;
  };
};

export type ContentVersionDiff = {
  versionId: string;
  draftId: string;
  summary: {
    originalLength: number;
    versionLength: number;
    originalLines: number;
    versionLines: number;
    lengthDelta: number;
    lineDelta: number;
  };
  original: {
    title: string;
    content: string;
  };
  version: {
    title: string;
    content: string;
  };
};

export type ContentVersionFeedback = {
  id: string;
  versionId: string;
  publishIntentId?: string;
  platform: ContentWorkflowPlatform;
  views: number;
  likes: number;
  comments: number;
  saves: number;
  leads: number;
  note: string;
  createdAt: string;
  updatedAt: string;
};

export type ContentVersionComment = {
  id: string;
  versionId: string;
  body: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
};

export type ContentOptimizationVersionInput = {
  draftId?: string;
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

export type ContentOptimizationVersionsResult = {
  items: ContentOptimizationVersion[];
  total: number;
};

export type PublishPreparation = {
  id: string;
  versionId: string;
  platform: ContentWorkflowPlatform;
  title: string;
  content: string;
  status: "ready" | string;
  scheduledAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export function listContentOptimizationVersions(
  params: {
    draftId?: string;
    sourceType?: string;
    sourceId?: string;
    platform?: ContentWorkflowPlatform;
    status?: string;
  } = {},
) {
  const searchParams = new URLSearchParams();
  if (params.draftId) searchParams.set("draftId", params.draftId);
  if (params.sourceType) searchParams.set("sourceType", params.sourceType);
  if (params.sourceId) searchParams.set("sourceId", params.sourceId);
  if (params.platform) searchParams.set("platform", params.platform);
  if (params.status) searchParams.set("status", params.status);
  const query = searchParams.toString();
  return api.get<ContentOptimizationVersionsResult>(
    `/content-optimization/versions${query ? `?${query}` : ""}`,
  );
}

export function getContentOptimizationVersion(id: string) {
  return api.get<ContentOptimizationVersion>(
    `/content-optimization/versions/${encodeURIComponent(id)}`,
  );
}

export function saveContentOptimizationVersion(
  input: ContentOptimizationVersionInput,
) {
  return api.post<ContentOptimizationVersion>(
    "/content-optimization/versions",
    input,
  );
}

export function setOfficialContentVersion(id: string) {
  return api.post<ContentOptimizationVersion>(
    `/content-optimization/versions/${encodeURIComponent(id)}/official`,
    { writeBackDraft: true },
  );
}

export function getContentVersionDiff(id: string) {
  return api.get<ContentVersionDiff>(
    `/content-optimization/versions/${encodeURIComponent(id)}/diff`,
  );
}

export function markContentVersionCompliance(
  id: string,
  input: ContentVersionComplianceStatus,
) {
  return api.post<ContentOptimizationVersion>(
    `/content-optimization/versions/${encodeURIComponent(id)}/compliance`,
    input,
  );
}

export function manualReviewContentVersion(id: string, note?: string) {
  return api.post<ContentOptimizationVersion>(
    `/content-optimization/versions/${encodeURIComponent(id)}/manual-review`,
    { note },
  );
}

export function listContentVersionFeedback(id: string) {
  return api.get<{ items: ContentVersionFeedback[]; total: number }>(
    `/content-optimization/versions/${encodeURIComponent(id)}/feedback`,
  );
}

export function createContentVersionFeedback(
  id: string,
  input: {
    publishIntentId?: string;
    platform?: ContentWorkflowPlatform;
    views?: number;
    likes?: number;
    comments?: number;
    saves?: number;
    leads?: number;
    note?: string;
  },
) {
  return api.post<ContentVersionFeedback>(
    `/content-optimization/versions/${encodeURIComponent(id)}/feedback`,
    input,
  );
}

export function listContentVersionComments(id: string) {
  return api.get<{ items: ContentVersionComment[]; total: number }>(
    `/content-optimization/versions/${encodeURIComponent(id)}/comments`,
  );
}

export function createContentVersionComment(id: string, body: string) {
  return api.post<ContentVersionComment>(
    `/content-optimization/versions/${encodeURIComponent(id)}/comments`,
    { body },
  );
}

export function createPublishPreparation(input: {
  versionId: string;
  platform?: ContentWorkflowPlatform;
  scheduledAt?: string;
}) {
  return api.post<PublishPreparation>(
    "/content-optimization/publish-intents",
    input,
  );
}

export function getPublishPreparation(id: string) {
  return api.get<PublishPreparation>(
    `/content-optimization/publish-intents/${encodeURIComponent(id)}`,
  );
}

// ---- §3 图文大纲流水线 ----

export type OutlinePageType = "cover" | "content" | "summary";

export type OutlinePage = {
  type: OutlinePageType;
  title: string;
  points: string[];
  imagePrompt?: string;
};

export type GeneratedImagePage = {
  index: number;
  type: OutlinePageType;
  heading: string;
  content: string;
  imagePrompt: string;
  imageFilename?: string | null;
  imageUrl?: string | null;
  status: "pending" | "done" | "failed";
  error?: string | null;
};

export type ImageGenTask = {
  id: string;
  tenantId: string | null;
  userId: string;
  topic: string;
  status: "generating" | "completed" | "failed";
  pages: GeneratedImagePage[];
  generated: GeneratedImagePage[];
  failed: GeneratedImagePage[];
  titles: string[];
  tags: string[];
  coverRef?: string | null;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
};

export function generateImageOutline(topic: string, pageCount?: number) {
  return api.post<{ pages: OutlinePage[] }>("/content-optimization/outline", {
    topic,
    pageCount,
  });
}

export function getImageGenTask(id: string) {
  return api.get<ImageGenTask>(
    "/content-optimization/task/" + encodeURIComponent(id),
  );
}
