/**
 * ExecutorRouter · 任务执行路由器
 *
 * 详见 docs/adr/001-executor-router-capability-interface.md §2.2
 *
 * 职责：
 * 1. 调用各注册执行器的 canHandle()，按优先级选择
 * 2. 强制护栏：wechat-desktop 任务必须命中 agent-s
 * 3. 没有可用执行器时返回 runtime_unavailable，不抛异常
 *
 * P1 骨架：仅注入 LocalRuntimeClient；AgentSService 在 P2 wire-up
 * （避免 LocalEngineModule ↔ RuntimeModule 循环依赖，P2 用 forwardRef 处理）。
 */

import { Injectable, Logger } from '@nestjs/common';
import { LocalRuntimeClient } from './local-runtime.client';
import {
  type ExecutorContext,
  type ExecutorTask,
  type RuntimeExecutionResult,
  type TaskExecutor,
  rejectResult,
} from './executor.interface';

@Injectable()
export class ExecutorRouter {
  private readonly logger = new Logger(ExecutorRouter.name);

  /**
   * 已注册执行器。P1 仅 local-runtime；P2 加 agent-s。
   */
  private readonly executors: TaskExecutor[];

  constructor(private readonly localRuntime: LocalRuntimeClient) {
    this.executors = [this.localRuntime];
  }

  /**
   * 路由任务到可用执行器。
   *
   * @returns 总是返回 RuntimeExecutionResult，不抛异常。
   */
  async route(
    task: ExecutorTask,
    ctx: ExecutorContext,
  ): Promise<RuntimeExecutionResult> {
    const candidates = this.executors
      .map((executor) => ({ executor, capability: executor.canHandle(task) }))
      .filter((c) => c.capability.ok)
      .sort((a, b) => b.capability.priority - a.capability.priority);

    if (candidates.length === 0) {
      const reasons = this.executors
        .map((e) => {
          const cap = e.canHandle(task);
          return `${e.id}: ${cap.reason ?? 'no reason'}`;
        })
        .join('; ');
      this.logger.warn(
        `No executor for task ${task.relatedId} (${task.type}/${task.platform}); reasons: ${reasons}`,
      );
      return rejectResult(
        'runtime_unavailable',
        '没有可用的执行器处理本任务',
        reasons,
      );
    }

    const chosen = candidates[0].executor;

    // 强制护栏：桌面任务必须命中 agent-s
    if (task.platform === 'wechat-desktop' && chosen.id !== 'agent-s') {
      this.logger.error(
        `Routing guardrail violation: wechat-desktop task ${task.relatedId} was about to route to ${chosen.id}; rejecting`,
      );
      return rejectResult(
        'agent_s_unavailable',
        '微信桌面任务必须经 Agent-S 执行，本次路由错配已拒绝',
        `Task ${task.relatedId} platform=wechat-desktop chosen=${chosen.id}`,
      );
    }

    this.logger.debug(
      `Routing task ${task.relatedId} (${task.type}/${task.platform}) to executor ${chosen.id}`,
    );

    try {
      return await chosen.execute(task, ctx);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Executor ${chosen.id} threw for task ${task.relatedId}: ${message}`,
      );
      return rejectResult(
        chosen.id === 'agent-s' ? 'agent_s_unavailable' : 'runtime_unavailable',
        '执行器内部错误',
        message,
      );
    }
  }

  /**
   * 健康检查所有已注册执行器。
   */
  async healthCheck(): Promise<
    Array<{ id: string; ok: boolean; details?: string }>
  > {
    const results = await Promise.all(
      this.executors.map(async (executor) => {
        const health = await executor.isHealthy();
        return { id: executor.id, ...health };
      }),
    );
    return results;
  }
}
