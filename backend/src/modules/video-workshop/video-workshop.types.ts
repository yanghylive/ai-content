export type VideoWorkshopSource = 'video-workshop' | 'ai-employee';

export interface VideoWorkshopTemplateClipInput {
  materialPath?: string;
  templateName?: string;
  titlePrompt?: string;
  titleText?: string;
  subtitleText?: string;
  outputName?: string;
  outputDir?: string;
  durationSeconds?: number;
  source?: VideoWorkshopSource;
  productName?: string;
  settings?: VideoWorkshopClipSettings;
}

export interface VideoWorkshopClipSettings {
  musicPreset?: string;
  titleStyle?: string;
  subtitleStyle?: string;
  fontPreset?: string;
  filterPreset?: string;
  transitionPreset?: string;
  aspectRatio?: string;
}

export interface VideoWorkshopLatestClip {
  id: string;
  outputPath: string;
  outputName: string;
  templateName: string;
  materialPath: string;
  source: VideoWorkshopSource;
  titlePrompt?: string;
  productName?: string;
  settings?: VideoWorkshopClipSettings;
  message: string;
  createdAt: string;
}

export interface VideoWorkshopProductProfile {
  id: string;
  name: string;
  highlights: string[];
  description: string;
  updatedAt: string;
}

export interface VideoWorkshopProductProfileInput {
  id?: string;
  name?: string;
  highlights?: string[] | string;
  description?: string;
}

export interface VideoWorkshopMaterialImportResult {
  items: VideoWorkshopMaterialFile[];
  rejected: Array<{ name: string; reason: string }>;
}

export interface VideoWorkshopMaterialFile {
  id: string;
  name: string;
  path: string;
  kind: 'video' | 'image';
  sizeBytes: number;
  updatedAt: string;
}

export interface VideoWorkshopUploadFile {
  originalname?: string;
  buffer?: Buffer;
  size?: number;
  mimetype?: string;
}

export interface VideoWorkshopPreviewClip {
  path: string;
  name: string;
}

export type VideoWorkshopTaskKind = 'render' | 'download';
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

export interface VideoWorkshopDownloadInput {
  url?: string;
  outputName?: string;
  maxBytes?: number;
}

export interface VideoWorkshopTask {
  id: string;
  kind: VideoWorkshopTaskKind;
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
  downloadInput?: VideoWorkshopDownloadInput;
  outputPath?: string;
  material?: VideoWorkshopMaterialFile;
  result?: VideoWorkshopTaskResult;
}

export interface VideoWorkshopTaskResult {
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
}

export type VideoWorkshopPhoneUploadStatus =
  | 'pending'
  | 'uploading'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'expired';

export interface VideoWorkshopPhoneUploadSession {
  id: string;
  status: VideoWorkshopPhoneUploadStatus;
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
}

export interface VideoWorkshopDownloadPolicy {
  allowedHosts: string[];
  maxBytes: number;
  timeoutMs: number;
  maxRedirects: number;
}
