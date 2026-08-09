export type VideoWorkshopLatestClip = {
  id: string;
  outputPath: string;
  outputName: string;
  templateName: string;
  materialPath: string;
  titlePrompt?: string;
  productName?: string;
  settings?: {
    musicPreset?: string;
    titleStyle?: string;
    subtitleStyle?: string;
    fontPreset?: string;
    filterPreset?: string;
    transitionPreset?: string;
    aspectRatio?: string;
  };
  message?: string;
  createdAt: string;
};

export const VIDEO_WORKSHOP_LATEST_CLIP_STORAGE_KEY =
  "kaypal.videoWorkshop.latestClip";

let currentConfirmedClip: VideoWorkshopLatestClip | null = null;

function clearLegacyStoredClip() {
  if (typeof window === "undefined" || !window.localStorage) return;
  window.localStorage.removeItem(VIDEO_WORKSHOP_LATEST_CLIP_STORAGE_KEY);
}

export function readLatestVideoWorkshopClip(): VideoWorkshopLatestClip | null {
  clearLegacyStoredClip();
  return currentConfirmedClip;
}

export function writeLatestVideoWorkshopClip(clip: VideoWorkshopLatestClip) {
  currentConfirmedClip = clip;
  clearLegacyStoredClip();
}

export function clearLatestVideoWorkshopClip() {
  currentConfirmedClip = null;
  clearLegacyStoredClip();
}
