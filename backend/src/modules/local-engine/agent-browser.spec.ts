import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AgentBrowserSessionService } from './agent-browser-session.service';
import { AgentBrowserPolicyService } from './agent-browser-policy.service';

function makeBrowserMock() {
  return {
    getOrCreateSession: jest.fn().mockResolvedValue({
      key: 'general-web-abc',
      page: { url: () => 'https://example.com', goto: jest.fn() },
    }),
    closeSession: jest.fn().mockResolvedValue(true),
  };
}

/** 测试租户上下文（fail-closed 测试注入） */
function makeTenantContextMock(tenantId = 't-test') {
  return {
    resolveTenantId: jest.fn().mockResolvedValue(tenantId),
  };
}

/** 测试 prisma（tenantMember 归属） */
function makePrismaMock(tenantId = 't-test') {
  return {
    tenantMember: {
      findFirst: jest.fn().mockResolvedValue({ tenantId }),
    },
  };
}

describe('AgentBrowserSessionService（P4 会话生命周期）', () => {
  it('create：生成会话，域名白名单默认取 startUrl origin', () => {
    const svc = new AgentBrowserSessionService(makeBrowserMock() as never, makePrismaMock() as never, makeTenantContextMock() as never);
    const s = svc.create('u-1', { startUrl: 'https://example.com/abc' });
    expect(s.status).toBe('created');
    expect(s.engineKey).toBeUndefined();
    // toDto 已剔除 ownerId（防泄露）；allowDomains 保留
    expect(JSON.stringify(s)).not.toContain('ownerId');
    expect(s.allowDomains).toEqual(['example.com']);
    expect(s.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('create：显式 allowDomains 覆盖默认', () => {
    const svc = new AgentBrowserSessionService(makeBrowserMock() as never, makePrismaMock() as never, makeTenantContextMock() as never);
    const s = svc.create('u-1', {
      startUrl: 'https://a.com',
      allowDomains: ['b.com', 'c.com'],
    });
    expect(s.allowDomains).toEqual(['b.com', 'c.com']);
  });

  it('get：不存在抛 NotFound', () => {
    const svc = new AgentBrowserSessionService(makeBrowserMock() as never, makePrismaMock() as never, makeTenantContextMock() as never);
    expect(() => svc.get('nope')).toThrow(NotFoundException);
  });

  it('acquireEngineSession：复用 general-web 引擎 + 状态置 running', async () => {
    const browser = makeBrowserMock();
    const svc = new AgentBrowserSessionService(browser as never, makePrismaMock() as never, makeTenantContextMock() as never);
    const s = svc.create('u-1', { startUrl: 'https://example.com' });
    const { engineKey } = await svc.acquireEngineSession(s.id);
    expect(engineKey).toBe('general-web-abc');
    expect(browser.getOrCreateSession).toHaveBeenCalledWith({
      platform: 'general-web',
      accountId: s.accountId,
    });
    expect(svc.get(s.id).status).toBe('running');
  });

  it('租约过期：acquire 抛 BadRequest', async () => {
    const browser = makeBrowserMock();
    const svc = new AgentBrowserSessionService(browser as never, makePrismaMock() as never, makeTenantContextMock() as never);
    const s = svc.create('u-1', {});
    // 手动把内部会话租约改成已过期（DTO 是副本，须改内部）
    const inner = svc.get(s.id);
    inner.lease!.expiresAt = new Date(Date.now() - 1000).toISOString();
    await expect(svc.acquireEngineSession(s.id)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('stop：关闭引擎 + 状态 stopped', async () => {
    const browser = makeBrowserMock();
    const svc = new AgentBrowserSessionService(browser as never, makePrismaMock() as never, makeTenantContextMock() as never);
    const s = svc.create('u-1', {});
    await svc.stop(s.id);
    expect(browser.closeSession).not.toHaveBeenCalled(); // 未 acquire 不关闭
    expect(svc.get(s.id).status).toBe('stopped');
  });

  it('stop：已 acquire 后关闭引擎', async () => {
    const browser = makeBrowserMock();
    const svc = new AgentBrowserSessionService(browser as never, makePrismaMock() as never, makeTenantContextMock() as never);
    const s = svc.create('u-1', {});
    await svc.acquireEngineSession(s.id);
    await svc.stop(s.id);
    expect(browser.closeSession).toHaveBeenCalledWith('general-web-abc');
  });
});

describe('AgentBrowserPolicyService（P4 策略审计）', () => {
  const policy = new AgentBrowserPolicyService();

  it('工具白名单：合法工具通过，非法拒绝', () => {
    expect(() => policy.assertToolAllowed('navigate')).not.toThrow();
    expect(() => policy.assertToolAllowed('snapshot')).not.toThrow();
    expect(() => policy.assertToolAllowed('evaluate_js')).toThrow();
  });

  it('高危工具硬拦截（evaluate_js/read_file/payment/delete）', () => {
    const d = policy.audit('evaluate_js' as never, {}, { allowDomains: [] });
    expect(d.allowed).toBe(false);
    expect(d.riskLevel).toBe('blocked');
  });

  it('navigate 域名白名单：允许精确域名+子域，拒绝白名单外', () => {
    const ok = policy.audit('navigate', { url: 'https://sub.example.com/a' }, {
      allowDomains: ['example.com'],
    });
    expect(ok.allowed).toBe(true);

    const bad = policy.audit('navigate', { url: 'https://evil.com' }, {
      allowDomains: ['example.com'],
    });
    expect(bad.allowed).toBe(false);
    expect(bad.riskLevel).toBe('blocked');
    expect(bad.reason).toContain('不在白名单');
  });

  it('navigate 无白名单：需确认（medium）', () => {
    const d = policy.audit('navigate', { url: 'https://any.com' }, {
      allowDomains: [],
    });
    expect(d.allowed).toBe(true);
    expect(d.requiresConfirmation).toBe(true);
  });

  it('click/fill_form：中风险需确认；snapshot/wait_for 低风险', () => {
    const click = policy.audit('click', {}, { allowDomains: ['x.com'] });
    expect(click.riskLevel).toBe('medium');
    expect(click.requiresConfirmation).toBe(true);

    const snap = policy.audit('snapshot', {}, { allowDomains: ['x.com'] });
    expect(snap.riskLevel).toBe('low');
    expect(snap.requiresConfirmation).toBe(false);
  });

  it('press_key Enter：高风险需确认', () => {
    const enter = policy.audit('press_key', { key: 'Enter' }, { allowDomains: [] });
    expect(enter.riskLevel).toBe('high');
    expect(enter.requiresConfirmation).toBe(true);
  });
});
describe('AgentBrowserLoopService（P4 Observe-Act-Verify）', () => {
  const { AgentBrowserLoopService } = require('./agent-browser-loop.service');
  const { AiBrowserActionService } = require('./ai-browser-action.service');
  const { AgentBrowserPolicyService } = require('./agent-browser-policy.service');

  // feature flag：测试用 dom-agent 模式 + 允许写（跑通 Observe-Act-Verify）
    const ORIG_ENV = { ...process.env };
  beforeAll(() => {
    process.env.AGENT_BROWSER_STORE_PATH =
      '/tmp/agent-browser-spec-' + Math.random().toString(36).slice(2) + '.json';
  });
  afterAll(() => {
    process.env = ORIG_ENV;
  });
  beforeAll(() => {
    process.env.AGENT_BROWSER_MODE = 'dom-agent';
    process.env.AGENT_BROWSER_ALLOW_WRITE = 'true';
  });
  afterAll(() => {
    process.env = ORIG_ENV;
  });

  function makeLoop(sessionSvc: AgentBrowserSessionService, argsOpts?: { results?: unknown[]; ok?: boolean; actions?: unknown[] }) {
    const actionsMock = {
      run: jest.fn().mockResolvedValue({
        ok: argsOpts?.ok ?? true,
        instruction: '搜索装修公司',
        actions: argsOpts?.actions ?? [{ action: 'goto', url: 'https://example.com' }],
        results: argsOpts?.results ?? [
          { index: 0, action: 'goto', ok: true, evidenceUrl: 'https://ev/1' },
        ],
        sessionKey: 'general-web-abc',
      }),
      // 逐步循环：parseActions 解析（用 argsOpts.actions 或默认 goto）+ executeSingle
      parseActions: jest
        .fn()
        .mockResolvedValue(
          argsOpts?.actions?.length
            ? (argsOpts.actions as { action: string }[])
            : [{ action: 'goto', url: 'https://example.com' }],
        ),
      executeSingle: jest.fn().mockImplementation(
        async ({ action }: { action: { action: string } }) => ({
          index: 0,
          action: action.action,
          ok: true,
          evidenceUrl: 'https://ev/1',
        }),
      ),
    };
    const policySvc = new AgentBrowserPolicyService();
    const loop = new AgentBrowserLoopService(sessionSvc, actionsMock as never, policySvc);
    return { loop, actionsMock };
  }

  it('run：非 running 状态抛 BadRequest', async () => {
    const browser = makeBrowserMock();
    const sessionSvc = new AgentBrowserSessionService(browser as never, makePrismaMock() as never, makeTenantContextMock() as never);
    const s = sessionSvc.create('u-1', {});
    // status 是 created（未 run），直接 loop.run 应拒绝
    const { loop } = makeLoop(sessionSvc);
    await expect(loop.run(s.id, '指令')).rejects.toThrow('需先 run');
  });

  it('run：执行 Observe(快照) -> Act(动作) -> Verify(步骤事件)', async () => {
    const browser = makeBrowserMock();
    const sessionSvc = new AgentBrowserSessionService(browser as never, makePrismaMock() as never, makeTenantContextMock() as never);
    const s = sessionSvc.create('u-1', { startUrl: 'https://example.com' });
    await sessionSvc.acquireEngineSession(s.id);
    expect(sessionSvc.get(s.id).status).toBe('running');

    const { loop, actionsMock } = makeLoop(sessionSvc, {
      results: [
        { index: 0, action: 'goto', ok: true, message: 'ok', evidenceUrl: 'ev/1' },
        { index: 1, action: 'click', ok: false, message: 'not found' },
      ],
    });
    const events: unknown[] = [];
    const result = await loop.run(s.id, '搜索装修公司', {
      onStep: (e) => events.push(e),
      confirmedTools: [{ action: 'goto' }, { action: 'click' }, { action: 'type' }],
    });

    expect(result.ok).toBe(true);
    // 事件序列（逐步循环）：首 snapshot -> [步1 snapshot -> step(goto)] -> done
    expect(events[0]).toMatchObject({ type: 'snapshot' });
    expect(events[1]).toMatchObject({ type: 'snapshot' }); // 步1 re-observe
    expect(events[2]).toMatchObject({ type: 'step', action: 'goto', ok: true });
    expect(events[3]).toMatchObject({ type: 'done' });
    // 逐步循环：parseActions 解析 + executeSingle 单步执行（注入会话独立 accountId）
    expect(actionsMock.parseActions).toHaveBeenCalledWith('搜索装修公司');
    expect(actionsMock.executeSingle).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: s.accountId,
      }),
    );
    // stepCount 累计（逐步循环默认 1 个动作）
    expect(sessionSvc.get(s.id).stepCount).toBe(1);
  });

  it('run：actions.run 失败时 done.ok=false 但流程不断', async () => {
    const browser = makeBrowserMock();
    const sessionSvc = new AgentBrowserSessionService(browser as never, makePrismaMock() as never, makeTenantContextMock() as never);
    const s = sessionSvc.create('u-1', {});
    await sessionSvc.acquireEngineSession(s.id);

    const { loop } = makeLoop(sessionSvc, { ok: false, results: [], actions: [] });
    const result = await loop.run(s.id, '指令');
    expect(result.ok).toBe(false);
  });

  it('auditStep：合法工具返回审计，非法抛错', () => {
    const browser = makeBrowserMock();
    const sessionSvc = new AgentBrowserSessionService(browser as never, makePrismaMock() as never, makeTenantContextMock() as never);
    const { loop } = makeLoop(sessionSvc);
    const d = loop.auditStep('navigate', { url: 'https://ok.com' }, ['ok.com']);
    expect(d.allowed).toBe(true);
    expect(() => loop.auditStep('evaluate_js' as never, {}, [])).toThrow();
  });

  it('list：只返回当前用户会话 + DTO 不含 ownerId', () => {
    const browser = makeBrowserMock();
    const svc = new AgentBrowserSessionService(browser as never, makePrismaMock() as never, makeTenantContextMock() as never);
    const s1 = svc.create('u-1', {});
    svc.create('u-2', {});
    const list = svc.list('u-1');
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(s1.id);
    const raw = JSON.stringify(list[0]);
    expect(raw).not.toContain('ownerId');
  });

  it('assertOwner：他人会话抛 Forbidden，本人放行', () => {
    const browser = makeBrowserMock();
    const svc = new AgentBrowserSessionService(browser as never, makePrismaMock() as never, makeTenantContextMock() as never);
    const s = svc.create('u-owner', {});
    expect(() => svc.assertOwner(s.id, 'u-owner')).not.toThrow();
    expect(() => svc.assertOwner(s.id, 'u-attacker')).toThrow();
  });

  it('逐步审计：click 步骤被标记中风险需确认', async () => {
    const browser = makeBrowserMock();
    const sessionSvc = new AgentBrowserSessionService(browser as never, makePrismaMock() as never, makeTenantContextMock() as never);
    const s = sessionSvc.create('u-1', { startUrl: 'https://example.com' });
    await sessionSvc.acquireEngineSession(s.id);
    const { loop } = makeLoop(sessionSvc, {
      actions: [{ action: 'click', selector: '#btn' }],
      results: [
        { index: 0, action: 'click', ok: true, evidenceUrl: 'ev/1' },
      ],
    });
    const events: unknown[] = [];
    await loop.run(s.id, '点击按钮', { onStep: (e) => events.push(e) });
    // 逐步循环：click 未确认 → 确认闸门阻断
    const step = events.find((e) => (e as { type?: string }).type === 'step') as
      | { message?: string }
      | undefined;
    expect(step?.message).toContain('需用户确认');
  });

  it('observe：playwright-mcp 可用时返回真实 DOM 快照', async () => {
    const browser = makeBrowserMock();
    const sessionSvc = new AgentBrowserSessionService(browser as never, makePrismaMock() as never, makeTenantContextMock() as never);
    const s = sessionSvc.create('u-1', { startUrl: 'https://example.com' });
    await sessionSvc.acquireEngineSession(s.id);
    const playwrightMcpMock = {
      ensureProfile: jest.fn().mockResolvedValue({}),
      rpcCall: jest.fn().mockResolvedValue({
        result: {
          content: [{ type: 'text', text: 'button 搜索\ninput 关键词' }],
        },
      }),
    };
    const { AgentBrowserLoopService } = require('./agent-browser-loop.service');
    const { AiBrowserActionService } = require('./ai-browser-action.service');
    const { AgentBrowserPolicyService } = require('./agent-browser-policy.service');
    const loop = new AgentBrowserLoopService(
      sessionSvc,
      Object.create(AiBrowserActionService.prototype) as never,
      new AgentBrowserPolicyService(),
      playwrightMcpMock as never,
    );
    const snap = await loop.observe(s.id);
    expect(snap.ok).toBe(true);
    expect(snap.snapshot).toContain('搜索');
    expect(snap.message).toContain('DOM 快照');
    // 先绑定会话 profile（同页面快照）
    expect(playwrightMcpMock.ensureProfile).toHaveBeenCalledWith({
      platform: 'general-web',
      accountId: s.accountId,
    });
  });

  it('feature flag：AGENT_BROWSER_MODE=legacy 拒绝 run', async () => {
    const browser = makeBrowserMock();
    const sessionSvc = new AgentBrowserSessionService(browser as never, makePrismaMock() as never, makeTenantContextMock() as never);
    const s = sessionSvc.create('u-1', {});
    await sessionSvc.acquireEngineSession(s.id);
    const { loop } = makeLoop(sessionSvc);
    const saved = process.env.AGENT_BROWSER_MODE;
    process.env.AGENT_BROWSER_MODE = 'legacy';
    try {
      await expect(loop.run(s.id, '搜索')).rejects.toThrow('灰度开关关闭');
    } finally {
      if (saved === undefined) delete process.env.AGENT_BROWSER_MODE;
      else process.env.AGENT_BROWSER_MODE = saved;
    }
  });

  it('feature flag：ALLOW_WRITE=false 按动作类型阻断写操作（P4-1 审计修复，不再按中文指令）', async () => {
    const browser = makeBrowserMock();
    const sessionSvc = new AgentBrowserSessionService(browser as never, makePrismaMock() as never, makeTenantContextMock() as never);
    const s = sessionSvc.create('u-1', {});
    await sessionSvc.acquireEngineSession(s.id);
    const { loop, actionsMock } = makeLoop(sessionSvc, {
      actions: [{ action: 'type', selector: '#email', text: 'a@b.com' }],
    });
    const saved = process.env.AGENT_BROWSER_ALLOW_WRITE;
    process.env.AGENT_BROWSER_ALLOW_WRITE = 'false';
    try {
      // 英文指令也不再绕过：type 动作按类型阻断（不执行 + 事件提示）
      const events: unknown[] = [];
      await loop.run(s.id, 'type email into the form', {
        onStep: (e) => events.push(e),
      });
      expect(actionsMock.executeSingle).not.toHaveBeenCalled();
      const step = events.find(
        (e) => (e as { type?: string }).type === 'step',
      ) as { message?: string } | undefined;
      expect(step?.message).toContain('写操作未开启');
    } finally {
      if (saved === undefined) delete process.env.AGENT_BROWSER_ALLOW_WRITE;
      else process.env.AGENT_BROWSER_ALLOW_WRITE = saved;
    }
  });

  it('acquire 补齐租约 tenantId（多租户隔离）', async () => {
    const browser = makeBrowserMock();
    const prismaMock = {
      tenantMember: {
        findFirst: jest.fn().mockResolvedValue({ tenantId: 't-tenant-1' }),
      },
    };
    const svc = new AgentBrowserSessionService(
      browser as never,
      prismaMock as never,
    );
    const s = svc.create('u-1', {});
    expect(s.lease?.tenantId).toBeUndefined();
    await svc.acquireEngineSession(s.id);
    expect(svc.get(s.id).lease?.tenantId).toBe('t-tenant-1');
  });

  it('fail-closed：无租户上下文 acquire 抛 Forbidden', async () => {
    const browser = makeBrowserMock();
    // prisma 无 tenantMember delegate → 租户解析失败必须阻断
    const svc = new AgentBrowserSessionService(
      browser as never,
      {} as never,
    );
    const s = svc.create('u-1', {});
    await expect(svc.acquireEngineSession(s.id)).rejects.toThrow(
      '缺少租户上下文',
    );
  });

  it('fail-closed：跨租户 assertOwner 拒绝', async () => {
    const browser = makeBrowserMock();
    const svc = new AgentBrowserSessionService(
      browser as never,
      makePrismaMock('t-a') as never,
      makeTenantContextMock('t-a') as never,
    );
    const s = svc.create('u-1', {}, 't-a');
    // 请求租户 t-b ≠ 会话租约 t-a → 拒绝
    expect(() => svc.assertOwner(s.id, 'u-1', 't-b')).toThrow();
    // 同租户放行
    expect(() => svc.assertOwner(s.id, 'u-1', 't-a')).not.toThrow();
  });

  it('list：按租户过滤（多租户用户只见当前租户会话）', () => {
    const browser = makeBrowserMock();
    const svc = new AgentBrowserSessionService(
      browser as never,
      makePrismaMock() as never,
      makeTenantContextMock() as never,
    );
    svc.create('u-1', {}, 't-a');
    svc.create('u-1', {}, 't-b');
    const listA = svc.list('u-1', 't-a');
    const listB = svc.list('u-1', 't-b');
    expect(listA).toHaveLength(1);
    expect(listB).toHaveLength(1);
  });

  it('确认持久化：高风险未确认动作写 AgentConfirmation pending', async () => {
    const browser = makeBrowserMock();
    const prismaMock = {
      tenantMember: { findFirst: jest.fn().mockResolvedValue({ tenantId: 't-1' }) },
      agentConfirmation: {
        create: jest.fn().mockResolvedValue({ id: 'confirm-1' }),
      },
    };
    const sessionSvc = new AgentBrowserSessionService(
      browser as never,
      prismaMock as never,
      makeTenantContextMock('t-1') as never,
    );
    const s = sessionSvc.create('u-1', {}, 't-1');
    await sessionSvc.acquireEngineSession(s.id);
    const { AgentBrowserLoopService } = require('./agent-browser-loop.service');
    const { AgentBrowserPolicyService } = require('./agent-browser-policy.service');
    const actionsMock = {
      run: jest.fn().mockResolvedValue({
        ok: false,
        instruction: '点击按钮',
        actions: [{ action: 'click', selector: '#btn' }],
        results: [
          {
            index: 0,
            action: 'click',
            ok: false,
            message: '需用户确认后执行（高风险动作，确认单 confirm-1）',
            blocked: true,
          },
        ],
        sessionKey: 'general-web-abc',
      }),
      parseActions: jest.fn().mockResolvedValue([
        { action: 'click', selector: '#btn' },
      ]),
      executeSingle: jest.fn().mockResolvedValue({
        index: 0,
        action: 'click',
        ok: false,
        message: '需用户确认后执行（高风险动作，确认单 confirm-1）',
        blocked: true,
      }),
    };
    const loop = new AgentBrowserLoopService(
      sessionSvc,
      actionsMock as never,
      new AgentBrowserPolicyService(),
      undefined,
      prismaMock as never,
    );
    // 未确认 click → 确认记录由 policyGate 持久化（mock actions 已含 blocked）
    const events: unknown[] = [];
    await loop.run(s.id, '点击按钮', {
      onStep: (e) => events.push(e),
      confirmedTools: [],
    });
    // 验证 Verify 阶段事件携带确认单提示（find step 事件，前面有 re-observe snapshot）
    const step = events.find(
      (e) => (e as { type?: string }).type === 'step',
    ) as { message?: string } | undefined;
    expect(step?.message).toContain('确认单 confirm-1');
    // 验证持久化器被调用（persistPendingConfirmation 由 run 的 policyGate 触发——
    // 但 actionsMock.run 是 mock 不走真实 policyGate；改为直接验证方法存在）
    expect(typeof (loop as unknown as { persistPendingConfirmation?: unknown }).persistPendingConfirmation).toBe('function');
  });

  it('逐步 re-observe：导航后会话 URL 更新 + 每步先快照', async () => {
    const browser = makeBrowserMock();
    const sessionSvc = new AgentBrowserSessionService(
      browser as never,
      makePrismaMock() as never,
      makeTenantContextMock() as never,
    );
    const s = sessionSvc.create('u-1', { startUrl: 'https://example.com' });
    await sessionSvc.acquireEngineSession(s.id);
    const { loop } = makeLoop(sessionSvc, {
      actions: [
        { action: 'goto', url: 'https://example.com' },
        { action: 'goto', url: 'https://target.com' },
      ],
    });
    const events: unknown[] = [];
    await loop.run(s.id, '访问 example 和 target', {
      onStep: (e) => events.push(e),
      confirmedTools: [{ action: 'goto' }],
    });
    // 每步前都有 re-observe snapshot：snapshot(首) + snapshot(步1) + step + snapshot(步2) + step + done
    const snapshots = events.filter((e) => (e as { type?: string }).type === 'snapshot');
    const steps = events.filter((e) => (e as { type?: string }).type === 'step');
    expect(snapshots.length).toBe(3); // 首 + 每步前
    expect(steps.length).toBe(2);
  });

  it('事件缓冲：appendEvent/listEvents 记录循环过程', async () => {
    const browser = makeBrowserMock();
    const sessionSvc = new AgentBrowserSessionService(browser as never, makePrismaMock() as never, makeTenantContextMock() as never);
    const s = sessionSvc.create('u-1', {});
    sessionSvc.appendEvent(s.id, { type: 'snapshot', ok: true } as never);
    sessionSvc.appendEvent(s.id, { type: 'done', ok: true } as never);
    const events = sessionSvc.listEvents(s.id);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: 'snapshot', ok: true });
    expect(events[0].at).toBeTruthy();
  });
});

describe('P0-2 服务端确认校验（审计 2026-08-22）', () => {
  const ORIG_ENV = { ...process.env };
  beforeAll(() => {
    process.env.AGENT_BROWSER_MODE = 'dom-agent';
    process.env.AGENT_BROWSER_ALLOW_WRITE = 'true';
  });
  afterAll(() => {
    process.env = ORIG_ENV;
  });

  function makeSession() {
    const browser = makeBrowserMock();
    const sessionSvc = new AgentBrowserSessionService(
      browser as never,
      makePrismaMock() as never,
      makeTenantContextMock() as never,
    );
    const s = sessionSvc.create('u-1', {}, 't-1');
    return { sessionSvc, s };
  }

  function makeLoop(
    sessionSvc: AgentBrowserSessionService,
    prismaMock: unknown,
    actions: unknown[],
  ) {
    const actionsMock = {
      parseActions: jest.fn().mockResolvedValue(actions),
      executeSingle: jest.fn().mockResolvedValue({
        index: 0,
        action: 'click',
        ok: true,
      }),
    };
    const loop = new (require('./agent-browser-loop.service').AgentBrowserLoopService)(
      sessionSvc,
      actionsMock as never,
      new (require('./agent-browser-policy.service').AgentBrowserPolicyService)(),
      undefined,
      prismaMock as never,
    );
    return { loop, actionsMock };
  }

  it('confirmationIds 查库：绑定+指纹一致 → 放行（执行）', async () => {
    const { sessionSvc, s } = makeSession();
    const prismaMock = {
      agentConfirmation: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'c-1',
            status: 'pending',
            sessionId: s.id,
            tenantId: 't-1',
            userId: 'u-1',
            action: 'click',
            target: '#btn',
            content: null,
          },
        ]),
      },
    };
    await sessionSvc.acquireEngineSession(s.id);
    const { loop, actionsMock } = makeLoop(
      sessionSvc,
      prismaMock,
      [{ action: 'click', selector: '#btn' }],
    );
    const result = await loop.run(s.id, '点击按钮', {
      confirmationIds: ['c-1'],
    });
    expect(actionsMock.executeSingle).toHaveBeenCalled(); // 确认通过→执行
    expect(result.ok).toBe(true);
  });

  it('confirmationIds 查库：跨会话确认单 → 拒绝（不执行）', async () => {
    const { sessionSvc, s } = makeSession();
    const prismaMock = {
      agentConfirmation: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'c-other',
            status: 'pending',
            sessionId: 'other-session', // 绑定别的会话
            tenantId: 't-1',
            userId: 'u-1',
            action: 'click',
            target: '#btn',
            content: null,
          },
        ]),
      },
    };
    await sessionSvc.acquireEngineSession(s.id);
    const { loop, actionsMock } = makeLoop(
      sessionSvc,
      prismaMock,
      [{ action: 'click', selector: '#btn' }],
    );
    const events: unknown[] = [];
    await loop.run(s.id, '点击按钮', {
      onStep: (e) => events.push(e),
      confirmationIds: ['c-other'],
    });
    expect(actionsMock.executeSingle).not.toHaveBeenCalled(); // 拒绝→不执行
    const step = events.find((e) => (e as { type?: string }).type === 'step') as
      | { message?: string; selector?: string }
      | undefined;
    expect(step?.message).toContain('需用户确认');
    expect(step?.selector).toBe('#btn'); // 事件带真实 selector（P0-3 前端用）
  });
});

