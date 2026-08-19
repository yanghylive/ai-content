import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AgentSService,
  type AgentSSidecarEvent,
} from '../agent-s/agent-s.service';

const SCHEDULED_WECHAT_TYPES = [
  'WECHAT_GROUP_BROADCAST',
  'WECHAT_CONTACT_ADD',
  'WECHAT_FRIEND_ACCEPT',
  'WECHAT_MOMENTS_PUBLISH',
  'WECHAT_MOMENTS_MARKETING',
] as const;

type StoredTask = {
  id: string;
  tenantId: string;
  userId: string;
  taskType: string;
  sendMode: string;
  status: string;
  stage: string | null;
  sessionId: string | null;
  currentTarget: string | null;
  batchTargets: unknown;
  config: unknown;
  events: unknown;
  createdBy?: string | null;
  updatedAt: Date;
};

type SchedulerState = {
  attempts?: number;
  nextAttemptAt?: string;
  lastError?: string;
  dispatchedAt?: string;
  agentSessionId?: string;
  momentsItemIndex?: number;
  momentsItemTarget?: string;
};

type BatchOutcome = {
  completed: Set<string>;
  failed: Map<string, string>;
  skipped: Set<string>;
  pending: Set<string>;
  evidenceByTarget: Map<string, string[]>;
  noTarget: boolean;
};

