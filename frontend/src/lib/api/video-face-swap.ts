import { api } from "./client";

export type VideoFaceSwapMode =
  | "face_swap"
  | "deep_swap"
  | "lip_sync"
  | "face_enhance"
  | "frame_enhance"
  | "background_remove"
  | "frame_colorize"
  | "expression_restore"
  | "face_edit"
  | "age_modify";

export type VideoFaceSwapCapability = {
  mode: VideoFaceSwapMode;
  title: string;
  description: string;
  requiredMaterials: string[];
  cost: {
    basePoints: number;
    includedSeconds: number;
    extraPointsPer30Seconds: number;
  };
};

export type VideoFaceSwapJobInput = {
  mode: VideoFaceSwapMode;
  targetPath: string;
  sourcePath?: string;
  audioPath?: string;
  outputName?: string;
  durationSeconds?: number;
  authorizationConfirmed?: boolean;
  lawfulUseConfirmed?: boolean;
  commercialLicenseConfirmed?: boolean;
  usagePurpose?: string;
  acceptedCostPoints?: number;
};

export type VideoFaceSwapEstimate = {
  mode: VideoFaceSwapMode;
  durationSeconds: number;
  estimatedCostPoints: number;
  policyVersion: string;
  items: Array<{
    label: string;
    amount: number;
    rule: string;
  }>;
};

export type VideoFaceSwapMaterialFile = {
  id: string;
  name: string;
  path: string;
  kind: "video" | "image" | "audio";
  sizeBytes: number;
  updatedAt: string;
};

export type VideoFaceSwapRunResult = {
  ok: boolean;
  status: "success" | "failed" | "blocked" | "skipped";
  reasonCode: string;
  message: string;
  detail?: string;
  billing?: {
    status: "charged" | "skipped" | "failed";
    amount: number;
    reservationId?: string;
    transactionId?: string;
    balanceAfter?: number;
    policyVersion?: string;
    idempotencyKey?: string;
    message?: string;
  };
  estimate: VideoFaceSwapEstimate;
  evidence: Array<{
    type: string;
    label: string;
    url?: string;
    path?: string;
    createdAt: string;
    raw?: Record<string, unknown>;
  }>;
};

export type VideoFaceSwapJobSummary = {
  id: string;
  outputPath: string;
  outputName: string;
  message: string;
  createdAt: string;
  mode: VideoFaceSwapMode;
};

export type VideoFaceSwapHealth = {
  ok: boolean;
  status: "ready" | "needs_setup";
  message: string;
  checkedAt: string;
  checks: Array<{
    key: string;
    label: string;
    ok: boolean;
    message: string;
    required: boolean;
  }>;
};

export type VideoFaceSwapBillingStatus = {
  ok: boolean;
  status:
    | "ready"
    | "needs_login"
    | "needs_account"
    | "needs_authorization"
    | "local_only";
  label: string;
  message: string;
  actionLabel?: string;
  actionHref?: string;
};

export const videoFaceSwapApi = {
  capabilities() {
    return api.get<VideoFaceSwapCapability[]>("/video-face-swap/capabilities");
  },
  estimate(input: Partial<VideoFaceSwapJobInput>) {
    return api.post<VideoFaceSwapEstimate>("/video-face-swap/estimate", input);
  },
  health() {
    return api.get<VideoFaceSwapHealth>("/video-face-swap/health");
  },
  billingStatus() {
    return api.get<VideoFaceSwapBillingStatus>(
      "/video-face-swap/billing-status",
    );
  },
  jobs(limit = 20) {
    return api.get<VideoFaceSwapJobSummary[]>(
      `/video-face-swap/jobs?limit=${limit}`,
    );
  },
  materialFiles(limit = 50) {
    return api.get<VideoFaceSwapMaterialFile[]>(
      `/video-face-swap/material-files?limit=${limit}`,
    );
  },
  uploadMaterialFile(formData: FormData) {
    return api.upload<VideoFaceSwapMaterialFile>(
      "/video-face-swap/material-files",
      formData,
    );
  },
  previewUrl(outputPath: string) {
    return api.url(
      `/video-face-swap/preview?path=${encodeURIComponent(outputPath)}`,
    );
  },
  createJob(input: VideoFaceSwapJobInput) {
    return api.post<VideoFaceSwapRunResult>("/video-face-swap/jobs", input);
  },
};
