import type { LucideIcon } from "@/components/iconpark";
import {
  ClipboardList,
  FilePenLine,
  ListTree,
  PanelsTopLeft,
  ShieldCheck,
} from "@/components/iconpark";
import type {
  ContentWorkspaceBrief,
  ContentWorkspaceOutline,
} from "@/lib/content-workspace-types";

export type WorkspaceStepId =
  | "brief"
  | "outline"
  | "draft"
  | "versions"
  | "review";

export type WorkspaceStep = {
  id: WorkspaceStepId;
  label: string;
  description: string;
  icon: LucideIcon;
};

export const WORKSPACE_STEPS: WorkspaceStep[] = [
  {
    id: "brief",
    label: "选题简报",
    description: "明确目标与读者",
    icon: ClipboardList,
  },
  {
    id: "outline",
    label: "内容大纲",
    description: "检查信息结构",
    icon: ListTree,
  },
  {
    id: "draft",
    label: "正文编辑",
    description: "完成可发布正文",
    icon: FilePenLine,
  },
  {
    id: "versions",
    label: "多平台版本",
    description: "查看渠道适配",
    icon: PanelsTopLeft,
  },
  {
    id: "review",
    label: "审核准备",
    description: "处理阻塞项并交接",
    icon: ShieldCheck,
  },
];

export type WorkspaceQueueItemView = {
  id: string;
  title: string;
  excerpt: string;
  status: string;
  statusLabel: string;
  platformLabel: string;
  updatedAt: string;
};

export type WorkspaceMaterialView = {
  id: string;
  title: string;
  summary: string;
  platformLabel: string;
};

export type WorkspaceVersionView = {
  id: string;
  title: string;
  content: string;
  platform: string;
  platformLabel: string;
  versionLabel: string;
  isOfficial: boolean;
  updatedAt: string;
};

export type WorkspaceKnowledgeView = {
  id: string;
  title: string;
  excerpt: string;
  sourceLabel: string;
};

export type EditorValue = {
  title: string;
  brief: ContentWorkspaceBrief;
  outline: ContentWorkspaceOutline;
  content: string;
  legacyBodyEditable: boolean;
};

export type SaveState = "idle" | "pending" | "saving" | "saved" | "error";

export type WorkspaceBrandVoice = "professional" | "practical" | "concise";
export type WorkspaceCandidatePlatform =
  | "all"
  | "xiaohongshu"
  | "wechat"
  | "douyin";

export type RulePreviewCandidate = {
  title: string;
  content: string;
  changes: string[];
  platform: WorkspaceCandidatePlatform;
  platformLabel: string;
};

export type ReviewCheck = {
  id: string;
  label: string;
  detail: string;
  status: "pass" | "warning" | "blocked";
};

export function formatWorkspaceTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function buildReviewChecks(value: EditorValue): ReviewCheck[] {
  const titleLength = value.title.trim().length;
  const contentLength = value.content.trim().length;
  const hasRiskWords = /保证|第一|永久|绝对|治愈|稳赚/.test(value.content);

  return [
    {
      id: "title",
      label: "标题完整性",
      detail:
        titleLength >= 8 && titleLength <= 36
          ? "标题长度适合主要内容平台"
          : "建议将标题控制在 8-36 个字",
      status: titleLength >= 8 && titleLength <= 36 ? "pass" : "warning",
    },
    {
      id: "content",
      label: "正文完整性",
      detail:
        contentLength >= 120
          ? `正文共 ${contentLength} 字，已达到审核基线`
          : `正文仅 ${contentLength} 字，至少补充到 120 字`,
      status: contentLength >= 120 ? "pass" : "blocked",
    },
    {
      id: "risk",
      label: "风险词初检",
      detail: hasRiskWords ? "发现绝对化或承诺性表述，请人工复核" : "未发现常见高风险表述",
      status: hasRiskWords ? "blocked" : "pass",
    },
    {
      id: "source",
      label: "引用与素材",
      detail: "发布前仍需在发布中心确认素材授权与来源",
      status: "warning",
    },
  ];
}
