import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Capabilities, TenantContext } from '../core/types';
import { getOctopIdentity } from '../octop-identity';
import { OctopAdapter } from './octop-mock';

/** 浏览器环境探测缓存有效期（Octop 侧探测含文件系统扫描，不宜每次请求都打） */
const ENV_PROBE_TTL_MS = 30_000;

/**
 * 「仅令牌」会话句柄前缀：Octop 浏览器环境未就绪（未装 playwright/Chrome）时，
 * 高级模式仍可用（桌面端注入令牌打开 Octop 原生 UI），但**没有**后端浏览器会话。
 * 用该前缀显式标记，避免把「无浏览器会话」伪装成「有会话」。
 */
const TOKEN_ONLY_PREFIX = 'octop_tok_';

type OctopSessionResponse = { id?: string; url?: string; tabs?: unknown[] };
type OctopEnvStatus = {
  playwright?: boolean;
  browsers_ok?: boolean;
  harness_browser?: boolean;
  chrome_path?: string | null;
  error?: string | null;
};

/**
 * 真实 Octop 适配器（v0.9.26，本机 127.0.0.1:8088）。
 *
 * 审计 #3「Agent Gateway 真控 Octop」落地——不再返回 `genId()` 假会话 id：
 *   - 健康检查：`GET /api/health`（免鉴权）
 *   - 身份/令牌：`OctopIdentity`（审计 #2）→ 每 Kaypal 用户独立 Octop 账号令牌
 *   - **真实建会话**：`POST /api/browser/sessions` → 返回 Octop 真实 session id
 *   - **真实取消**：`DELETE /api/browser/sessions/{id}`（关掉该用户的浏览器会话）
 *   - **真实能力**：`GET /api/browser/env-status`（playwright + Chrome 实测），
 *     不可得时回退读 `~/.octop/config.json` 探测缓存
 *
 * 降级策略（不可达/无凭据/浏览器环境未就绪）→ 能力标 degraded，引擎走 3010 原生工具；
 * 浏览器环境未就绪时会话降级为「仅令牌句柄」（前缀 `octop_tok_`），语义显式不作假。
 */
export class RealOctopAdapter implements OctopAdapter {
  private baseUrl: string;
  /** 构造入参显式令牌（测试/特殊部署用；优先级最高） */
  private explicitToken?: string;
  private healthyFlag = true;
  private identity = getOctopIdentity();
  /** octopSessionId → kaypalUserId：令牌交换/取消时定位会话属主，保证 per-user 令牌 */
  private sessionOwners = new Map<string, string>();
  private envCache?: { at: number; env: OctopEnvStatus };

  constructor(opts?: { baseUrl?: string; accessToken?: string }) {
    this.baseUrl = (
      opts?.baseUrl ??
      process.env.OCTOP_BASE_URL ??
      'http://127.0.0.1:8088'
    ).replace(/\/+$/, '');
    this.explicitToken =
      opts?.accessToken ?? process.env.OCTOP_ACCESS_TOKEN?.trim();
  }

  private credentials(): { username?: string; password?: string } {
    return {
      username:
        process.env.OCTOP_ADMIN_USERNAME?.trim() ||
        process.env.OCTOP_USERNAME?.trim(),
      password:
        process.env.OCTOP_ADMIN_PASSWORD?.trim() ||
        process.env.OCTOP_PASSWORD?.trim(),
    };
  }

  /**
   * 真实凭据交换：显式令牌直用，否则经 OctopIdentity 解析
   * （per-user 模式 → 该用户专属 Octop 账号；shared 模式 → 共享凭据）。
   */
  private async auth(kaypalUserId?: string): Promise<string | undefined> {
    if (this.explicitToken) return this.explicitToken;
    try {
      const r = await this.identity.resolve(kaypalUserId);
      return r.token;
    } catch {
      return undefined; // 降级
    }
  }

  /** 「仅令牌」句柄：确定性绑定到用户，避免随机假 id */
  private tokenOnlyHandle(kaypalUserId?: string): string {
    const h = createHash('sha256')
      .update(`octop-token-only:${kaypalUserId ?? 'shared'}`)
      .digest('hex')
      .slice(0, 12);
    return `${TOKEN_ONLY_PREFIX}${h}`;
  }

