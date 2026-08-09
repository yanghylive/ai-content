// local-engine batch targets 方法簇（god class 拆解阶段 2——mixin 化）
// 本簇方法只操作传入的 task 参数与 utils 函数，不访问 service 字段，
// 因此不依赖 LocalEngineService 类型（避免循环 import）。

import type {
  InteractionBatchTarget,
  InteractionTask,
} from './local-engine.types';
import { buildBatchSummary } from './local-engine.utils';

type BatchTargetMetadata = {
  nextAction?: string;
  evidenceEventIds?: string[];
};

const markQueuedBatchTargets = (
  task: InteractionTask,
  status: InteractionBatchTarget['status'],
  failureReason?: string,
  metadata: BatchTargetMetadata = {},
) => {
  const now = new Date().toISOString();
  const targets = task.batchTargets || [];
  targets.forEach((target) => {
    if (
      target.status === 'queued' ||
      target.status === 'running' ||
      target.status === 'waiting_confirmation'
    ) {
      target.status = status;
      target.updatedAt = now;
      if (failureReason) {
        target.failureReason = failureReason;
      }
      if (metadata.nextAction) {
        target.nextAction = metadata.nextAction;
      }
      if (metadata.evidenceEventIds?.length) {
        target.evidenceEventIds = [
          ...new Set([
            ...(target.evidenceEventIds || []),
            ...metadata.evidenceEventIds,
          ]),
        ];
      }
    }
  });
  task.batchSummary = buildBatchSummary(targets);
  return targets.filter((target) => target.status === status).length;
};

/** batch targets 方法簇（挂载到 LocalEngineService.prototype） */
export const batchTargetMethods = {
  completeQueuedBatchTargets(
    this: unknown,
    task: InteractionTask,
    metadata: BatchTargetMetadata = {},
  ): number {
    return markQueuedBatchTargets(task, 'completed', undefined, metadata);
  },

  markQueuedBatchTargets(
    this: unknown,
    task: InteractionTask,
    status: InteractionBatchTarget['status'],
    failureReason?: string,
    metadata: BatchTargetMetadata = {},
  ): number {
    return markQueuedBatchTargets(task, status, failureReason, metadata);
  },

  markPausableBatchTargets(
    this: unknown,
    task: InteractionTask,
    reason?: string,
    metadata: BatchTargetMetadata = {},
  ): number {
    const now = new Date().toISOString();
    const targets = task.batchTargets || [];
    targets.forEach((target) => {
      if (target.status === 'running') {
        target.status = 'failed';
        target.failureReason =
          '暂停发生在执行中，无法证明发送按钮尚未生效，禁止自动重发。';
        target.updatedAt = now;
        target.nextAction =
          '请核对该对象的微信会话和迟到回读；确认未发送后再显式重试。';
        if (metadata.evidenceEventIds?.length) {
          target.evidenceEventIds = [
            ...new Set([
              ...(target.evidenceEventIds || []),
              ...metadata.evidenceEventIds,
            ]),
          ];
        }
      } else if (
        target.status === 'queued' ||
        target.status === 'waiting_confirmation'
      ) {
        target.status = 'queued';
        target.updatedAt = now;
        delete target.failureReason;
        if (reason) {
          target.nextAction = metadata.nextAction || reason;
        }
        if (metadata.evidenceEventIds?.length) {
          target.evidenceEventIds = [
            ...new Set([
              ...(target.evidenceEventIds || []),
              ...metadata.evidenceEventIds,
            ]),
          ];
        }
      }
    });
    task.batchSummary = buildBatchSummary(targets);
    return targets.filter((target) => target.status === 'queued').length;
  },

  markUnfinishedBatchTargets(
    this: unknown,
    task: InteractionTask,
    status: InteractionBatchTarget['status'],
    failureReason?: string,
    metadata: BatchTargetMetadata = {},
  ): number {
    const now = new Date().toISOString();
    const terminalStatuses: InteractionBatchTarget['status'][] = [
      'completed',
      'skipped',
      'no_target',
    ];
    const targets = task.batchTargets || [];
    targets.forEach((target) => {
      if (terminalStatuses.includes(target.status)) {
        return;
      }
      target.status = status;
      target.updatedAt = now;
      if (failureReason) {
        target.failureReason = failureReason;
      } else if (status !== 'failed') {
        delete target.failureReason;
      }
      if (metadata.nextAction) {
        target.nextAction = metadata.nextAction;
      }
      if (metadata.evidenceEventIds?.length) {
        target.evidenceEventIds = [
          ...new Set([
            ...(target.evidenceEventIds || []),
            ...metadata.evidenceEventIds,
          ]),
        ];
      }
    });
    task.batchSummary = buildBatchSummary(targets);
    return targets.filter((target) => target.status === status).length;
  },

  markBatchTargetsForApprovalOutcome(
    this: unknown,
    task: InteractionTask,
    status: InteractionBatchTarget['status'],
    reason?: string,
    metadata: BatchTargetMetadata = {},
  ): number {
    return markQueuedBatchTargets(task, status, reason, metadata);
  },

  markBatchTargetsByNames(
    this: unknown,
    task: InteractionTask,
    targetNames: string[],
    status: InteractionBatchTarget['status'],
    reason?: string,
    metadata: BatchTargetMetadata = {},
  ): number {
    if (!task.batchTargets?.length || !targetNames.length) {
      return 0;
    }

    const targets = new Set(
      targetNames.map((name) => name.trim()).filter(Boolean),
    );
    if (!targets.size) {
      return 0;
    }

    let updated = 0;
    const updatedAt = new Date().toISOString();
    task.batchTargets.forEach((target) => {
      if (!targets.has(target.targetName)) {
        return;
      }
      target.status = status;
      target.updatedAt = updatedAt;
      if (
        status === 'failed' ||
        status === 'skipped' ||
        status === 'no_target'
      ) {
        target.failureReason = reason;
      } else {
        delete target.failureReason;
      }
      if (metadata.nextAction) {
        target.nextAction = metadata.nextAction;
      }
      if (metadata.evidenceEventIds?.length) {
        target.evidenceEventIds = [
          ...new Set([
            ...(target.evidenceEventIds || []),
            ...metadata.evidenceEventIds,
          ]),
        ];
      }
      updated += 1;
    });
    task.batchSummary = buildBatchSummary(task.batchTargets);
    return updated;
  },
};
