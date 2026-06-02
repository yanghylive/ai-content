import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import OpenAI from 'openai';
import { QiniuService } from '../storage/qiniu.service';

function readDefaultHeaders(config: unknown): Record<string, string> {
  if (!config || typeof config !== 'object') {
    return {};
  }
  const headers = (config as { defaultHeaders?: unknown }).defaultHeaders;
  if (!headers || typeof headers !== 'object') {
    return {};
  }
  return Object.fromEntries(
    Object.entries(headers as Record<string, unknown>)
      .filter(([, value]) => typeof value === 'string' && value.trim())
      .map(([key, value]) => [key, String(value).trim()]),
  );
}

@Injectable()
export class AiClientService {
  private readonly logger = new Logger(AiClientService.name);
  private clients: Map<string, OpenAI> = new Map();

  constructor(
    private prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly qiniuService: QiniuService,
  ) { }

  // 获取或创建 AI 客户端
  async getClient(platformId: string): Promise<OpenAI> {
    const platform = await this.prisma.aIPlatform.findUnique({
      where: { id: platformId },
    });

    if (!platform || !platform.enabled) {
      throw new Error('AI 平台未配置或已禁用');
    }

    const dynamicHeaders = await this.resolveDynamicHeaders(platform);
    const cacheKey = `${platformId}:${JSON.stringify(dynamicHeaders)}`;
    if (this.clients.has(platformId)) {
      if (!Object.keys(dynamicHeaders).length) {
        return this.clients.get(platformId)!;
      }
      if (this.clients.has(cacheKey)) {
        return this.clients.get(cacheKey)!;
      }
    }

    // 自动修正并兼容中转平台的 Base URL 填写形式
    // 很多平台会写成 https://api.xxx.com/v1 或者 https://api.xxx.com/v1/chat/completions
    // openai sdk 内部会自动在 baseURL 后面追加 /chat/completions
    let safeBaseUrl = platform.baseUrl.trim();
    if (safeBaseUrl.endsWith('/chat/completions')) {
      safeBaseUrl = safeBaseUrl.replace('/chat/completions', '');
    }
    // 移除末尾的斜杠
    safeBaseUrl = safeBaseUrl.replace(/\/$/, '');

    // 如果没有自带 /v1 且没有说明具体版本路径（通常用于判断那些忘记写 v1 的），由于无法 100% 确定，这里只把明确错误的后缀移除，尽量相信用户的输入
    // 官方的标准是 baseURL 指向到 API 版本这一级，比如 https://api.openai.com/v1

    const client = new OpenAI({
      apiKey: platform.apiKey,
      baseURL: safeBaseUrl,
      defaultHeaders: {
        ...readDefaultHeaders(platform.config),
        ...dynamicHeaders,
      },
    });

    this.clients.set(Object.keys(dynamicHeaders).length ? cacheKey : platformId, client);
    return client;
  }

  // 清除客户端缓存（平台配置更新时调用）
  clearClient(platformId: string) {
    this.clients.delete(platformId);
  }

  private isKaypalProxyPlatform(platform: { baseUrl?: string | null; config?: unknown }) {
    const baseUrl = platform.baseUrl || '';
    const source =
      platform.config && typeof platform.config === 'object'
        ? (platform.config as { source?: unknown }).source
        : null;
    return source === 'kaypal' || /\/api\/ai\/?$/i.test(baseUrl);
  }

  private async resolveDynamicHeaders(platform: { baseUrl?: string | null; config?: unknown }) {
    if (!this.isKaypalProxyPlatform(platform)) {
      return {};
    }

    const session = await this.prisma.userSession.findFirst({
      where: {
        expiresAt: { gt: new Date() },
      },
      orderBy: { updatedAt: 'desc' },
    });
    const metadata = session?.metadata as Record<string, unknown> | null;
    const token = await this.resolveKaypalDesktopToken(session?.id || '', metadata);
    if (!token) {
      return {};
    }
    return { Authorization: `Bearer ${token}` };
  }

  private async resolveKaypalDesktopToken(
    sessionId: string,
    metadata: Record<string, unknown> | null,
  ) {
    const accessToken =
      typeof metadata?.kaypalDesktopAccessToken === 'string'
        ? metadata.kaypalDesktopAccessToken.trim()
        : '';
    const expiresAt = metadata?.kaypalDesktopTokenExpiresAt
      ? new Date(String(metadata.kaypalDesktopTokenExpiresAt))
      : null;
    if (
      accessToken &&
      (!expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt > new Date(Date.now() + 60_000))
    ) {
      return accessToken;
    }

    const refreshToken =
      typeof metadata?.kaypalDesktopRefreshToken === 'string'
        ? metadata.kaypalDesktopRefreshToken.trim()
        : '';
    const deviceId =
      typeof metadata?.kaypalDesktopDeviceId === 'string'
        ? metadata.kaypalDesktopDeviceId.trim()
        : '';
    if (!refreshToken || !deviceId || !sessionId) {
      return accessToken;
    }

    const baseUrl = this.config.get<string>('KAYPAL_AUTH_BASE_URL')?.trim();
    if (!baseUrl) {
      return accessToken;
    }

    try {
      const response = await fetch(new URL('/api/desktop-auth/token', baseUrl), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          device_id: deviceId,
        }),
        signal: AbortSignal.timeout(
          Number(this.config.get<string>('KAYPAL_TOKEN_REFRESH_TIMEOUT_MS') || 10000),
        ),
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            access_token?: string;
            refresh_token?: string;
            expires_in?: number;
          }
        | null;
      if (!response.ok || !payload?.access_token) {
        this.logger.warn(`Kaypal desktop token refresh failed: HTTP ${response.status}`);
        return accessToken;
      }

