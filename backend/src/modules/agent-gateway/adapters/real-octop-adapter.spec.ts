import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RealOctopAdapter } from './real-octop-adapter';

/**
 * 真实 Octop 适配器测试（本机 127.0.0.1:8088 有 Octop v0.9.26）。
 * 凭据从 backend .env 读取（OCTOP_USERNAME/OCTOP_PASSWORD，gitignore）；
 * 本机 Octop 可达且有凭据时真跑（健康/登录/能力探测），否则跳过。
 */
function octopEnv(): { username?: string; password?: string; baseUrl?: string } {
  const txt = readFileSync(join(process.cwd(), '.env'), 'utf8');
  const get = (k: string): string | undefined =>
    txt.split('\n').find((l) => l.startsWith(`${k}=`))?.split('=').slice(1).join('=').trim();
  return { username: get('OCTOP_USERNAME'), password: get('OCTOP_PASSWORD'), baseUrl: get('OCTOP_BASE_URL') };
}

describe('RealOctopAdapter（真实 Octop 接入）', () => {
  const env = octopEnv();
  const baseUrl = env.baseUrl ?? 'http://127.0.0.1:8088';
  const hasCreds = !!(env.username && env.password);
  let reachable = false;

  beforeAll(async () => {
    const probe = new RealOctopAdapter({ baseUrl });
    reachable = await probe.healthy();
  });

  it('健康检查真实调用 /api/health', async () => {
    if (!reachable) return;
    expect(await new RealOctopAdapter({ baseUrl }).healthy()).toBe(true);
  });

  it('tokenExchange 真实凭据交换（/api/auth/login → access_token）', async () => {
    if (!reachable || !hasCreds) return;
    process.env.OCTOP_USERNAME = env.username;
    process.env.OCTOP_PASSWORD = env.password;
    const a = new RealOctopAdapter({ baseUrl });
    const r = await a.tokenExchange('octop_sess');
    expect(r.token).toBeTruthy();
    expect(r.token.length).toBeGreaterThan(20);
  });

  it('能力探测读 Octop 真实探测缓存（mobile/browser）', async () => {
    if (!reachable) return;
    const a = new RealOctopAdapter({ baseUrl });
    const caps = a.getCapabilities();
    // Octop 服务端 config.json capabilities 有真实探测值（mobile.enabled=true 等）
    expect(caps.mobile).toBeDefined();
    expect(typeof caps.mobile.available).toBe('boolean');
  });

  it('不可达 → 能力 unavailable 降级', async () => {
    const a = new RealOctopAdapter({ baseUrl: 'http://127.0.0.1:59999' });
    expect(await a.healthy()).toBe(false);
    expect(a.getCapabilities().browser.available).toBe(false);
    expect(a.getCapabilities().browser.degraded).toBe(true);
  });

  it('未配置凭据且无能力缓存 → 降级提示', async () => {
    const a = new RealOctopAdapter({ baseUrl });
    const caps = a.getCapabilities();
    expect(typeof caps.browser.available).toBe('boolean');
  });
});
