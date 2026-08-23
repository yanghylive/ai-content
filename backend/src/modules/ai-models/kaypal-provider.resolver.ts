import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APIError } from 'openai';

/**
 * Kaypal 百炼统一 Provider Resolver（计划 Stage 1A）
 *
 * 职责（计划一.1 / 二.A）：
 * - 解析 KAYPAL_AUTH_BASE_URL / KAYPAL_AI_PROXY_BASE_URL / KAYPAL_AI_PROXY_API_KEY
 * - 校验 URL host，只允许 kaypal.cn 根域及其子域（见 KAYPAL_ROOT_DOMAIN）
 * - 统一生成 x-kaypal-api-key / x-kaypal-user-id / Authorization 等请求头
 * - 统一错误分类（401/402/409/429/5xx）与 unknown 类型安全读取
 *
 * 业务模块禁止自行拼接第三方 URL 或读取第三方 Key（DASHSCOPE/OPENAI/DEEPSEEK）。
 */
/**
 * 网关根域。生产在用的子域不止 test：enterprise.kaypal.cn、cases.kaypal.cn、
 * aicontent.vip.kaypal.cn 等，因此按「根域 + 子域后缀」判定，而不是维护枚举。
 * 关键是必须解析出 URL.host 再比对——用 baseUrl.includes('kaypal.cn') 做子串匹配
 * 会被 https://kaypal.cn.evil.com 和 https://evil.com/?x=kaypal.cn 绕过。
 */
const KAYPAL_ROOT_DOMAIN = 'kaypal.cn';

export class KaypalHostNotAllowedError extends Error {
  constructor(public readonly host: string) {
    super(
      `Kaypal 地址非法，仅允许 ${KAYPAL_ROOT_DOMAIN} 及其子域，实际: ${host}`,
    );
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

  /**
   * host 是否属于 kaypal 网关（根域或其子域）。
   * 只接受精确的 host（已去端口），不做任何子串匹配。
   * 逃生阀：KAYPAL_EXTRA_ALLOWED_HOSTS（逗号分隔）用于私有化部署/本地代理，默认空。
   */
  static isAllowedHost(rawHost: string, extraHosts?: string): boolean {
    const host = rawHost.trim().toLowerCase().split(':')[0];
    if (!host) return false;
    if (host === KAYPAL_ROOT_DOMAIN) return true;
    if (host.endsWith(`.${KAYPAL_ROOT_DOMAIN}`)) return true;
    const extra = (extraHosts ?? process.env.KAYPAL_EXTRA_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((h) => h.trim().toLowerCase().split(':')[0])
      .filter(Boolean);
    return extra.includes(host);
  }

  /**
   * 校验任意 Kaypal 地址（含数据库里的 platform.baseUrl），返回去尾斜杠的规范值。
   * 非法则抛 KaypalHostNotAllowedError —— 调用方不得用子串匹配自行判定。
   */
  static assertAllowedUrl(rawUrl: string, extraHosts?: string): string {
    const raw = `${rawUrl ?? ''}`.trim().replace(/\/+$/, '');
    let host: string;
    try {
      host = new URL(raw).host;
    } catch {
      throw new KaypalHostNotAllowedError(raw || '(空地址)');
    }
    if (!KaypalProviderResolver.isAllowedHost(host, extraHosts)) {
      throw new KaypalHostNotAllowedError(host);
    }
    return raw;
  }

  /** 网关默认地址，供各业务服务统一引用，避免各自硬编码字面量 */
  static readonly DEFAULT_BASE_URL = `https://${KAYPAL_ROOT_DOMAIN}`;

  /**
   * 按优先级取第一个非空候选值作为 base url，并强制 host 校验。
   *
   * 用于原地替换各业务服务里的无校验拼接：
   *   const base = this.readConfig('KAYPAL_AUTH_BASE_URL') || 'https://kaypal.cn';
   * 这种写法一旦 env 被改成第三方/恶意域名，请求会带着凭据直接打过去。
   * 改为本方法后，任何非 kaypal.cn 根域的配置都会在读取时立刻抛错（fail-closed）。
   *
   * 采用静态方法而非注入实例：这些服务分散在 10 个模块，注入 resolver 需要改动
   * 各自的 module imports（大范围 DI 变更风险高）。静态校验同样达成单点化目标。
   */
  static resolveBaseUrlFrom(
    candidates: Array<string | null | undefined>,
    fallback: string = KaypalProviderResolver.DEFAULT_BASE_URL,
    extraHosts?: string,
  ): string {
    for (const candidate of candidates) {
      const value = `${candidate ?? ''}`.trim();
      if (value) {
        return KaypalProviderResolver.assertAllowedUrl(value, extraHosts);
      }
    }
    return KaypalProviderResolver.assertAllowedUrl(fallback, extraHosts);
  }

  /** 解析并校验 Kaypal 基础地址，host 必须属于网关根域或其子域 */
  resolveBaseUrl(
    envKey: 'KAYPAL_AUTH_BASE_URL' | 'KAYPAL_AI_PROXY_BASE_URL',
    fallback: string,
  ): string {
    return KaypalProviderResolver.assertAllowedUrl(
      this.config.get<string>(envKey) || fallback,
      this.config.get<string>('KAYPAL_EXTRA_ALLOWED_HOSTS'),
    );
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
