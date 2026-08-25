import { createHmac } from 'node:crypto';

/** 令牌缓存条目（纯内存，进程重启即失效；不落盘、不进日志） */
type CachedToken = { token: string; expiresAtMs: number };

export type OctopIdentityResolution = {
  token: string;
  /**
   * true = 该 token 绑定到「该 Kaypal 用户专属的 Octop 账号」，
   * Octop 侧的浏览器会话与浏览器 profile 因此天然隔离。
   * false = 回退到共享凭据（单用户桌面场景）。
   */
  isolated: boolean;
  /** 派生出的 Octop 用户名（仅 isolated=true 时有值；便于排障，不含 PII） */
  octopUsername?: string;
};

/** 默认给每用户 Octop 账号授的权限（对齐产品：Agent Browser / 远程手机 / 终端） */
const DEFAULT_USER_PERMISSIONS = ['browser', 'mobile', 'terminal'];

/** 提前过期余量：避免拿到「即将过期」的 token */
const EXPIRY_SKEW_MS = 60_000;

/**
 * Octop 用户级身份解析（审计 #2：用户级 SSO，取代共享管理员令牌）。
 *
 * **为什么必须做**（实证，Octop 0.9.26 源码）：
 * Octop 的浏览器会话与浏览器 profile 目录都按 **Octop 用户 id** 隔离——
 *   - `api/routers/browser/sessions.py::_get_session(user_id, sid)`：跨用户取会话直接 404
 *   - `_user_profile_dir(root, user_id)` → `browser-profiles/<user_id>`
 *   - `create_session` 对同一 user.id 复用同一个活会话
 * 因此若所有 Kaypal 用户共用一个 Octop 管理员令牌，则**所有租户共享同一个浏览器会话
 * 和同一份 cookie/登录态**——A 客户登录的抖音号会被 B 客户直接复用，跨租户越权。
 * 多用户部署必须为每个 Kaypal 用户绑定独立 Octop 账号。
 *
 * **身份派生**（确定性，无需存储任何用户密码）：
 *   username = `${prefix}${HMAC-SHA256(secret, 'usr:'+kaypalUserId).hex[0..23]}`
 *   password = base64url(HMAC-SHA256(secret, 'pwd:'+kaypalUserId)) + 'A1'
 * 确定性派生 ⇒ 不需落库、不需同步、重装即可复现；密码后缀 `A1` 保证满足 Octop
 * 密码策略（`infra/users/password.py`：长度 + 必含字母与数字）。
 * secret 泄露等于全量泄露，故只从 env 读、不落盘、不进仓库。
 *
 * **模式**（`OCTOP_IDENTITY_MODE`）：
 *   - `per-user`：强制每用户账号；缺 secret/管理员凭据即抛错（fail-closed，服务端部署用）
 *   - `shared`  ：沿用共享凭据（单机单用户桌面，无跨租户风险）
 *   - `auto`（默认）：配了 `OCTOP_USER_SECRET` + 管理员凭据 ⇒ per-user，否则 shared
 */
export class OctopIdentity {
  private cache = new Map<string, CachedToken>();
  private adminCache?: CachedToken;
  private sharedWarned = false;

  private base(): string {
    return (
      process.env.OCTOP_BASE_URL?.trim() || 'http://127.0.0.1:8088'
    ).replace(/\/+$/, '');
  }

  private secret(): string | undefined {
    return process.env.OCTOP_USER_SECRET?.trim() || undefined;
  }

  private adminCreds(): { username?: string; password?: string } {
    return {
      username:
        process.env.OCTOP_ADMIN_USERNAME?.trim() ||
        process.env.OCTOP_USERNAME?.trim(),
      password:
        process.env.OCTOP_ADMIN_PASSWORD?.trim() ||
        process.env.OCTOP_PASSWORD?.trim() ||
        process.env.OCTOP_SETUP_PASSWORD?.trim(),
    };
  }

  /** 解析后的有效模式（auto 已折叠为 per-user / shared） */
  mode(): 'per-user' | 'shared' {
    const raw = process.env.OCTOP_IDENTITY_MODE?.trim().toLowerCase();
    if (raw === 'per-user' || raw === 'peruser') return 'per-user';
    if (raw === 'shared') return 'shared';
    const { username, password } = this.adminCreds();
    return this.secret() && username && password ? 'per-user' : 'shared';
  }

