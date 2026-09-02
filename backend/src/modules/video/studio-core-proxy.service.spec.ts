import { StudioCoreBusinessError, StudioCoreProxyService } from './studio-core-proxy.service';

/**
 * 2026-09-02（复核第七轮 P1）：StudioCore 登录 4xx 必须按业务拒绝抛出
 * （不被上层当作"引擎不可达"回退云端计费通道）。
 */
describe('StudioCoreProxyService 登录失败分类（复核第七轮）', () => {
  const originalFetch = global.fetch;
  const originalUrl = process.env.STUDIO_CORE_SSE_URL;

  beforeEach(() => {
    // 非回环地址：跳过 assertPortOpen 端口探测，真实走登录路径
    process.env.STUDIO_CORE_SSE_URL = 'http://studio-core.test:8610';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalUrl === undefined) {
      delete process.env.STUDIO_CORE_SSE_URL;
    } else {
      process.env.STUDIO_CORE_SSE_URL = originalUrl;
    }
  });

  it('登录 401（凭据错误）→ StudioCoreBusinessError（不触发云端回退）', async () => {
    global.fetch = jest.fn(async () => {
      if (String((global.fetch as jest.Mock).mock.calls.at(-1)?.[0]).includes('/api/auth/login')) {
        return { ok: false, status: 401, text: async () => 'unauthorized' };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }) as never;
    const proxy = new StudioCoreProxyService();
    await expect(
      proxy.postGenerate({ pipeline: 'promo', prompt: 'x' } as never),
    ).rejects.toThrow(StudioCoreBusinessError);
  });

  it('引擎 5xx → 普通错误（允许上层按不可达回退）', async () => {
    let loginCalls = 0;
    global.fetch = jest.fn(async (url: unknown) => {
      if (String(url).includes('/api/auth/login')) {
        loginCalls += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({ token: 't' }),
        };
      }
      return { ok: false, status: 503, text: async () => 'down' };
    }) as never;
    const proxy = new StudioCoreProxyService();
    await expect(
      proxy.postGenerate({ pipeline: 'promo', prompt: 'x' } as never),
    ).rejects.not.toBeInstanceOf(StudioCoreBusinessError);
    expect(loginCalls).toBe(1);
  });
});