  /**
   * 真实创建 Octop 浏览器会话。
   * 注意：Octop 侧会话与浏览器 profile 按 **Octop 用户 id** 隔离，
   * 所以这里必须用「该 Kaypal 用户对应的 Octop 令牌」，否则所有租户会共用一个会话。
   */
  async createSession(ctx: TenantContext): Promise<{ octopSessionId: string }> {
    const userId = ctx.userId;
    let token = await this.auth(userId);
    if (!token) throw new Error('OCTOP_UNAVAILABLE');

    const post = (t: string): Promise<Response> =>
      fetch(`${this.baseUrl}/api/browser/sessions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${t}`,
        },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(30_000), // 冷启动要拉起 Chromium
      });

    let res: Response;
    try {
      res = await post(token);
      if (res.status === 401) {
        // 令牌过期：失效缓存后重试一次
        this.identity.invalidate(userId);
        const fresh = await this.auth(userId);
        if (!fresh) throw new Error('OCTOP_UNAVAILABLE');
        token = fresh;
        res = await post(fresh);
      }
    } catch (e) {
      if (e instanceof Error && e.message === 'OCTOP_UNAVAILABLE') throw e;
      throw new Error('OCTOP_UNAVAILABLE');
    }

    if (res.ok) {
      const d = (await res.json()) as OctopSessionResponse;
      const id = typeof d.id === 'string' && d.id ? d.id : undefined;
      if (id) {
        this.sessionOwners.set(id, userId);
        return { octopSessionId: id };
      }
    }

    // 503 = Octop 浏览器环境未就绪（未装 playwright / 找不到 Chrome）。
    // 高级模式仍应可用（桌面端注入令牌打开 Octop 原生 UI），故降级为「仅令牌句柄」。
    if (res.status === 503) {
      const handle = this.tokenOnlyHandle(userId);
      this.sessionOwners.set(handle, userId);
      return { octopSessionId: handle };
    }

    throw new Error('OCTOP_UNAVAILABLE');
  }

  async tokenExchange(
    octopSessionId: string,
  ): Promise<{ token: string; expiresAt: string }> {
    const owner = this.sessionOwners.get(octopSessionId);
    const token = await this.auth(owner);
    if (!token) throw new Error('OCTOP_UNAVAILABLE');
    return {
      token,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    };
  }

  /**
   * 真实取消：关闭该用户在 Octop 侧的浏览器会话（`DELETE /api/browser/sessions/{id}` → 204）。
   * 传入的应是 Octop 真实会话 id；「仅令牌句柄」没有后端会话可关，返回 cancelled=false（不作假）。
   */
  async cancelRun(
    octopSessionId: string,
    _reason?: string,
  ): Promise<{ cancelled: boolean }> {
    if (octopSessionId.startsWith(TOKEN_ONLY_PREFIX))
      return { cancelled: false };
    const owner = this.sessionOwners.get(octopSessionId);
    const token = await this.auth(owner);
    if (!token) return { cancelled: false };
    try {
      const r = await fetch(
        `${this.baseUrl}/api/browser/sessions/${encodeURIComponent(octopSessionId)}`,
        {
          method: 'DELETE',
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(5_000),
        },
      );
      if (r.status === 204 || r.ok) {
        this.sessionOwners.delete(octopSessionId);
        return { cancelled: true };
      }
      return { cancelled: false };
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
      return this.degraded(base, 'Octop 不可达，已降级为 3010 原生工具');
    }

    // 真实浏览器环境（/api/browser/env-status 实测 playwright + Chrome），由 healthy() 刷新
    const env = this.envCache?.env;
    const browserReady =
      env !== undefined
        ? env.playwright === true && env.browsers_ok === true
        : undefined;

    const probed = this.readOctopProbedCapabilities();
    if (probed) {
      return {
        browser: {
          available: browserReady ?? probed.browser,
          ...(browserReady === false
            ? {
                degraded: true,
                reason:
                  env?.error ??
                  'Octop 浏览器环境未就绪（缺 playwright / Chrome）',
              }
            : {}),
        },
        computer: { available: probed.computer },
        mobile: { available: probed.mobile },
        file: { available: probed.file },
        businessTools: [],
      };
    }
    if (!this.explicitToken && !this.credentials().username) {
      return this.degraded(
        base,
        '未配置 Octop 凭据（OCTOP_USERNAME/OCTOP_PASSWORD / OCTOP_ACCESS_TOKEN）',
      );
    }
    return {
      ...base,
      browser: { available: browserReady ?? true },
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

  /** 刷新真实浏览器环境探测（需鉴权；失败不影响健康判定） */
  private async refreshBrowserEnv(): Promise<void> {
    if (this.envCache && Date.now() - this.envCache.at < ENV_PROBE_TTL_MS)
      return;
    const token = await this.auth();
    if (!token) return;
    try {
      const r = await fetch(`${this.baseUrl}/api/browser/env-status`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(3_000),
      });
      if (!r.ok) return;
      const env = (await r.json()) as OctopEnvStatus;
      this.envCache = { at: Date.now(), env };
    } catch {
      /* 探测失败 → 保留旧缓存/回退 config.json */
    }
  }

  async healthy(): Promise<boolean> {
    try {
      const r = await fetch(`${this.baseUrl}/api/health`, {
        signal: AbortSignal.timeout(1500),
      });
      this.healthyFlag = r.ok;
      if (r.ok) await this.refreshBrowserEnv();
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
