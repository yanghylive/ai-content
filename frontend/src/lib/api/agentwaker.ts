import { api } from "./client";

export type AgentWakerRunStatus =
  | "draft"
  | "running"
  | "waiting_for_confirmation"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentWakerRole = {
  id: "xiaohongshu-operator" | "wechat-official-account-operator";
  name: string;
  available: boolean;
  workflows: Array<{ id: string; name: string }>;
};

export type AgentWakerRun = {
  runId: string;
  role: "xiaohongshu-operator" | "wechat-official-account-operator";
  workflow: "note-package" | "article-pipeline";
  status: AgentWakerRunStatus;
  statusLabel: string;
  currentStep: "input" | "generation" | "approval" | "handoff" | "failed";
  goal: string;
  inputs: {
    brand: string;
    audience: string;
    product: string;
    keywords: string[];
    sourceMaterials: string[];
    author: string;
    tone: string;
    accountName: string;
    sourceUrl: string;
  };
  modelId: string | null;
  articleId: string | null;
  confirmationId: string | null;
  checklist: {
    ready?: boolean;
    items?: Array<{
      label: string;
      status: "ready" | "warning" | "blocked";
    }>;
  };
  risks: string[];
  events: Array<{
    id: string;
    level: "info" | "success" | "warning" | "error";
    title: string;
    message: string;
    createdAt: string;
  }>;
  output: {
    articleId: string;
    title: string;
    content: string;
    contentFormat: "markdown" | "html";
    finalHtml: string | null;
    coverImage: string | null;
    channel: "xiaohongshu" | "wechat-official-account";
    caption: string;
    hashtags: string[];
    slides: Array<{
      role?: string;
      title?: string;
      body?: string;
      bullets?: string[];
      highlight?: string;
      cardImageUrl?: string | null;
    }>;
    digest: string;
    author: string;
    sourceLedger: Array<{
      title: string;
      url: string;
      evidence: string;
    }>;
    wordCount: number;
  } | null;
  nextAction?: string;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateAgentWakerRunInput = {
  role: "xiaohongshu-operator" | "wechat-official-account-operator";
  workflow: "note-package" | "article-pipeline";
  goal: string;
  inputs: {
    brand: string;
    audience: string;
    product: string;
    keywords: string[];
    sourceMaterials: string[];
    author?: string;
    tone?: string;
    accountName?: string;
    sourceUrl?: string;
  };
  generateCards?: boolean;
};

export const agentWakerApi = {
  roles() {
    return api.get<AgentWakerRole[]>("/agentwaker/roles");
  },

  runs(limit = 20) {
    return api.get<{ runs: AgentWakerRun[] }>(
      `/agentwaker/runs?limit=${Math.max(1, Math.min(limit, 100))}`,
    );
  },

  run(id: string) {
    return api.get<AgentWakerRun>(`/agentwaker/runs/${encodeURIComponent(id)}`);
  },

  createRun(input: CreateAgentWakerRunInput) {
    return api.post<AgentWakerRun>("/agentwaker/runs", input);
  },

  executeRun(id: string) {
    return api.post<AgentWakerRun>(
      `/agentwaker/runs/${encodeURIComponent(id)}/execute`,
    );
  },
};
