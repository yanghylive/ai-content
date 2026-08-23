import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APIError } from 'openai';

/**
 * Kaypal 百炼统一 Provider Resolver（计划 Stage 1A）
 *
 * 职责（计划一.1 / 二.A）：
 * - 解析 KAYPAL_AUTH_BASE_URL / KAYPAL_AI_PROXY_BASE_URL / KAYPAL_AI_PROXY_API_KEY
 * - 校验 URL host，只允许 kaypal.cn / test.kaypal.cn
 * - 统一生成 x-kaypal-api-key / x-kaypal-user-id / Authorization 等请求头
 * - 统一错误分类（401/402/409/429/5xx）与 unknown 类型安全读取
 *
 * 业务模块禁止自行拼接第三方 URL 或读取第三方 Key（DASHSCOPE/OPENAI/DEEPSEEK）。
 */
export const ALLOWED_KAYPAL_HOSTS = ['kaypal.cn', 'test.kaypal.cn'] as const;

export class KaypalHostNotAllowedError extends Error {
  constructor(public readonly host: string) {
    super(`Kaypal 地址非法，仅允许 kaypal.cn / test.kaypal.cn，实际: ${host}`);
    this.name = 'KaypalHostNotAllowedError';
  }
}

export type GatewayErrorKind =
  'auth' | 'balance' | 'conflict' | 'rate' | 'server' | 'unknown';

export interface GatewayErrorInfo {
  kind: GatewayErrorKind;
  status?: number;
  message: string;
}

@Injectable()
export class KaypalProviderResolver {
  private readonly logger = new Logger(KaypalProviderResolver.name);

  private static readonly DEFAULT_AUTH_BASE_URL = 'https://kaypal.cn';
  private static readonly DEFAULT_AI_PROXY_BASE_URL =
    'https://kaypal.cn/api/ai';

  constructor(private readonly config: ConfigService) {}

  /** 解析并校验 Kaypal 基础地址，host 必须命中白名单 */
  resolveBaseUrl(
    envKey: 'KAYPAL_AUTH_BASE_URL' | 'KAYPAL_AI_PROXY_BASE_URL',
    fallback: string,
  ): string {
    const raw = (this.config.get<string>(envKey) || fallback)
      .trim()
      .replace(/\/+$/, '');
    let host: string;
    try {
      host = new URL(raw).host;
    } catch {
      throw new KaypalHostNotAllowedError(raw);
    }
    if (!(ALLOWED_KAYPAL_HOSTS as readonly string[]).includes(host)) {
      throw new KaypalHostNotAllowedError(host);
    }
    return raw;
  }

  get authBaseUrl(): string {
    return this.resolveBaseUrl(
      'KAYPAL_AUTH_BASE_URL',
      KaypalProviderResolver.DEFAULT_AUTH_BASE_URL,
    );
  }

  get aiProxyBaseUrl(): string {
    return this.resolveBaseUrl(
      'KAYPAL_AI_PROXY_BASE_URL',
      KaypalProviderResolver.DEFAULT_AI_PROXY_BASE_URL,
    );
  }

  get serverApiKey(): string {
    return (
      this.config.get<string>('KAYPAL_AI_PROXY_API_KEY')?.trim() ||
      this.config.get<string>('KAYPAL_API_KEY')?.trim() ||
      ''
    );
  }

  /** 统一生成 Kaypal 网关鉴权头（计划一.1） */
  buildHeaders(opts: {
    userId?: string;
    token?: string;
    serverApiKey?: string;
  }): Record<string, string> {
    const headers: Record<string, string> = {};
    const key = opts.serverApiKey ?? this.serverApiKey;
    if (key) headers['x-kaypal-api-key'] = key;
    if (opts.userId) headers['x-kaypal-user-id'] = opts.userId;
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    return headers;
  }

  /** 安全读取 unknown 错误文案（消除 any.message / TS18047） */
  static getErrorMessage(e: unknown): string {
    if (e instanceof Error) return e.message;
    if (typeof e === 'string') return e;
    if (e && typeof e === 'object' && 'message' in e) {
      const m = (e as { message?: unknown }).message;
      if (typeof m === 'string') return m;
    }
    return String(e);
  }

  /** 判断是否为视觉模型——禁止作为普通文本对话 fallback（计划二.B.6） */
  static isVisionModel(m: {
    modelId?: string | null;
    name?: string | null;
  }): boolean {
    const s = `${m.modelId ?? ''} ${m.name ?? ''}`.toLowerCase();
    return /vision|vl[-._]|vlmax|vl_max|视觉|qwen-vl|glm-4v|doubao.*vision|glm-v/i.test(
      s,
    );
  }

  /** 安全提取 HTTP 状态码（规避 openai APIError.status 的 any 类型） */
  private static extractHttpStatus(e: unknown): number | undefined {
    if (e instanceof APIError) {
      const s = (e as { status?: unknown }).status;
      return typeof s === 'number' ? s : undefined;
    }
    return undefined;
  }

  /** 把网关错误分类为可操作的用户提示（计划二.C / 一.1） */
  static classifyError(e: unknown): GatewayErrorInfo {
    const message = KaypalProviderResolver.getErrorMessage(e);
    const status = KaypalProviderResolver.extractHttpStatus(e);
    switch (status) {
      case 401:
        return {
          kind: 'auth',
          status,
          message: 'Kaypal 模型台鉴权失效，请到「账号与设备」重新登录后再试。',
        };
      case 402:
        return {
          kind: 'balance',
          status,
          message: 'Kaypal 网关余额不足或额度已用完，请充值后重试。',
        };
      case 409:
        return {
          kind: 'conflict',
          status,
          message: '检测到重复请求（幂等冲突），请稍后重试。',
        };
      case 429:
        return {
          kind: 'rate',
          status,
          message: '请求过于频繁，请稍后再试。',
        };
      case 500:
      case 502:
      case 503:
      case 504:
        return {
          kind: 'server',
          status,
          message: 'Kaypal 网关临时不可用，请稍后重试。',
        };
      default:
        if (
          /402|payment required|insufficient[_\s-]*credits|余额不足|额度不足|积分不足/i.test(
            message,
          )
        ) {
          return {
            kind: 'balance',
            status,
            message: 'Kaypal 网关余额不足或额度已用完，请充值后重试。',
          };
        }
        if (
          /401|unauthorized|鉴权|授权已失效|重新登录|重新授权/i.test(message)
        ) {
          return {
            kind: 'auth',
            status,
            message:
              'Kaypal 模型台需要登录授权，请到「账号与设备」重新登录后再试。',
          };
        }
        return { kind: 'unknown', status, message };
    }
  }
}
