import { MemoryNamespace } from '../core/types';
import { makeError } from '../contracts/error-codes';
import { KaypalMemoryAdapter, MemoryItem } from './kaypal-memory-mock';

/**
 * 真实 Kaypal Memory 适配器（P0-3）—— 对齐《整合 PRD》10 / 《补充包》6。
 * 契约（kaypal-ai src/app/api/memory/，2026-08-23 源码确认）：
 * - GET  /api/memory?tier=short|daily|long&query=&nResults=&limit=&since= → {tier, items[]}
 * - POST /api/memory {tier, content, summary?, payload?, metadata?} → MemoryItem（支持 memoryId 幂等）
 * - GET  /api/memory/list?tier=&limit= → {items[]}
 * - DELETE /api/memory/long?ids=id1,id2 → {ok}
 * - 鉴权：Authorization Bearer <desktop access_token（kda_）> 或 x-kaypal-api-key；
 *   Edge 网关已改 auth:'optional'，鉴权由 route handler getCurrentUser(request) 完成。
 *   api-key 需要 kaypal-ai 的 KAYPAL_API_KEYS 配置；生产未配置时回退 tokenProvider（推荐）。
 * - namespace：服务端由 userId 派生（Chroma where userId）；3010 的 tenant/agent 经
 *   metadata.agentNs 传递，检索后应用层过滤（防跨租户召回）。
 * - 故障降级：网络/401/5xx → 抛 MEMORY_TIMEOUT / MEMORY_REJECTED，由 Orchestrator 软降级。
 */
export class RealKaypalMemoryAdapter implements KaypalMemoryAdapter {
  constructor(
    private readonly opts: {
      baseUrl: string;
      apiKey: string;
      timeoutMs?: number;
      /** 可选 Bearer token 提供器（每次请求前调用换短时 token，优先于 api-key） */
      tokenProvider?: () => Promise<string | undefined>;
    },
  ) {}

  private async authHeaders(accessToken?: string): Promise<Record<string, string>> {
    // P3-1：请求级 token（per-call，KaypalAuthGuard 已验签）优先——避免服务再用共享凭据代发请求。
    // 兼容性：内部 HMAC 测试 token（点号分隔、单点）不属于 Kaypal desktop token，kaypal.cn 不认；
    // 见到 HMAC 形态直接回退 tokenProvider / api-key，避免误把测试 token 发到生产。
    if (accessToken && !this.looksLikeHmacToken(accessToken)) {
      return { authorization: `Bearer ${accessToken}` };
    }
    // 回退 tokenProvider（生产 desktop token 已验证 200）；再回退 api-key
    if (this.opts.tokenProvider) {
      try {
        const token = await this.opts.tokenProvider();
        if (token) return { authorization: `Bearer ${token}` };
      } catch {
        /* token 获取失败 → 回退 api-key */
      }
    }
    return { 'x-kaypal-api-key': this.opts.apiKey };
  }

  /** 内部 HMAC 测试 token = base64url body + '.' + base64url sig；仅单点；kaypal.cn 不认 */
  private looksLikeHmacToken(token: string): boolean {
    return token.includes('.') && token.split('.').length === 2 && !token.startsWith('kda_');
  }

