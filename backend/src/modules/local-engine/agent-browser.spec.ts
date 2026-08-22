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

describe('AgentBrowserSessionService（P4 会话生命周期）', () => {
  it('create：生成会话，域名白名单默认取 startUrl origin', () => {
    const svc = new AgentBrowserSessionService(makeBrowserMock() as never, "/tmp/agent-browser-spec-" + Math.random().toString(36).slice(2) + ".json");
    const s = svc.create('u-1', { startUrl: 'https://example.com/abc' });
    expect(s.status).toBe('created');
    expect(s.engineKey).toBeUndefined();
    // toDto 已剔除 ownerId（防泄露）；allowDomains 保留
    expect(JSON.stringify(s)).not.toContain('ownerId');
    expect(s.allowDomains).toEqual(['example.com']);
    expect(s.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('create：显式 allowDomains 覆盖默认', () => {
    const svc = new AgentBrowserSessionService(makeBrowserMock() as never, "/tmp/agent-browser-spec-" + Math.random().toString(36).slice(2) + ".json");
    const s = svc.create('u-1', {
      startUrl: 'https://a.com',
      allowDomains: ['b.com', 'c.com'],
    });
    expect(s.allowDomains).toEqual(['b.com', 'c.com']);
  });

  it('get：不存在抛 NotFound', () => {
    const svc = new AgentBrowserSessionService(makeBrowserMock() as never, "/tmp/agent-browser-spec-" + Math.random().toString(36).slice(2) + ".json");
    expect(() => svc.get('nope')).toThrow(NotFoundException);
  });

  it('acquireEngineSession：复用 general-web 引擎 + 状态置 running', async () => {
    const browser = makeBrowserMock();
    const svc = new AgentBrowserSessionService(browser as never);
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
    const svc = new AgentBrowserSessionService(browser as never);
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
    const svc = new AgentBrowserSessionService(browser as never);
    const s = svc.create('u-1', {});
    await svc.stop(s.id);
    expect(browser.closeSession).not.toHaveBeenCalled(); // 未 acquire 不关闭
    expect(svc.get(s.id).status).toBe('stopped');
  });

  it('stop：已 acquire 后关闭引擎', async () => {
    const browser = makeBrowserMock();
    const svc = new AgentBrowserSessionService(browser as never);
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
    };
    const policySvc = new AgentBrowserPolicyService();
    const loop = new AgentBrowserLoopService(sessionSvc, actionsMock as never, policySvc);
    return { loop, actionsMock };
  }

  it('run：非 running 状态抛 BadRequest', async () => {
    const browser = makeBrowserMock();
    const sessionSvc = new AgentBrowserSessionService(browser as never);
    const s = sessionSvc.create('u-1', {});
    // status 是 created（未 run），直接 loop.run 应拒绝
    const { loop } = makeLoop(sessionSvc);
    await expect(loop.run(s.id, '指令')).rejects.toThrow('需先 run');
  });

  it('run：执行 Observe(快照) -> Act(动作) -> Verify(步骤事件)', async () => {
    const browser = makeBrowserMock();
    const sessionSvc = new AgentBrowserSessionService(browser as never);
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
    const result = await loop.run(s.id, '搜索装修公司', (e) => events.push(e));

    expect(result.ok).toBe(true);
    // 事件序列：snapshot -> 2 step -> done
    expect(events[0]).toMatchObject({ type: 'snapshot' });
    expect(events[1]).toMatchObject({ type: 'step', action: 'goto', ok: true });
    expect(events[2]).toMatchObject({ type: 'step', action: 'click', ok: false });
    expect(events[3]).toMatchObject({ type: 'done' });
    // actions.run 被调用且注入当前 URL + 会话独立 accountId
    expect(actionsMock.run).toHaveBeenCalledWith(
      expect.objectContaining({
        instruction: '搜索装修公司',
        url: 'https://example.com',
        accountId: s.accountId,
      }),
    );
    // stepCount 累计
    expect(sessionSvc.get(s.id).stepCount).toBe(2);
  });

  it('run：actions.run 失败时 done.ok=false 但流程不断', async () => {
    const browser = makeBrowserMock();
    const sessionSvc = new AgentBrowserSessionService(browser as never);
    const s = sessionSvc.create('u-1', {});
    await sessionSvc.acquireEngineSession(s.id);

    const { loop } = makeLoop(sessionSvc, { ok: false, results: [], actions: [] });
    const result = await loop.run(s.id, '指令');
    expect(result.ok).toBe(false);
  });

  it('auditStep：合法工具返回审计，非法抛错', () => {
    const browser = makeBrowserMock();
    const sessionSvc = new AgentBrowserSessionService(browser as never);
    const { loop } = makeLoop(sessionSvc);
    const d = loop.auditStep('navigate', { url: 'https://ok.com' }, ['ok.com']);
    expect(d.allowed).toBe(true);
    expect(() => loop.auditStep('evaluate_js' as never, {}, [])).toThrow();
  });

  it('list：只返回当前用户会话 + DTO 不含 ownerId', () => {
    const browser = makeBrowserMock();
    const svc = new AgentBrowserSessionService(browser as never);
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
    const svc = new AgentBrowserSessionService(browser as never);
    const s = svc.create('u-owner', {});
    expect(() => svc.assertOwner(s.id, 'u-owner')).not.toThrow();
    expect(() => svc.assertOwner(s.id, 'u-attacker')).toThrow();
  });

  it('逐步审计：click 步骤被标记中风险需确认', async () => {
    const browser = makeBrowserMock();
    const sessionSvc = new AgentBrowserSessionService(browser as never);
    const s = sessionSvc.create('u-1', { startUrl: 'https://example.com' });
    await sessionSvc.acquireEngineSession(s.id);
    const { loop } = makeLoop(sessionSvc, {
      results: [
        { index: 0, action: 'click', ok: true, evidenceUrl: 'ev/1' },
      ],
    });
    const events: unknown[] = [];
    await loop.run(s.id, '点击按钮', (e) => events.push(e));
    // click 步骤 message 应含策略标记
    const step = events[1] as { message?: string };
    expect(step.message).toContain('风险动作');
  });

  it('observe：playwright-mcp 可用时返回真实 DOM 快照', async () => {
    const browser = makeBrowserMock();
    const sessionSvc = new AgentBrowserSessionService(browser as never);
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
    const sessionSvc = new AgentBrowserSessionService(browser as never);
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

  it('feature flag：ALLOW_WRITE=false 拒绝写指令', async () => {
    const browser = makeBrowserMock();
    const sessionSvc = new AgentBrowserSessionService(browser as never);
    const s = sessionSvc.create('u-1', {});
    await sessionSvc.acquireEngineSession(s.id);
    const { loop } = makeLoop(sessionSvc);
    const saved = process.env.AGENT_BROWSER_ALLOW_WRITE;
    process.env.AGENT_BROWSER_ALLOW_WRITE = 'false';
    try {
      await expect(loop.run(s.id, '在输入框填写内容并提交')).rejects.toThrow(
        '写操作未开启',
      );
    } finally {
      if (saved === undefined) delete process.env.AGENT_BROWSER_ALLOW_WRITE;
      else process.env.AGENT_BROWSER_ALLOW_WRITE = saved;
    }
  });

  it('事件缓冲：appendEvent/listEvents 记录循环过程', async () => {
    const browser = makeBrowserMock();
    const sessionSvc = new AgentBrowserSessionService(browser as never);
    const s = sessionSvc.create('u-1', {});
    sessionSvc.appendEvent(s.id, { type: 'snapshot', ok: true } as never);
    sessionSvc.appendEvent(s.id, { type: 'done', ok: true } as never);
    const events = sessionSvc.listEvents(s.id);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: 'snapshot', ok: true });
    expect(events[0].at).toBeTruthy();
  });
});
