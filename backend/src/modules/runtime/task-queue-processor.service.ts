/**
 * TaskQueueProcessor · 任务队列处理器（worker）
 *
 * 2026-06-04 补：原系统建任务后状态 = "queued" 但没有任何 worker 取任务执行。
 * 这里用 setInterval 每 2s 扫一次 queued 任务，调 RuntimeOrchestrator.execute()
 * 触发真实 CDP 流程（抖音/视频号评论/私信）。
 *
 * 设计：
 * 1. 单 worker 单线程（用 isProcessing 锁避免并发执行同一 task）
 * 2. 失败 / blocked / paused 状态的任务不处理
 * 3. local-engine 已有 concurrency 控制（同一 accountId 同时只跑一个）
 * 4. DISPATCH_MOCK=true 时跳过真实 CDP
 */

import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RuntimeOrchestrator } from './orchestrator/runtime-orchestrator.service';
import { LocalEngineService } from '../local-engine/local-engine.service';
import {
  type ExecutorContext,
  type ExecutorTask,
  type RuntimeExecutionResult,
} from './executor.interface';

@Injectable()
export class TaskQueueProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TaskQueueProcessor.name);
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private isProcessing = false;
  private readonly tickMs: number;
  private readonly mockMode = process.env.DISPATCH_MOCK === 'true';
  private readonly autoStart: boolean;
  private readonly processExistingQueued: boolean;
  private readonly startedAt = Date.now();
  private lastTickAt: string | null = null;
  private lastSuccessAt: string | null = null;
  private lastErrorAt: string | null = null;
  private lastError: string | null = null;
  private consecutiveFailures = 0;

  constructor(
    private readonly config: ConfigService,
    private readonly orchestrator: RuntimeOrchestrator,
    private readonly engine: LocalEngineService,
    private readonly prisma: PrismaService,
    private readonly authRequestContext: AuthRequestContextService,
  ) {
    const configuredTickMs = Number(
      this.config.get<string>('TASK_QUEUE_TICK_MS') || 2000,
    );
    this.tickMs = Number.isFinite(configuredTickMs)
      ? Math.max(250, configuredTickMs)
      : 2000;
    this.autoStart =
      (this.config.get<string>('TASK_QUEUE_AUTOSTART') || 'true')
        .trim()
        .toLowerCase() !== 'false';
    this.processExistingQueued =
      (this.config.get<string>('TASK_QUEUE_PROCESS_EXISTING') || 'false')
        .trim()
        .toLowerCase() === 'true';
  }

  onModuleInit(): void {
    if (this.intervalHandle) return;
    if (!this.autoStart) {
      this.logger.log('TaskQueueProcessor autostart disabled');
      return;
    }
    this.logger.log(
      `TaskQueueProcessor started (tick=${this.tickMs}ms, mock=${this.mockMode}, processExisting=${this.processExistingQueued})`,
    );
    this.intervalHandle = setInterval(() => {
      this.tick().catch((e) =>
        this.logger.error(`tick error: ${e instanceof Error ? e.message : e}`),
      );
    }, this.tickMs);
  }

  onModuleDestroy(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  getHealth() {
    const running = this.intervalHandle !== null;
    const staleAfterMs = Math.max(this.tickMs * 3, 10_000);
    const lastTickTime = this.lastTickAt ? Date.parse(this.lastTickAt) : NaN;
    const stale =
      this.autoStart &&
      running &&
      !this.isProcessing &&
      (Number.isFinite(lastTickTime)
        ? Date.now() - lastTickTime > staleAfterMs
        : Date.now() - this.startedAt > staleAfterMs);
    const ok =
      !this.autoStart || (running && this.consecutiveFailures === 0 && !stale);
    const status = !this.autoStart
      ? ('disabled' as const)
      : !running
        ? ('stopped' as const)
        : this.consecutiveFailures > 0
          ? ('unhealthy' as const)
          : stale
            ? ('stale' as const)
            : this.lastSuccessAt
              ? ('healthy' as const)
              : ('starting' as const);

    return {
      ok,
      enabled: this.autoStart,
      running,
      processing: this.isProcessing,
      processExisting: this.processExistingQueued,
      tickMs: this.tickMs,
      status,
      safetyStatus: this.autoStart
        ? this.processExistingQueued
          ? ('drain-existing' as const)
          : ('new-tasks-only' as const)
        : ('closed' as const),
      lastTickAt: this.lastTickAt,
      lastSuccessAt: this.lastSuccessAt,
      lastErrorAt: this.lastErrorAt,
      failureReason: this.lastError ? ('worker-tick-failed' as const) : null,
      consecutiveFailures: this.consecutiveFailures,
    };
  }

  private async tick(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;
    this.lastTickAt = new Date().toISOString();
    try {
      const queuedRows = await this.prisma.interactionTask.findMany({
        where: { status: 'QUEUED' },
        orderBy: { updatedAt: 'desc' },
        take: 20,
        select: {
          id: true,
          tenantId: true,
          userId: true,
          taskType: true,
          config: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      const queued = queuedRows
        .map((row) => {
          const config = (row.config || {}) as Record<string, unknown>;
          return {
            ...row,
            type: String(config.type || row.taskType || ''),
            executionMode: String(config.executionMode || ''),
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
          };
        })
        .filter((task) => task.executionMode !== 'browser-assisted')
        .filter((task) => this.shouldDispatchQueuedTask(task));
      if (!queued.length) {
        this.markTickSucceeded();
        return;
      }
      this.logger.log(`[queue] picked up ${queued.length} queued task(s)`);
      const dispatchErrors: string[] = [];
      for (const taskSummary of queued.slice(0, 3)) {
        try {
          await this.authRequestContext.run(
            {
              requestedTenantId: taskSummary.tenantId,
              user: {
                id: taskSummary.userId,
                kaypalLocalOnly:
                  taskSummary.tenantId ===
                  `local-desktop:${taskSummary.userId}`,
              },
            },
            async () => {
              const task = await this.engine.getTask(taskSummary.id);
              await this.dispatchOne(task);
            },
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          dispatchErrors.push(`${taskSummary.id}: ${message}`);
          this.logger.error(
            `dispatch failed for task ${taskSummary.id}: ${message}`,
          );
        }
      }
      if (dispatchErrors.length) {
        throw new Error(
          `${dispatchErrors.length} queued task(s) failed: ${dispatchErrors[0]}`,
        );
      }
      this.markTickSucceeded();
    } catch (error) {
      this.lastErrorAt = new Date().toISOString();
      this.lastError = error instanceof Error ? error.message : String(error);
      this.consecutiveFailures += 1;
      throw error;
    } finally {
      this.isProcessing = false;
    }
  }

  private markTickSucceeded(): void {
    this.lastSuccessAt = new Date().toISOString();
    this.lastError = null;
    this.consecutiveFailures = 0;
  }

  private shouldDispatchQueuedTask(task: any): boolean {
    if (this.processExistingQueued) {
      return true;
    }
    const createdAt = Date.parse(
      String(task.createdAt || task.updatedAt || ''),
    );
    if (!Number.isFinite(createdAt)) {
      return false;
    }
    const isNewThisRun = createdAt >= this.startedAt - this.tickMs;
    if (!isNewThisRun) {
      this.logger.warn(
        `skip existing queued task=${task.id} type=${task.type} createdAt=${task.createdAt}; set TASK_QUEUE_PROCESS_EXISTING=true to drain backlog`,
      );
    }
    return isNewThisRun;
  }

  private async dispatchOne(task: any): Promise<RuntimeExecutionResult | null> {
    // local-engine 内部已经把 task 转成 ExecutorTask
    const runtimeInput = this.mapInteractionTaskToRuntimeInput(task);
    if (!runtimeInput) {
      this.logger.warn(
        `no runtime mapping for task ${task.id} type=${task.type}`,
      );
      return null;
    }
    this.logger.log(
      `dispatch task=${task.id} type=${task.type} accountId=${task.accountId} sendMode=${task.sendMode}`,
    );
    const result = await this.orchestrator.execute(
      runtimeInput.task,
      runtimeInput.ctx,
    );
    this.logger.log(
      `dispatch done task=${task.id} ok=${result.ok} message=${(result as any).message?.slice?.(0, 80) ?? ''}`,
    );
    return result;
  }

  private mapInteractionTaskToRuntimeInput(
    task: any,
  ): { task: ExecutorTask; ctx: ExecutorContext } | null {
    return {
      task: {
        relatedId: task.id,
        relatedType: 'interaction-task',
        type: task.type,
        platform: this.inferPlatform(task.type),
        accountId: task.accountId,
        payload: {
          targetName: task.targetName,
          targetText: task.sourceText,
          sourceText: task.sourceText,
          sourceUrl: task.sourceUrl,
          profileUrl: task.profileUrl,
          commentTime: task.commentTime,
          videoTitle: task.videoTitle,
          videoUrl: task.videoUrl,
          engagementScore: task.engagementScore,
          replyText: task.replyText,
          accountName: task.accountName,
          platformType: task.platformType,
          platformName: task.platformName,
        },
      } as ExecutorTask,
      ctx: {
        sendMode: task.sendMode || 'auto-send',
        requestId: task.id,
        traceId: task.id,
        riskContext: {
          ...(task.sendMode === 'auto-send'
            ? { riskLevel: 'low' as const }
            : {}),
        },
        billing: task.billingIdentity
          ? {
              scope: 'task-queue',
              identity: task.billingIdentity,
            }
          : undefined,
      } as ExecutorContext,
    };
  }

  private inferPlatform(
    type: string,
  ): 'douyin' | 'wechat-channel' | 'wechat-desktop' | 'mixed' {
    if (type?.startsWith('douyin')) return 'douyin';
    if (type?.startsWith('wechat-channel')) return 'wechat-channel';
    if (type?.startsWith('wechat')) return 'wechat-desktop';
    return 'mixed';
  }
}
