import { RealOctopAdapter } from './real-octop-adapter';

/**
 * 真实 Octop 适配器测试（本机 127.0.0.1:8088 有 Octop v0.9.26 时可测）。
 * - healthy() 真实探测 /api/health
 * - 未配置凭据 → getCapabilities 优雅降级（OCTOP_DEGRADED 语义）
 * - 不可达地址 → unavailable 降级
 * 无本机 Octop 时自适应跳过（CI 安全）。
 */
describe('RealOctopAdapter（真实 Octop 接入）', () => {
  let octopAvailable = false;

  beforeAll(async () => {
    const probe = new RealOctopAdapter({ baseUrl: 'http://127.0.0.1:8088' });
    octopAvailable = await probe.healthy();
  });

  it('健康检查真实调用本机 Octop /api/health', async () => {
    if (!octopAvailable) return; // 无 Octop 环境自适应跳过
    const a = new RealOctopAdapter({ baseUrl: 'http://127.0.0.1:8088' });
    expect(await a.healthy()).toBe(true);
  });

  it('未配置凭据 → 能力降级（OCTOP_DEGRADED 语义，引擎走 3010 原生工具）', async () => {
    if (!octopAvailable) return;
    const a = new RealOctopAdapter({ baseUrl: 'http://127.0.0.1:8088' });
    const caps = a.getCapabilities();
    expect(caps.browser.available).toBe(false);
    expect(caps.browser.degraded).toBe(true);
    expect(caps.browser.reason).toContain('OCTOP_API_PASSWORD');
  });

  it('未配置凭据 → 会话/token 交换抛 OCTOP_UNAVAILABLE', async () => {
    if (!octopAvailable) return;
    const a = new RealOctopAdapter({ baseUrl: 'http://127.0.0.1:8088' });
    await expect(a.createSession({ tenantId: 't1', userId: 'u1', agentId: 'a1' })).rejects.toThrow(/OCTOP_UNAVAILABLE/);
    await expect(a.tokenExchange('octop_x')).rejects.toThrow(/OCTOP_UNAVAILABLE/);
  });

  it('Octop 不可达 → 能力 unavailable 降级', async () => {
    const a = new RealOctopAdapter({ baseUrl: 'http://127.0.0.1:59999' });
    expect(await a.healthy()).toBe(false);
    const caps = a.getCapabilities();
    expect(caps.browser.available).toBe(false);
    expect(caps.browser.degraded).toBe(true);
  });

  it('配置凭据后能力可用（密码/accessToken 均支持）', async () => {
    const a = new RealOctopAdapter({ baseUrl: 'http://127.0.0.1:8088', accessToken: 'test-token' });
    const caps = a.getCapabilities();
    expect(caps.browser.available).toBe(true);
    const pwd = new RealOctopAdapter({ baseUrl: 'http://127.0.0.1:8088', password: 'x' });
    expect(pwd.getCapabilities().browser.available).toBe(true);
  });
});
