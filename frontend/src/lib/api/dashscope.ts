/** 阿里百炼客户端（B3 ASR / P4 多模态）：生图 / 配音 / 语音识别 */

export interface DashImageResult {
  filename: string;
  sizeBytes: number;
  url?: string;
  prompt: string;
}

export interface DashVideoResult {
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

/** AI 生视频（happyhorse-1.1-i2v → 素材库，文生/图生均可，异步约 1-5 分钟） */
export function generateVideo(input: {
  prompt: string;
  duration?: number;
  ratio?: string;
  imageUrl?: string;
}): Promise<DashVideoResult> {
  return postJson<DashVideoResult>("/api/ai/video", input);
}

/** AI 配音（qwen3-tts → 音频 URL） */
export function generateSpeech(input: {
  text: string;
  voice?: string;
}): Promise<DashSpeechResult> {
  return postJson<DashSpeechResult>("/api/ai/speech", input);
}

/** 媒体生成成本预估（报告 16.3 第 11 项）——积分 + 人民币，预估失败返回 null */
export interface CostQuote {
  resourceType: string;
  amount: number;
  estimatedCostCny: number;
  managed: boolean;
  pricingBasis: string;
  inputs: Record<string, unknown>;
}

async function postCostQuote(
  path: string,
  body: Record<string, unknown>,
): Promise<CostQuote | null> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { success?: boolean; data?: CostQuote | null };
    if (!res.ok || !json.success) return null;
    return json.data ?? null;
  } catch {
    return null;
  }
}

/** 生图成本预估 */
export function quoteImageCost(input: { count?: number }): Promise<CostQuote | null> {
  return postCostQuote("/api/ai/image/quote", input);
}

/** 生视频成本预估 */
export function quoteVideoCost(input: { durationSeconds?: number }): Promise<CostQuote | null> {
  return postCostQuote("/api/ai/video/quote", input);
}
