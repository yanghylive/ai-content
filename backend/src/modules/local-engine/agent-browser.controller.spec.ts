import {
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { AgentBrowserController } from './agent-browser.controller';

// P0-1（审计 2026-08-22）：AuthGuard 写 request.authUser，控制器读 request.user
// 恒空回落 local-user → 用户级隔离失效。修复后：
// 1. 读 request.authUser，有值返回真实 userId
// 2. 无身份抛 401（不再回落 local-user）
// 3. 跨用户访问会话 → 403（防 IDOR）
describe('AgentBrowserController P0-1 身份字段（审计修复）', () => {
  function makeController(authUser?: { id: string }) {
    const ctrl = Object.create(AgentBrowserController.prototype) as AgentBrowserController;
    return {
      ctrl,
      getUserId(req: { authUser?: { id: string } }) {
        // 访问私有方法
        return (ctrl as unknown as {
          getUserId(r: { authUser?: { id: string } }): string;
        }).getUserId(req);
      },
    };
  }

  it('有 authUser：返回真实 userId（不再回落 local-user）', () => {
    const { getUserId } = makeController({ id: 'user-123' });
    expect(getUserId({ authUser: { id: 'user-123' } })).toBe('user-123');
  });

  it('无 authUser：抛 401（禁止回落 local-user）', () => {
    const { getUserId } = makeController();
    expect(() => getUserId({})).toThrow(UnauthorizedException);
  });

  it('无 authUser 的旧 request.user 路径也抛 401（不再读 request.user）', () => {
    const { getUserId } = makeController();
    // 即使攻击者塞了 request.user 也不能用（AuthGuard 不写该字段，读取路径已改 authUser）
    expect(() =>
      getUserId({ authUser: undefined } as never),
    ).toThrow(UnauthorizedException);
  });
});

// ── 阶段 5 第一站（2026-09-04）：GET sessions/:id/login-state ────────────────
describe('AgentBrowserController loginState（平台登录态查询）', () => {
  type LoginStateOk = {
    ok: true;
    platform: string;
    state: string;
    url: string;
    panelWebContentsId: number | null;
  };

  function makeLoginStateController(opts: {
    platform?: string;
    leaseTenantId?: string | null;
    result: { ok: false; reason: string } | LoginStateOk;
  }) {
    const loginStateViaPanel = jest.fn(async () => opts.result);
    const assertOwner = jest.fn();
    const sessionsStub = {
      // resolveTenantId 探测用（无 prisma 直接 403，这里给空对象占位）
      prisma: {},
      assertOwner,
      get: jest.fn(() => ({
        id: 's1',
        platform: opts.platform ?? 'general-web',
        lease: { ownerId: 'user-a', tenantId: opts.leaseTenantId ?? null },
      })),
    };
    const ctrl = Object.create(
      AgentBrowserController.prototype,
    ) as unknown as Record<string, unknown>;
    ctrl.sessions = sessionsStub;
    ctrl.authRequestContext = { resolveTenantId: async () => 'tenant-x' };
    ctrl.executor = { loginStateViaPanel };
    return { ctrl, sessionsStub, assertOwner, loginStateViaPanel };
  }

  it('xiaohongshu 会话：actor 用租约身份（tenantId 缺失回落请求租户），透传 ok 结果', async () => {
    const { ctrl, assertOwner, loginStateViaPanel } = makeLoginStateController({
      platform: 'xiaohongshu',
      leaseTenantId: null,
      result: {
        ok: true,
        platform: 'xiaohongshu',
        state: 'login_prompt',
        url: 'https://www.xiaohongshu.com/explore',
        panelWebContentsId: 42,
      },
    });
    const out = (await (ctrl as never as {
      loginState: (req: unknown, id: string) => Promise<LoginStateOk>;
    }).loginState({ authUser: { id: 'user-a' } }, 's1')) as LoginStateOk;
    expect(out).toMatchObject({ ok: true, platform: 'xiaohongshu', state: 'login_prompt' });
    expect(assertOwner).toHaveBeenCalledWith('s1', 'user-a', 'tenant-x');
    expect(loginStateViaPanel).toHaveBeenCalledWith(
      { ownerId: 'user-a', tenantId: 'tenant-x' },
      'xiaohongshu',
    );
  });

  it('未注册平台（general-web）→ 400，executor 不被调用', async () => {
    const { ctrl, loginStateViaPanel } = makeLoginStateController({
      platform: 'general-web',
      result: {
        ok: true,
        platform: 'general-web',
        state: 'unknown',
        url: 'https://kaypal.cn',
        panelWebContentsId: 42,
      },
    });
    await expect(
      (ctrl as never as {
        loginState: (req: unknown, id: string) => Promise<unknown>;
      }).loginState({ authUser: { id: 'user-a' } }, 's1'),
    ).rejects.toThrow(BadRequestException);
    expect(loginStateViaPanel).not.toHaveBeenCalled();
  });

  it('executor ok:false（如面板未开）→ 400 带 reason（不静默降级）', async () => {
    const { ctrl } = makeLoginStateController({
      platform: 'xiaohongshu',
      result: { ok: false, reason: '当前仅面板模式支持登录态查询（面板模式未开启），未查询' },
    });
    await expect(
      (ctrl as never as {
        loginState: (req: unknown, id: string) => Promise<unknown>;
      }).loginState({ authUser: { id: 'user-a' } }, 's1'),
    ).rejects.toThrow('仅面板模式支持登录态查询');
  });
});
