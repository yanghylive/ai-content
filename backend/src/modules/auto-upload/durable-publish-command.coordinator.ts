import { Injectable } from '@nestjs/common';
import {
  PublishRecordStore,
  type ClaimDurablePublishRecordResult,
  type CreateDurablePublishClaimInput,
  type PublishOwnerScope,
} from './publish-record.store';

export class DurablePublishIdempotencyConflictError extends Error {
  readonly code = 'IDEMPOTENCY_CONFLICT';

  constructor(readonly idempotencyKey: string) {
    super('同一幂等键已绑定不同的发布请求');
    this.name = 'DurablePublishIdempotencyConflictError';
  }
}

@Injectable()
export class DurablePublishCommandCoordinator {
  constructor(private readonly publishRecordStore: PublishRecordStore) {}

  async claimOrLoad(
    scope: PublishOwnerScope,
    input: CreateDurablePublishClaimInput,
  ): Promise<ClaimDurablePublishRecordResult> {
    try {
      const record = await this.publishRecordStore.createClaim(scope, input);
      return { kind: 'created', record };
    } catch (error) {
      if (!this.isIdempotencyKeyConflict(error)) throw error;
      const existing = await this.publishRecordStore.findClaimByIdempotencyKey(
        scope,
        input.idempotencyKey,
      );
      if (!existing) throw error;
      if (existing.requestHash !== input.requestHash) {
        throw new DurablePublishIdempotencyConflictError(
          input.idempotencyKey,
        );
      }
      return { kind: 'existing', record: existing };
    }
  }

  private isIdempotencyKeyConflict(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const prismaError = error as {
      code?: unknown;
      meta?: { target?: unknown };
    };
    if (prismaError.code !== 'P2002') return false;
    const target = prismaError.meta?.target;
    if (typeof target === 'string') {
      return target.includes(
        'runtime_executions_tenant_user_task_idempotency_key',
      );
    }
    if (!Array.isArray(target)) return false;
    const fields = new Set(
      target.filter((field): field is string => typeof field === 'string'),
    );
    return (
      fields.has('tenant_id') &&
      fields.has('user_id') &&
      fields.has('taskType') &&
      (fields.has('idempotency_key') || fields.has('idempotencyKey'))
    );
  }
}
