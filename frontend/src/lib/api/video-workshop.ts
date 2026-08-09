import { api } from './client';
import type { AiEmployeeRunResult } from './ai-employee';

export type VideoWorkshopTemplateClipInput = {
  materialPath: string;
  templateName: string;
  titlePrompt?: string;
  titleText?: string;
  subtitleText?: string;
  outputName?: string;
  outputDir?: string;
  durationSeconds?: number;
  source?: 'video-workshop' | 'ai-employee';
  productName?: string;
  settings?: VideoWorkshopClipSettings;
};

export type VideoWorkshopClipSettings = {
  musicPreset?: string;
  titleStyle?: string;
  subtitleStyle?: string;
  fontPreset?: string;
  filterPreset?: string;
  transitionPreset?: string;
  aspectRatio?: string;
};

export type VideoWorkshopLatestClip = {
  id: string;
  outputPath: string;
  outputName: string;
  templateName: string;
  materialPath: string;
  source: 'video-workshop' | 'ai-employee';
  titlePrompt?: string;
  productName?: string;
  settings?: VideoWorkshopClipSettings;
  message: string;
  createdAt: string;
};

export type VideoWorkshopMaterialFile = {
  id: string;
  name: string;
  path: string;
  kind: 'video' | 'image';
  sizeBytes: number;
  updatedAt: string;
};

export type VideoWorkshopProductProfile = {
  id: string;
  name: string;
  highlights: string[];
  description: string;
  updatedAt: string;
};

export type VideoWorkshopProductProfileInput = {
  id?: string;
  name: string;
  highlights: string[];
  description?: string;
};

export type VideoWorkshopMaterialImportResult = {
  items: VideoWorkshopMaterialFile[];
  rejected: Array<{ name: string; reason: string }>;
};

export type VideoWorkshopTaskStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type VideoWorkshopFailureCode =
  | 'invalid_input'
  | 'missing_asset'
  | 'processing_failure'
  | 'runtime_unavailable'
  | 'cancelled';

export type VideoWorkshopReasonCode = 'success' | VideoWorkshopFailureCode;

export type VideoWorkshopTaskResult = {
  ok: boolean;
  status: 'success' | 'failed' | 'cancelled';
  reasonCode: VideoWorkshopReasonCode;
  message: string;
  detail?: string;
  evidence: Array<{
    type: string;
    label: string;
    url?: string;
    path?: string;
    createdAt: string;
    raw?: unknown;
  }>;
  candidates: unknown[];
};

export type VideoWorkshopTask = {
  id: string;
  kind: 'render' | 'download';
  status: VideoWorkshopTaskStatus;
  progress: number;
  stage: string;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  renderInput?: VideoWorkshopTemplateClipInput;
  downloadInput?: {
    url?: string;
    outputName?: string;
    maxBytes?: number;
  };
  outputPath?: string;
  material?: VideoWorkshopMaterialFile;
  result?: VideoWorkshopTaskResult;
};

export type VideoWorkshopDownloadPolicy = {
  allowedHosts: string[];
  maxBytes: number;
  timeoutMs: number;
  maxRedirects: number;
};

export type VideoWorkshopPhoneUploadSession = {
  id: string;
  status:
    | 'pending'
    | 'uploading'
    | 'succeeded'
    | 'failed'
    | 'cancelled'
    | 'expired';
  progress: number;
  bytesReceived: number;
  maxBytes: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  uploadUrl?: string;
  qrDataUrl?: string;
  reachableFromPhone?: boolean;
  networkHint?: string;
  error?: string;
  material?: VideoWorkshopMaterialFile;
};

export const videoWorkshopApi = {
  latestClip(source: 'video-workshop' | 'ai-employee' = 'video-workshop') {
    return api.get<VideoWorkshopLatestClip | null>(`/video-workshop/latest-clip?source=${source}`);
  },
  clips(source: 'video-workshop' | 'ai-employee' = 'video-workshop', limit = 20) {
    return api.get<VideoWorkshopLatestClip[]>(`/video-workshop/clips?source=${source}&limit=${limit}`);
  },
  materialFiles(limit = 30) {
    return api.get<VideoWorkshopMaterialFile[]>(`/video-workshop/material-files?limit=${limit}`);
  },
  uploadMaterialFile(formData: FormData) {
    return api.upload<VideoWorkshopMaterialFile>('/video-workshop/material-files', formData);
  },
  uploadMaterialFiles(formData: FormData) {
    return api.upload<VideoWorkshopMaterialImportResult>(
      '/video-workshop/material-files/batch',
      formData,
    );
  },
  productProfiles() {
    return api.get<VideoWorkshopProductProfile[]>('/video-workshop/product-profiles');
  },
  saveProductProfile(input: VideoWorkshopProductProfileInput) {
    return api.post<VideoWorkshopProductProfile>(
      '/video-workshop/product-profiles',
      input,
    );
  },
  downloadPolicy() {
    return api.get<VideoWorkshopDownloadPolicy>('/video-workshop/download-policy');
  },
  tasks(limit = 50) {
    return api.get<VideoWorkshopTask[]>(`/video-workshop/tasks?limit=${limit}`);
  },
  task(id: string) {
    return api.get<VideoWorkshopTask>(`/video-workshop/tasks/${encodeURIComponent(id)}`);
  },
  createRenderTask(input: VideoWorkshopTemplateClipInput) {
    return api.post<VideoWorkshopTask>('/video-workshop/tasks/render', input);
  },
  createDownloadTask(input: { url: string; outputName?: string; maxBytes?: number }) {
    return api.post<VideoWorkshopTask>('/video-workshop/tasks/download', input);
  },
  retryTask(id: string) {
    return api.post<VideoWorkshopTask>(
      `/video-workshop/tasks/${encodeURIComponent(id)}/retry`,
    );
  },
  cancelTask(id: string) {
    return api.post<VideoWorkshopTask>(
      `/video-workshop/tasks/${encodeURIComponent(id)}/cancel`,
    );
  },
  createPhoneUploadSession(maxBytes?: number) {
    return api.post<VideoWorkshopPhoneUploadSession>(
      '/video-workshop/phone-upload/sessions',
      maxBytes ? { maxBytes } : {},
    );
  },
  phoneUploadSession(id: string) {
    return api.get<VideoWorkshopPhoneUploadSession>(
      `/video-workshop/phone-upload/sessions/${encodeURIComponent(id)}`,
    );
  },
  cancelPhoneUploadSession(id: string) {
    return api.post<VideoWorkshopPhoneUploadSession>(
      `/video-workshop/phone-upload/sessions/${encodeURIComponent(id)}/cancel`,
    );
  },
  previewClipUrl(outputPath: string) {
    return api.url(`/video-workshop/preview?path=${encodeURIComponent(outputPath)}`);
  },
  clipWithTemplate(input: VideoWorkshopTemplateClipInput) {
    return api.post<AiEmployeeRunResult>('/video-workshop/template-clip', input);
  },
};