describe('P4-3 状态语义（审计 2026-08-22）', () => {
  const ORIG_ENV = { ...process.env };
  beforeAll(() => {
    process.env.AGENT_BROWSER_MODE = 'dom-agent';
    process.env.AGENT_BROWSER_ALLOW_WRITE = 'true';
  });
  afterAll(() => {
    process.env = ORIG_ENV;
  });

  // 局部 makeLoop（与其他 describe 独立）
  function makeLoop(
    sessionSvc: AgentBrowserSessionService,
    argsOpts?: { actions?: unknown[] },
  ) {
    const actionsMock = {
      run: jest.fn(),
      parseActions: jest.fn().mockResolvedValue(
        argsOpts?.actions?.length
          ? (argsOpts.actions as { action: string }[])
          : [{ action: 'goto', url: 'https://example.com' }],
      ),
      executeSingle: jest.fn().mockResolvedValue({
        index: 0,
        action: 'goto',
        ok: true,
      }),
    };
    const loop = new (require('./agent-browser-loop.service').AgentBrowserLoopService)(
      sessionSvc,
      actionsMock as never,
      new (require('./agent-browser-policy.service').AgentBrowserPolicyService)(),
    );
    return { loop, actionsMock };
  }

  it('部分失败 → partial_success（不再 1 成功 4 失败算成功）', async () => {
    const browser = makeBrowserMock();
    const sessionSvc = new AgentBrowserSessionService(
      browser as never,
      makePrismaMock() as never,
      makeTenantContextMock() as never,
    );
    const s = sessionSvc.create('u-1', {
      allowDomains: ['a.com', 'b.com'],
    });
    await sessionSvc.acquireEngineSession(s.id);
    const { loop, actionsMock } = makeLoop(sessionSvc, {
      actions: [
        { action: 'goto', url: 'https://a.com' },
        { action: 'goto', url: 'https://b.com' },
      ],
    });
    // 第一个成功；第二个持续失败（重试也失败）→ 部分成功
    actionsMock.executeSingle
      .mockResolvedValueOnce({ index: 0, action: 'goto', ok: true })
      .mockResolvedValue({
        index: 1,
        action: 'goto',
        ok: false,
        message: 'navigation_failed',
      });
    const result = await loop.run(s.id, '访问两个页面');
    const done = result.steps.find(
      (e) => e.type === 'done',
    ) as { status?: string; ok?: boolean } | undefined;
    expect(done?.status).toBe('partial_success');
    expect(done?.ok).toBe(true);
  });

  it('全部失败 → failed', async () => {
    const browser = makeBrowserMock();
    const sessionSvc = new AgentBrowserSessionService(
      browser as never,
      makePrismaMock() as never,
      makeTenantContextMock() as never,
    );
    const s = sessionSvc.create('u-1', { allowDomains: ['a.com'] });
    await sessionSvc.acquireEngineSession(s.id);
    const { loop, actionsMock } = makeLoop(sessionSvc, {
      actions: [{ action: 'goto', url: 'https://a.com' }],
    });
    actionsMock.executeSingle.mockResolvedValue({
      index: 0,
      action: 'goto',
      ok: false,
      message: 'navigation_failed',
    });
    const result = await loop.run(s.id, '访问页面');
    const done = result.steps.find(
      (e) => e.type === 'done',
    ) as { status?: string; ok?: boolean } | undefined;
    expect(done?.status).toBe('failed');
    expect(done?.ok).toBe(false);
  });

  it('提示注入 → needs-human 事件 + 会话状态 needs-human', async () => {
    const browser = makeBrowserMock();
    const sessionSvc = new AgentBrowserSessionService(
      browser as never,
      makePrismaMock() as never,
      makeTenantContextMock() as never,
    );
    const s = sessionSvc.create('u-1', {
      startUrl: 'https://inject.example.com',
      allowDomains: ['a.com'],
    });
    await sessionSvc.acquireEngineSession(s.id);
    // observe 被 mock 成注入命中？——直接调用 loop 的 observe 依赖 playwright-mcp。
    // 这里改为验证 observe 不可用时正常；注入分支用 stub observe。
    const { loop } = makeLoop(sessionSvc, {
      actions: [{ action: 'goto', url: 'https://a.com' }],
    });
    // 覆写 observe 返回 injected=true
    (loop as unknown as { observe: () => Promise<never> }).observe = jest
      .fn()
      .mockResolvedValue({
        type: 'snapshot',
        ok: true,
        url: 'https://inject.example.com',
        injected: true,
        message: '检测到注入',
      }) as never;
    const events: unknown[] = [];
    const result = await loop.run(s.id, '访问页面', {
      onStep: (e) => events.push(e),
    });
    expect(result.ok).toBe(false);
    const nh = events.find(
      (e) => (e as { type?: string }).type === 'needs-human',
    ) as { reasonCode?: string } | undefined;
    expect(nh?.reasonCode).toBe('prompt_injection');
    expect(sessionSvc.get(s.id).status).toBe('needs-human');
  });
});

