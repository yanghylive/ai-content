import {
  BadRequestException,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AiAuditService } from '../ai-audit/ai-audit.service';
import { SavingsExchangeService } from '../savings/savings-exchange.service';
import OpenAI from 'openai';
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionChunk,
} from 'openai/resources/chat/completions';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { StorageService } from '../storage/storage.service';
import {
  KaypalHostNotAllowedError,
  KaypalProviderResolver,
} from './kaypal-provider.resolver';
import {
  AuthRequestContextService,
  type AuthRequestContextUser,
} from '../../common/auth-request-context.service';

/** 图片生成平台响应（兼容标准 SDK 与中转包装） */
type ImageGenResponse = {
  code?: number;
  message?: string;
  data?: Array<{ url?: string; b64_json?: string }>;
};

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

const DEFAULT_KAYPAL_AUTH_BASE_URL = 'https://kaypal.cn';
const DEFAULT_KAYPAL_TEXT_CREDIT_COST = 1;
const DEFAULT_KAYPAL_IMAGE_CREDIT_COST = 5;
const KAYPAL_KNOWLEDGE_CONTEXT_MAX_QUERY_CHARS = 900;
const KAYPAL_KNOWLEDGE_CONTEXT_MAX_SNIPPET_CHARS = 260;

type AiBillingKind = 'text_generation' | 'image_generation';

type AiModelWithPlatform = {
  id: string;
  name: string;
  modelId: string;
  platformId: string;
  platform: {
    baseUrl?: string | null;
    config?: unknown;
    apiKey?: string | null;
  };
};

export type KaypalKnowledgeMode =
  'required' | 'preferred' | 'contextual' | 'off';

export type TextGenerationOptions = {
  temperature?: number;
  maxTokens?: number;
  knowledgeMode?: KaypalKnowledgeMode;
  knowledgeQuery?: string;
  signal?: AbortSignal;
  /** M6：返利直付凭证（已用返利现金抵扣，跳过云端积分扣费） */
  rebateReceiptId?: string;
  /**
   * 计费幂等键附加盐（2026-09 交互式生成 409 修复）。
   * 缺省行为不变：键 = 场景+用户+模型+内容哈希（同内容重试安全）。
   * 交互式「主动再次生成」场景（收件箱 AI 回复 / 客服候选）传每次新盐，
   * 避免同评论再次生成被上游误判为计费重放（BILLING_IDEMPOTENCY_REPLAY）。
   */
  billingSalt?: string;
};

export type ImageTextGenerationOptions = TextGenerationOptions & {
  mimeType?: string;
  detail?: 'low' | 'high' | 'auto';
};

type RequestSignal = {
  signal: AbortSignal;
  cleanup: () => void;
};

function createRequestSignal(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
  timeoutMessage: string,
): RequestSignal {
  const controller = new AbortController();
  const timeoutError = new Error(timeoutMessage);
  timeoutError.name = 'TimeoutError';
  const abort = (reason: unknown) => {
    if (!controller.signal.aborted) controller.abort(reason);
  };
  const onParentAbort = () => abort(parentSignal?.reason);

  if (parentSignal) {
    if (parentSignal.aborted) onParentAbort();
    else parentSignal.addEventListener('abort', onParentAbort, { once: true });
  }

  const timer = setTimeout(() => abort(timeoutError), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', onParentAbort);
    },
  };
}

@Injectable()
export class AiClientService {
  private readonly logger = new Logger(AiClientService.name);
  private clients: Map<string, OpenAI> = new Map();

  constructor(
    private prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly storageService: StorageService,
    @Optional()
    private readonly authRequestContext?: AuthRequestContextService,
    @Optional()
    private readonly savingsExchange?: SavingsExchangeService,
    @Optional()
    private readonly aiAudit?: AiAuditService,
  ) {}

  // 获取或创建 AI 客户端
  async getClient(platformId: string, signal?: AbortSignal): Promise<OpenAI> {
    const platform = await this.prisma.aIPlatform.findUnique({
      where: { id: platformId },
    });

    if (!platform || !platform.enabled) {
      throw new Error('AI 平台未配置或已禁用');
    }
    // 2026-08-22 大王指示：封死自定义第三方平台（用户自配 key 绕过 kaypal 计费）。
    // 所有 AI 调用只允许 Kaypal 模型台（云端记账），第三方直连一律拒绝。
    //
    // 2026-08-23 Stage 1A：改为经 KaypalProviderResolver 做 host 精确校验。
    // 旧实现有三个可绕过的口子，等于「单点化」形同虚设：
    //   ① baseUrl.includes('kaypal.cn') 是子串匹配 ——
    //      https://kaypal.cn.evil.com/v1 与 https://evil.com/?x=kaypal.cn 都能过；
    //   ② platform.name 含 'Kaypal' 就放行 —— 平台改个名即可直连任意第三方域名；
    //   ③ config.source === 'kaypal' 就放行 —— 同上，与真实 baseUrl 无关。
    // 现在唯一判据是 URL.host 属于 kaypal.cn 根域或其子域，名字/source 一律不作数。
    try {
      KaypalProviderResolver.assertAllowedUrl(
        `${platform.baseUrl ?? ''}`,
        // config 用可选链：本方法在部分测试/工具路径下以 Object.create 直接构造，
        // 未经 DI 注入 ConfigService；逃生阀取不到时按「无额外白名单」处理（更严格）。
        this.config?.get<string>('KAYPAL_EXTRA_ALLOWED_HOSTS'),
      );
    } catch (error) {
      if (error instanceof KaypalHostNotAllowedError) {
        throw new Error(
          `仅支持 Kaypal 模型台（统一计费），用户自定义第三方 AI 平台已关闭。${error.message}`,
        );
      }
      throw error;
    }

    this.throwIfAborted(signal);
    const dynamicHeaders = await this.resolveDynamicHeaders(platform, signal);
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
    // OpenAI 兼容协议的约定是 baseURL 指到 API 版本这一级（如 .../api/v1）。
    // 2026-08-23 Stage 1D：注释不再举第三方直连域名为例，生产只走 KAYPAL 网关。

    const client = new OpenAI({
      apiKey: platform.apiKey,
      baseURL: safeBaseUrl,
      defaultHeaders: {
        ...readDefaultHeaders(platform.config),
        ...dynamicHeaders,
      },
    });

    this.clients.set(
      Object.keys(dynamicHeaders).length ? cacheKey : platformId,
      client,
    );
    return client;
  }

  // 清除客户端缓存（平台配置更新时调用）
  clearClient(platformId: string) {
    this.clients.delete(platformId);
  }

  private isKaypalProxyPlatform(platform: {
    baseUrl?: string | null;
    config?: unknown;
  }) {
    const baseUrl = platform.baseUrl || '';
    const source =
      platform.config && typeof platform.config === 'object'
        ? (platform.config as { source?: unknown }).source
        : null;
    return source === 'kaypal' || /\/api\/ai\/?$/i.test(baseUrl);
  }

