import { OctopIdentity } from './octop-identity';

/**
 * Octop 用户级身份解析测试（审计 #2）。
 * 纯本地：模式判定 / 确定性派生 / 密码策略 / fail-closed，全部不打网络。
 * 真实开号端到端（会在本机 Octop 建用户，有副作用）需显式 OCTOP_IDENTITY_E2E=1 才跑。
 */
const OCTOP_ENV_KEYS = [
  'OCTOP_IDENTITY_MODE',
  'OCTOP_USER_SECRET',
  'OCTOP_USER_PREFIX',
  'OCTOP_ADMIN_USERNAME',
  'OCTOP_ADMIN_PASSWORD',
  'OCTOP_USERNAME',
  'OCTOP_PASSWORD',
  'OCTOP_SETUP_PASSWORD',
  'OCTOP_ACCESS_TOKEN',
] as const;

/**
 * E2E 配置快照：必须在模块加载期取——下面的 beforeEach 会清空全部 OCTOP_* env
 * 以保证单测互不污染，若在用例里读 env 会拿不到外部传入的 E2E 凭据。
 */
const E2E = {
  enabled: process.env.OCTOP_IDENTITY_E2E === '1',
  secret: process.env.OCTOP_USER_SECRET,
  username: process.env.OCTOP_ADMIN_USERNAME ?? process.env.OCTOP_USERNAME,
  password: process.env.OCTOP_ADMIN_PASSWORD ?? process.env.OCTOP_PASSWORD,
  base: process.env.OCTOP_BASE_URL ?? 'http://127.0.0.1:8088',
};