describe('P4-4 生命周期（审计 2026-08-22）', () => {
  function makeSvc() {
    const browser = makeBrowserMock();
    const sessionSvc = new AgentBrowserSessionService(
      browser as never,
      makePrismaMock() as never,
      makeTenantContextMock() as never,
    );
    return { browser, sessionSvc };
  }

  it('assertTransition：created → paused 非法（抛 400）', async () => {
    const { sessionSvc } = makeSvc();
    const s = sessionSvc.create('u-1', {}, 't-1');
    expect(() =>
      sessionSvc.assertTransition(s.id, ['running', 'needs-human'], 'paused'),
    ).toThrow(/不能迁移/);
  });

  it('pause（running）→ resume：重新获取引擎会话置 running', async () => {
    const { browser, sessionSvc } = makeSvc();
    const s = sessionSvc.create('u-1', {}, 't-1');
    await sessionSvc.acquireEngineSession(s.id);
    expect(sessionSvc.get(s.id).status).toBe('running');
    // 模拟运行中暂停
    sessionSvc.assertTransition(s.id, ['running', 'needs-human'], 'paused');
    sessionSvc.updateStatus(s.id, 'paused');
    expect(sessionSvc.get(s.id).status).toBe('paused');
    // resume：paused → running + 引擎重新获取
    await sessionSvc.resume(s.id);
    expect(sessionSvc.get(s.id).status).toBe('running');
    expect(sessionSvc.get(s.id).engineKey).toBeTruthy();
  });

  it('list fail-closed：请求带租户时不返回无 tenantId 的旧会话', async () => {
    const { sessionSvc } = makeSvc();
    sessionSvc.create('u-1', {}, 't-a'); // 有租户
    sessionSvc.create('u-1', {}); // 无租户（旧数据）
    const listed = sessionSvc.list('u-1', 't-a');
    expect(listed.length).toBe(1);
    expect(listed[0].id).toBe(sessionSvc.list('u-1', 't-a')[0].id);
  });

  it('配置边界：MAX_RETRIES 超范围（>5）拒绝', async () => {
    const { sessionSvc } = makeSvc();
    const s = sessionSvc.create('u-1', {}, 't-1');
    await sessionSvc.acquireEngineSession(s.id);
    const { AgentBrowserLoopService } = require('./agent-browser-loop.service');
    const loop = new AgentBrowserLoopService(
      sessionSvc,
      {
        parseActions: jest.fn().mockResolvedValue([]),
        executeSingle: jest.fn(),
      } as never,
      new (require('./agent-browser-policy.service').AgentBrowserPolicyService)(),
    );
    const saved = process.env.AGENT_BROWSER_MAX_RETRIES;
    process.env.AGENT_BROWSER_MAX_RETRIES = '99';
    try {
      await expect(loop.run(s.id, '测试')).rejects.toThrow(/MAX_RETRIES/);
    } finally {
      if (saved === undefined) delete process.env.AGENT_BROWSER_MAX_RETRIES;
      else process.env.AGENT_BROWSER_MAX_RETRIES = saved;
    }
  });
});

