import { MemoryNamespace, TenantContext } from '../core/types';
import { makeError } from '../contracts/error-codes';
import { genId, nowIso } from '../core/util';

export interface MemoryItem {
  id: string;
  namespace: string;
  content: string;
  scope: string;
  source: string;
  createdAt: string;
}

/**
 * Kaypal 远程长期记忆（mock）—— 对齐《整合 PRD》10 / 《补充包》6。
 * 真实实现需：服务端受控鉴权、tenant/user/agent namespace、search/add/delete/export、限流、故障码。
 * 多租户隔离：所有读写按服务端派生 namespace，前端传入值忽略。
 */
export interface KaypalMemoryAdapter {
  /** @param accessToken 可选请求级 Bearer（per-call 注入，真实适配器用其代发，mock 忽略） */
  search(ns: MemoryNamespace, query: string, accessToken?: string): Promise<MemoryItem[]>;
  /** 本地/远程共用同一 item id，保证删除对账一致 */
  add(ns: MemoryNamespace, content: string, id?: string, accessToken?: string): Promise<{ id: string }>;
  /** 删除必须限定在派生 namespace 内，禁止跨租户/跨用户删除 */
  delete(ns: MemoryNamespace, id: string, accessToken?: string): Promise<boolean>;
  export(ns: MemoryNamespace, accessToken?: string): Promise<MemoryItem[]>;
}

function nsKey(ns: MemoryNamespace): string {
  const ws = ns.workspaceId ? `/_ws_${ns.workspaceId}` : '';
  return `${ns.tenantId}/${ns.userId}/${ns.agentId}/${ns.scope}${ws}`;
}

export class MockKaypalMemoryAdapter implements KaypalMemoryAdapter {
  private store = new Map<string, MemoryItem[]>();
  private degraded = false;

  setDegraded(v: boolean): void {
    this.degraded = v;
  }

  async search(ns: MemoryNamespace, query: string): Promise<MemoryItem[]> {
    if (this.degraded) throw makeError('MEMORY_TIMEOUT', { details: { namespace: nsKey(ns) } });
    const items = this.store.get(nsKey(ns)) ?? [];
    const q = query.toLowerCase();
    return items.filter((i) => i.content.toLowerCase().includes(q));
  }

  async add(ns: MemoryNamespace, content: string, id?: string): Promise<{ id: string }> {
    if (this.degraded) throw makeError('MEMORY_REJECTED', { details: { namespace: nsKey(ns) } });
    const item: MemoryItem = {
      id: id ?? genId('x'),
      namespace: nsKey(ns),
      content,
      scope: ns.scope,
      source: ns.source,
      createdAt: nowIso(),
    };
    const arr = this.store.get(nsKey(ns)) ?? [];
    arr.push(item);
    this.store.set(nsKey(ns), arr);
    return { id: item.id };
  }

  async delete(ns: MemoryNamespace, id: string): Promise<boolean> {
    const key = nsKey(ns);
    const arr = this.store.get(key);
    if (!arr) return false;
    const idx = arr.findIndex((i) => i.id === id && i.namespace === key);
    if (idx === -1) return false;
    arr.splice(idx, 1);
    if (arr.length === 0) this.store.delete(key);
    return true;
  }

  async export(ns: MemoryNamespace): Promise<MemoryItem[]> {
    return [...(this.store.get(nsKey(ns)) ?? [])];
  }
}

/** 服务端从登录态派生 namespace，忽略前端传入值（对齐《补充包》6.2） */
export function deriveNamespace(ctx: TenantContext, scope: string, source: string): MemoryNamespace {
  return {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    agentId: ctx.agentId,
    scope,
    source,
    retention: 'long_term',
    workspaceId: ctx.workspaceId,
  };
}