  /**
   * 2026-08-27：生成网关强制的 X-Kaypal-Context JWT（HS256，kaypal.cn 侧验签）。
   * iss=kaypal-ai-platform / aud=kaypal-api-v1 固定；app_id 取 KAYPAL_APP_ID；
   * secret 取 KAYPAL_CONTEXT_JWT_SECRET。缺失配置时返回 null（调用方跳过该头，
   * 走 legacy 放行路径）。与 octop 已验证接入模式完全一致。
   */
  /**
   * 2026-08-27：业务模型名 → 网关别名映射。kaypal.cn 只放行 6 个 kaypal-* 别名，
   * 而 ai_models 里存的是业务名（deepseek-v4-flash/pro 等）。出站前统一转换；
   * 未命中映射的模型名保持原样（由网关兜底拒绝并给出明确错误）。
   */
  resolveKaypalGatewayModel(modelId: string): string {
    if (!modelId) return modelId;
    const MAP: Record<string, string> = {
      'deepseek-v4-flash': 'kaypal-fast',
      'deepseek-v4-pro': 'kaypal-general',
      'deepseek-v3': 'kaypal-general',
      'kimi-k3': 'kaypal-reasoning',
      'qwen3.8-max': 'kaypal-general',
    };
    if (MAP[modelId]) return MAP[modelId];
    if (/^kaypal-/.test(modelId)) return modelId;
    return modelId;
  }

