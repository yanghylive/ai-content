import { Injectable, Logger } from '@nestjs/common';
import { KaypalProviderResolver } from '../ai-models/kaypal-provider.resolver';

/**
 * Kaypal 统一记忆系统客户端（T3-1，2026-08-20）
 *
 * 对接 118.178.108.44 kaypal-app-baota 的腾讯开源记忆系统（TencentDB Agent Memory 集成）。
 * 公网入口：https://kaypal.cn（nginx 反代 3000，本机后端直连可达，实测已通）
 * 鉴权：POST /api/auth/login {phone, password} → kaypal_auth JWT（HttpOnly cookie，7 天）
 * 写：POST /api/memory {tier: short|daily|long, content, summary?, metadata?}
 * 读：GET /api/memory?query=&tier=&limit=
 *
 * 与既有 MemoryService（本地 UserMemory + MemoryCore 双模）的关系：
 * KaypalMemoryService 是"用户级长期记忆（跨设备、永久）"的补充通道，
 * 在获客域调用点（T3-3 写入 / T3-4 召回）按需使用，失败静默降级不阻断主流程。
 *
 * 配置（env）：KAYPAL_MEMORY_ENABLED=true / KAYPAL_MEMORY_BASE_URL / KAYPAL_MEMORY_PHONE / KAYPAL_MEMORY_PASSWORD
 */

export type MemoryTier = 'short' | 'daily' | 'long';

export interface KaypalMemoryItem {
  id: string;
  content: string;
  summary?: string | null;
  tier: MemoryTier;
  createdAt: string;
  metadata?: Record<string, unknown> | null;
}

@Injectable()
export class KaypalMemoryService {
  private readonly logger = new Logger(KaypalMemoryService.name);
  private authToken: string | null = null;
  private authExpiresAt = 0;

  private get enabled(): boolean {
    return process.env.KAYPAL_MEMORY_ENABLED === 'true';
  }

  private get baseUrl(): string {
    // Stage 1A：host 统一经 KaypalProviderResolver 校验（fail-closed）
    return KaypalProviderResolver.resolveBaseUrlFrom([
      process.env.KAYPAL_MEMORY_BASE_URL,
    ]);
  }

  private get phone(): string {
    return process.env.KAYPAL_MEMORY_PHONE || '';
  }

  private get password(): string {
    return process.env.KAYPAL_MEMORY_PASSWORD || '';
  }

  /** 确保有有效 JWT（缓存 6 天；401 重登一次） */
  private async ensureAuth(): Promise<string | null> {
    if (!this.enabled) {
      this.logger.debug('KAYPAL_MEMORY_ENABLED != true，kaypal 记忆未启用');
      return null;
    }
    if (this.authToken && Date.now() < this.authExpiresAt) {
      return this.authToken;
    }
    if (!this.phone || !this.password) {
      this.logger.warn(
        '缺少 KAYPAL_MEMORY_PHONE / KAYPAL_MEMORY_PASSWORD，kaypal 记忆不可用',
      );
      return null;
    }
    try {
      const res = await fetch(`${this.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: this.phone, password: this.password }),
        signal: AbortSignal.timeout(8000),
      });
      const setCookie = res.headers.get('set-cookie') || '';
      const match = setCookie.match(/kaypal_auth=([^;]+)/);
      if (!res.ok || !match) {
        this.logger.warn(`kaypal 记忆登录失败 HTTP ${res.status}`);
        return null;
      }
      this.authToken = match[1];
      // JWT 7 天有效，本地缓存 6 天提前重登
      this.authExpiresAt = Date.now() + 6 * 24 * 60 * 60 * 1000;
      return this.authToken;
    } catch (error) {
      this.logger.warn(
        `kaypal 记忆登录异常：${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  private async request(
    path: string,
    init: RequestInit & { retried?: boolean },
  ): Promise<Response | null> {
    const token = await this.ensureAuth();
    if (!token) return null;
    const headers: Record<string, string> = {
      Cookie: `kaypal_auth=${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers as Record<string, string> | undefined),
    };
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(10000),
    });
    // 401 → 清缓存重登一次
    if (res.status === 401 && !init.retried) {
      this.authToken = null;
      this.authExpiresAt = 0;
      return this.request(path, { ...init, retried: true });
    }
    return res;
  }

  /** 写入一条记忆（失败静默降级，返回 null） */
  async add(
    tier: MemoryTier,
    content: string,
    options?: {
      summary?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<KaypalMemoryItem | null> {
    if (!content?.trim()) return null;
    try {
      const res = await this.request('/api/memory', {
        method: 'POST',
        body: JSON.stringify({
          tier,
          content: content.trim(),
          summary: options?.summary,
          metadata: options?.metadata,
        }),
      });
      if (!res) return null;
      if (!res.ok) {
        this.logger.warn(`kaypal 记忆写入失败 HTTP ${res.status} tier=${tier}`);
        return null;
      }
      return (await res.json()) as KaypalMemoryItem;
    } catch (error) {
      this.logger.warn(
        `kaypal 记忆写入异常：${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /** 语义检索记忆（失败静默降级，返回空数组） */
  async search(
    query: string,
    tier?: MemoryTier,
    limit = 10,
  ): Promise<KaypalMemoryItem[]> {
    if (!query?.trim()) return [];
    try {
      const params = new URLSearchParams({ query: query.trim() });
      if (tier) params.set('tier', tier);
      if (limit) params.set('limit', String(limit));
      const res = await this.request(`/api/memory?${params.toString()}`, {
        method: 'GET',
      });
      if (!res) return [];
      if (!res.ok) {
        this.logger.warn(`kaypal 记忆检索失败 HTTP ${res.status}`);
        return [];
      }
      const body = (await res.json()) as { items?: KaypalMemoryItem[] };
      return Array.isArray(body?.items) ? body.items : [];
    } catch (error) {
      this.logger.warn(
        `kaypal 记忆检索异常：${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }
}
