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

// ── 2026-09-04：run 立即返回 202（消除 >10s 代理 502 误报）+ 在飞守卫 ──────────
describe('AgentBrowserController run 立即返回（2026-09-04）', () => {
  function makeRunController(opts: { loopRun?: () => Promise<void> } = {}) {
    const sessions = {
      prisma: {} as unknown,
      get: jest.fn().mockReturnValue({ id: 's1', status: 'created' }),
      assertOwner: jest.fn(),
      updateStatus: jest.fn(),
      acquireEngineSession: jest.fn().mockResolvedValue(undefined),
      markError: jest.fn(),
      toPublicDto: jest.fn((s: unknown) => s),
    };
    let releaseLoopRun: (() => void) | null = null;
    const loopRunGate = new Promise<void>((resolve) => {
      releaseLoopRun = resolve;
    });
    const loop = {
      run: jest.fn(
        opts.loopRun ??
          (async () => {
            await loopRunGate;
          }),
      ),
    };
    const authCtx = { resolveTenantId: jest.fn().mockResolvedValue('tenant-1') };
    const ctrl = new AgentBrowserController(
      sessions as never,
      {} as never,
      loop as never,
      authCtx as never,
      undefined,
    );
    const callRun = (body: Record<string, unknown> = {}) =>
      (ctrl as never as {
        run: (
          req: unknown,
          id: string,
          body: Record<string, unknown>,
        ) => Promise<unknown>;
      }).run({ authUser: { id: 'user-a' } }, 's1', body);
    return { ctrl, sessions, loop, callRun, releaseLoopRun: releaseLoopRun! };
  }

  it('run 不等 loop 完成：loop 挂起时 run 也能立即 resolve（返回会话 DTO）', async () => {
    const { callRun, loop } = makeRunController();
    const dto = await callRun({ instruction: '打开 https://example.com' });
    expect(dto).toEqual({ id: 's1', status: 'created' });
    expect(loop.run).toHaveBeenCalledWith('s1', '打开 https://example.com', {
      confirmedTools: [],
      confirmationIds: undefined,
      // 0d098260（09-04 触达审计）给 run 透传 leadId，无线索场景为 null；
      // 提交时漏更本 spec，2026-09-05 面板优先改造跑门禁时发现，顺手补齐。
      leadId: null,
    });
    // 不留悬挂句柄
    await new Promise((r) => setImmediate(r));
  });

  it('在飞守卫：首次 run 未完成时再次 run → 400（防双击竞态补缝）', async () => {
    const { callRun } = makeRunController();
    await callRun({ instruction: 'x' });
    // sessions.get 仍返回 created（异步还没翻转 running），原「running 拒重」拦不住
    await expect(callRun({ instruction: 'x' })).rejects.toThrow(BadRequestException);
  });

  it('后台异常 → markError 落 error 终态（不抛回已返回的 202 响应）', async () => {
    const { sessions, loop, callRun } = makeRunController({
      loopRun: async () => {
        throw new Error('解析爆炸');
      },
    });
    await callRun({ instruction: 'x' }); // 202 正常返回
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(sessions.markError).toHaveBeenCalledWith('s1', '解析爆炸');
    expect(loop.run).toHaveBeenCalled();
  });
});
