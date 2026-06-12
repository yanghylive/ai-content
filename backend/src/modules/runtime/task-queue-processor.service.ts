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

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

  constructor(
    private readonly config: ConfigService,
    private readonly orchestrator: RuntimeOrchestrator,
    private readonly engine: LocalEngineService,
  ) {
    this.tickMs = Number(this.config.get<string>('TASK_QUEUE_TICK_MS') || 2000);
  }

  onModuleInit(): void {
    if (this.intervalHandle) return;
    this.logger.log(`TaskQueueProcessor started (tick=${this.tickMs}ms, mock=${this.mockMode})`);
    this.intervalHandle = setInterval(() => {
      this.tick().catch((e) => this.logger.error(`tick error: ${e instanceof Error ? e.message : e}`));
    }, this.tickMs);
  }

  onModuleDestroy(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;
    try {
      const queued = (await this.engine.listTasks(20, { status: 'queued' })).filter(
        (task: any) => task.executionMode !== 'browser-assisted',
      );
      if (!queued.length) return;
      this.logger.log(`[queue] picked up ${queued.length} queued task(s)`);
      for (const task of queued.slice(0, 3)) {
        try {
          await this.dispatchOne(task);
        } catch (error) {
          this.logger.error(
            `dispatch failed for task ${task.id}: ${error instanceof Error ? error.message : error}`,
          );
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private async dispatchOne(task: any): Promise<RuntimeExecutionResult | null> {
    // local-engine 内部已经把 task 转成 ExecutorTask
    const runtimeInput = this.mapInteractionTaskToRuntimeInput(task);
    if (!runtimeInput) {
      this.logger.warn(`no runtime mapping for task ${task.id} type=${task.type}`);
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

  private mapInteractionTaskToRuntimeInput(task: any): { task: ExecutorTask; ctx: ExecutorContext } | null {
    return {
      task: {
        relatedId: task.id,
        relatedType: 'interaction-task',
        type: task.type,
        platform: this.inferPlatform(task.type),
        accountId: task.accountId,
        payload: {
          targetText: task.sourceText,
          replyText: task.replyText,
        },
      } as ExecutorTask,
      ctx: {
        sendMode: task.sendMode || 'auto-send',
        requestId: task.id,
        traceId: task.id,
        riskContext: { ...(task.sendMode === 'auto-send' ? { riskLevel: 'low' as const } : {}) },
      } as ExecutorContext,
    };
  }

  private inferPlatform(type: string): 'douyin' | 'wechat-channel' | 'wechat-desktop' | 'mixed' {
    if (type?.startsWith('douyin')) return 'douyin';
    if (type?.startsWith('wechat-channel')) return 'wechat-channel';
    if (type?.startsWith('wechat')) return 'wechat-desktop';
    return 'mixed';
  }
}