  /** 派生该 Kaypal 用户对应的 Octop 用户名（确定性、不含 PII） */
  usernameFor(kaypalUserId: string): string {
    const secret = this.secret();
    if (!secret) throw new Error('OCTOP_USER_SECRET 未配置');
    const prefix = process.env.OCTOP_USER_PREFIX?.trim() || 'kx_';
    const h = createHmac('sha256', secret)
      .update(`usr:${kaypalUserId}`)
      .digest('hex')
      .slice(0, 24);
    return `${prefix}${h}`; // 默认 27 字符 < Octop 上限 64
  }

  /** 派生该 Kaypal 用户对应的 Octop 密码（确定性，永不出后端） */
  private passwordFor(kaypalUserId: string): string {
    const secret = this.secret();
    if (!secret) throw new Error('OCTOP_USER_SECRET 未配置');
    const b64 = createHmac('sha256', secret)
      .update(`pwd:${kaypalUserId}`)
      .digest('base64url');
    return `${b64}A1`; // 保证必含字母+数字，满足 Octop 密码策略
  }

  /**
   * 派生结果自检（排障 + 测试用）：只回可公开的形状信息，**不回密码本身**。
   * 用于确认派生密码满足 Octop 密码策略（长度 + 必含字母与数字）。
   */
  describeDerived(kaypalUserId: string): {
    username: string;
    passwordLength: number;
    passwordHasLetter: boolean;
    passwordHasDigit: boolean;
  } {
    const pwd = this.passwordFor(kaypalUserId);
    return {
      username: this.usernameFor(kaypalUserId),
      passwordLength: pwd.length,
      passwordHasLetter: /[A-Za-z]/.test(pwd),
      passwordHasDigit: /\d/.test(pwd),
    };
  }