@Injectable()
export class WechatPlanSchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(WechatPlanSchedulerService.name);
  private readonly active = new Set<string>();
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly agentS: AgentSService,
  ) {}

  onModuleInit() {
    if (!this.enabled())
      this.logger.log(
        'Wechat plan dispatch is not armed; Agent-S readback reconciliation remains active.',
      );
    const intervalMs = this.intervalMs();
    this.timer = setInterval(() => {
      void this.runOnce();
    }, intervalMs);
    this.timer.unref?.();
    void this.runOnce();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(now = new Date()) {
    const [dispatched, reconciled] = await Promise.all([
      this.enabled() ? this.dispatchDuePlans(now) : Promise.resolve(0),
      this.reconcileRunningPlans(now),
    ]);
    return { dispatched, reconciled };
  }

  private enabled() {
    return this.readBoolean(
      this.config.get<string>('WECHAT_PLAN_SCHEDULER_ENABLED'),
    );
  }

  private intervalMs() {
    const value = Number(
      this.config.get<string>('WECHAT_PLAN_SCHEDULER_INTERVAL_MS'),
    );
    return Number.isFinite(value)
      ? Math.max(5000, Math.min(value, 60000))
      : 15000;
  }

  private readBoolean(value: unknown) {
    return ['1', 'true', 'yes', 'on'].includes(
      this.text(value).trim().toLowerCase(),
    );
  }

  private async dispatchDuePlans(now: Date) {
    const rows = (await this.prisma.interactionTask.findMany({
      where: {
        status: 'QUEUED',
        taskType: { in: [...SCHEDULED_WECHAT_TYPES] },
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
    })) as unknown as StoredTask[];
    let dispatched = 0;
    for (const row of rows) {
      if (!this.hasTenantScope(row)) {
        this.logger.warn(`Wechat plan ${row.id} has no tenant scope; skipped.`);
        continue;
      }
      const activeKey = this.activeKey(row);
      if (this.active.has(activeKey) || !this.isDue(row, now)) continue;
      this.active.add(activeKey);
      try {
        if (await this.dispatch(row, now)) dispatched += 1;
      } finally {
        this.active.delete(activeKey);
      }
    }
    return dispatched;
  }

  private isDue(row: StoredTask, now: Date) {
    const task = this.record(row.config);
    if (this.text(task.planStatus) !== 'scheduled') return false;
    if (
      this.text(task.type) === 'wechat-moments-publish' &&
      this.momentsDetails(task).length > 0 &&
      !this.nextPendingMomentsItem(task)
    ) {
      return false;
    }
    const scheduler = this.record(task.scheduler);
    const nextAttemptAt = this.date(scheduler.nextAttemptAt);
    if (nextAttemptAt && nextAttemptAt.getTime() > now.getTime()) return false;
    const scheduledAt = this.scheduledAt(task);
    return Boolean(scheduledAt && scheduledAt.getTime() <= now.getTime());
  }

  private async dispatch(row: StoredTask, now: Date) {
    const task = this.record(row.config);
    const scheduler = this.record(task.scheduler) as SchedulerState;
    const safetyBoundary = this.record(task.safetyBoundary);
    if (
      row.sendMode !== 'auto-send' ||
      safetyBoundary.commercialExecutionAllowed !== true ||
      safetyBoundary.requestedCommercialExecution !== true
    ) {
      await this.finishWithoutSend(
        row,
        task,
        'BLOCKED',
        '计划需要确认商用执行权限，当前没有发送。',
        '请打开计划确认账号、目标和自动发送权限。',
      );
      return false;
    }

    const claimed = await this.prisma.interactionTask.updateMany({
      where: {
        ...this.scopedWhere(row),
        status: 'QUEUED',
      },
      data: { status: 'RUNNING', stage: 'agent-s-scheduled-dispatch' },
    });
    if (!claimed.count) return false;

    try {
      const status = await this.agentS.ensureRunning();
      if (!status.connected) {
        throw new Error(status.lastError || '本机助手尚未连接。');
      }
      const metadata = this.record(task.metadata);
      const momentsItem = this.nextDueMomentsItem(task, now);
      const executionMetadata = momentsItem
        ? this.buildMomentsItemMetadata(metadata, momentsItem.detail)
        : metadata;
      const sessionResult = await this.agentS.createSession({
        session_name: `${this.text(task.planName) || '微信计划'}-${row.id}`,
        task_type:
          this.text(metadata.skill_id) || this.text(task.type) || row.taskType,
        metadata: {
          ...executionMetadata,
          source: 'wechat-plan-scheduler',
          interaction_task_id: row.id,
          scheduled_at: this.scheduledAt(task)?.toISOString(),
          created_by: row.createdBy || undefined,
          tenant_id: row.tenantId,
          user_id: row.userId,
          commercialExecutionRequested:
            safetyBoundary.requestedCommercialExecution === true,
          commercialExecutionAllowed:
            safetyBoundary.commercialExecutionAllowed === true,
        },
        labels: this.stringList(metadata.agent_s_labels),
      });
      const sessionId = sessionResult.session.session_id;
      await this.agentS.runTask(sessionId, {
        instruction:
          this.text(metadata.agent_s_instruction) ||
          this.text(task.sourceText) ||
          '执行已到时间的微信计划，并返回逐对象发送结果。',
        task_type:
          this.text(metadata.skill_id) || this.text(task.type) || row.taskType,
        metadata: {
          ...executionMetadata,
          interaction_task_id: row.id,
          scheduler_dispatch: true,
          tenant_id: row.tenantId,
          user_id: row.userId,
          commercialExecutionRequested:
            safetyBoundary.requestedCommercialExecution === true,
          commercialExecutionAllowed:
            safetyBoundary.commercialExecutionAllowed === true,
        },
        risk_level: this.riskLevel(task.riskLevel),
        requires_approval: false,
      });
      const nextTask: Record<string, unknown> = {
        ...task,
        status: 'running',
        statusLabel: '执行中',
        planStatus: 'sending',
        runtimeState: 'running',
        sessionId,
        nextAction: '本机助手正在执行，收到逐对象结果后更新状态。',
        scheduler: {
          ...scheduler,
          dispatchedAt: now.toISOString(),
          agentSessionId: sessionId,
          momentsItemIndex: momentsItem?.index,
          momentsItemTarget: momentsItem?.target,
          lastError: undefined,
        },
        updatedAt: now.toISOString(),
      };
      const events = this.appendEvent(row.events, {
        level: 'info',
        message: '计划已到时间，本机助手开始执行。',
        stageKey: 'agent-s-scheduled-dispatch',
      });
      nextTask.events = events;
      await this.prisma.interactionTask.update({
        where: this.scopedWhere(row),
        data: {
          sessionId,
          status: 'RUNNING',
          stage: 'agent-s-scheduled-running',
          config: nextTask as unknown as Prisma.InputJsonValue,
          events: events,
        },
      });
      return true;
    } catch (error) {
      await this.deferRetry(row, task, scheduler, error, now);
      return false;
    }
  }

  private async deferRetry(
    row: StoredTask,
    task: Record<string, unknown>,
    scheduler: SchedulerState,
    error: unknown,
    now: Date,
  ) {
    const attempts = Number(scheduler.attempts || 0) + 1;
    const message = error instanceof Error ? error.message : String(error);
    if (attempts >= 5) {
      await this.finishWithoutSend(
        row,
        task,
        'BLOCKED',
        `本机助手连续 ${attempts} 次未能启动，计划没有发送。`,
        '请检查微信登录和桌面权限后重试计划。',
      );
      return;
    }
    const delayMs = Math.min(15 * 60_000, 30_000 * 2 ** (attempts - 1));
    const nextAttemptAt = new Date(now.getTime() + delayMs).toISOString();
    const events = this.appendEvent(row.events, {
      level: 'warning',
      message: `本机助手未启动，将自动重试（${attempts}/5）。`,
      stageKey: 'agent-s-scheduled-retry',
    });
    await this.prisma.interactionTask.update({
      where: this.scopedWhere(row),
      data: {
        status: 'QUEUED',
        stage: 'agent-s-scheduled-retry',
        events: events,
        config: {
          ...task,
          status: 'queued',
          statusLabel: '等待执行',
          planStatus: 'scheduled',
          failureReason: undefined,
          nextAction: '本机助手恢复后会自动重试。',
          scheduler: {
            ...scheduler,
            attempts,
            nextAttemptAt,
            lastError: message,
          },
          events,
          updatedAt: now.toISOString(),
        },
      },
    });
  }

  private async reconcileRunningPlans(now: Date) {
    const rows = (await this.prisma.interactionTask.findMany({
      where: {
        status: { in: ['RUNNING', 'PAUSED'] },
        stage: {
          in: ['agent-s-scheduled-running', 'agent-s-immediate-running'],
        },
        taskType: { in: [...SCHEDULED_WECHAT_TYPES] },
      },
      orderBy: { updatedAt: 'asc' },
      take: 50,
    })) as unknown as StoredTask[];
    let reconciled = 0;
    for (const row of rows) {
      if (!row.sessionId || !this.hasTenantScope(row)) continue;
      const activeKey = this.activeKey(row);
      if (this.active.has(activeKey)) continue;
      this.active.add(activeKey);
      try {
        const result = await this.agentS.getEvents(row.sessionId, 0);
        const terminal = [...result.events]
          .reverse()
          .find((event) =>
            ['completed', 'failed', 'cancelled', 'blocked'].includes(
              this.text(event.status),
            ),
          );
        if (!terminal) continue;
        const outcome = this.extractBatchOutcome(result.events);
        if (
          ['failed', 'cancelled', 'blocked'].includes(
            this.text(terminal.status),
          )
        ) {
          if (
            await this.settleScheduledMomentsItem(
              row,
              'failed',
              terminal.message || '本条朋友圈明细执行失败。',
              '请检查本条明细的内容、媒体、可见范围和微信状态。',
              result.events,
              [],
              now,
            )
          ) {
            reconciled += 1;
            continue;
          }
          if (this.hasBatchOutcome(outcome)) {
            await this.settleBatchOutcome(
              row,
              result.events,
              outcome,
              this.text(terminal.status) === 'cancelled'
                ? 'PAUSED'
                : this.text(terminal.status) === 'blocked'
                  ? 'BLOCKED'
                  : 'FAILED',
              terminal.message || '本机助手没有完成全部对象。',
              now,
            );
            reconciled += 1;
            continue;
          }
          await this.finishWithoutSend(
            row,
            this.record(row.config),
            this.text(terminal.status) === 'blocked' ? 'BLOCKED' : 'FAILED',
            terminal.message || '本机助手执行失败，当前没有完成发送。',
            '查看失败对象并重试计划。',
          );
          reconciled += 1;
          continue;
        }
        const proof = this.completeReadback(row, result.events);
        if (!proof.ok) {
          if (
            await this.settleScheduledMomentsItem(
              row,
              'failed',
              '本机助手已结束，但没有返回本条朋友圈明细的完整结果。',
              proof.nextAction,
              result.events,
              proof.refs,
              now,
            )
          ) {
            reconciled += 1;
            continue;
          }
          await this.finishWithoutSend(
            row,
            this.record(row.config),
            'BLOCKED',
            '本机助手已结束，但没有返回完整的逐对象发送结果。',
            proof.nextAction,
          );
          reconciled += 1;
          continue;
        }
        if (
          await this.settleScheduledMomentsItem(
            row,
            'completed',
            '本条朋友圈明细已完成，并收到执行结果。',
            '后续明细会按各自时间继续。',
            result.events,
            proof.refs,
            now,
          )
        ) {
          reconciled += 1;
          continue;
        }
        await this.settleBatchOutcome(
          row,
          result.events,
          outcome,
          outcome.noTarget
            ? 'NO_TARGET'
            : outcome.failed.size > 0
              ? 'FAILED'
              : outcome.pending.size > 0 || outcome.skipped.size > 0
                ? 'BLOCKED'
                : 'COMPLETED',
          outcome.failed.size > 0
            ? '部分对象执行失败，不能按整单成功处理。'
            : outcome.pending.size > 0 || outcome.skipped.size > 0
              ? '仍有对象未完成，不能按整单成功处理。'
              : '微信计划已完成，并收到逐对象发送结果。',
          now,
          proof.refs,
        );
        reconciled += 1;
      } catch (error) {
        this.logger.warn(
          `Wechat scheduled plan reconciliation failed for ${row.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      } finally {
        this.active.delete(activeKey);
      }
    }
    return reconciled;
  }

  private async settleScheduledMomentsItem(
    row: StoredTask,
    outcome: 'completed' | 'failed',
    reason: string,
    nextAction: string,
    agentEvents: AgentSSidecarEvent[],
    refs: string[],
    now: Date,
  ) {
    const task = this.record(row.config);
    if (this.text(task.type) !== 'wechat-moments-publish') return false;
    const scheduler = this.record(task.scheduler) as SchedulerState;
    const details = this.momentsDetails(task);
    const itemIndex = Number(scheduler.momentsItemIndex);
    if (
      !Number.isInteger(itemIndex) ||
      itemIndex < 0 ||
      itemIndex >= details.length
    ) {
      return false;
    }

    const updatedDetails = details.map((detail, index) =>
      index === itemIndex
        ? {
            ...detail,
            status: outcome,
            completedAt: now.toISOString(),
            failureReason: outcome === 'failed' ? reason : undefined,
            readbackRefs: refs,
          }
        : detail,
    );
    const metadata = {
      ...this.record(task.metadata),
      momentsDetails: updatedDetails,
      wechat_moments_details: updatedDetails,
    };
    const completedCount = updatedDetails.filter(
      (detail) => this.text(detail.status) === 'completed',
    ).length;
    const failedCount = updatedDetails.filter(
      (detail) => this.text(detail.status) === 'failed',
    ).length;
    const pendingCount = updatedDetails.filter(
      (detail) => !this.isTerminalMomentsStatus(detail.status),
    ).length;
    const eventMessage =
      outcome === 'completed'
        ? `朋友圈明细 ${itemIndex + 1} 已完成。`
        : `朋友圈明细 ${itemIndex + 1} 失败，后续明细不受影响。`;
    const events = this.appendEvent(row.events, {
      level: outcome === 'completed' ? 'info' : 'warning',
      message: eventMessage,
      stageKey: 'agent-s-scheduled-item-result',
      evidence: refs,
    });
    const baseScheduler = {
      ...scheduler,
      agentSessionId: undefined,
      momentsItemIndex: undefined,
      momentsItemTarget: undefined,
      lastError: outcome === 'failed' ? reason : undefined,
    };
    const combinedRefs = Array.from(
      new Set([...this.stringList(task.readbackRefs), ...refs]),
    );

    if (pendingCount > 0) {
      const nextTask: Record<string, unknown> = {
        ...task,
        metadata,
        status: 'queued',
        statusLabel: '等待执行',
        planStatus: 'scheduled',
        runtimeState: 'record_ready',
        sessionId: undefined,
        failureReason: undefined,
        nextAction: `已完成 ${completedCount} 条，失败 ${failedCount} 条；其余 ${pendingCount} 条按各自时间继续。`,
        scheduler: baseScheduler,
        updatedAt: now.toISOString(),
        events,
        agentSEvents: [
          ...(Array.isArray(task.agentSEvents) ? task.agentSEvents : []),
          ...agentEvents,
        ].slice(-100),
        readbackRefs: combinedRefs,
      };
      const nextScheduledAt = this.scheduledAt(nextTask);
      nextTask.scheduler = {
        ...baseScheduler,
        nextAttemptAt:
          nextScheduledAt && nextScheduledAt.getTime() > now.getTime()
            ? nextScheduledAt.toISOString()
            : new Date(now.getTime() + 1000).toISOString(),
      };
      await this.prisma.interactionTask.update({
        where: this.scopedWhere(row),
        data: {
          sessionId: null,
          status: 'QUEUED',
          stage: 'scheduled-wait',
          config: nextTask as unknown as Prisma.InputJsonValue,
          events: events,
        },
      });
      return true;
    }

    const finalStatus = completedCount > 0 ? 'COMPLETED' : 'FAILED';
    await this.prisma.interactionTask.update({
      where: this.scopedWhere(row),
      data: {
        sessionId: null,
        status: finalStatus,
        stage: 'agent-s-scheduled-readback',
        config: {
          ...task,
          metadata,
          status: finalStatus === 'COMPLETED' ? 'completed' : 'failed',
          statusLabel: finalStatus === 'COMPLETED' ? '已完成' : '失败',
          planStatus: 'completed',
          runtimeState: finalStatus === 'COMPLETED' ? 'completed' : 'blocked',
          failureReason:
            finalStatus === 'FAILED'
              ? reason
              : failedCount
                ? `${failedCount} 条明细失败，请在计划中查看。`
                : undefined,
          nextAction:
            failedCount > 0
              ? `已完成 ${completedCount} 条，失败 ${failedCount} 条；可单独重试失败明细。`
              : '可查看每条朋友圈明细的执行结果。',
          completedAt: now.toISOString(),
          updatedAt: now.toISOString(),
          scheduler: baseScheduler,
          events,
          agentSEvents: [
            ...(Array.isArray(task.agentSEvents) ? task.agentSEvents : []),
            ...agentEvents,
          ].slice(-100),
          readbackRefs: combinedRefs,
        } as unknown as Prisma.InputJsonValue,
        events: events,
      },
    });
    return true;
  }

  private completeReadback(row: StoredTask, events: AgentSSidecarEvent[]) {
    const refs = events.flatMap((event) => this.readbackRefs(event));
    const task = this.record(row.config);
    const scheduler = this.record(task.scheduler) as SchedulerState;
    const isSingleMomentsItem =
      this.text(task.type) === 'wechat-moments-publish' &&
      Number.isInteger(Number(scheduler.momentsItemIndex));
    const targets = isSingleMomentsItem
      ? 1
      : Array.isArray(row.batchTargets)
        ? row.batchTargets.length
        : 1;
    const completedTargets = events.flatMap((event) => {
      const payload = this.record(event.payload);
      return this.stringList(
        payload.completedTargets || payload.completed_targets,
      );
    });
    const enough =
      targets <= 1 ? refs.length > 0 : completedTargets.length >= targets;
    return {
      ok: enough,
      refs: Array.from(new Set(refs)),
      nextAction:
        targets > 1
          ? `请核对 ${targets} 个对象的发送结果后重试未完成对象。`
          : '请核对微信中的实际发送结果后重试。',
    };
  }

  private readbackRefs(event: AgentSSidecarEvent) {
    const refs: string[] = [];
    const walk = (value: unknown, key = '', depth = 0) => {
      if (depth > 4 || value == null) return;
      if (Array.isArray(value)) {
        value.forEach((item) => walk(item, key, depth + 1));
        return;
      }
      if (typeof value === 'object') {
        Object.entries(value as Record<string, unknown>).forEach(
          ([childKey, childValue]) => walk(childValue, childKey, depth + 1),
        );
        return;
      }
      if (
        /(readback|message.?id|external.?id|receipt|screenshot|sent.?at|delivered.?at)/i.test(
          key,
        ) &&
        this.text(value).trim()
      ) {
        refs.push(`${key}:${this.text(value).trim()}`);
      }
    };
    walk(event.payload);
    if (
      event.artifact_id &&
      /(result|readback|complete)/i.test(event.event_type)
    ) {
      refs.push(`artifact:${event.artifact_id}`);
    }
    return refs;
  }

  private extractBatchOutcome(events: AgentSSidecarEvent[]): BatchOutcome {
    const outcome: BatchOutcome = {
      completed: new Set(),
      failed: new Map(),
      skipped: new Set(),
      pending: new Set(),
      evidenceByTarget: new Map(),
      noTarget: false,
    };
    const addEvidence = (
      targetName: string,
      event: AgentSSidecarEvent,
      payload: unknown = event.payload,
    ) => {
      const target = targetName.trim();
      if (!target) return;
      const refs = this.readbackRefs({
        ...event,
        payload,
      } as AgentSSidecarEvent);
      const eventRef = `agent-s:${event.session_id || 'session'}:${event.seq}`;
      outcome.evidenceByTarget.set(
        target,
        Array.from(
          new Set([
            ...(outcome.evidenceByTarget.get(target) || []),
            eventRef,
            ...refs,
          ]),
        ),
      );
    };
    const complete = (targetName: string) => {
      const target = targetName.trim();
      if (!target) return;
      outcome.completed.add(target);
      outcome.failed.delete(target);
      outcome.skipped.delete(target);
      outcome.pending.delete(target);
    };
    const fail = (targetName: string, reason: string) => {
      const target = targetName.trim();
      if (!target || outcome.completed.has(target)) return;
      outcome.failed.set(target, reason || '该对象执行失败。');
      outcome.pending.delete(target);
    };

    for (const event of events) {
      const payload = this.record(event.payload);
      if (payload.noTarget === true || payload.no_target === true) {
        outcome.noTarget = true;
      }
      for (const target of this.stringList(
        payload.completedTargets || payload.completed_targets,
      )) {
        complete(target);
      }
      for (const target of this.stringList(
        payload.skippedTargets ||
          payload.skipped_targets ||
          payload.skippedByBlacklist,
      )) {
        if (!outcome.completed.has(target)) outcome.skipped.add(target);
      }
      for (const target of this.stringList(
        payload.pendingTargets || payload.pending_targets,
      )) {
        if (
          !outcome.completed.has(target) &&
          !outcome.failed.has(target) &&
          !outcome.skipped.has(target)
        ) {
          outcome.pending.add(target);
        }
      }
      const rawFailed = Array.isArray(payload.failedTargets)
        ? payload.failedTargets
        : Array.isArray(payload.failed_targets)
          ? payload.failed_targets
          : [];
      for (const item of rawFailed) {
        if (typeof item === 'string') {
          fail(item, event.message || '该对象执行失败。');
          continue;
        }
        const record = this.record(item);
        const target = this.text(
          record.targetName || record.target || record.name,
        ).trim();
        const reason = this.text(
          record.reason || record.message || record.error,
        ).trim();
        fail(target, reason || event.message || '该对象执行失败。');
      }

      const directTarget = this.text(
        payload.target || payload.targetName || payload.target_name,
      ).trim();
      if (directTarget) {
        if (/TargetCompleted$/i.test(event.event_type)) {
          complete(directTarget);
          addEvidence(directTarget, event);
        } else if (/TargetFailed$/i.test(event.event_type)) {
          fail(
            directTarget,
            this.text(payload.error).trim() ||
              event.message ||
              '该对象执行失败。',
          );
          addEvidence(directTarget, event);
        } else if (/TargetSkipped$/i.test(event.event_type)) {
          if (!outcome.completed.has(directTarget)) {
            outcome.skipped.add(directTarget);
          }
          addEvidence(directTarget, event);
        }
      }

      const resultArrays = [
        Array.isArray(payload.results) ? payload.results : [],
        Array.isArray(
          this.record(this.record(payload.nativeResponse).output).results,
        )
          ? (this.record(this.record(payload.nativeResponse).output)
              .results as unknown[])
          : [],
      ];
      for (const rawResult of resultArrays.flat()) {
        const result = this.record(rawResult);
        const target = this.text(
          result.targetName || result.target || result.targetId,
        ).trim();
        if (!target) continue;
        const status = this.text(result.status).trim().toLowerCase();
        if (
          result.ok === true ||
          status === 'success' ||
          status === 'completed'
        ) {
          complete(target);
        } else if (status === 'skipped') {
          if (!outcome.completed.has(target)) outcome.skipped.add(target);
        } else if (status) {
          fail(
            target,
            this.text(result.message || result.error).trim() ||
              '该对象执行失败。',
          );
        }
        addEvidence(target, event, result);
      }
    }
    return outcome;
  }

  private hasBatchOutcome(outcome: BatchOutcome) {
    return Boolean(
      outcome.noTarget ||
      outcome.completed.size ||
      outcome.failed.size ||
      outcome.skipped.size ||
      outcome.pending.size,
    );
  }

  private async settleBatchOutcome(
    row: StoredTask,
    agentEvents: AgentSSidecarEvent[],
    outcome: BatchOutcome,
    requestedStatus:
      'COMPLETED' | 'FAILED' | 'BLOCKED' | 'PAUSED' | 'NO_TARGET',
    reason: string,
    now: Date,
    refs: string[] = [],
  ) {
    const task = this.record(row.config);
    const baseTargets = Array.isArray(row.batchTargets)
      ? row.batchTargets
      : Array.isArray(task.batchTargets)
        ? task.batchTargets
        : [];
    const targets = baseTargets
      .filter((item): item is Record<string, unknown> =>
        Boolean(item && typeof item === 'object' && !Array.isArray(item)),
      )
      .map((item) => ({ ...item }));
    const outcomeNames = Array.from(
      new Set([
        ...outcome.completed,
        ...outcome.failed.keys(),
        ...outcome.skipped,
        ...outcome.pending,
      ]),
    );
    if (
      this.text(task.type) === 'wechat-friend-accept' &&
      outcomeNames.length > 0
    ) {
      for (let index = targets.length - 1; index >= 0; index -= 1) {
        if (
          /新的好友申请|好友申请扫描/.test(this.text(targets[index].targetName))
        ) {
          targets.splice(index, 1);
        }
      }
    }
    const knownNames = new Set(
      targets
        .map((target) => this.text(target.targetName).trim())
        .filter(Boolean),
    );
    const template = targets[0] || {};
    for (const [index, targetName] of outcomeNames.entries()) {
      if (knownNames.has(targetName)) continue;
      targets.push({
        ...template,
        id: `agent-s-target-${index + 1}-${row.id}`,
        targetName,
        sourceText: this.text(template.sourceText || task.sourceText),
        replyText: this.text(template.replyText || task.replyText),
        status: 'queued',
      });
      knownNames.add(targetName);
    }

    const effectiveStatus = outcome.noTarget
      ? 'NO_TARGET'
      : requestedStatus === 'COMPLETED' &&
          (outcome.failed.size > 0 ||
            outcome.pending.size > 0 ||
            outcome.skipped.size > 0)
        ? outcome.failed.size > 0
          ? 'FAILED'
          : 'BLOCKED'
        : requestedStatus;
    const updatedAt = now.toISOString();
    const onlyTarget = targets.length === 1 ? targets[0] : null;
    for (const target of targets) {
      const targetName = this.text(target.targetName).trim();
      const targetEvidence = outcome.evidenceByTarget.get(targetName) || [];
      if (outcome.noTarget) {
        target.status = 'no_target';
        target.failureReason = '没有符合筛选条件的待处理对象。';
      } else if (outcome.completed.has(targetName)) {
        target.status = 'completed';
        delete target.failureReason;
      } else if (outcome.failed.has(targetName)) {
        target.status = 'failed';
        target.failureReason = outcome.failed.get(targetName);
      } else if (outcome.skipped.has(targetName)) {
        target.status = 'skipped';
        target.failureReason = '该对象按规则跳过。';
      } else if (
        effectiveStatus === 'COMPLETED' &&
        onlyTarget === target &&
        refs.length > 0
      ) {
        target.status = 'completed';
        delete target.failureReason;
      } else if (effectiveStatus === 'FAILED') {
        target.status = 'failed';
        target.failureReason = reason;
      } else {
        target.status = 'queued';
        delete target.failureReason;
      }
      target.updatedAt = updatedAt;
      if (targetEvidence.length) {
        target.evidenceEventIds = Array.from(
          new Set([
            ...(Array.isArray(target.evidenceEventIds)
              ? (target.evidenceEventIds as string[])
              : []),
            ...targetEvidence,
          ]),
        );
        target.evidenceRef = targetEvidence[0];
      }
      target.nextAction =
        target.status === 'failed'
          ? '查看该对象证据和失败原因后单独重试。'
          : target.status === 'queued'
            ? '恢复任务后继续处理该对象。'
            : target.status === 'completed'
              ? '该对象已有独立执行结果和证据。'
              : '该对象未执行发送。';
    }
    const batchSummary = this.batchSummary(targets);
    const eventLevel =
      effectiveStatus === 'COMPLETED' || effectiveStatus === 'NO_TARGET'
        ? 'info'
        : effectiveStatus === 'FAILED'
          ? 'error'
          : 'warning';
    const events = this.appendEvent(row.events, {
      level: eventLevel,
      message: reason,
      stageKey: 'agent-s-target-results',
      evidence: refs,
    });
    const statusView = {
      COMPLETED: {
        status: 'completed',
        label: '已完成',
        planStatus: 'completed',
        runtimeState: 'completed',
        nextAction: '可查看每个对象的执行结果和独立证据。',
      },
      FAILED: {
        status: 'failed',
        label: '失败',
        planStatus: 'failed',
        runtimeState: 'blocked',
        nextAction: '仅重试失败或未完成对象，不会重发已成功对象。',
      },
      BLOCKED: {
        status: 'blocked',
        label: '需要处理',
        planStatus: 'failed',
        runtimeState: 'blocked',
        nextAction: '修复阻断后仅继续未完成对象。',
      },
      PAUSED: {
        status: 'paused',
        label: '已暂停',
        planStatus: 'paused',
        runtimeState: 'blocked',
        nextAction: '恢复后只处理尚未完成的对象。',
      },
      NO_TARGET: {
        status: 'no_target',
        label: '无可处理对象',
        planStatus: 'completed',
        runtimeState: 'completed',
        nextAction: '没有匹配的测试对象，本次未执行微信写入。',
      },
    }[effectiveStatus];
    const completedAt = [
      'COMPLETED',
      'FAILED',
      'BLOCKED',
      'NO_TARGET',
    ].includes(effectiveStatus)
      ? updatedAt
      : undefined;
    await this.prisma.interactionTask.update({
      where: this.scopedWhere(row),
      data: {
        sessionId: null,
        status: effectiveStatus,
        stage: 'agent-s-target-results',
        currentTarget: null,
        processedCount: batchSummary.completed,
        failedCount: batchSummary.failed,
        skippedCount: batchSummary.skipped + batchSummary.noTarget,
        batchTargets: targets as unknown as Prisma.InputJsonValue,
        batchSummary: batchSummary,
        events: events,
        config: {
          ...task,
          status: statusView.status,
          statusLabel: statusView.label,
          planStatus: statusView.planStatus,
          runtimeState: statusView.runtimeState,
          sessionId: undefined,
          batchTargets: targets,
          batchSummary,
          failureReason:
            effectiveStatus === 'FAILED' || effectiveStatus === 'BLOCKED'
              ? reason
              : undefined,
          nextAction: statusView.nextAction,
          completedAt,
          updatedAt,
          events,
          agentSEvents: agentEvents.slice(-100),
          readbackRefs: Array.from(
            new Set([...this.stringList(task.readbackRefs), ...refs]),
          ),
        } as unknown as Prisma.InputJsonValue,
      },
    });
  }

  private batchSummary(targets: Array<Record<string, unknown>>) {
    const count = (status: string) =>
      targets.filter((target) => this.text(target.status) === status).length;
    return {
      total: targets.length,
      queued: count('queued'),
      running: count('running'),
      waitingConfirmation: count('waiting_confirmation'),
      completed: count('completed'),
      failed: count('failed'),
      skipped: count('skipped'),
      noTarget: count('no_target'),
    };
  }

  private async finishWithoutSend(
    row: StoredTask,
    task: Record<string, unknown>,
    status: 'FAILED' | 'BLOCKED',
    reason: string,
    nextAction: string,
  ) {
    const now = new Date().toISOString();
    const events = this.appendEvent(row.events, {
      level: status === 'FAILED' ? 'error' : 'warning',
      message: reason,
      stageKey: 'agent-s-scheduled-result',
    });
    await this.prisma.interactionTask.update({
      where: this.scopedWhere(row),
      data: {
        status,
        stage: 'agent-s-scheduled-result',
        events: events,
        config: {
          ...task,
          status: status === 'FAILED' ? 'failed' : 'blocked',
          statusLabel: status === 'FAILED' ? '失败' : '需要处理',
          planStatus: 'failed',
          runtimeState: 'blocked',
          failureReason: reason,
          nextAction,
          completedAt: now,
          updatedAt: now,
          events,
        },
      },
    });
  }

  private scheduledAt(task: Record<string, unknown>) {
    const nextMomentsItem = this.nextPendingMomentsItem(task);
    if (nextMomentsItem) {
      return (
        this.date(nextMomentsItem.detail.scheduledPublishTime) ||
        this.date(nextMomentsItem.detail.scheduledAt) ||
        new Date(0)
      );
    }
    const metadata = this.record(task.metadata);
    return this.date(
      task.planTime ||
        metadata.scheduledAt ||
        metadata.scheduleStartTime ||
        metadata.wechat_plan_schedule_start_time ||
        metadata.wechat_moments_schedule_start_time,
    );
  }

  private momentsDetails(task: Record<string, unknown>) {
    const metadata = this.record(task.metadata);
    const value = Array.isArray(metadata.wechat_moments_details)
      ? metadata.wechat_moments_details
      : Array.isArray(metadata.momentsDetails)
        ? metadata.momentsDetails
        : [];
    return value
      .filter((item): item is Record<string, unknown> =>
        Boolean(item && typeof item === 'object' && !Array.isArray(item)),
      )
      .map((item) => ({ ...item }));
  }

  private isTerminalMomentsStatus(value: unknown) {
    return ['completed', 'failed', 'skipped'].includes(this.text(value));
  }

  private nextPendingMomentsItem(task: Record<string, unknown>) {
    if (this.text(task.type) !== 'wechat-moments-publish') return undefined;
    return this.momentsDetails(task)
      .map((detail, index) => ({
        detail,
        index,
        target:
          this.text(detail.targetName).trim() || `朋友圈明细 ${index + 1}`,
        scheduledAt:
          this.date(detail.scheduledPublishTime) ||
          this.date(detail.scheduledAt) ||
          new Date(0),
      }))
      .filter((item) => !this.isTerminalMomentsStatus(item.detail.status))
      .sort(
        (left, right) =>
          left.scheduledAt.getTime() - right.scheduledAt.getTime() ||
          left.index - right.index,
      )[0];
  }

  private nextDueMomentsItem(task: Record<string, unknown>, now: Date) {
    const next = this.nextPendingMomentsItem(task);
    return next && next.scheduledAt.getTime() <= now.getTime()
      ? next
      : undefined;
  }

  private buildMomentsItemMetadata(
    metadata: Record<string, unknown>,
    detail: Record<string, unknown>,
  ) {
    const content = this.text(
      detail.content || detail.sendContent || detail.replyText,
    ).trim();
    const attachments = this.stringList(
      detail.attachments || detail.assetPaths,
    );
    const assetPath =
      attachments.join('\n') || this.text(detail.assetPath).trim();
    const visibility = this.text(detail.visibility).trim() || 'public';
    const additionalComment = this.text(
      detail.additionalComment || detail.comment,
    ).trim();
    return {
      ...metadata,
      wechat_moments_details: [{ ...detail }],
      momentsDetails: [{ ...detail }],
      wechat_moments_content: content,
      wechat_moments_asset_path: assetPath,
      wechat_moments_additional_comment: additionalComment,
      wechat_moments_visibility: visibility,
      wechat_moments_visibility_code: visibility,
    };
  }

  private hasTenantScope(row: StoredTask) {
    return Boolean(row.tenantId?.trim() && row.userId?.trim());
  }

  private scopedWhere(row: StoredTask) {
    return {
      id: row.id,
      tenantId: row.tenantId,
      userId: row.userId,
    };
  }

  private activeKey(row: StoredTask) {
    return `${row.tenantId}\u0000${row.userId}\u0000${row.id}`;
  }

  private date(value: unknown) {
    if (!value) return undefined;
    const date = new Date(this.text(value));
    return Number.isFinite(date.getTime()) ? date : undefined;
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private stringList(value: unknown) {
    return Array.isArray(value)
      ? value.map((item) => this.text(item).trim()).filter(Boolean)
      : [];
  }

  private text(value: unknown) {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    return '';
  }

  private riskLevel(value: unknown): 'low' | 'medium' | 'high' {
    return value === 'low' || value === 'high' ? value : 'medium';
  }

  private appendEvent(
    value: unknown,
    input: {
      level: 'info' | 'warning' | 'error';
      message: string;
      stageKey: string;
      evidence?: string[];
    },
  ) {
    const events = Array.isArray(value) ? value : [];
    return [
      ...events,
      {
        id: `scheduler-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        level: input.level,
        message: input.message,
        createdAt: new Date().toISOString(),
        evidence: input.evidence?.length
          ? {
              type: 'text',
              label: '发送结果',
              value: input.evidence.join('\n'),
              stageKey: input.stageKey,
            }
          : {
              type: 'stage_log',
              label: '计划状态',
              value: input.message,
              stageKey: input.stageKey,
            },
      },
    ].slice(-200);
  }
}