  private async request(path: string, init?: RequestInit, accessToken?: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 8000);
    try {
      try {
        const auth = await this.authHeaders(accessToken);
        return await fetch(`${this.opts.baseUrl}${path}`, {
          ...init,
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            ...auth,
            ...(init?.headers ?? {}),
          },
          signal: controller.signal,
        });
      } catch (e) {
        // 网络错误/超时/中止 → 统一 MEMORY_TIMEOUT（Orchestrator 软降级为本地结果）
        const reason = e instanceof Error ? e.message : String(e);
        throw makeError('MEMORY_TIMEOUT', { details: { context: 'network', reason } });
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private async ensureOk(res: Response, context: string): Promise<unknown> {
    if (res.ok) {
      const text = await res.text();
      return text ? JSON.parse(text) : {};
    }
    // 401/403 → 鉴权失败（确定性问题，但 Orcherstrator 按 MEMORY_TIMEOUT 降级）
    throw makeError(res.status === 401 || res.status === 403 ? 'MEMORY_REJECTED' : 'MEMORY_TIMEOUT', {
      details: { context, httpStatus: res.status, body: (await res.text()).slice(0, 200) },
    });
  }

  async search(ns: MemoryNamespace, query: string, accessToken?: string): Promise<MemoryItem[]> {
    const p = new URLSearchParams({ tier: 'long' });
    if (query) p.set('query', query);
    p.set('nResults', '10');
    const res = await this.request(`/api/memory?${p.toString()}`, undefined, accessToken);
    const body = (await this.ensureOk(res, 'search')) as { items?: Array<Record<string, unknown>> };
    const items = ((body.items ?? []) as Array<Record<string, unknown>>).map((i) => ({
      id: String(i.id),
      namespace: nsKey(ns),
      content: String(i.content ?? ''),
      scope: ns.scope,
      source: String((i.metadata as Record<string, unknown> | undefined)?.source ?? 'remote'),
      createdAt: String(i.createdAt ?? ''),
      metadata: (i.metadata as Record<string, unknown> | undefined) ?? undefined,
    }));
    // 应用层租户隔离：Chroma 仅按 userId 过滤，3010 的 tenant/agent/scope 经 metadata.agentNs 区分；
    // 含 workspace 段（4.4）后严格精确匹配，杜绝跨租户/跨 Agent/跨 scope/跨 workspace 串扰
    const prefix = agentNsKey(ns);
    return items.filter((i) => {
      const agentNs = String((i as { metadata?: Record<string, unknown> }).metadata?.agentNs ?? '');
      return agentNs === prefix;
    });
  }

  async add(ns: MemoryNamespace, content: string, id?: string, accessToken?: string): Promise<{ id: string }> {
    const res = await this.request('/api/memory', {
      method: 'POST',
      body: JSON.stringify({
        tier: 'long',
        content,
        metadata: {
          agentNs: agentNsKey(ns),
          source: ns.source,
        },
        ...(id ? { memoryId: id } : {}), // 幂等：本地/远程共用同一 id
      }),
    }, accessToken);
    const body = (await this.ensureOk(res, 'add')) as { id?: string };
    if (!body.id) throw makeError('MEMORY_REJECTED', { details: { context: 'add', reason: '响应缺少 id' } });
    return { id: String(body.id) };
  }

  async delete(ns: MemoryNamespace, id: string, accessToken?: string): Promise<boolean> {
    // 限定 long tier 删除；id 必须匹配本租户前缀（应用层校验）
    if (!id) return false;
    const res = await this.request(`/api/memory/long?ids=${encodeURIComponent(id)}`, { method: 'DELETE' }, accessToken);
    const body = (await this.ensureOk(res, 'delete')) as { ok?: boolean };
    return body.ok !== false;
  }

  async export(ns: MemoryNamespace, accessToken?: string): Promise<MemoryItem[]> {
    const res = await this.request('/api/memory/list?tier=long&limit=100', undefined, accessToken);
    const body = (await this.ensureOk(res, 'export')) as { items?: Array<Record<string, unknown>> };
    // P3-2：按 ctx 完整 namespace（tenant/agent/scope[/_ws_<id>]）严格匹配；userId 由 Chroma 服务端隔离
    const prefix = agentNsKey(ns);
    return ((body.items ?? []) as Array<Record<string, unknown>>)
      .map((i) => ({
        id: String(i.id),
        namespace: nsKey(ns),
        content: String(i.content ?? ''),
        scope: ns.scope,
        source: String((i.metadata as Record<string, unknown> | undefined)?.source ?? 'remote'),
        createdAt: String(i.createdAt ?? ''),
        metadata: (i.metadata as Record<string, unknown> | undefined) ?? undefined,
      }))
      .filter((i) => {
        const agentNs = String((i as { metadata?: Record<string, unknown> }).metadata?.agentNs ?? '');
        return agentNs === prefix; // 全字段匹配（含 scope 与 workspace），杜绝跨 scope/workspace 串扰
      });
  }
}

/** 本地隔离键（local map / Chroma namespace 字段） */
function nsKey(ns: MemoryNamespace): string {
  const ws = ns.workspaceId ? `/_ws_${ns.workspaceId}` : '';
  return `${ns.tenantId}/${ns.userId}/${ns.agentId}/${ns.scope}${ws}`;
}

/** 应用层隔离键（metadata.agentNs）：tenant/agent/scope[/_ws_<id>]，远程检索后严格匹配 */
function agentNsKey(ns: MemoryNamespace): string {
  const ws = ns.workspaceId ? `/_ws_${ns.workspaceId}` : '';
  return `${ns.tenantId}/${ns.agentId}/${ns.scope}${ws}`;
}