  private userPermissions(): string[] {
    const raw = process.env.OCTOP_USER_PERMISSIONS?.trim();
    if (!raw) return [...DEFAULT_USER_PERMISSIONS];
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /** POST /api/auth/login → { access_token, expires_in } */
  private async login(
    username: string,
    password: string,
  ): Promise<CachedToken | undefined> {
    try {
      const r = await fetch(`${this.base()}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!r.ok) return undefined;
      const d = (await r.json()) as {
        access_token?: string;
        expires_in?: number;
      };
      const token = typeof d.access_token === 'string' ? d.access_token : '';
      if (!token) return undefined;
      const ttlMs =
        (typeof d.expires_in === 'number' && d.expires_in > 0
          ? d.expires_in
          : 86_400) * 1000;
      return { token, expiresAtMs: Date.now() + ttlMs };
    } catch {
      return undefined;
    }
  }

  /** 管理员令牌（仅用于开号；带缓存） */
  private async adminToken(): Promise<string | undefined> {
    const direct = process.env.OCTOP_ACCESS_TOKEN?.trim();
    if (direct) return direct;
    if (
      this.adminCache &&
      this.adminCache.expiresAtMs - EXPIRY_SKEW_MS > Date.now()
    ) {
      return this.adminCache.token;
    }
    const { username, password } = this.adminCreds();
    if (!username || !password) return undefined;
    const t = await this.login(username, password);
    if (!t) return undefined;
    this.adminCache = t;
    return t.token;
  }

  /** 用管理员令牌为该 Kaypal 用户开 Octop 账号（幂等：已存在视为成功） */
  private async provision(
    username: string,
    password: string,
  ): Promise<boolean> {
    const admin = await this.adminToken();
    if (!admin) return false;
    try {
      const r = await fetch(`${this.base()}/api/users`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${admin}`,
        },
        body: JSON.stringify({
          username,
          password,
          role: 'user',
          display_name: 'JIUZHANG AI',
          permissions: this.userPermissions(),
        }),
        signal: AbortSignal.timeout(8_000),
      });
      if (r.status === 201) return true;
      // 已存在（USERNAME_TAKEN）：说明历史已开过号，密码是同一派生值 → 视为成功
      if (r.status === 409 || r.status === 400) {
        const body = (await r.text()).slice(0, 400);
        return (
          body.includes('USERNAME_TAKEN') || body.includes('already exists')
        );
      }
      return false;
    } catch {
      return false;
    }
  }

  /** 共享凭据令牌（OCTOP_ACCESS_TOKEN 直用，或管理员账号登录） */
  private async sharedToken(): Promise<OctopIdentityResolution> {
    const direct = process.env.OCTOP_ACCESS_TOKEN?.trim();
    if (direct) return { token: direct, isolated: false };
    const { username, password } = this.adminCreds();
    if (!username || !password) {
      // 明确指出缺哪个 env，便于运维自查（适配器侧会统一转成 OCTOP_UNAVAILABLE 降级态）
      throw new Error(
        'OCTOP 凭据未配置（OCTOP_USERNAME/OCTOP_PASSWORD 或 OCTOP_ACCESS_TOKEN）',
      );
    }
    const cached = this.cache.get('__shared__');
    if (cached && cached.expiresAtMs - EXPIRY_SKEW_MS > Date.now()) {
      return { token: cached.token, isolated: false };
    }
    const t = await this.login(username, password);
    if (!t) throw new Error('OCTOP_UNAVAILABLE');
    this.cache.set('__shared__', t);
    return { token: t.token, isolated: false };
  }

  /** 显式凭据登录（供 bridge 的 authenticate/自带凭据路径复用） */
  async loginWith(opts: {
    username?: string;
    password?: string;
    accessToken?: string;
  }): Promise<{ token: string; expiresAt: string }> {
    const direct = opts.accessToken?.trim();
    if (direct) {
      return {
        token: direct,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      };
    }
    const u = opts.username?.trim();
    const p = opts.password?.trim();
    if (!u || !p) throw new Error('OCTOP 凭据未提供');
    const t = await this.login(u, p);
    if (!t) throw new Error('Octop 登录失败');
    return { token: t.token, expiresAt: new Date(t.expiresAtMs).toISOString() };
  }

  /**
   * 解析该 Kaypal 用户可用的 Octop 令牌。
   * per-user 模式：登录专属账号（首次自动开号）；shared 模式：共享凭据。
   */
  async resolve(kaypalUserId?: string): Promise<OctopIdentityResolution> {
    if (this.mode() === 'shared' || !kaypalUserId) {
      if (this.mode() === 'per-user' && !kaypalUserId) {
        // per-user 强制模式下拿不到用户身份 ⇒ 不允许退回共享账号（fail-closed）
        throw new Error('OCTOP_IDENTITY_NO_USER');
      }
      return this.sharedToken();
    }

    const cached = this.cache.get(kaypalUserId);
    if (cached && cached.expiresAtMs - EXPIRY_SKEW_MS > Date.now()) {
      return {
        token: cached.token,
        isolated: true,
        octopUsername: this.usernameFor(kaypalUserId),
      };
    }

    const username = this.usernameFor(kaypalUserId);
    const password = this.passwordFor(kaypalUserId);

    let t = await this.login(username, password);
    if (!t) {
      // 首次使用：自动开号后重试一次
      const ok = await this.provision(username, password);
      if (ok) t = await this.login(username, password);
    }
    if (t) {
      this.cache.set(kaypalUserId, t);
      return { token: t.token, isolated: true, octopUsername: username };
    }

    // 开号/登录失败：显式 per-user 模式 fail-closed，auto 模式退回共享并告警一次
    if (process.env.OCTOP_IDENTITY_MODE?.trim().toLowerCase() === 'per-user') {
      throw new Error('OCTOP_IDENTITY_PROVISION_FAILED');
    }
    if (!this.sharedWarned) {
      this.sharedWarned = true;
      console.warn(
        '[octop-identity] 每用户 Octop 账号不可用，已回退共享凭据；' +
          '多用户部署下 Octop 浏览器会话/cookie 将跨用户共享，请配置 OCTOP_USER_SECRET + 管理员凭据。',
      );
    }
    return this.sharedToken();
  }

  /** 令牌失效（401 后重试用） */
  invalidate(kaypalUserId?: string): void {
    if (kaypalUserId) this.cache.delete(kaypalUserId);
    else this.cache.clear();
    this.adminCache = undefined;
  }
}

let singleton: OctopIdentity | undefined;

/** 进程级单例（令牌缓存需要跨请求复用；无 Nest DI 依赖，适配器/控制器均可直用） */
export function getOctopIdentity(): OctopIdentity {
  singleton ??= new OctopIdentity();
  return singleton;
}
