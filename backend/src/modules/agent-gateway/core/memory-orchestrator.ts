import { MemoryNamespace, MemoryOutbox, TenantContext } from './types';
import {
  deriveNamespace,
  KaypalMemoryAdapter,
  MemoryItem,
} from '../adapters/kaypal-memory-mock';
import { genId, hashJson, nowIso } from './util';

interface OutboxEntry {
  outbox: MemoryOutbox;
  content: string;
  ns: MemoryNamespace;
  /** 本地记忆 item id，远程写入复用同一 id 保证删除对账 */
  itemId: string;
}

/**
 * Memory Orchestrator —— 对齐《整合 PRD》10 / 《补充包》6。
 * - 召回：本地短期 + 远程长期并行，去重并按 token 预算截断；远程故障降级为本地。
 * - 写入：先写本地摘要，再进入 outbox 异步写远程；失败指数退避、死信可重放。
 * - 删除：同步远程、本地索引与缓存。
 * 命名空间永远由 ctx 派生，忽略任何前端/模型传入值。
 */
export class MemoryOrchestrator {
  private local = new Map<string, MemoryItem[]>();
  private outboxItems = new Map<string, OutboxEntry>();
  private readonly tokenBudget: number;
  private readonly maxAttempts = 5;

  constructor(private remote: KaypalMemoryAdapter, tokenBudget = 2000) {
    this.tokenBudget = tokenBudget;
  }

  private nsKey(ns: MemoryNamespace): string {
    return `${ns.tenantId}/${ns.userId}/${ns.agentId}/${ns.scope}`;
  }

  async recall(
    ctx: TenantContext,
    scope: string,
    query: string,
  ): Promise<{ items: MemoryItem[]; degraded: boolean }> {
    const ns = deriveNamespace(ctx, scope, 'recall');
    const localItems = this.local.get(this.nsKey(ns)) ?? [];
    let remoteItems: MemoryItem[] = [];
    let degraded = false;
    try {
      remoteItems = await this.remote.search(ns, query);
    } catch {
      degraded = true; // 软降级：返回本地结果，不阻塞主任务
    }
    const merged = dedupe([...localItems, ...remoteItems]);
    return { items: truncate(merged, this.tokenBudget), degraded };
  }

  async capture(
    ctx: TenantContext,
    scope: string,
    content: string,
    source = 'confirmed_user_statement',
  ): Promise<{ memoryEventId: string; outboxId: string }> {
    const ns = deriveNamespace(ctx, scope, source);
    const key = this.nsKey(ns);
    const localItem: MemoryItem = {
      id: genId('x'),
      namespace: key,
      content,
      scope,
      source,
      createdAt: nowIso(),
    };
    const arr = this.local.get(key) ?? [];
    arr.push(localItem);
    this.local.set(key, arr);

    const memoryEventId = genId('mem');
    const outbox: MemoryOutbox = {
      id: genId('ob'),
      memoryEventId,
      namespace: key,
      operation: 'add',
      payloadHash: hashJson(content),
      attempts: 0,
      nextRetryAt: nowIso(),
      status: 'pending',
    };
    this.outboxItems.set(memoryEventId, { outbox, content, ns, itemId: localItem.id });
    // 主链路不等待；后台补偿
    void this.flushOutbox(memoryEventId).catch(() => undefined);
    return { memoryEventId, outboxId: outbox.id };
  }

  private async flushOutbox(memoryEventId: string): Promise<void> {
    const entry = this.outboxItems.get(memoryEventId);
    if (!entry || entry.outbox.status === 'done') return;
    try {
      await this.remote.add(entry.ns, entry.content, entry.itemId);
      entry.outbox.status = 'done';
    } catch {
      entry.outbox.attempts += 1;
      if (entry.outbox.attempts >= this.maxAttempts) {
        entry.outbox.status = 'dead'; // 死信，可人工重放
      } else {
        entry.outbox.nextRetryAt = new Date(Date.now() + 2 ** entry.outbox.attempts * 1000).toISOString();
      }
    }
  }

  /** 人工重放死信 */
  async replayDeadLetters(): Promise<number> {
    let n = 0;
    for (const [id, entry] of this.outboxItems) {
      if (entry.outbox.status === 'dead') {
        entry.outbox.status = 'pending';
        entry.outbox.attempts = 0;
        await this.flushOutbox(id);
        n += 1;
      }
    }
    return n;
  }

