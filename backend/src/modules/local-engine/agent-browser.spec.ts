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
    const svc = new AgentBrowserSessionService(makeBrowserMock() as never);
    const s = svc.create('u-1', { startUrl: 'https://example.com/abc' });
    expect(s.status).toBe('created');
    expect(s.engineKey).toBeUndefined();
    expect(s.lease?.ownerId).toBe('u-1');
    expect(s.allowDomains).toEqual(['example.com']);
    expect(s.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('create：显式 allowDomains 覆盖默认', () => {
    const svc = new AgentBrowserSessionService(makeBrowserMock() as never);
    const s = svc.create('u-1', {
      startUrl: 'https://a.com',
      allowDomains: ['b.com', 'c.com'],
    });
    expect(s.allowDomains).toEqual(['b.com', 'c.com']);
  });

  it('get：不存在抛 NotFound', () => {
    const svc = new AgentBrowserSessionService(makeBrowserMock() as never);
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
    // 手动把租约改成已过期
    s.lease!.expiresAt = new Date(Date.now() - 1000).toISOString();
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