describe('OctopIdentity（Octop 用户级身份）', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of OCTOP_ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of OCTOP_ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  describe('模式判定', () => {
    it('auto（默认）：未配 secret → shared（单机单用户桌面不变更行为）', () => {
      process.env.OCTOP_USERNAME = 'admin';
      process.env.OCTOP_PASSWORD = 'pw';
      expect(new OctopIdentity().mode()).toBe('shared');
    });

    it('auto：配了 secret + 管理员凭据 → per-user', () => {
      process.env.OCTOP_USER_SECRET = 's3cret';
      process.env.OCTOP_USERNAME = 'admin';
      process.env.OCTOP_PASSWORD = 'pw';
      expect(new OctopIdentity().mode()).toBe('per-user');
    });

    it('auto：有 secret 但缺管理员凭据 → shared（开不了号，不假装隔离）', () => {
      process.env.OCTOP_USER_SECRET = 's3cret';
      expect(new OctopIdentity().mode()).toBe('shared');
    });

    it('显式 shared 覆盖 auto 推断', () => {
      process.env.OCTOP_IDENTITY_MODE = 'shared';
      process.env.OCTOP_USER_SECRET = 's3cret';
      process.env.OCTOP_USERNAME = 'admin';
      process.env.OCTOP_PASSWORD = 'pw';
      expect(new OctopIdentity().mode()).toBe('shared');
    });

    it('显式 per-user 即使缺 secret 也不退回 shared（fail-closed 由 resolve 触发）', () => {
      process.env.OCTOP_IDENTITY_MODE = 'per-user';
      expect(new OctopIdentity().mode()).toBe('per-user');
    });
  });

  describe('确定性派生', () => {
    beforeEach(() => {
      process.env.OCTOP_USER_SECRET = 'unit-test-secret';
    });

    it('同一用户多次派生结果一致（无需落库即可复现）', () => {
      const a = new OctopIdentity();
      const b = new OctopIdentity();
      expect(a.usernameFor('user-1')).toBe(b.usernameFor('user-1'));
      expect(a.describeDerived('user-1')).toEqual(b.describeDerived('user-1'));
    });

    it('不同用户派生出不同 Octop 用户名（会话/cookie 才能隔离）', () => {
      const id = new OctopIdentity();
      expect(id.usernameFor('user-1')).not.toBe(id.usernameFor('user-2'));
    });

    it('用户名不含原始 userId（不把 Kaypal PII 写进 Octop）', () => {
      const id = new OctopIdentity();
      expect(id.usernameFor('18230326666')).not.toContain('18230326666');
    });

    it('用户名长度在 Octop 上限（64）内，且前缀可配', () => {
      const id = new OctopIdentity();
      expect(id.usernameFor('u').startsWith('kx_')).toBe(true);
      expect(id.usernameFor('u').length).toBeLessThanOrEqual(64);
      process.env.OCTOP_USER_PREFIX = 'jz_';
      expect(new OctopIdentity().usernameFor('u').startsWith('jz_')).toBe(true);
    });

    it('派生密码满足 Octop 密码策略（长度 + 必含字母与数字）', () => {
      const d = new OctopIdentity().describeDerived('user-1');
      // Octop infra/users/password.py: 长度下限 + has_letter && has_digit
      expect(d.passwordLength).toBeGreaterThanOrEqual(16);
      expect(d.passwordHasLetter).toBe(true);
      expect(d.passwordHasDigit).toBe(true);
    });

    it('换 secret → 派生结果随之变化（secret 即隔离根凭据）', () => {
      const before = new OctopIdentity().usernameFor('user-1');
      process.env.OCTOP_USER_SECRET = 'another-secret';
      expect(new OctopIdentity().usernameFor('user-1')).not.toBe(before);
    });

    it('未配 secret → 派生直接抛错（不静默降级成可预测口令）', () => {
      delete process.env.OCTOP_USER_SECRET;
      expect(() => new OctopIdentity().usernameFor('user-1')).toThrow(
        /OCTOP_USER_SECRET/,
      );
    });
  });

  describe('resolve 行为', () => {
    it('shared 模式 + OCTOP_ACCESS_TOKEN → 直用且标记未隔离', async () => {
      process.env.OCTOP_ACCESS_TOKEN = 'direct-token';
      const r = await new OctopIdentity().resolve('user-1');
      expect(r.token).toBe('direct-token');
      expect(r.isolated).toBe(false);
    });

    it('未配任何凭据 → 抛错并提示缺哪个 env', async () => {
      await expect(new OctopIdentity().resolve('user-1')).rejects.toThrow(
        /OCTOP_USERNAME/,
      );
    });

    it('per-user 强制模式 + 拿不到用户身份 → fail-closed，不退回共享账号', async () => {
      process.env.OCTOP_IDENTITY_MODE = 'per-user';
      process.env.OCTOP_ACCESS_TOKEN = 'direct-token';
      await expect(new OctopIdentity().resolve(undefined)).rejects.toThrow(
        /OCTOP_IDENTITY_NO_USER/,
      );
    });

    it('per-user 强制模式 + Octop 不可达 → 抛错而非静默共享（越权防线）', async () => {
      process.env.OCTOP_IDENTITY_MODE = 'per-user';
      process.env.OCTOP_USER_SECRET = 'unit-test-secret';
      process.env.OCTOP_USERNAME = 'admin';
      process.env.OCTOP_PASSWORD = 'pw';
      process.env.OCTOP_BASE_URL = 'http://127.0.0.1:59999'; // 必然不可达
      await expect(new OctopIdentity().resolve('user-1')).rejects.toThrow(
        /OCTOP_IDENTITY_PROVISION_FAILED/,
      );
      delete process.env.OCTOP_BASE_URL;
    });
  });

  describe('端到端真实开号（需 OCTOP_IDENTITY_E2E=1，会在本机 Octop 建用户）', () => {
    it('per-user：自动开号 → 拿到该用户专属令牌 → /api/auth/me 可用', async () => {
      if (!E2E.enabled || !E2E.secret || !E2E.username || !E2E.password) return;
      process.env.OCTOP_IDENTITY_MODE = 'per-user';
      process.env.OCTOP_USER_SECRET = E2E.secret;
      process.env.OCTOP_ADMIN_USERNAME = E2E.username;
      process.env.OCTOP_ADMIN_PASSWORD = E2E.password;
      process.env.OCTOP_BASE_URL = E2E.base;
      const base = E2E.base;
      const id = new OctopIdentity();
      const r = await id.resolve('e2e-user-1');
      expect(r.isolated).toBe(true);
      const me = await fetch(`${base}/api/auth/me`, {
        headers: { authorization: `Bearer ${r.token}` },
      });
      expect(me.status).toBe(200);
      const body = (await me.json()) as { username?: string };
      expect(body.username).toBe(r.octopUsername);
    }, 30_000);

    /**
     * 跨租户隔离的决定性证据（审计 #2/#3 的根因回归）：
     * Octop 浏览器会话按 Octop 用户 id 隔离，所以两个 Kaypal 用户必须拿到
     * 不同的 Octop 令牌，且互相看不到对方的浏览器会话。
     * 共享管理员令牌时该断言必然失败（两人是同一个 Octop 用户，会话互相可见）。
     */
    it('per-user：A 的浏览器会话对 B 不可见（跨租户越权回归）', async () => {
      if (!E2E.enabled || !E2E.secret || !E2E.username || !E2E.password) return;
      process.env.OCTOP_IDENTITY_MODE = 'per-user';
      process.env.OCTOP_USER_SECRET = E2E.secret;
      process.env.OCTOP_ADMIN_USERNAME = E2E.username;
      process.env.OCTOP_ADMIN_PASSWORD = E2E.password;
      process.env.OCTOP_BASE_URL = E2E.base;
      const base = E2E.base;
      const id = new OctopIdentity();

      const a = await id.resolve('e2e-user-1');
      const b = await id.resolve('e2e-user-2');
      expect(a.isolated && b.isolated).toBe(true);
      expect(a.token).not.toBe(b.token); // 共享管理员令牌时这里就会挂

      const created = await fetch(`${base}/api/browser/sessions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${a.token}`,
        },
        body: JSON.stringify({}),
      });
      if (created.status === 503) return; // 本机未装 playwright/Chrome → 跳过
      expect(created.status).toBe(201);
      const sess = (await created.json()) as { id?: string };
      expect(typeof sess.id).toBe('string');
      const sid = sess.id as string;

      try {
        // A 自己可见
        const own = await fetch(`${base}/api/browser/sessions/${sid}`, {
          headers: { authorization: `Bearer ${a.token}` },
        });
        expect(own.status).toBe(200);
        // B 不可见（Octop 侧 _get_session(user.id, sid) → 404）
        const cross = await fetch(`${base}/api/browser/sessions/${sid}`, {
          headers: { authorization: `Bearer ${b.token}` },
        });
        expect(cross.status).toBe(404);
        // B 的会话列表里不含 A 的会话
        const list = await fetch(`${base}/api/browser/sessions`, {
          headers: { authorization: `Bearer ${b.token}` },
        });
        const items = (await list.json()) as { id?: string }[];
        expect(items.some((x) => x.id === sid)).toBe(false);
      } finally {
        await fetch(`${base}/api/browser/sessions/${sid}`, {
          method: 'DELETE',
          headers: { authorization: `Bearer ${a.token}` },
        });
      }
    }, 60_000);
  });
});
