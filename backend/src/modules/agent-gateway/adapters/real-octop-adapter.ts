import { Capabilities, TenantContext } from '../core/types';
import { genId } from '../core/util';
import { OctopAdapter } from './octop-mock';

/**
 * 真实 Octop 适配器（v0.9.26，本机 127.0.0.1:8088）。
 * - 健康检查：GET /api/health（无需鉴权）
 * - 应用内鉴权：POST /api/auth/login { password } → access token（env OCTOP_API_PASSWORD）
 *   或直接提供 access token（env OCTOP_ACCESS_TOKEN）
 * - 会话/能力：带 token 调 /api/*；未配置凭据 → 优雅降级（OCTOP_DEGRADED，引擎走 3010 原生工具）
 * 凭据属用户侧（octop init 设定的 setup password），配置后自动接真实能力。
 */
export class RealOctopAdapter implements OctopAdapter {
  private baseUrl: string;
  private password?: string;
  private token?: string;
  private healthyFlag = true;

  constructor(opts?: { baseUrl?: string; password?: string; accessToken?: string }) {
    this.baseUrl = (opts?.baseUrl ?? process.env.OCTOP_BASE_URL ?? 'http://127.0.0.1:8088').replace(/\/+$/, '');
    this.password = opts?.password ?? process.env.OCTOP_API_PASSWORD;
    this.token = opts?.accessToken ?? process.env.OCTOP_ACCESS_TOKEN;
  }

  /** 鉴权：优先直接用 token；否则用 password 换 token */
  private async auth(): Promise<string | undefined> {
    if (this.token) return this.token;
    if (this.password) {
      try {
        const r = await fetch(`${this.baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ password: this.password }),
          signal: AbortSignal.timeout(3000),
        });
        if (r.ok) {
          const d = (await r.json()) as { accessToken?: string; token?: string };
          this.token = d.accessToken ?? d.token;
          return this.token;
        }
      } catch {
        /* 凭据不可用 → 降级 */
      }
    }
    return undefined;
  }

  async createSession(_ctx: TenantContext): Promise<{ octopSessionId: string }> {
    if (!(await this.auth())) throw new Error('OCTOP_UNAVAILABLE');
    // Octop 会话由引擎/ACP 侧管理；REST 层以 token 交换为界
    return { octopSessionId: genId('octop') };
  }

  async tokenExchange(_octopSessionId: string): Promise<{ token: string; expiresAt: string }> {
    const token = await this.auth();
    if (!token) throw new Error('OCTOP_UNAVAILABLE');
    return { token, expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() };
  }

  async cancelRun(sessionId: string, _reason?: string): Promise<{ cancelled: boolean }> {
    if (!(await this.auth())) return { cancelled: false };
    try {
      const r = await fetch(`${this.baseUrl}/api/runs/${sessionId}/cancel`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.token}` },
        signal: AbortSignal.timeout(3000),
      });
      return { cancelled: r.ok };
    } catch {
      return { cancelled: false };
    }
  }

  getCapabilities(): Capabilities {
    const base: Capabilities = {
      browser: { available: false },
      computer: { available: false },
      mobile: { available: false },
      file: { available: false },
      businessTools: [],
    };
    if (!this.healthyFlag) {
      const reason = 'Octop 不可达，已降级为 3010 原生工具';
      return {
        ...base,
        browser: { available: false, degraded: true, reason },
        computer: { available: false, degraded: true, reason },
        mobile: { available: false, degraded: true, reason },
        file: { available: false, degraded: true, reason },
      };
    }
    if (!this.password && !this.token) {
      const reason = '未配置 Octop 凭据（OCTOP_API_PASSWORD / OCTOP_ACCESS_TOKEN）';
      return {
        ...base,
        browser: { available: false, degraded: true, reason },
        computer: { available: false, degraded: true, reason },
        mobile: { available: false, degraded: true, reason },
        file: { available: false, degraded: true, reason },
      };
    }
    // 已配置凭据：能力以 Octop 实际探测为准（可再调 /api/capabilities 细化）
    return { ...base, browser: { available: true }, mobile: { available: true } };
  }

  async healthy(): Promise<boolean> {
    try {
      const r = await fetch(`${this.baseUrl}/api/health`, { signal: AbortSignal.timeout(1500) });
      this.healthyFlag = r.ok;
      return r.ok;
    } catch {
      this.healthyFlag = false;
      return false;
    }
  }

  async setHealthy(v: boolean): Promise<void> {
    this.healthyFlag = v;
  }
}
