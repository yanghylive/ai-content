/**
 * ExecutorRouter · 任务执行路由器
 *
 * 详见 docs/adr/001-executor-router-capability-interface.md §2.2
 *
 * 职责：
 * 1. 调用各注册执行器的 canHandle()，按优先级选择
 * 2. 强制护栏：wechat-desktop 任务必须命中 agent-s
 * 3. 没有可用执行器时返回 runtime_unavailable，不抛异常
 * 4. P2-D4：route() 完成后通过 EvidenceService 持久化执行结果
 *    （fire-and-forget，证据写失败不影响 task 返回）
 *
 * P1 骨架：仅注入 LocalRuntimeClient；AgentSService 在 P2 wire-up
 * （避免 LocalEngineModule ↔ RuntimeModule 循环依赖，P2 用 forwardRef 处理）。
 */

import { Injectable, Logger } from '@nestjs/common';
import { AgentSExecutorAdapter } from './agent-s-adapter';
import { EvidenceService } from './evidence/evidence.service';
import { LocalRuntimeClient } from './local-runtime.client';
import { PlatformPublishService } from './platforms/publishing/platform-publish.service';
import { VideoFaceSwapService } from './platforms/video/video-face-swap.service';
import { VideoTemplateClipService } from './platforms/video/video-template-clip.service';
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
   * 已注册执行器。
   *
   * P1 仅 local-runtime（agent-s-adapter 在 P2 D4 加入）。
   * P2 D4：加入 agent-s-adapter。
   */
  private readonly executors: TaskExecutor[];

  constructor(
    private readonly localRuntime: LocalRuntimeClient,
    private readonly platformPublish: PlatformPublishService,
    private readonly videoFaceSwap: VideoFaceSwapService,
    private readonly videoTemplateClip: VideoTemplateClipService,
    private readonly agentSAdapter: AgentSExecutorAdapter,
    private readonly evidence: EvidenceService,
  ) {
    this.executors = [
      this.localRuntime,
      this.platformPublish,
      this.videoFaceSwap,
      this.videoTemplateClip,
      this.agentSAdapter,
    ];
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
    let result: RuntimeExecutionResult;

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
      result = rejectResult(
        'runtime_unavailable',
        '没有可用的执行器处理本任务',
        reasons,
      );
    } else {
      const chosen = candidates[0].executor;

      // 强制护栏：桌面任务必须命中 agent-s
      if (task.platform === 'wechat-desktop' && chosen.id !== 'agent-s') {
        this.logger.error(
          `Routing guardrail violation: wechat-desktop task ${task.relatedId} was about to route to ${chosen.id}; rejecting`,
        );
        result = rejectResult(
          'agent_s_unavailable',
          '微信桌面任务必须经 Agent-S 执行，本次路由错配已拒绝',
          `Task ${task.relatedId} platform=wechat-desktop chosen=${chosen.id}`,
        );
      } else {
        this.logger.debug(
          `Routing task ${task.relatedId} (${task.type}/${task.platform}) to executor ${chosen.id}`,
        );

        try {
          result = await chosen.execute(task, ctx);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Executor ${chosen.id} threw for task ${task.relatedId}: ${message}`,
          );
          result = rejectResult(
            chosen.id === 'agent-s'
              ? 'agent_s_unavailable'
              : 'runtime_unavailable',
            '执行器内部错误',
            message,
          );
        }
      }
    }

    // P2-D4：所有路径都把执行结果持久化（fire-and-forget）
    // 写失败不影响 task 返回（EvidenceService.recordExecutionFireAndForget 不抛）
    // 防御性 try/catch：万一 EvidenceService 实现 bug 自身抛错，也不污染 task 返回
    try {
      this.evidence.recordExecutionFireAndForget(
        {
          relatedId: task.relatedId,
          relatedType: task.relatedType,
          platform: task.platform,
          taskType: task.type,
          accountId: task.accountId,
        },
        result,
      );
    } catch (error) {
      this.logger.error(
        `EvidenceService.recordExecutionFireAndForget threw (should not happen): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return result;
  }

  /**
   * 健康检查所有已注册执行器 + 4 个 platform sub-services。
   * local-runtime 还内嵌 4 个 platform service（douyin-comment-reply 等），
   * 这些也算独立执行能力，UI 端要看到完整 7 个。
   */
  async healthCheck(): Promise<
    Array<{ id: string; ok: boolean; details?: string }>
  > {
    const mainHealths = await Promise.all(
      this.executors.map(async (executor) => {
        const health = await executor.isHealthy();
        return { id: executor.id, ...health };
      }),
    );

    const localRuntime = this.executors.find((e) => e.id === 'local-runtime');

    let subHealths: Array<{ id: string; ok: boolean; details?: string }> = [];
    const localRuntimeHealths = (
      localRuntime as unknown as {
        getPlatformHealths?: () => Promise<
          Array<{ id: string; ok: boolean; details?: string }>
        >;
      }
    ).getPlatformHealths;
    if (localRuntime && typeof localRuntimeHealths === 'function') {
      try {
        subHealths = await localRuntimeHealths();
      } catch (error) {
        this.logger.warn(
          `getPlatformHealths failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return [...mainHealths, ...subHealths];
  }
}
