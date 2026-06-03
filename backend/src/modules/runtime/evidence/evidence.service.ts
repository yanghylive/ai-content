/**
 * EvidenceService · Runtime 执行证据持久化
 *
 * 详见 docs/adr/002-copy-first-migration-strategy.md §5 P2-D3
 *
 * 职责：
 * 1. 把 RuntimeExecutionResult 写入 runtime_executions 表
 * 2. 异步 + 失败降级：写失败不抛异常，只记日志；调用方拿到 failed 状态自行降级
 * 3. P2-D3 阶段：单进程 fire-and-forget（无 Bull/Redis 队列依赖）
 * 4. 后续 P3 可替换为 Bull/Redis，不影响 API 形状
 *
 * 关键设计：
 * - recordExecution 返 { persisted, executionId?, error? } 而非抛
 * - 提供 recordExecutionSync 给需要同步等待的 caller
 * - 内置序列化：runtimeJson / evidenceJson 整个对象
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import type { RuntimeExecutionResult } from '../executor.interface';

export type RecordExecutionOutcome =
  | { status: 'persisted'; executionId: string; durationMs: number }
  | { status: 'failed'; error: string; durationMs: number }
  | { status: 'invalid'; reason: string };

export type RecordExecutionInput = {
  relatedId: string;
  relatedType: 'interaction-task' | 'agent-session';
  platform: string;
  taskType: string;
  accountId?: number;
};

@Injectable()
export class EvidenceService {
  private readonly logger = new Logger(EvidenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 异步持久化执行结果。
   * 不抛异常——写失败返 { status: 'failed' } 让调用方决定如何处理。
   *
   * @param input 来源任务信息
   * @param result Executor 返的 RuntimeExecutionResult
   */
  async recordExecution(
    input: RecordExecutionInput,
    result: RuntimeExecutionResult,
  ): Promise<RecordExecutionOutcome> {
    if (!input.relatedId) {
      return { status: 'invalid', reason: 'relatedId 不能为空' };
    }

    const startedAt = Date.now();
    try {
      const created = await this.prisma.runtimeExecution.create({
        data: {
          relatedId: input.relatedId,
          relatedType: input.relatedType,
          executor: result.runtime.mode,
          platform: input.platform,
          taskType: input.taskType,
          accountId: input.accountId ?? null,
          ok: result.ok,
          status: result.status,
          reasonCode: result.reasonCode,
          userMessage: result.userMessage,
          technicalMessage: result.technicalMessage ?? null,
          runtimeJson: result.runtime as unknown as object,
          evidenceJson: result.evidence as unknown as object,
          readbackJson: (result.readback as unknown as object) ?? null,
          agentSSessionId: result.runtime.agentSSessionId ?? null,
          engineUrl: result.runtime.engineUrl ?? null,
        },
      });
      return {
        status: 'persisted',
        executionId: created.id,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `RuntimeExecution 持久化失败: relatedId=${input.relatedId} err=${message}`,
      );
      return {
        status: 'failed',
        error: message,
        durationMs: Date.now() - startedAt,
      };
    }
  }

  /**
   * Fire-and-forget 写入。不返值，不 await。
   * 用于"任务执行完了，证据后台持久化，调用方不关心结果"的场景。
   */
  recordExecutionFireAndForget(
    input: RecordExecutionInput,
    result: RuntimeExecutionResult,
  ): void {
    this.recordExecution(input, result).catch((err) => {
      this.logger.error(
        `recordExecution 自身抛错（不该发生）: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  /**
   * 查询某 relatedId 的执行历史。
   * 用于前端 UI / 审计回看。
   */
  async listByRelatedId(
    relatedId: string,
    limit = 20,
  ): Promise<
    Array<{
      id: string;
      executor: string;
      status: string;
      reasonCode: string;
      createdAt: Date;
    }>
  > {
    const rows = await this.prisma.runtimeExecution.findMany({
      where: { relatedId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        executor: true,
        status: true,
        reasonCode: true,
        createdAt: true,
      },
    });
    return rows;
  }
}
