import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Capabilities, TenantContext } from '../core/types';
import { genId } from '../core/util';
import { OctopAdapter } from './octop-mock';

/**
 * 真实 Octop 适配器（v0.9.26，本机 127.0.0.1:8088）。
 * - 健康检查：GET /api/health（免鉴权）
 * - 真实登录：POST /api/auth/login {username,password}（env OCTOP_USERNAME/OCTOP_PASSWORD，
 *   或 OCTOP_ACCESS_TOKEN 直用）——tokenExchange 即真实凭据交换
 * - 能力探测：读 Octop 服务端真实探测缓存（~/.octop/config.json capabilities.*）+ 健康检查
 * - 会话创建：Octop 会话由 ACP 通道管理（HTTP 路由未公开），REST 层以 token 交换为界
 * - 未配置凭据/不可达 → 优雅降级（OCTOP_DEGRADED，引擎走 3010 原生工具）
 */
export class RealOctopAdapter implements OctopAdapter {
  private baseUrl: string;
  private token?: string;
  private healthyFlag = true;

  constructor(opts?: { baseUrl?: string; accessToken?: string }) {
    this.baseUrl = (
      opts?.baseUrl ??
      process.env.OCTOP_BASE_URL ??
      'http://127.0.0.1:8088'
    ).replace(/\/+$/, '');
    this.token = opts?.accessToken ?? process.env.OCTOP_ACCESS_TOKEN?.trim();
  }

  private credentials(): { username?: string; password?: string } {
    return {
      username: process.env.OCTOP_USERNAME?.trim(),
      password: process.env.OCTOP_PASSWORD?.trim(),
    };
  }

  /** 真实凭据交换：OCTOP_ACCESS_TOKEN 直用，或 /api/auth/login 换 token */
  private async auth(): Promise<string | undefined> {
    if (this.token) return this.token;
    const { username, password } = this.credentials();
    if (username && password) {
      try {
        const r = await fetch(`${this.baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ username, password }),
          signal: AbortSignal.timeout(5000),
        });
        if (r.ok) {
          const d = (await r.json()) as { access_token?: string };
          this.token = d.access_token;
          return this.token;
        }
      } catch {
        /* 降级 */
      }
    }
    return undefined;
  }

  async createSession(
    _ctx: TenantContext,
  ): Promise<{ octopSessionId: string }> {
    if (!(await this.auth())) throw new Error('OCTOP_UNAVAILABLE');
    // Octop 会话由 ACP 通道管理（HTTP 路由未公开，enable_api_docs=false）；
    // REST 层以 token 交换为界，会话 ID 由引擎侧持有
    return { octopSessionId: genId('octop') };
  }

  async tokenExchange(
    _octopSessionId: string,
  ): Promise<{ token: string; expiresAt: string }> {
    const token = await this.auth(); // 真实 /api/auth/login（octop-bridge 凭据）
    if (!token) throw new Error('OCTOP_UNAVAILABLE');
    return {
      token,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    };
  }

  async cancelRun(
    sessionId: string,
    _reason?: string,
  ): Promise<{ cancelled: boolean }> {
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
      return this.degraded(base, reason);
    }
    // 真实能力：读 Octop 服务端探测缓存（config.json capabilities.*，Octop 启动时实测）
    const probed = this.readOctopProbedCapabilities();
    if (probed) {
      return {
        browser: { available: probed.browser },
        computer: { available: probed.computer },
        mobile: { available: probed.mobile },
        file: { available: probed.file },
        businessTools: [],
      };
    }
    if (!this.token && !this.credentials().username) {
      return this.degraded(
        base,
        '未配置 Octop 凭据（OCTOP_USERNAME/OCTOP_PASSWORD / OCTOP_ACCESS_TOKEN）',
      );
    }
    return {
      ...base,
      browser: { available: true },
      mobile: { available: true },
    };
  }

  private readOctopProbedCapabilities():
    | { browser: boolean; computer: boolean; mobile: boolean; file: boolean }
    | undefined {
    try {
      type OctopCaps = {
        enabled?: boolean;
        available?: boolean;
      };
      type OctopCfg = {
        capabilities?: {
          browser?: OctopCaps;
          computer?: OctopCaps;
          mobile?: OctopCaps;
          file?: OctopCaps;
        };
      };
      const cfg = JSON.parse(
        readFileSync(join(homedir(), '.octop', 'config.json'), 'utf8'),
      ) as OctopCfg;
      const caps = cfg.capabilities ?? {};
      return {
        browser:
          caps.browser?.enabled === true || caps.browser?.available === true,
        computer:
          caps.computer?.enabled === true || caps.computer?.available === true,
        mobile:
          caps.mobile?.enabled === true || caps.mobile?.available === true,
        file: caps.file?.enabled === true || caps.file?.available === true,
      };
    } catch {
      return undefined;
    }
  }

  private degraded(base: Capabilities, reason: string): Capabilities {
    return {
      ...base,
      browser: { available: false, degraded: true, reason },
      computer: { available: false, degraded: true, reason },
      mobile: { available: false, degraded: true, reason },
      file: { available: false, degraded: true, reason },
    };
  }

  async healthy(): Promise<boolean> {
    try {
      const r = await fetch(`${this.baseUrl}/api/health`, {
        signal: AbortSignal.timeout(1500),
      });
      this.healthyFlag = r.ok;
      return r.ok;
    } catch {
      this.healthyFlag = false;
      return false;
    }
  }

  setHealthy(v: boolean): Promise<void> {
    this.healthyFlag = v;
    return Promise.resolve();
  }
}
