/**
 * LocalRuntimeClient · 浏览器 CDP 路径执行器
 *
 * 详见 docs/adr/001-executor-router-capability-interface.md §3.1
 *
 * P1 骨架：实现 TaskExecutor 接口但所有方法 stub。
 * P2 实施：内部包装 AutoUploadService，并迁入 5409 浏览器执行能力。
 */

import { Injectable, Logger } from '@nestjs/common';
import { AutoUploadService } from '../auto-upload/auto-upload.service';
import {
  type ExecutorCapability,
  type ExecutorContext,
  type ExecutorTask,
  type RuntimeExecutionResult,
  type TaskExecutor,
  rejectResult,
} from './executor.interface';

@Injectable()
export class LocalRuntimeClient implements TaskExecutor {
  readonly id = 'local-runtime' as const;

  private readonly logger = new Logger(LocalRuntimeClient.name);

  constructor(private readonly autoUpload: AutoUploadService) {}

  canHandle(task: ExecutorTask): ExecutorCapability {
    // P1 骨架：全部拒绝。P2 实施时按 task.platform / task.type 决定。
    if (task.platform === 'wechat-desktop') {
      return {
        ok: false,
        priority: 0,
        reason: 'local-runtime 不处理桌面任务，桌面任务应命中 agent-s',
      };
    }

    return {
      ok: false,
      priority: 0,
      reason:
        'P1 骨架阶段，所有任务暂不路由到 local-runtime（仍走 LocalInteractionExecutorService）',
    };
  }

  execute(
    task: ExecutorTask,
    ctx: ExecutorContext,
  ): Promise<RuntimeExecutionResult> {
    this.logger.warn(
      `LocalRuntimeClient.execute called in P1 skeleton phase for task ${task.relatedId} (${task.type}, sendMode=${ctx.sendMode}); returning runtime_unavailable`,
    );

    return Promise.resolve(
      rejectResult(
        'runtime_unavailable',
        'Local Runtime 尚未实现，请等待 P2 迁移完成',
        `P1 skeleton: task type ${task.type} on platform ${task.platform}`,
      ),
    );
  }

  async isHealthy(): Promise<{ ok: boolean; details?: string }> {
    // P1：透传 AutoUploadService 健康检查
    try {
      const health = await this.autoUpload.getHealth();
      return {
        ok: Boolean(health?.online),
        details: health
          ? `AutoUpload status=${health.status} version=${health.version} engineUrl=${health.engineUrl}`
          : 'AutoUpload health unknown',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        details: `AutoUpload health check failed: ${message}`,
      };
    }
  }
}