  async delete(ctx: TenantContext, id: string): Promise<{ deleted: boolean }> {
    // 只在本租户/用户命名空间前缀下查找，杜绝跨租户删除
    const prefix = `${ctx.tenantId}/${ctx.userId}/${ctx.agentId}/`;
    let localRemoved = false;
    let itemNs: MemoryNamespace | undefined;
    for (const [key, arr] of this.local) {
      if (!key.startsWith(prefix)) continue;
      const idx = arr.findIndex((i) => i.id === id);
      if (idx !== -1) {
        const item = arr[idx];
        arr.splice(idx, 1);
        if (arr.length === 0) this.local.delete(key);
        localRemoved = true;
        itemNs = parseNsKey(item.namespace);
        break;
      }
    }

    // 远程：仅在派生 namespace 内删除；找不到或越界一律返回 false
    if (!itemNs) {
      // 本地都没有，远程大概率也没有；仍以防万一按派生 ns 试删（不会越界）
      itemNs = deriveNamespace(ctx, 'user_preference', 'delete');
    }
    let remoteRemoved = false;
    try {
      remoteRemoved = await this.remote.delete(itemNs, id);
    } catch {
      // 远程故障：绝不宣称删除成功
      return { deleted: false };
    }

    // 准确标志：本地或远程任一实际删除成功即 deleted=true（P1-6）
    // （远程故障抛错 → 不宣称成功；两端都没有 → false）
    const deleted = localRemoved || remoteRemoved;
    return { deleted };
  }

  // ---------------------------------------------------------------- outbox 自动重试
  private workerTimer: ReturnType<typeof setInterval> | undefined;

  /** 启动后台 worker，定时扫描 nextRetryAt 到期的 pending 记录并重试远程写入 */
  startOutboxWorker(intervalMs = 2000): () => void {
    if (this.workerTimer) return () => this.stopOutboxWorker();
    this.workerTimer = setInterval(() => {
      void this.scanOutbox();
    }, intervalMs);
    // 不阻止进程退出
    const t = this.workerTimer as unknown as { unref?: () => void };
    if (typeof t.unref === 'function') t.unref();
    return () => this.stopOutboxWorker();
  }

  stopOutboxWorker(): void {
    if (this.workerTimer) {
      clearInterval(this.workerTimer);
      this.workerTimer = undefined;
    }
  }

  private async scanOutbox(): Promise<void> {
    const now = Date.now();
    for (const [id, entry] of this.outboxItems) {
      if (entry.outbox.status === 'pending' && Date.parse(entry.outbox.nextRetryAt) <= now) {
        await this.flushOutbox(id);
      }
    }
  }

  async export(ctx: TenantContext, scope: string): Promise<MemoryItem[]> {
    const ns = deriveNamespace(ctx, scope, 'export');
    const local = this.local.get(this.nsKey(ns)) ?? [];
    let remote: MemoryItem[] = [];
    try {
      remote = await this.remote.export(ns);
    } catch {
      remote = [];
    }
    return dedupe([...local, ...remote]);
  }

  pendingOutbox(): OutboxEntry[] {
    return [...this.outboxItems.values()];
  }
}

function dedupe(items: MemoryItem[]): MemoryItem[] {
  const seenId = new Set<string>();
  const seenContent = new Set<string>();
  const out: MemoryItem[] = [];
  for (const i of items) {
    const ch = hashJson(i.content);
    if (seenId.has(i.id) || seenContent.has(ch)) continue;
    seenId.add(i.id);
    seenContent.add(ch);
    out.push(i);
  }
  return out;
}

/** 把 nsKey（tenant/user/agent/scope）解析回 MemoryNamespace 对象 */
function parseNsKey(key: string): MemoryNamespace {
  const [tenantId, userId, agentId, scope] = key.split('/');
  return { tenantId, userId, agentId, scope, source: 'delete', retention: 'long_term' };
}

function truncate(items: MemoryItem[], tokenBudget: number): MemoryItem[] {
  let used = 0;
  const out: MemoryItem[] = [];
  for (const i of items) {
    const cost = Math.ceil(i.content.length / 4);
    if (used + cost > tokenBudget) break;
    used += cost;
    out.push(i);
  }
  return out;
}
