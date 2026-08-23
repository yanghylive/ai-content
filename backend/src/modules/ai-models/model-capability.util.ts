import { Prisma } from '@prisma/client';
import { KaypalProviderResolver } from './kaypal-provider.resolver';

/**
 * 按能力选择默认模型（计划 Stage 1B / 二.B）
 *
 * 规则：
 * - 普通文本对话只选 text 能力模型，禁止视觉模型作兜底（二.B.3 / 二.B.6）。
 * - 视觉输入只选 vision 能力模型（二.B.4）。
 * - 402 fallback 只能同能力组内切换（二.B.5）。
 * - 禁止 findFirst(orderBy: createdAt/updatedAt desc) 作为业务默认（二.B.7）。
 *
 * 这里用「能力过滤 + 确定性的 modelId 排序 + 能力优先级」替代 createdAt/updatedAt desc，
 * 保证选模型结果可复现、不随模型创建顺序漂移，且天然排除视觉模型进入文本链路。
 */

export type AiCapability =
  'text' | 'vision' | 'image' | 'video' | 'tts' | 'asr';

/** 各能力组的模型别名优先级（命中靠前的优先），其余按 modelId 字典序兜底 */
const CAPABILITY_PRIORITY: Record<AiCapability, string[]> = {
  text: ['deepseek-v4-flash', 'deepseek-v4-pro'],
  vision: ['kaypal-vision'],
  image: ['wan', 'flux', 'dall', 'stable-diffusion', 'sd', 'image', '绘'],
  video: ['wan', 'i2v', 't2v', 'video'],
  tts: ['cosyvoice', 'sambert', 'tts', 'voice', '配音'],
  asr: ['paraformer', 'whisper', 'asr', '识别'],
};

/** 从模型标识推断能力（视觉优先，其次按关键字归类，默认 text） */
export function capabilityOf(m: {
  modelId?: string | null;
  name?: string | null;
}): AiCapability {
  if (KaypalProviderResolver.isVisionModel(m)) return 'vision';
  const s = `${m.modelId ?? ''} ${m.name ?? ''}`.toLowerCase();
  if (
    /image|img|图片|绘画|画图|flux|dall|stable[\s_-]?diffusion|绘|作画|文生图|t2i/i.test(
      s,
    )
  )
    return 'image';
  if (/video|视频|i2v|图生视频|文生视频|t2v|v2v/i.test(s)) return 'video';
  if (/tts|语音|配音|voice|speak|cosyvoice|sambert|读音|朗读/i.test(s))
    return 'tts';
  if (
    /asr|识别|speech[\s_-]?to[\s_-]?text|paraformer|whisper|转写|听写/i.test(s)
  )
    return 'asr';
  return 'text';
}

export interface PickedModel {
  id: string;
  modelId: string;
  name: string | null;
  platformId: string;
}

/**
 * 确定性地从启用模型中挑选某能力的默认模型。
 * 不依赖 createdAt/updatedAt，只按「能力匹配 + 优先级 + modelId 字典序」。
 */
export async function pickDefaultModel(
  prisma: Pick<Prisma.TransactionClient, 'aIModel'>,
  capability: AiCapability,
  opts: { platformId?: string } = {},
): Promise<PickedModel | null> {
  const where = {
    enabled: true,
    ...(opts.platformId ? { platformId: opts.platformId } : {}),
  };
  const models = await prisma.aIModel.findMany({
    where,
    orderBy: { modelId: 'asc' },
  });
  const matched = models.filter((m) => capabilityOf(m) === capability);
  const priority = CAPABILITY_PRIORITY[capability];
  matched.sort((a, b) => {
    const ai = priority.findIndex((p) => a.modelId.toLowerCase().includes(p));
    const bi = priority.findIndex((p) => b.modelId.toLowerCase().includes(p));
    if (ai !== bi) return (ai === -1 ? 1 : ai) - (bi === -1 ? 1 : bi);
    return a.modelId.localeCompare(b.modelId);
  });
  const first = matched[0];
  return first
    ? {
        id: first.id,
        modelId: first.modelId,
        name: first.name,
        platformId: first.platformId,
      }
    : null;
}