      const nextMetadata = {
        ...(metadata || {}),
        kaypalDesktopAccessToken: payload.access_token,
        kaypalDesktopRefreshToken: payload.refresh_token || refreshToken,
        kaypalDesktopTokenExpiresAt: new Date(
          Date.now() + Number(payload.expires_in || 3600) * 1000,
        ).toISOString(),
      };
      await this.prisma.userSession.update({
        where: { id: sessionId },
        data: { metadata: nextMetadata },
      });
      this.logger.log('Kaypal desktop token refreshed for AI proxy');
      return payload.access_token;
    } catch (error) {
      this.logger.warn(
        `Kaypal desktop token refresh error: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return accessToken;
    }
  }

  // 将 SDK/平台抛出的多种错误形态压平成可展示字符串
  private getErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    if (typeof error === 'object' && error !== null) {
      const maybeMessage = (error as { message?: unknown }).message;
      if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
        return maybeMessage;
      }

      const maybeError = (error as { error?: { message?: unknown } }).error?.message;
      if (typeof maybeError === 'string' && maybeError.trim()) {
        return maybeError;
      }
    }

    return '未知错误';
  }

  // 非流式生成（用于评分、摘要等）
  async generate(
    modelId: string,
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    options?: { temperature?: number; maxTokens?: number },
  ): Promise<string> {
    const model = await this.prisma.aIModel.findUnique({
      where: { id: modelId },
      include: { platform: true },
    });

    if (!model) throw new Error('AI 模型不存在');

    const client = await this.getClient(model.platformId);

    this.logger.log(`调用 AI 模型: ${model.name} (${model.modelId})`);

    const response = await client.chat.completions.create({
      model: model.modelId,
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 4000,
    });

    return response.choices[0]?.message?.content || '';
  }

  // 流式生成（用于文章创作）
  async *streamGenerate(
    modelId: string,
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    options?: { temperature?: number; maxTokens?: number },
  ): AsyncGenerator<string> {
    const model = await this.prisma.aIModel.findUnique({
      where: { id: modelId },
      include: { platform: true },
    });

    if (!model) throw new Error('AI 模型不存在');

    const client = await this.getClient(model.platformId);

    this.logger.log(`流式调用 AI 模型: ${model.name} (${model.modelId})`);

    const stream = await client.chat.completions.create({
      model: model.modelId,
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 4000,
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield content;
      }
    }
  }

  // 图片生成（用于生成文章封面或插图）
  async generateImage(
    modelId: string,
    prompt: string,
    options?: { size?: '256x256' | '512x512' | '1024x1024'; n?: number; ratio?: string; resolution?: string },
  ): Promise<string> {
    try {
      const model = await this.prisma.aIModel.findUnique({
        where: { id: modelId },
        include: { platform: true },
      });

      if (!model) throw new Error('AI 图片模型不存在');

      const client = await this.getClient(model.platformId);

      this.logger.log(`调用 AI 图片生成: ${model.name} (${model.modelId}) - Prompt: ${prompt.substring(0, 30)}...`);

      const imageParams: Record<string, unknown> = {
        model: model.modelId,
        prompt,
        n: options?.n ?? 1,
      };

      if (options?.ratio) {
        imageParams.ratio = options.ratio;
        if (options?.resolution) {
          imageParams.resolution = options.resolution;
        }
      } else {
        imageParams.size = options?.size ?? '1024x1024';
      }

      if (options?.resolution && !options?.ratio) {
        imageParams.resolution = options.resolution;
      }

      const response: any = options?.ratio || options?.resolution
        ? await client.post('/images/generations', { body: imageParams as any })
        : await client.images.generate(imageParams as any);

      // 某些中转平台会返回 200，但把错误塞在业务字段里。
      if ((response as any).code && (response as any).code !== 0 && !(response as any).data) {
        throw new Error((response as any).message || '平台接口返回错误');
      }

      const images = response?.data || [];
      if (images.length === 0) {
        throw new Error('图片接口未返回任何图片数据');
      }

      for (const img of images) {
        const url = img.url;
        if (url) {
          try {
            const controller = new AbortController();
            const checkRes = await fetch(url, { method: 'GET', signal: controller.signal });

            if (checkRes.ok) {
              controller.abort();
              const cdnUrl = await this.qiniuService.uploadFromUrl(url);
              return cdnUrl || url;
            }

            this.logger.warn(`图片检测无效 (状态码: ${checkRes.status}): ${url}`);
          } catch (e: unknown) {
            this.logger.warn(`图片检测请求失败: ${url}, Error: ${this.getErrorMessage(e)}`);
          }
        }

        // 兼容返回 base64 的图片平台。
        if (img.b64_json) {
          const buffer = Buffer.from(img.b64_json, 'base64');
          const cdnUrl = await this.qiniuService.uploadBuffer(buffer, 'png', 'ai-images');
          if (cdnUrl) {
            return cdnUrl;
          }
          throw new Error('图片平台返回了 base64 图片，但七牛云未配置或上传失败');
        }
      }

      const fallbackUrl = images.find((img) => img.url)?.url;
      if (fallbackUrl) {
        this.logger.warn('返回的图片链接未通过可用性检测，回退使用原始 URL');
        return fallbackUrl;
      }

      throw new Error('图片平台返回的数据中既没有可用 URL，也没有 b64_json');
    } catch (error: unknown) {
      const message = this.getErrorMessage(error);
      this.logger.error(`AI 图片生成失败: ${message}`);
      throw new Error(message);
    }
  }
}
