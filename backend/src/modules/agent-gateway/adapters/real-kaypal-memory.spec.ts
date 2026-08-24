import { RealKaypalMemoryAdapter } from './real-kaypal-memory';
import { MemoryNamespace } from '../core/types';

/**
 * RealKaypalMemoryAdapter 单测（mock fetch，不连真实网络）：
 * - 契约映射：search → GET /api/memory?tier=long&query&nResults；add → POST /api/memory（memoryId 幂等）；
 *   delete → DELETE /api/memory/long?ids=；export → GET /api/memory/list
 * - 鉴权头：x-kaypal-api-key 始终携带
 * - 租户隔离：agentNs 前缀过滤（跨 tenant/agent 记忆不召回）
 * - 降级：401 → MEMORY_REJECTED；5xx/网络错 → MEMORY_TIMEOUT
 */
const NS: MemoryNamespace = { tenantId: 't1', userId: 'u1', agentId: 'a1', scope: 'user_preference', source: 'test', retention: 'long_term' };

function mockFetch(impl: (url: string, init?: RequestInit) => { status: number; body: unknown }) {
  global.fetch = jest.fn((url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const { status, body } = impl(u, init);
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(JSON.stringify(body)),
    } as Response);
  }) as unknown as typeof fetch;
}

describe('RealKaypalMemoryAdapter（真实契约映射，mock fetch）', () => {
  const make = () => new RealKaypalMemoryAdapter({ baseUrl: 'https://kaypal.cn', apiKey: 'k_test', timeoutMs: 2000 });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('search：GET /api/memory?tier=long&query&nResults + api-key 头', async () => {
    let seenUrl = '';
    let seenKey = '';
    mockFetch((url, init) => {
      seenUrl = url;
      seenKey = String(init?.headers && (init.headers as Record<string, string>)['x-kaypal-api-key']);
      return {
        status: 200,
        body: {
          tier: 'long',
          items: [
            { id: 'm1', content: '用户偏好：喜欢简洁风', tier: 'long', createdAt: '2026-08-23T00:00:00Z', metadata: { agentNs: 't1/a1/user_preference', source: 'confirmed_user_statement' } },
            { id: 'm2', content: '另一租户秘密', tier: 'long', createdAt: '2026-08-23T00:00:00Z', metadata: { agentNs: 't9/a9/user_preference' } },
          ],
        },
      };
    });
    const items = await make().search(NS, '偏好');
    expect(seenUrl).toContain('/api/memory?tier=long');
    expect(seenUrl).toContain('query=');
    expect(seenKey).toBe('k_test');
    expect(items.map((i) => i.id)).toEqual(['m1']); // m2 跨租户被过滤
    expect(items[0].namespace).toBe('t1/u1/a1/user_preference');
  });

  test('add：POST /api/memory 带 memoryId 幂等 + agentNs metadata', async () => {
    let seenBody: Record<string, unknown> = {};
    mockFetch((url, init) => {
      seenBody = JSON.parse(String(init?.body));
      return { status: 200, body: { id: 'm_new', content: 'x', tier: 'long', createdAt: '2026-08-23T00:00:00Z' } };
    });
    const r = await make().add(NS, '用户偏好', 'local_id_1');
    expect(seenBody.tier).toBe('long');
    expect(seenBody.content).toBe('用户偏好');
    expect(seenBody.memoryId).toBe('local_id_1');
    expect((seenBody.metadata as Record<string, unknown>).agentNs).toBe('t1/a1/user_preference');
    expect(r.id).toBe('m_new');
  });

  test('delete：DELETE /api/memory/long?ids=', async () => {
    let seenUrl = '';
    mockFetch((url) => {
      seenUrl = url;
      return { status: 200, body: { ok: true } };
    });
    const ok = await make().delete(NS, 'm1');
    expect(seenUrl).toContain('/api/memory/long?ids=m1');
    expect(ok).toBe(true);
  });

  test('export：GET /api/memory/list?tier=long&limit=100', async () => {
    let seenUrl = '';
    mockFetch((url) => {
      seenUrl = url;
      return { status: 200, body: { items: [{ id: 'm1', content: 'a', tier: 'long', createdAt: 'x' }] } };
    });
    const items = await make().export(NS);
    expect(seenUrl).toContain('/api/memory/list?tier=long&limit=100');
    expect(items.length).toBe(1);
  });

  test('401 → MEMORY_REJECTED（鉴权失败）', async () => {
    mockFetch(() => ({ status: 401, body: { error: 'Unauthorized' } }));
    await expect(make().add(NS, 'x')).rejects.toMatchObject({ code: 'MEMORY_REJECTED' });
  });

  test('500 → MEMORY_TIMEOUT（远程故障降级）', async () => {
    mockFetch(() => ({ status: 500, body: { error: 'boom' } }));
    await expect(make().search(NS, 'q')).rejects.toMatchObject({ code: 'MEMORY_TIMEOUT' });
  });

  test('网络错误 → MEMORY_TIMEOUT（fetch reject）', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof fetch;
    await expect(make().search(NS, 'q')).rejects.toMatchObject({ code: 'MEMORY_TIMEOUT' });
  });
});