  private buildKaypalContextJwt(userId: string): string | null {
    const secret = this.config.get<string>('KAYPAL_CONTEXT_JWT_SECRET')?.trim();
    const appId =
      this.config.get<string>('KAYPAL_APP_ID')?.trim() || 'ai-content-desktop';
    if (!secret) return null;
    const header = Buffer.from(
      JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
    ).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(
      JSON.stringify({
        iss: 'kaypal-ai-platform',
        aud: 'kaypal-api-v1',
        sub: userId,
        tenant_id:
          this.config.get<string>('KAYPAL_TENANT_ID')?.trim() ||
          `tenant-${userId}`,
        app_id: appId,
        request_id: `req_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
        jti: randomUUID().replace(/-/g, '').slice(0, 24),
        iat: now,
        exp: now + 120,
      }),
    ).toString('base64url');
    const sig = createHmac('sha256', secret)
      .update(`${header}.${payload}`)
      .digest('base64url');
    return `${header}.${payload}.${sig}`;
  }

  private readKaypalProxyServerApiKey(platform: {
    apiKey?: string | null;
    config?: unknown;
  }) {
    const defaultHeaders = readDefaultHeaders(platform.config);
    const configuredHeader = Object.entries(defaultHeaders).find(
      ([key]) => key.toLowerCase() === 'x-kaypal-api-key',
    )?.[1];
    return (
      // 2026-08-27：env 显式配置（release-config 注入的 desktop 网关凭据）优先于
      // sync 落库的 platform.config 值——后者可能是早前会话的 session token，
      // 网关只认 kaypalcred_* 系列凭据，混用必 401。
      this.config.get<string>('KAYPAL_AI_PROXY_API_KEY')?.trim() ||
      this.config.get<string>('KAYPAL_API_KEY')?.trim() ||
      configuredHeader ||
      platform.apiKey?.trim() ||
      ''
    );
  }

  async resolveDynamicHeaders(
    platform: {
      baseUrl?: string | null;
      config?: unknown;
      apiKey?: string | null;
    },
    signal?: AbortSignal,
  ) {
    if (!this.isKaypalProxyPlatform(platform)) {
      return {};
    }

    const headers: Record<string, string> = {};
    const serverApiKey = this.readKaypalProxyServerApiKey(platform);
    if (serverApiKey) {
      headers['x-kaypal-api-key'] = serverApiKey;
    }

    // 2026-08-27：kaypal.cn 对 chat/completions 强制校验 X-Kaypal-Context JWT。
    // 计费用户优先用当前登录用户的 kaypalUserId（同一手机号在云端是同一个账户）。
    const ctxUser =
      this.authRequestContext?.get()?.user?.kaypalUserId?.trim() ||
      this.config.get<string>('KAYPAL_BILLING_USER_ID')?.trim() ||
      '';
    if (ctxUser) {
      const contextJwt = this.buildKaypalContextJwt(ctxUser);
      if (contextJwt) {
        headers['x-kaypal-context'] = contextJwt;
      }
    }

    const requestContext = this.authRequestContext?.get();
    if (this.authRequestContext?.hasContext()) {
      // 服务商模式：配置 KAYPAL_BILLING_USER_ID 时统一挂靠该账号计费，
      // 直接返回（无需当前用户 token/授权），避免各用户无额度 402。
      const billingUserId = this.config
        .get<string>('KAYPAL_BILLING_USER_ID')
        ?.trim();
      if (billingUserId) {
        headers['x-kaypal-user-id'] = billingUserId;
        return headers;
      }
      const userId = requestContext?.user?.kaypalUserId?.trim() || '';
      if (!userId) {
        // context 存在但无 kaypal 用户（系统级调用，如 MemoryCore 走 LLM 代理）：
        // 降级复用 DB 中可用的 kaypal session（需用户曾登录过）
        const reusable = await this.findReusableKaypalSession();
        const reusableUserId =
          typeof reusable?.user?.kaypalUserId === 'string'
            ? reusable.user.kaypalUserId.trim()
            : '';
        if (reusableUserId) {
          headers['x-kaypal-user-id'] = reusableUserId;
        }
        const reusableToken = await this.resolveKaypalDesktopToken(
          reusable?.id || '',
          (reusable?.metadata as Record<string, unknown> | null) || null,
          signal,
        );
        if (reusableToken) {
          headers.Authorization = `Bearer ${reusableToken}`;
        }
        return headers;
      }
      if (userId) {
        headers['x-kaypal-user-id'] = userId;
      }
      const token = await this.resolveCurrentRequestKaypalToken(
        requestContext?.sessionId || '',
        requestContext?.user || null,
        signal,
      );
      if (!token) {
        if (serverApiKey && userId) {
          return headers;
        }
        throw new ServiceUnavailableException(
          'Kaypal 模型台需要当前登录用户授权，请在「账号与设备」重新登录后再试。',
        );
      }
      headers.Authorization = `Bearer ${token}`;
      if (!userId) {
        throw new ServiceUnavailableException(
          'Kaypal 模型台扣积分需要当前 Kaypal 用户，请重新登录后再创作。',
        );
      }
      return headers;
    }

    // 服务商模式：无用户上下文（@Public 路由）时统一挂靠 KAYPAL_BILLING_USER_ID
    // 出站，保证 x-kaypal-user-id 计费头始终存在（网关对 chat/completions 强校验）。
    const billingUserId = this.config
      .get<string>('KAYPAL_BILLING_USER_ID')
      ?.trim();
    if (billingUserId) {
      headers['x-kaypal-user-id'] = billingUserId;
      return headers;
    }
    const session = await this.findReusableKaypalSession();
    const userId =
      typeof session?.user?.kaypalUserId === 'string'
        ? session.user.kaypalUserId.trim()
        : '';
    if (userId) {
      headers['x-kaypal-user-id'] = userId;
    }
    const metadata = session?.metadata as Record<string, unknown> | null;
    const token = await this.resolveKaypalDesktopToken(
      session?.id || '',
      metadata,
      signal,
    );
    if (!token) {
      return headers;
    }
    headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  private async resolveKaypalProxyUserId(platform: {
    baseUrl?: string | null;
    config?: unknown;
  }) {
    if (!this.isKaypalProxyPlatform(platform)) {
      return '';
    }

    // 服务商模式：配置默认计费用户（KAYPAL_BILLING_USER_ID）时统一挂靠该账号
    // 计费（如模型台已充值的主体），避免各用户各自无额度导致 402。
    const billingUserId = this.config
      .get<string>('KAYPAL_BILLING_USER_ID')
      ?.trim();
    if (billingUserId) {
      return billingUserId;
    }

    const requestContext = this.authRequestContext?.get();
    if (this.authRequestContext?.hasContext()) {
      return requestContext?.user?.kaypalUserId?.trim() || '';
    }

    const session = await this.findReusableKaypalSession();
    return typeof session?.user?.kaypalUserId === 'string'
      ? session.user.kaypalUserId.trim()
      : '';
  }

  private getKaypalCloudBaseUrl() {
    // 模型台/AI 网关独立于认证 base：KAYPAL_AI_PROXY_BASE_URL 优先，
    // 否则回退 KAYPAL_AUTH_BASE_URL（认证切生产时 AI 能力可继续走 test 网关）
    // Stage 1A：host 统一经 KaypalProviderResolver 校验（fail-closed）
    return KaypalProviderResolver.resolveBaseUrlFrom(
      [
        this.config.get<string>('KAYPAL_AI_PROXY_BASE_URL'),
        this.config.get<string>('KAYPAL_AUTH_BASE_URL'),
      ],
      DEFAULT_KAYPAL_AUTH_BASE_URL,
      this.config?.get<string>('KAYPAL_EXTRA_ALLOWED_HOSTS'),
    );
  }

  private isCloudAiBillingEnabled() {
    const value =
      this.config.get<string>('KAYPAL_CLOUD_AI_BILLING_ENABLED') ??
      this.config.get<string>('KAYPAL_CLOUD_BILLING_ENABLED');
    return value !== 'false' && value !== '0';
  }

  private readPositiveNumberConfig(key: string, fallback: number) {
    const value = Number(this.config.get<string>(key) || '');
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  private getCloudAiBillingCost(kind: AiBillingKind) {
    return kind === 'image_generation'
      ? this.readPositiveNumberConfig(
          'KAYPAL_AI_IMAGE_CREDIT_COST',
          DEFAULT_KAYPAL_IMAGE_CREDIT_COST,
        )
      : this.readPositiveNumberConfig(
          'KAYPAL_AI_TEXT_CREDIT_COST',
          DEFAULT_KAYPAL_TEXT_CREDIT_COST,
        );
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private toNumberOrNull(value: unknown) {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private extractBillingBalanceValue(value: unknown) {
    const record = this.asRecord(value);
    if (!record) return null;
    const nestedBalance = this.asRecord(record.balance);
    const nestedBilling = this.asRecord(record.billing);
    return (
      (typeof record.balance === 'number' || typeof record.balance === 'string'
        ? record.balance
        : nestedBalance?.balance) ??
      nestedBilling?.balanceAfter ??
      nestedBilling?.balance_after ??
      nestedBilling?.balance ??
      record.creditBalance ??
      record.credit_balance ??
      record.remainingBalance ??
      record.remaining_balance ??
      record.balanceAfter ??
      record.balance_after ??
      record.credits ??
      record.points ??
      record.availablePoints ??
      record.available_points ??
      record.availableCredits ??
      record.available_credits ??
      null
    );
  }

  private shouldUseKaypalProxyServerBilling(
    kind: AiBillingKind,
    model: AiModelWithPlatform,
    metadata: Record<string, unknown>,
  ) {
    return (
      this.isKaypalProxyPlatform(model.platform) &&
      (kind === 'text_generation' || metadata.mode !== 'image')
    );
  }

  private async resolveKaypalBillingCacheTarget(platform: {
    baseUrl?: string | null;
    config?: unknown;
  }) {
    if (!this.isKaypalProxyPlatform(platform)) {
      return null;
    }

    const requestContext = this.authRequestContext?.get();
    if (this.authRequestContext?.hasContext()) {
      const userId = requestContext?.user?.kaypalUserId?.trim() || '';
      const sessionId = requestContext?.sessionId || '';
      return userId && sessionId ? { userId, sessionId } : null;
    }

    const session = await this.findReusableKaypalSession();
    const userId =
      typeof session?.user?.kaypalUserId === 'string'
        ? session.user.kaypalUserId.trim()
        : '';
    return userId && session?.id ? { userId, sessionId: session.id } : null;
  }

  private async resolveKaypalBillingIdentity(
    platform: {
      baseUrl?: string | null;
      config?: unknown;
    },
    signal?: AbortSignal,
  ) {
    if (!this.isKaypalProxyPlatform(platform)) {
      return null;
    }

    const requestContext = this.authRequestContext?.get();
    if (this.authRequestContext?.hasContext()) {
      const token = await this.resolveCurrentRequestKaypalToken(
        requestContext?.sessionId || '',
        requestContext?.user || null,
        signal,
      );
      const userId = requestContext?.user?.kaypalUserId?.trim() || '';
      return token && userId
        ? { token, userId, sessionId: requestContext?.sessionId || '' }
        : null;
    }

    const session = await this.findReusableKaypalSession();
    const metadata = session?.metadata as Record<string, unknown> | null;
    const token = await this.resolveKaypalDesktopToken(
      session?.id || '',
      metadata,
      signal,
    );
    const userId =
      typeof session?.user?.kaypalUserId === 'string'
        ? session.user.kaypalUserId.trim()
        : '';
    return token && userId
      ? { token, userId, sessionId: session?.id || '' }
      : null;
  }

  private async syncSessionCreditBalanceAfterDeduction(
    sessionId: string,
    userId: string,
    amount: number,
    payload: unknown,
    source = 'cloud-deduct',
  ) {
    if (!sessionId) return;
    try {
      const payloadRecord = this.asRecord(payload);
      const payloadData = this.asRecord(payloadRecord?.data);
      const explicitBalance = this.toNumberOrNull(
        this.extractBillingBalanceValue(payloadData) ??
          this.extractBillingBalanceValue(payloadRecord),
      );
      const session = await this.prisma.system.userSession.findUnique({
        where: { id: sessionId },
        select: { metadata: true },
      });
      const metadata = this.asRecord(session?.metadata) || {};
      const cachedBalance = this.toNumberOrNull(metadata.kaypalCreditBalance);
      const nextBalance =
        explicitBalance ??
        (cachedBalance === null ? null : Math.max(0, cachedBalance - amount));
      if (nextBalance === null) return;

      await this.prisma.system.userSession.update({
        where: { id: sessionId },
        data: {
          metadata: {
            ...metadata,
            kaypalCreditBalance: nextBalance,
            kaypalCreditBalanceUserId:
              typeof metadata.kaypalCreditBalanceUserId === 'string'
                ? metadata.kaypalCreditBalanceUserId
                : userId || null,
            kaypalCreditBalanceSyncedAt: new Date().toISOString(),
            kaypalCreditBalanceSource: source,
          },
        },
      });
    } catch (error) {
      this.logger.warn(
        `Kaypal local credit cache update failed: ${this.getErrorMessage(error)}`,
      );
    }
  }

  /** Token 自动计量（P0 炼刀对标）：成功调用后采集 usage 上报 AiAuditService，不阻塞主流程 */
  private async reportTokenUsage(input: {
    kaypalUserId?: string;
    modelName?: string;
    modelId?: string;
    scene: string;
    usage?: {
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
    };
  }) {
    const aiAudit = this.aiAudit;
    const userId = input.kaypalUserId?.trim();
    if (!aiAudit || !userId) return; // 未绑定云账号不累计本地 token（与云端 billing 口径一致）
    try {
      const prompt = Math.max(Math.floor(input.usage?.promptTokens ?? 0), 0);
      const completion = Math.max(
        Math.floor(input.usage?.completionTokens ?? 0),
        0,
      );
      const total =
        Math.max(Math.floor(input.usage?.totalTokens ?? 0), 0) ||
        prompt + completion;
      if (total <= 0) return;
      await aiAudit.recordTokenUsage({
        userId,
        tokens: total,
        tool: input.modelName || input.scene,
        scene: input.scene,
        refType: 'ai-model',
        refId: input.modelId ?? undefined,
      });
    } catch (error) {
      this.logger.warn(`Token 用量上报失败（不影响主流程）: ${error}`);
    }
  }

  private async syncSessionCreditBalanceFromServerBilling(
    model: AiModelWithPlatform,
    payload: unknown,
  ) {
    const target = await this.resolveKaypalBillingCacheTarget(model.platform);
    if (!target) return;
    const payloadRecord = this.asRecord(payload);
    const billingRecord = this.asRecord(payloadRecord?.billing);
    const balance = this.toNumberOrNull(
      this.extractBillingBalanceValue(billingRecord) ??
        this.extractBillingBalanceValue(payloadRecord),
    );
    if (balance === null) return;

    await this.syncSessionCreditBalanceAfterDeduction(
      target.sessionId,
      target.userId,
      0,
      billingRecord || payload,
      'kaypal-server-billing',
    );
  }

  private async chargeCloudAiCredits(
    kind: AiBillingKind,
    model: AiModelWithPlatform,
    metadata: Record<string, unknown> = {},
    signal?: AbortSignal,
    rebateReceiptId?: string,
  ) {
    if (
      !this.isCloudAiBillingEnabled() ||
      !this.isKaypalProxyPlatform(model.platform)
    ) {
      return;
    }

    // M6：返利直付凭证 → 校验已付（属当前用户）后跳过云端扣费
    if (rebateReceiptId) {
      const userId = this.authRequestContext?.get()?.user?.id?.trim();
      if (!userId) {
        throw new ServiceUnavailableException('返利支付需登录用户身份');
      }
      if (!this.savingsExchange) {
        throw new ServiceUnavailableException('返利支付服务未就绪');
      }
      await this.savingsExchange.assertRebatePaid(
        userId,
        rebateReceiptId,
        kind,
      );
      this.logger.log(
        `返利直付已抵扣云端扣费: ${kind}, receipt=${rebateReceiptId}`,
      );
      return;
    }

    if (this.shouldUseKaypalProxyServerBilling(kind, model, metadata)) {
      this.logger.debug(
        `Kaypal 代理模型由服务器扣积分: ${kind}, model=${model.modelId}`,
      );
      return;
    }

    this.throwIfAborted(signal);
    const identity = await this.resolveKaypalBillingIdentity(
      model.platform,
      signal,
    );
    if (!identity) {
      throw new ServiceUnavailableException(
        '云端扣积分需要当前登录用户授权，请在「账号与设备」重新登录后再试。',
      );
    }

    const amount = this.getCloudAiBillingCost(kind);
    const baseUrl = this.getKaypalCloudBaseUrl();

    let request: RequestSignal | undefined;
    try {
      request = createRequestSignal(
        signal,
        this.readPositiveNumberConfig('KAYPAL_AI_BILLING_TIMEOUT_MS', 8000),
        'Kaypal cloud billing timeout',
      );
      const response = await fetch(new URL('/api/billing/deduct', baseUrl), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${identity.token}`,
        },
        body: JSON.stringify({
          user_id: identity.userId,
          amount,
          service_type: 'ai_content_workbench',
          resource_type: kind,
          metadata: {
            source: 'ai-content-workbench',
            billingMode: 'cloud',
            phase: 'pre_model_call',
            idempotencyKey: `ai-content:${kind}:${randomUUID()}`,
            modelId: model.modelId,
            localModelId: model.id,
            platformId: model.platformId,
            ...metadata,
          },
        }),
        signal: request.signal,
      });

      const payload = (await response.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      const payloadRecord = this.asRecord(payload);

      if (!response.ok) {
        const reason =
          (typeof payloadRecord?.error === 'string'
            ? payloadRecord.error
            : '') ||
          (typeof payloadRecord?.message === 'string'
            ? payloadRecord.message
            : '') ||
          `Kaypal 云端扣积分接口返回 HTTP ${response.status}`;
        const amount = this.getCloudAiBillingCost(kind);
        if (/余额不足|积分不足|insufficient/i.test(reason)) {
          throw new BadRequestException({
            code: 'INSUFFICIENT_CREDITS',
            message: `云积分不足（本次需 ${amount} 积分），可用返利现金抵扣`,
            amount,
            kind,
          });
        }
        throw new Error(reason);
      }

      await this.syncSessionCreditBalanceAfterDeduction(
        identity.sessionId,
        identity.userId,
        amount,
        payload,
      );
      this.logger.log(
        `Kaypal 云端已扣积分: ${kind}, amount=${amount}, model=${model.modelId}`,
      );
    } catch (error) {
      this.rethrowIfAborted(error, signal);
      const message = this.getErrorMessage(error);
      this.logger.warn(`Kaypal 云端扣积分失败: ${message}`);
      throw new ServiceUnavailableException(`云端扣积分失败：${message}`);
    } finally {
      request?.cleanup();
    }
  }

