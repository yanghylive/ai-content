import { describe, it, expect } from '@jest/globals';
import { IdempotencyStore } from './core/idempotency';

describe('幂等键存储', () => {
  it('首次认领为 new，并发重复认领冲突，完成后再次认领返回 done', () => {
    const s = new IdempotencyStore();
    const r1 = s.claim('t1', 'publish:content1:douyin', 'taskA');
    expect(r1.status).toBe('new');

    let conflictCode = '';
    try {
      s.claim('t1', 'publish:content1:douyin', 'taskB');
    } catch (e) {
      conflictCode = (e as { code: string }).code;
    }
    expect(conflictCode).toBe('IDEMPOTENCY_CONFLICT');

    s.markDone('t1', 'publish:content1:douyin', 'usage_123');
    const r3 = s.claim('t1', 'publish:content1:douyin', 'taskA');
    expect(r3.status).toBe('done');
    expect(r3.record.usageId).toBe('usage_123');
  });

  it('完成后再次认领返回 done 并携带 usageId', () => {
    const s = new IdempotencyStore();
    s.claim('t1', 'key-x', 'taskA');
    s.markDone('t1', 'key-x', 'usage_123');
    const r = s.claim('t1', 'key-x', 'taskA');
    expect(r.status).toBe('done');
    expect(r.record.usageId).toBe('usage_123');
  });

  it('跨租户隔离：不同 tenantId 视为不同键', () => {
    const s = new IdempotencyStore();
    s.claim('t1', 'same-key', 'taskA');
    const r = s.claim('t2', 'same-key', 'taskA');
    expect(r.status).toBe('new');
  });
});
