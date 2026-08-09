import type {
  ArticleWorkspaceIntentPlatform,
  ArticleWorkspaceIntentTask,
  CreateArticleDraftInput,
} from "@/lib/api/articles";

type SearchParamsReader = {
  get(name: string): string | null;
};

export type WorkspaceIntent = ArticleWorkspaceIntentTask;
export type WorkspaceIntentPlatform = ArticleWorkspaceIntentPlatform;

export type WorkspaceIntentDefinition = {
  id: WorkspaceIntent;
  label: string;
  description: string;
  defaultGoal: string;
  defaultPlatform: WorkspaceIntentPlatform;
  submitLabel: string;
};

export const WORKSPACE_INTENT_IDS = [
  "create",
  "rewrite",
  "multiplatform",
  "prepare",
] as const satisfies readonly WorkspaceIntent[];

export const WORKSPACE_INTENTS: readonly WorkspaceIntentDefinition[] = [
  {
    id: "create",
    label: "写一篇内容",
    description: "从目标和平台开始，创建一篇可继续编辑的内容主稿。",
    defaultGoal: "完成一篇可审核、可交接的内容主稿",
    defaultPlatform: "wechat",
    submitLabel: "创建内容草稿",
  },
  {
    id: "rewrite",
    label: "改写已有内容",
    description: "先建立改写任务，再把原内容整理为更适合目标平台的版本。",
    defaultGoal: "把已有内容改写为更清晰、更适合目标平台的版本",
    defaultPlatform: "wechat",
    submitLabel: "创建改写草稿",
  },
  {
    id: "multiplatform",
    label: "生成多平台版本",
    description: "先确定首个目标平台，后续在工作室中继续生成其他平台版本。",
    defaultGoal: "基于一份主稿生成多个平台可用的内容版本",
    defaultPlatform: "xiaohongshu",
    submitLabel: "创建多平台草稿",
  },
  {
    id: "prepare",
    label: "准备发布",
    description: "创建一篇需要完成审核并交接到发布中心的内容。",
    defaultGoal: "完成一篇通过审核并可进入发布准备的内容",
    defaultPlatform: "wechat",
    submitLabel: "创建发布准备草稿",
  },
];

export const WORKSPACE_INTENT_PLATFORMS: ReadonlyArray<{
  id: WorkspaceIntentPlatform;
  label: string;
  description: string;
}> = [
  { id: "wechat", label: "公众号", description: "适合完整图文与品牌内容" },
  {
    id: "xiaohongshu",
    label: "小红书",
    description: "适合种草、经验和步骤内容",
  },
  { id: "douyin", label: "抖音", description: "适合短视频口播和脚本" },
  { id: "bilibili", label: "B站", description: "适合中长视频脚本" },
  { id: "tiktok", label: "TikTok", description: "适合海外短视频内容" },
];

const intentDefinitions = new Map(
  WORKSPACE_INTENTS.map((definition) => [definition.id, definition]),
);

export function parseWorkspaceIntent(
  searchParams: SearchParamsReader,
): WorkspaceIntent | null {
  const value = searchParams.get("intent")?.trim();
  return WORKSPACE_INTENT_IDS.includes(value as WorkspaceIntent)
    ? (value as WorkspaceIntent)
    : null;
}

export function shouldShowWorkspaceIntent(searchParams: SearchParamsReader) {
  if (!parseWorkspaceIntent(searchParams)) return false;
  return !(
    searchParams.get("articleId")?.trim() || searchParams.get("step")?.trim()
  );
}

export function getWorkspaceIntentDefinition(intent: WorkspaceIntent) {
  return intentDefinitions.get(intent) ?? intentDefinitions.get("create")!;
}

export function buildWorkspaceIntentHref(intent: WorkspaceIntent) {
  return `/content/workspace?intent=${encodeURIComponent(intent)}`;
}

export function buildWorkspaceIntentDraftInput(
  intent: WorkspaceIntent,
  goal: string,
  platform: WorkspaceIntentPlatform,
): CreateArticleDraftInput {
  const normalizedGoal = goal.trim();
  return {
    title: normalizedGoal.slice(0, 120) || "未命名内容",
    content: "",
    contentType: platform === "xiaohongshu" ? "xiaohongshu" : "article",
    contentFormat: "markdown",
    workspaceIntent: {
      task: intent,
      goal: normalizedGoal,
      platforms: [platform],
    },
  };
}
