import { AppError } from './types';
import { makeError } from '../contracts/error-codes';

export interface IdempotencyRecord {
  tenantId: string;
  idempotencyKey: string;
  taskId: string;
  status: 'in_progress' | 'done';
  usageId?: string;
  /** 审计字段（DB 落库用；内存版可不填） */
  userId?: string;
  workspaceId?: string;
  toolName?: string;
  risk?: string;
  inputHash?: string;
}

/**
 * 幂等键存储 —— 对齐《整合 PRD》8.2 / 《补充包》3.2 / 9.1。
 * 以 tenantId + idempotencyKey 唯一，防止重复发布 / 重复扣费。
 * 恢复前必须先检查外部状态，这里只保证进程内不重复派发。
 */
export class IdempotencyStore {
  private map = new Map<string, IdempotencyRecord>();

  private composite(tenantId: string, key: string): string {
    return `${tenantId}:${key}`;
  }

  /**
   * 尝试认领幂等键。
   * - 不存在 → 新建 in_progress，返回 { status: 'new' }
   * - 已 in_progress → IDEMPOTENCY_CONFLICT
   * - 已 done → DUPLICATE_REQUEST（附带原 usageId 供对账）
   */
  claim(tenantId: string, key: string, taskId: string, audit?: { userId?: string; workspaceId?: string; toolName?: string; risk?: string; inputHash?: string; requestJson?: string; toolCallId?: string }):
    | { status: 'new'; record: IdempotencyRecord }
    | { status: 'in_progress'; record: IdempotencyRecord }
    | { status: 'done'; record: IdempotencyRecord } {
    const ck = this.composite(tenantId, key);
    const existing = this.map.get(ck);
    if (!existing) {
      const record: IdempotencyRecord = {
        tenantId,
        idempotencyKey: key,
        taskId,
        status: 'in_progress',
        ...(audit ?? {}),
      };
      this.map.set(ck, record);
      return { status: 'new', record };
    }
    if (existing.status === 'in_progress') {
      throw makeError('IDEMPOTENCY_CONFLICT', {
        details: { idempotencyKey: key, existingTaskId: existing.taskId },
      });
    }
    return { status: 'done', record: existing };
  }

  markDone(tenantId: string, key: string, usageId: string): void {
    const ck = this.composite(tenantId, key);
    const rec = this.map.get(ck);
    if (rec) {
      rec.status = 'done';
      rec.usageId = usageId;
    }
  }

  /** 释放进行中的锁（执行失败/取消时调用），使客户端可安全重试 */
  release(tenantId: string, key: string): void {
    const ck = this.composite(tenantId, key);
    const rec = this.map.get(ck);
    if (rec && rec.status === 'in_progress') {
      this.map.delete(ck);
    }
  }

  get(tenantId: string, key: string): IdempotencyRecord | undefined {
    return this.map.get(this.composite(tenantId, key));
  }
}
