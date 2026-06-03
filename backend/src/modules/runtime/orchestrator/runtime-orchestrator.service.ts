/**
 * RuntimeOrchestrator · Runtime 统一入口（薄壳 wrapper）
 *
 * 详见 docs/adr/001-executor-router-capability-interface.md §4
 * 配合 P3-D1 的"切上层 + 双跑"使用
 *
 * 职责：
 * 1. 把 ExecutorRouter.route() 包装成上层友好的单一入口
 * 2. 不做业务逻辑——所有路由决策都委派给 ExecutorRouter
 * 3. 不持久化、不调度——EvidenceService 已在 ExecutorRouter.route() 末尾自动触发
 * 4. P3-D1 阶段：作为"切换目标"存在；上层 caller 仍走 LocalEngineService
 * 5. P3-D1 实际切换：把 LocalEngineService 中穿透到 LocalInteractionExecutorService
 *    的方法逐步改成调本 service（按调用点一个个切，per-call hard switch）
 *
 * 设计：
 * - 故意保持极薄：P2 已经把路由/证据/护栏全部内化到 ExecutorRouter
 * - 任何额外业务逻辑都应放在 ExecutorRouter 或 Executor 内部，而非此处
 */

import { Injectable, Logger } from '@nestjs/common';
import { ExecutorRouter } from '../executor-router';
import {
  type ExecutorContext,
  type ExecutorTask,
  type RuntimeExecutionResult,
} from '../executor.interface';

@Injectable()
export class RuntimeOrchestrator {
  private readonly logger = new Logger(RuntimeOrchestrator.name);

  constructor(private readonly router: ExecutorRouter) {}

  /**
   * 执行单个互动任务。
   *
   * 等价于直接调 ExecutorRouter.route()——P2-D4 后 ExecutorRouter 已自动
   * 调 EvidenceService 持久化，调用方无需额外关心。
   *
   * @returns 总是返回 RuntimeExecutionResult，不抛异常。
   */
  async execute(
    task: ExecutorTask,
    ctx: ExecutorContext,
  ): Promise<RuntimeExecutionResult> {
    this.logger.debug(
      `RuntimeOrchestrator.execute: task=${task.relatedId} platform=${task.platform} type=${task.type}`,
    );
    return this.router.route(task, ctx);
  }

  /**
   * 健康检查所有已注册执行器。
   * 薄包装，方便上层一个方法拿到所有执行器状态。
   */
  async healthCheck(): Promise<
    Array<{ id: string; ok: boolean; details?: string }>
  > {
    return this.router.healthCheck();
  }
}
