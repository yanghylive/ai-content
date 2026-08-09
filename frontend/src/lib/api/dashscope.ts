/** 阿里百炼客户端（B3 ASR / P4 多模态）：生图 / 配音 / 语音识别 */

export interface DashImageResult {
  filename: string;
  sizeBytes: number;
  url?: string;
  prompt: string;
}

export interface DashSpeechResult {
  filename: string;
  sizeBytes: number;
  text: string;
  voice: string;
  audioUrl: string;
}

async function postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as {
    success?: boolean;
    data?: T;
    message?: string;
  };
  if (!res.ok || !json.success || !json.data) {
    throw new Error(json.message || `请求失败（${res.status}）`);
  }
  return json.data;
}

/** AI 生图（qwen-image-3.0-pro → 素材库） */
export function generateImage(input: {
  prompt: string;
  size?: string;
}): Promise<DashImageResult> {
  return postJson<DashImageResult>("/api/ai/image", input);
}

/** AI 配音（qwen3-tts → 音频 URL） */
export function generateSpeech(input: {
  text: string;
  voice?: string;
}): Promise<DashSpeechResult> {
  return postJson<DashSpeechResult>("/api/ai/speech", input);
}