  private async findReusableKaypalSession() {
    // 服务商模式：仅允许显式配置的计费主体（KAYPAL_BILLING_USER_ID）。
    // 不再从全库任意挑 session 复用——消除「跨用户计费/配额归属错误」。
    // 未配置计费主体时返回 null，调用方 fail-closed（不猜计费主体）。
    const billingUserId = this.config
      .get<string>('KAYPAL_BILLING_USER_ID')
      ?.trim();
    if (!billingUserId) {
      return null;
    }

    const sessions = await this.prisma.system.userSession.findMany({
      where: {
        expiresAt: { gt: new Date() },
        user: { kaypalUserId: billingUserId },
      },
      include: {
        user: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 1,
    });

    const isAcceptanceOnlySession = (
      metadata: Record<string, unknown> | null,
    ) =>
      metadata?.localOnly === true ||
      metadata?.source === 'commercial-acceptance-gate' ||
      metadata?.source === 'codex-diagnostics' ||
      metadata?.source === 'codex-real-acceptance';
    return (
      sessions.find((session) => {
        const metadata = session.metadata as Record<string, unknown> | null;
        return (
          !isAcceptanceOnlySession(metadata) &&
          Boolean(
            typeof metadata?.kaypalDesktopAccessToken === 'string' ||
            typeof metadata?.kaypalDesktopRefreshToken === 'string',
          )
        );
      }) ||
      sessions.find((session) => {
        const metadata = session.metadata as Record<string, unknown> | null;
        return !isAcceptanceOnlySession(metadata);
      }) ||
      sessions[0] ||
      null
    );
  }

  private async resolveCurrentRequestKaypalToken(
    sessionId: string,
    user: AuthRequestContextUser | null,
    signal?: AbortSignal,
  ) {
    if (!user?.kaypalUserId) {
      return '';
    }

    const metadata = {
      kaypalDesktopAccessToken: user.kaypalDesktopAccessToken || '',
      kaypalDesktopRefreshToken: user.kaypalDesktopRefreshToken || '',
      kaypalDesktopTokenExpiresAt: user.kaypalDesktopTokenExpiresAt || '',
      kaypalDesktopDeviceId: user.kaypalDesktopDeviceId || '',
    };

    return this.resolveKaypalDesktopToken(sessionId, metadata, signal);
  }

  private async resolveKaypalDesktopToken(
    sessionId: string,
    metadata: Record<string, unknown> | null,
    signal?: AbortSignal,
  ) {
    const accessToken =
      typeof metadata?.kaypalDesktopAccessToken === 'string'
        ? metadata.kaypalDesktopAccessToken.trim()
        : '';
    const expiresAt =
      metadata?.kaypalDesktopTokenExpiresAt &&
      typeof metadata.kaypalDesktopTokenExpiresAt === 'string'
        ? new Date(metadata.kaypalDesktopTokenExpiresAt)
        : null;
    if (
      accessToken &&
      (!expiresAt ||
        Number.isNaN(expiresAt.getTime()) ||
        expiresAt > new Date(Date.now() + 60_000))
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

    const baseUrl = KaypalProviderResolver.resolveBaseUrlFrom(
      [this.config.get<string>('KAYPAL_AUTH_BASE_URL')],
      DEFAULT_KAYPAL_AUTH_BASE_URL,
      this.config?.get<string>('KAYPAL_EXTRA_ALLOWED_HOSTS'),
    );
    if (!baseUrl) {
      return accessToken;
    }

    const request = createRequestSignal(
      signal,
      Number(
        this.config.get<string>('KAYPAL_TOKEN_REFRESH_TIMEOUT_MS') || 10000,
      ),
      'Kaypal token refresh timeout',
    );
    try {
      const response = await fetch(
        new URL('/api/desktop-auth/token', baseUrl),
        {
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
          signal: request.signal,
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
      } | null;
      if (!response.ok || !payload?.access_token) {
        this.logger.warn(
          `Kaypal desktop token refresh failed: HTTP ${response.status}`,
        );
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
      await this.prisma.system.userSession.update({
        where: { id: sessionId },
        data: { metadata: nextMetadata },
      });
      this.logger.log('Kaypal desktop token refreshed for AI proxy');
      return payload.access_token;
    } catch (error) {
      this.rethrowIfAborted(error, signal);
      this.logger.warn(
        `Kaypal desktop token refresh error: ${this.getErrorMessage(error)}`,
      );
      return accessToken;
    } finally {
      request.cleanup();
    }
  }

  private async resolveCurrentRequestKaypalKnowledgeToken(
    signal?: AbortSignal,
  ) {
    if (!this.authRequestContext?.hasContext()) {
      return '';
    }
    const requestContext = this.authRequestContext.get();
    return this.resolveCurrentRequestKaypalToken(
      requestContext?.sessionId || '',
      requestContext?.user || null,
      signal,
    );
  }

  private shouldUseKaypalKnowledgeContext() {
    const value = this.config.get<string>('KAYPAL_KNOWLEDGE_CONTEXT_ENABLED');
    return value !== 'false' && value !== '0';
  }

  private extractKnowledgeQuery(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  ) {
    const userContent = messages
      .filter((message) => message.role === 'user')
      .map((message) => message.content)
      .join('\n')
      .replace(/\s+/g, ' ')
      .trim();
    return userContent.slice(0, KAYPAL_KNOWLEDGE_CONTEXT_MAX_QUERY_CHARS);
  }

  private async buildKaypalKnowledgeContext(
    query: string,
    signal?: AbortSignal,
  ) {
    this.throwIfAborted(signal);
    if (!this.shouldUseKaypalKnowledgeContext() || query.length < 4) {
      return '';
    }
    const localContext = await this.buildLocalKnowledgeContext(query);
    this.throwIfAborted(signal);
    const token = await this.resolveCurrentRequestKaypalKnowledgeToken(signal);

    let cloudContext = '';
    if (!token) {
      return localContext;
    }
    const baseUrl = KaypalProviderResolver.resolveBaseUrlFrom(
      [this.config.get<string>('KAYPAL_AUTH_BASE_URL')],
      DEFAULT_KAYPAL_AUTH_BASE_URL,
      this.config?.get<string>('KAYPAL_EXTRA_ALLOWED_HOSTS'),
    );
    const request = createRequestSignal(
      signal,
      Number(
        this.config.get<string>('KAYPAL_KNOWLEDGE_CONTEXT_TIMEOUT_MS') || 5000,
      ),
      'Kaypal knowledge context timeout',
    );
    try {
      const response = await fetch(
        new URL('/api/ai-content/knowledge/search', baseUrl),
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ query, limit: 3 }),
          signal: request.signal,
        },
      );
      if (!response.ok) return localContext;
      const payload = (await response.json().catch(() => null)) as {
        data?: { matches?: unknown[] };
      } | null;
      const matches = Array.isArray(payload?.data?.matches)
        ? payload.data.matches
        : [];
      const lines = matches
        .map((item, index) => {
          if (!item || typeof item !== 'object') return '';
          const record = item as Record<string, unknown>;
          const title =
            typeof record.title === 'string' ? record.title.trim() : '';
          const snippet =
            typeof record.snippet === 'string'
              ? record.snippet
                  .replace(/\s+/g, ' ')
                  .trim()
                  .slice(0, KAYPAL_KNOWLEDGE_CONTEXT_MAX_SNIPPET_CHARS)
              : '';
          if (!snippet) return '';
          return `${index + 1}. ${title || 'Kaypal 知识'}：${snippet}`;
        })
        .filter(Boolean);
      if (!lines.length) return localContext;
      cloudContext = [
        'Kaypal 主系统知识库参考：',
        ...lines,
        '使用要求：仅把以上内容作为事实参考；如与当前任务上下文冲突，以当前任务上下文为准；不要编造知识库没有的信息。',
      ].join('\n');
    } catch (error) {
      this.rethrowIfAborted(error, signal);
      this.logger.warn(
        `Kaypal knowledge context skipped: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    } finally {
      request.cleanup();
    }
    return [localContext, cloudContext].filter(Boolean).join('\n\n');
  }

  private buildKnowledgeTerms(query: string) {
    return Array.from(
      new Set(
        query
          .replace(/\s+/g, ' ')
          .trim()
          .toLowerCase()
          .match(/[a-z0-9_-]{2,}|[\u4e00-\u9fa5]{2,}/gi) || [],
      ),
    ).slice(0, 12);
  }

  private buildKnowledgeSnippet(content: string, terms: string[]) {
    const normalized = content.replace(/\s+/g, ' ').trim();
    if (!normalized) return '';
    const lower = normalized.toLowerCase();
    const firstIndex = terms
      .map((term) => lower.indexOf(term.toLowerCase()))
      .filter((index) => index >= 0)
      .sort((a, b) => a - b)[0];
    const start = firstIndex === undefined ? 0 : Math.max(0, firstIndex - 80);
    const snippet = normalized.slice(
      start,
      start + KAYPAL_KNOWLEDGE_CONTEXT_MAX_SNIPPET_CHARS,
    );
    return `${start > 0 ? '...' : ''}${snippet}${start + KAYPAL_KNOWLEDGE_CONTEXT_MAX_SNIPPET_CHARS < normalized.length ? '...' : ''}`;
  }

  private toAbortError(error?: unknown, signal?: AbortSignal): Error {
    if (signal?.reason instanceof Error) return signal.reason;
    if (error instanceof Error && /abort/i.test(error.name)) return error;
    const abortError = new Error(
      typeof signal?.reason === 'string' ? signal.reason : 'AI 生成已取消',
    );
    abortError.name = 'AbortError';
    return abortError;
  }

  private throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw this.toAbortError(undefined, signal);
  }

  private rethrowIfAborted(error: unknown, signal?: AbortSignal) {
    if (signal?.aborted) throw this.toAbortError(error, signal);
    const errorName =
      error && typeof error === 'object'
        ? (error as { name?: unknown }).name
        : undefined;
    if (
      error &&
      typeof error === 'object' &&
      ['AbortError', 'APIUserAbortError'].includes(
        typeof errorName === 'string' ? errorName : '',
      )
    ) {
      throw error instanceof Error
        ? error
        : new Error(
            typeof error === 'string'
              ? error
              : (JSON.stringify(error) ?? '未知错误'),
          );
    }
  }

  private async buildLocalKnowledgeContext(query: string) {
    const terms = this.buildKnowledgeTerms(query);
    const searchTerms = terms.length ? terms : [query];
    // P1-6：只召回「当前用户自己的」或「public」知识；系统级调用（无用户）只召回 public。
    // 绝不召回他人的 private，也绝不召回归属不明的 ownerId=null 旧数据。
    const currentUserId =
      this.authRequestContext?.get()?.user?.id?.trim() || null;
    const visibilityFilter = currentUserId
      ? { OR: [{ ownerId: currentUserId }, { visibility: 'public' }] }
      : { visibility: 'public' };
    const materials = await this.prisma.material.findMany({
      where: {
        platform: 'LocalKnowledge',
        AND: [
          visibilityFilter,
          {
            OR: searchTerms.flatMap((term) => [
              { title: { contains: term } },
              { summary: { contains: term } },
              { content: { contains: term } },
            ]),
          },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take: 5,
    });
    const lines = materials
      .map((item, index) => {
        const snippet = this.buildKnowledgeSnippet(
          item.content || item.summary || item.title,
          terms,
        );
        if (!snippet) return '';
        return `${index + 1}. ${item.title}：${snippet}`;
      })
      .filter(Boolean);
    if (!lines.length) return '';
    return [
      '本机知识库参考：',
      ...lines,
      '使用要求：优先使用本机知识库中的事实；如与当前任务上下文冲突，以当前任务上下文为准；不要编造知识库没有的信息。',
    ].join('\n');
  }

  private async withKaypalKnowledgeContext(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    options?: {
      mode?: KaypalKnowledgeMode;
      query?: string;
      signal?: AbortSignal;
    },
  ) {
    const mode = options?.mode || 'preferred';
    if (mode === 'off') return messages;

    const query = (
      options?.query || this.extractKnowledgeQuery(messages)
    ).trim();
    const context = await this.buildKaypalKnowledgeContext(
      query,
      options?.signal,
    );
    if (!context) {
      if (mode !== 'required') return messages;
      return [
        ...messages,
        {
          role: 'system' as const,
          content:
            '知识库未命中当前问题的可靠参考。对客回复时不得编造价格、库存、活动、承诺、联系方式、疗效或平台外交易信息；信息不足时请自然追问关键信息或建议转人工。',
        },
      ];
    }

    this.logger.debug(
      `Kaypal knowledge context applied: mode=${mode}, queryChars=${query.length}`,
    );
    return [
      ...messages,
      {
        role: 'system' as const,
        content: context,
      },
    ];
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

      const maybeError = (error as { error?: { message?: unknown } }).error
        ?.message;
      if (typeof maybeError === 'string' && maybeError.trim()) {
        return maybeError;
      }
    }

    return '未知错误';
  }

  /** 生成稳定的 kaypal 计费幂等键。
   * 2026-08-24 修复（error-reports 连续 409 BILLING_IDEMPOTENCY_REPLAY）：
   * 原实现每次调用 randomUUID() 生成新键，同内容重试（客户端超时重发 /
   * 失败重试）因幂等键不同被网关判定为「计费重放」→ 409。改为
   * 「场景 + 用户 + 模型 + 实际发送内容哈希」的确定性键：同内容重试命中
   * 网关幂等重试语义（复用首次结果、不重复计费），与 ai-gateway
   * 计划二.C.6「整次请求稳定幂等键」策略一致。 */
  private buildKaypalIdempotencyKey(
    scene: 'text' | 'vision_text' | 'stream_text',
    kaypalUserId: string,
    modelId: string,
    content: unknown,
  ): string {
    const digest = createHash('sha256')
      .update(JSON.stringify(content ?? ''))
      .digest('hex')
      .slice(0, 32);
    return `ai-content:${scene}:${kaypalUserId}:${modelId}:${digest}`;
  }

  private toUserFacingAiError(
    error: unknown,
    platform?: { baseUrl?: string | null; config?: unknown },
  ) {
    const message = this.getErrorMessage(error);
    if (
      /billing_user_required|billing user id|user id is required/i.test(message)
    ) {
      return new ServiceUnavailableException(
        'Kaypal 模型台扣积分缺少当前用户，请重新登录后再创作。',
      );
    }
    if (
      /402|Payment Required|INSUFFICIENT_CREDITS|insufficient[_\s-]*credits|积分不足|余额不足|额度不足/i.test(
        message,
      )
    ) {
      return new ServiceUnavailableException(
        'Kaypal 模型台积分余额不足，本次 AI 调用已被云端拦截。请确认账号积分或充值后再试。',
      );
    }
    if (/401|unauthorized|invalid api key|incorrect api key/i.test(message)) {
      if (platform && this.isKaypalProxyPlatform(platform)) {
        return new ServiceUnavailableException(
          'Kaypal 模型台服务端授权未放行，请确认 kaypal.cn 已部署 billing/AI proxy 服务端 key 配置。',
        );
      }
      return new ServiceUnavailableException(
        'Kaypal 模型台授权已失效，请在「账号与设备」重新授权后再试。',
      );
    }
    if (/supported API model names|you passed|model/i.test(message)) {
      return new ServiceUnavailableException(
        `当前默认 AI 模型不可用：${message}`,
      );
    }
    return new ServiceUnavailableException(`AI 服务暂时不可用：${message}`);
  }

  // 非流式生成（用于评分、摘要等）
  async generate(
    modelId: string,
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    options?: TextGenerationOptions,
  ): Promise<string> {
    this.throwIfAborted(options?.signal);
    const model = await this.prisma.aIModel.findUnique({
      where: { id: modelId },
      include: { platform: true },
    });

    if (!model) throw new Error('AI 模型不存在');

    const client = await this.getClient(model.platformId, options?.signal);
    const kaypalUserId = await this.resolveKaypalProxyUserId(model.platform);
    const contextualMessages = await this.withKaypalKnowledgeContext(messages, {
      mode: options?.knowledgeMode,
      query: options?.knowledgeQuery,
      signal: options?.signal,
    });
    // 稳定幂等键（基于实际发送内容哈希）：同内容重试不触发网关 409 计费重放
    const kaypalIdempotencyKey = kaypalUserId
      ? this.buildKaypalIdempotencyKey(
          'text',
          kaypalUserId,
          model.modelId,
          options?.billingSalt
            ? { body: contextualMessages, salt: options.billingSalt }
            : contextualMessages,
        )
      : '';
    // 2026-09-06 复核诊断：409 BILLING_IDEMPOTENCY_REPLAY 排查——键与 salt 落日志
    if (options?.billingSalt) {
      this.logger.log(
        `AI 调用带 billingSalt（len=${options.billingSalt.length}）→ key=${kaypalIdempotencyKey}`,
      );
    }

    await this.chargeCloudAiCredits(
      'text_generation',
      model,
      {
        mode: 'text',
        maxTokens: options?.maxTokens ?? 4000,
      },
      options?.signal,
      options?.rebateReceiptId,
    );

    this.logger.log(`调用 AI 模型: ${model.name} (${model.modelId})`);

    const startedAt = Date.now();
    try {
      const outboundModel = this.isKaypalProxyPlatform(model.platform)
        ? this.resolveKaypalGatewayModel(model.modelId)
        : model.modelId;
      const response = await client.chat.completions.create(
        {
          model: outboundModel,
          messages: contextualMessages,
          temperature: options?.temperature ?? 0.7,
          max_tokens: options?.maxTokens ?? 4000,
          // 2026-08-11 真机闭环验证发现：deepseek-v4-flash 默认开推理时输出全进
          // reasoning_content，content 为空（finishReason=stop 但 completion 满）
          // → 文案生成返回空串。显式关推理保证 content 直接出结果。
          thinking: { type: 'disabled' },
          ...(kaypalUserId ? { user: kaypalUserId, userId: kaypalUserId } : {}),
          ...(kaypalIdempotencyKey
            ? { idempotencyKey: kaypalIdempotencyKey }
            : {}),
        } as unknown as ChatCompletionCreateParamsNonStreaming,
        options?.signal ? { signal: options.signal } : undefined,
      );

      await this.syncSessionCreditBalanceFromServerBilling(model, response);
      void this.reportTokenUsage({
        kaypalUserId,
        modelName: model.name,
        modelId: model.modelId,
        scene: 'text_generation',
        usage: {
          promptTokens: response?.usage?.prompt_tokens,
          completionTokens: response?.usage?.completion_tokens,
          totalTokens: response?.usage?.total_tokens,
        },
      });
      const rawContent = response.choices[0]?.message?.content || '';
      // 兜底：部分模型 content 为空但推理内容在 reasoning_content（thinking 关闭参数未被代理透传时）
      const content =
        rawContent ||
        (
          response.choices[0]?.message as unknown as {
            reasoning_content?: string;
          }
        )?.reasoning_content ||
        '';
      if (!content) {
        this.logger.warn(
          `[ai-client] 模型返回空 content. model=${model.modelId} choices=${response?.choices?.length ?? 0} finishReason=${JSON.stringify(response?.choices?.[0]?.finish_reason ?? null)} usage=${JSON.stringify(response?.usage ?? null)}`,
        );
      }
      if (kaypalUserId) {
        void this.aiAudit?.recordTrace({
          userId: kaypalUserId,
          scene: 'text_generation',
          modelId: model.modelId,
          modelName: model.name,
          promptJson: contextualMessages,
          completion: content,
          promptTokens: response?.usage?.prompt_tokens,
          completionTokens: response?.usage?.completion_tokens,
          totalTokens: response?.usage?.total_tokens,
          latencyMs: Date.now() - startedAt,
          success: true,
        });
      }
      return content;
    } catch (error) {
      this.rethrowIfAborted(error, options?.signal);
      const message = this.getErrorMessage(error);
      this.logger.error(`AI 文本生成失败: ${message}`);
      if (kaypalUserId) {
        void this.aiAudit?.recordTrace({
          userId: kaypalUserId,
          scene: 'text_generation',
          modelId: model.modelId,
          modelName: model.name,
          promptJson: contextualMessages,
          errorMsg: message,
          latencyMs: Date.now() - startedAt,
          success: false,
        });
      }
      throw this.toUserFacingAiError(error, model.platform);
    }
  }

  async generateWithImage(
    modelId: string,
    input: {
      system?: string;
      prompt: string;
      imageBase64: string;
    },
    options?: ImageTextGenerationOptions,
  ): Promise<string> {
    this.throwIfAborted(options?.signal);
    const model = await this.prisma.aIModel.findUnique({
      where: { id: modelId },
      include: { platform: true },
    });

    if (!model) throw new Error('AI 模型不存在');

    const client = await this.getClient(model.platformId, options?.signal);
    const kaypalUserId = await this.resolveKaypalProxyUserId(model.platform);
    const mimeType = options?.mimeType || 'image/png';
    const messages = [
      input.system
        ? {
            role: 'system',
            content: input.system,
          }
        : null,
      {
        role: 'user',
        content: [
          { type: 'text', text: input.prompt },
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${input.imageBase64}`,
              detail: options?.detail || 'auto',
            },
          },
        ],
      },
    ].filter(Boolean);
    // 稳定幂等键（基于实际发送内容哈希）：同内容重试不触发网关 409 计费重放
    const kaypalIdempotencyKey = kaypalUserId
      ? this.buildKaypalIdempotencyKey(
          'vision_text',
          kaypalUserId,
          model.modelId,
          messages,
        )
      : '';

    await this.chargeCloudAiCredits(
      'image_generation',
      model,
      {
        mode: 'vision_text',
        maxTokens: options?.maxTokens ?? 1200,
      },
      options?.signal,
      options?.rebateReceiptId,
    );

    this.logger.log(`调用视觉 AI 模型: ${model.name} (${model.modelId})`);

    const startedAt = Date.now();
    try {
      const response = await client.chat.completions.create(
        {
          model: model.modelId,
          messages,
          temperature: options?.temperature ?? 0.1,
          max_tokens: options?.maxTokens ?? 1200,
          // 同 generate：显式关推理，避免输出全进 reasoning_content 导致 content 空
          thinking: { type: 'disabled' },
          ...(kaypalUserId ? { user: kaypalUserId, userId: kaypalUserId } : {}),
          ...(kaypalIdempotencyKey
            ? { idempotencyKey: kaypalIdempotencyKey }
            : {}),
        } as unknown as ChatCompletionCreateParamsNonStreaming,
        options?.signal ? { signal: options.signal } : undefined,
      );

      await this.syncSessionCreditBalanceFromServerBilling(model, response);
      void this.reportTokenUsage({
        kaypalUserId,
        modelName: model.name,
        modelId: model.modelId,
        scene: 'vision',
        usage: {
          promptTokens: response?.usage?.prompt_tokens,
          completionTokens: response?.usage?.completion_tokens,
          totalTokens: response?.usage?.total_tokens,
        },
      });
      const visionContent = response.choices[0]?.message?.content || '';
      if (kaypalUserId) {
        void this.aiAudit?.recordTrace({
          userId: kaypalUserId,
          scene: 'vision',
          modelId: model.modelId,
          modelName: model.name,
          // 脱敏：不存图片 base64，只存文本 prompt + 图片占位
          promptJson: [
            ...(input.system
              ? [{ role: 'system', content: input.system }]
              : []),
            { role: 'user', content: input.prompt },
            { role: 'user', content: '[image]' },
          ] as Prisma.InputJsonValue,
          completion: visionContent,
          promptTokens: response?.usage?.prompt_tokens,
          completionTokens: response?.usage?.completion_tokens,
          totalTokens: response?.usage?.total_tokens,
          latencyMs: Date.now() - startedAt,
          success: true,
        });
      }
      return visionContent;
    } catch (error) {
      this.rethrowIfAborted(error, options?.signal);
      const message = this.getErrorMessage(error);
      this.logger.error(`AI 图片识别失败: ${message}`);
      if (kaypalUserId) {
        void this.aiAudit?.recordTrace({
          userId: kaypalUserId,
          scene: 'vision',
          modelId: model.modelId,
          modelName: model.name,
          promptJson: [
            ...(input.system
              ? [{ role: 'system', content: input.system }]
              : []),
            { role: 'user', content: input.prompt },
            { role: 'user', content: '[image]' },
          ] as Prisma.InputJsonValue,
          errorMsg: message,
          latencyMs: Date.now() - startedAt,
          success: false,
        });
      }
      throw this.toUserFacingAiError(error, model.platform);
    }
  }

  // 流式生成（用于文章创作）
  async *streamGenerate(
    modelId: string,
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    options?: TextGenerationOptions,
  ): AsyncGenerator<string> {
    this.throwIfAborted(options?.signal);
    const model = await this.prisma.aIModel.findUnique({
      where: { id: modelId },
      include: { platform: true },
    });

    if (!model) throw new Error('AI 模型不存在');

    const client = await this.getClient(model.platformId, options?.signal);
    const kaypalUserId = await this.resolveKaypalProxyUserId(model.platform);
    const contextualMessages = await this.withKaypalKnowledgeContext(messages, {
      mode: options?.knowledgeMode,
      query: options?.knowledgeQuery,
      signal: options?.signal,
    });
    // 稳定幂等键（基于实际发送内容哈希）：同内容重试不触发网关 409 计费重放
    const kaypalIdempotencyKey = kaypalUserId
      ? this.buildKaypalIdempotencyKey(
          'stream_text',
          kaypalUserId,
          model.modelId,
          contextualMessages,
        )
      : '';

    await this.chargeCloudAiCredits(
      'text_generation',
      model,
      {
        mode: 'stream_text',
        maxTokens: options?.maxTokens ?? 4000,
      },
      options?.signal,
      options?.rebateReceiptId,
    );

    this.logger.log(`流式调用 AI 模型: ${model.name} (${model.modelId})`);

    const startedAt = Date.now();
    let stream: AsyncIterable<ChatCompletionChunk>;
    try {
      stream = await client.chat.completions.create(
        {
          model: model.modelId,
          messages: contextualMessages,
          temperature: options?.temperature ?? 0.7,
          max_tokens: options?.maxTokens ?? 4000,
          stream: true,
          ...(kaypalUserId ? { user: kaypalUserId, userId: kaypalUserId } : {}),
          ...(kaypalIdempotencyKey
            ? { idempotencyKey: kaypalIdempotencyKey }
            : {}),
        } as unknown as ChatCompletionCreateParamsStreaming,
        options?.signal ? { signal: options.signal } : undefined,
      );
    } catch (error) {
      this.rethrowIfAborted(error, options?.signal);
      const message = this.getErrorMessage(error);
      this.logger.error(`AI 流式文本生成失败: ${message}`);
      if (kaypalUserId) {
        void this.aiAudit?.recordTrace({
          userId: kaypalUserId,
          scene: 'stream_text',
          modelId: model.modelId,
          modelName: model.name,
          promptJson: contextualMessages,
          errorMsg: message,
          latencyMs: Date.now() - startedAt,
          success: false,
        });
      }
      throw this.toUserFacingAiError(error, model.platform);
    }

    let fullContent = '';
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;
    try {
      for await (const chunk of stream) {
        this.throwIfAborted(options?.signal);
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          fullContent += content;
          yield content;
        }
        // 流式 usage：仅在开启 stream_options.include_usage 时最后一个 chunk 携带
        const usage = (
          chunk as unknown as {
            usage?: {
              prompt_tokens?: number;
              completion_tokens?: number;
              total_tokens?: number;
            };
          }
        )?.usage;
        if (usage) {
          promptTokens = usage.prompt_tokens ?? promptTokens;
          completionTokens = usage.completion_tokens ?? completionTokens;
          totalTokens = usage.total_tokens ?? totalTokens;
        }
      }
      if (kaypalUserId) {
        void this.aiAudit?.recordTrace({
          userId: kaypalUserId,
          scene: 'stream_text',
          modelId: model.modelId,
          modelName: model.name,
          promptJson: contextualMessages,
          completion: fullContent,
          promptTokens,
          completionTokens,
          totalTokens,
          latencyMs: Date.now() - startedAt,
          success: true,
        });
      }
    } catch (error) {
      this.rethrowIfAborted(error, options?.signal);
      if (kaypalUserId) {
        void this.aiAudit?.recordTrace({
          userId: kaypalUserId,
          scene: 'stream_text',
          modelId: model.modelId,
          modelName: model.name,
          promptJson: contextualMessages,
          completion: fullContent || undefined,
          errorMsg: error instanceof Error ? error.message : String(error),
          latencyMs: Date.now() - startedAt,
          success: false,
        });
      }
      throw error;
    }
  }

  // 图片生成（用于生成文章封面或插图）
  async generateImage(
    modelId: string,
    prompt: string,
    options?: {
      size?: '256x256' | '512x512' | '1024x1024';
      n?: number;
      ratio?: string;
      resolution?: string;
      signal?: AbortSignal;
      /** M6：返利直付凭证（已用返利现金抵扣，跳过云端积分扣费） */
      rebateReceiptId?: string;
    },
  ): Promise<string> {
    this.throwIfAborted(options?.signal);
    try {
      const model = await this.prisma.aIModel.findUnique({
        where: { id: modelId },
        include: { platform: true },
      });

      if (!model) throw new Error('AI 图片模型不存在');

      const client = await this.getClient(model.platformId, options?.signal);

      await this.chargeCloudAiCredits(
        'image_generation',
        model,
        {
          mode: 'image',
          size: options?.size,
          ratio: options?.ratio,
          resolution: options?.resolution,
          count: options?.n ?? 1,
        },
        options?.signal,
        options?.rebateReceiptId,
      );

      this.logger.log(
        `调用 AI 图片生成: ${model.name} (${model.modelId}) - Prompt: ${prompt.substring(0, 30)}...`,
      );

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

      // 平台响应结构未知（标准 SDK 或中转包装），显式收敛为业务字段模型
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- double cast 中转 unknown 是刻意为之
      const response = (options?.ratio || options?.resolution
        ? await client.post('/images/generations', {
            body: imageParams as unknown as Parameters<
              typeof client.images.generate
            >[0],
            ...(options?.signal ? { signal: options.signal } : {}),
          })
        : await client.images.generate(
            imageParams as unknown as Parameters<
              typeof client.images.generate
            >[0],
            options?.signal ? { signal: options.signal } : undefined,
          )) as unknown as ImageGenResponse;

      // 某些中转平台会返回 200，但把错误塞在业务字段里。
      if (response.code && response.code !== 0 && !response.data) {
        throw new Error(response.message || '平台接口返回错误');
      }

      const images = response?.data || [];
      if (images.length === 0) {
        throw new Error('图片接口未返回任何图片数据');
      }

      for (const img of images) {
        const url = img.url;
        if (url) {
          try {
            const checkRes = await fetch(url, {
              method: 'GET',
              signal: options?.signal,
            });

            if (checkRes.ok) {
              const cdnUrl = options?.signal
                ? await this.storageService.uploadFromUrl(url, options.signal)
                : await this.storageService.uploadFromUrl(url);
              return cdnUrl || url;
            }

            this.logger.warn(
              `图片检测无效 (状态码: ${checkRes.status}): ${url}`,
            );
          } catch (e: unknown) {
            this.rethrowIfAborted(e, options?.signal);
            this.logger.warn(
              `图片检测请求失败: ${url}, Error: ${this.getErrorMessage(e)}`,
            );
          }
        }

        // 兼容返回 base64 的图片平台。
        if (img.b64_json) {
          const buffer = Buffer.from(img.b64_json, 'base64');
          const cdnUrl = options?.signal
            ? await this.storageService.uploadBuffer(
                buffer,
                'png',
                'ai-images',
                options.signal,
              )
            : await this.storageService.uploadBuffer(
                buffer,
                'png',
                'ai-images',
              );
          if (cdnUrl) {
            return cdnUrl;
          }
          throw new Error(
            '图片平台返回了 base64 图片，但七牛云未配置或上传失败',
          );
        }
      }

      const fallbackUrl = images.find((img) => img.url)?.url;
      if (fallbackUrl) {
        this.logger.warn('返回的图片链接未通过可用性检测，回退使用原始 URL');
        return fallbackUrl;
      }

      throw new Error('图片平台返回的数据中既没有可用 URL，也没有 b64_json');
    } catch (error: unknown) {
      this.rethrowIfAborted(error, options?.signal);
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      const message = this.getErrorMessage(error);
      this.logger.error(`AI 图片生成失败: ${message}`);
      throw new Error(message);
    }
  }
}