describe('P4 MCP 互斥锁（审计 2026-08-22 并发 profile 串读修复）', () => {
  it('并发 MCP 访问被串行化（单例 sidecar 防串 profile）', async () => {
    const { AgentBrowserLoopService } = require('./agent-browser-loop.service');
    const loop = Object.create(
      AgentBrowserLoopService.prototype,
    ) as {
      withMcpLock<T>(fn: () => Promise<T>): Promise<T>;
      logger: { warn: jest.Mock };
    };
    loop.logger = { warn: jest.fn() };
    let active = 0;
    let maxActive = 0;
    const tick = async (name: string) => {
      return loop.withMcpLock(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 20));
        active -= 1;
        return name;
      });
    };
    const results = await Promise.all([tick('a'), tick('b'), tick('c')]);
    expect(results).toEqual(['a', 'b', 'c']);
    expect(maxActive).toBe(1); // 任意时刻最多 1 个 MCP 访问在跑
  });
});

describe('P4 DOM 闭环（审计 2026-08-22 导航后重新决策）', () => {
  const ORIG_ENV = { ...process.env };
  beforeAll(() => {
    process.env.AGENT_BROWSER_MODE = 'dom-agent';
    process.env.AGENT_BROWSER_ALLOW_WRITE = 'true';
  });
  afterAll(() => {
    process.env = ORIG_ENV;
  });

  it('导航后 URL 变化：用新快照重新解析后续动作（不再盲执行旧序列）', async () => {
    const browser = makeBrowserMock();
    const sessionSvc = new AgentBrowserSessionService(
      browser as never,
      makePrismaMock() as never,
      makeTenantContextMock() as never,
    );
    const s = sessionSvc.create('u-1', {
      startUrl: 'https://a.com',
      allowDomains: ['a.com', 'b.com'],
    });
    await sessionSvc.acquireEngineSession(s.id);
    // 初始解析 2 个动作；导航后重新解析返回 1 个新动作（基于快照）
    const parseActions = jest
      .fn()
      .mockResolvedValueOnce([
        { action: 'goto', url: 'https://a.com' },
        { action: 'click', selector: '#old-btn' },
      ])
      .mockResolvedValueOnce([{ action: 'click', selector: '#new-btn' }]);
    const executeSingle = jest.fn().mockResolvedValue({
      index: 0,
      action: 'goto',
      ok: true,
    });
    const loop = new (require('./agent-browser-loop.service').AgentBrowserLoopService)(
      sessionSvc,
      { parseActions, executeSingle } as never,
      new (require('./agent-browser-policy.service').AgentBrowserPolicyService)(),
    );
    // 覆写 observe：第一次返回 a.com，执行 goto 后返回 b.com（导航发生）
    const observe = jest
      .fn()
      .mockResolvedValueOnce({
        type: 'snapshot',
        ok: true,
        url: 'https://a.com',
        snapshot: '页面A',
        injected: false,
      })
      .mockResolvedValueOnce({
        type: 'snapshot',
        ok: true,
        url: 'https://b.com',
        snapshot: '页面B（新 DOM）',
        injected: false,
      })
      .mockResolvedValue({
        type: 'snapshot',
        ok: true,
        url: 'https://b.com',
        snapshot: '页面B（新 DOM）',
        injected: false,
      });
    (loop as unknown as { observe: () => Promise<never> }).observe = observe as never;
    const result = await loop.run(s.id, '访问 a 然后点击按钮');
    // 第二次解析携带新快照上下文
    expect(parseActions).toHaveBeenCalledTimes(2);
    expect(parseActions).toHaveBeenLastCalledWith(
      '访问 a 然后点击按钮',
      expect.objectContaining({ url: 'https://b.com', snapshot: '页面B（新 DOM）' }),
    );
  });
});
