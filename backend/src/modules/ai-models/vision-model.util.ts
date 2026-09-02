import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../prisma/prisma.service';
import { KaypalProviderResolver } from './kaypal-provider.resolver';

/**
 * 视觉模型共享解析（2026-09-02 新增，对齐 MAI-UI 已验证模式）。
 *
 * 背景：抖音采集/MAI-UI 的「截图视觉兜底」此前硬编码数据库主键
 * 'cmsvis0001visionkaypalvl' 当作 id 调用 generateWithImage —— 两层断链：
 * 1) 干净环境（新库/新装）ai_models 没有 kaypal 平台记录；
 * 2) 即便有记录，ai_models.id 是 cuid 主键，不等于 modelId 字段，
 *    findUnique({ where: { id: modelId } }) 必然查不到 → 一律报「AI 模型不存在」。
 *
 * 统一约定：
 * - 服务端别名 kaypal-vision（网关映射 qwen-vl-max）与本机注册名
 *   cmsvis0001visionkaypalvl 任一命中即可，且必须 enabled；
 * - 缺失时用 env 的 kaypal 代理配置懒创建一条启用记录（host 经网关白名单校验）；
 * - 业务调用方拿到的返回值是 ai_models 数据库主键 id，直接传给
 *   aiClient.generateWithImage(id, ...)。
 */
export const VISION_MODEL_ALIASES = [
  'kaypal-vision',
  'cmsvis0001visionkaypalvl',
] as const;

const KAYPAL_PLATFORM_NAME = 'Kaypal 模型台';

/**
 * 懒创建 kaypal 视觉模型记录（幂等 upsert）。
 * 缺少 env 配置或 host 非法时静默降级返回 false（调用方保持原逻辑，不抛断请求）。
 */
export async function ensureKaypalVisionModel(
  prisma: Pick<PrismaService, 'aIPlatform' | 'aIModel'>,
  config: ConfigService,
  logger?: Logger,
): Promise<boolean> {
  const rawBaseUrl = config.get<string>('KAYPAL_AI_PROXY_BASE_URL')?.trim();
  const apiKey = config.get<string>('KAYPAL_AI_PROXY_API_KEY')?.trim();
  if (!rawBaseUrl || !apiKey) {
    logger?.warn(
      '视觉模型缺失且缺少 KAYPAL_AI_PROXY_BASE_URL/KAYPAL_AI_PROXY_API_KEY（无法懒创建）',
    );
    return false;
  }
  let baseUrl: string;
  try {
    baseUrl = KaypalProviderResolver.assertAllowedUrl(
      rawBaseUrl,
      config.get<string>('KAYPAL_EXTRA_ALLOWED_HOSTS'),
    );
  } catch (error) {
    logger?.warn(
      `视觉模型懒创建被拒：${KaypalProviderResolver.getErrorMessage(error)}`,
    );
    return false;
  }
  try {
    const platform = await prisma.aIPlatform.upsert({
      where: { name: KAYPAL_PLATFORM_NAME },
      create: {
        name: KAYPAL_PLATFORM_NAME,
        baseUrl,
        apiKey,
        enabled: true,
        config: {
          source: 'kaypal',
          defaultHeaders: { 'x-kaypal-api-key': apiKey },
          visionSeed: new Date().toISOString(),
        },
      },
      update: {
        // 只补 baseUrl/apiKey（若为空），不覆盖已有配置
        ...(baseUrl ? { baseUrl } : {}),
        ...(apiKey ? { apiKey } : {}),
      },
    });
    await prisma.aIModel.upsert({
      where: {
        platformId_modelId: {
          platformId: platform.id,
          modelId: VISION_MODEL_ALIASES[0],
        },
      },
      create: {
        name: 'Kaypal 视觉（qwen-vl-max）',
        modelId: VISION_MODEL_ALIASES[0],
        platformId: platform.id,
        enabled: true,
        config: { source: 'kaypal', visionSeed: new Date().toISOString() },
      },
      update: { enabled: true },
    });
    logger?.log(
      `视觉模型已懒创建（${VISION_MODEL_ALIASES[0]} @ ${baseUrl}）`,
    );
    return true;
  } catch (error) {
    logger?.warn(
      `视觉模型懒创建失败：${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}
