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

import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthRequestContextService } from '../../../common/auth-request-context.service';
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
  accountId?: string | number | null;
};

type EvidenceScope = { tenantId: string; userId: string };

@Injectable()
export class EvidenceService {
  private readonly logger = new Logger(EvidenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authRequestContext: AuthRequestContextService,
  ) {}

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
      const scope = await this.resolveWriteScope(input);
      if (!scope) {
        return {
          status: 'invalid',
          reason: '关联任务不存在或不属于当前租户用户',
        };
      }
      const created = await this.prisma.runtimeExecution.create({
        data: {
          tenantId: scope.tenantId,
          userId: scope.userId,
          relatedId: input.relatedId,
          relatedType: input.relatedType,
          executor: result.runtime.mode,
          platform: input.platform,
          taskType: input.taskType,
          accountId: input.accountId == null ? null : String(input.accountId),
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
    const scope = await this.resolveRequestScope(true);
    const rows = await this.prisma.runtimeExecution.findMany({
      where: { relatedId, ...scope },
      orderBy: { createdAt: 'desc' },
      take: Math.min(100, Math.max(1, Math.trunc(limit) || 20)),
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

  private async resolveWriteScope(input: RecordExecutionInput) {
    const requestScope = await this.resolveRequestScope(false);
    const where = requestScope
      ? { id: input.relatedId, ...requestScope }
      : { id: input.relatedId };
    const owner =
      input.relatedType === 'interaction-task'
        ? await this.prisma.interactionTask.findFirst({
            where,
            select: { tenantId: true, userId: true },
          })
        : await this.prisma.agentSession.findFirst({
            where,
            select: { tenantId: true, userId: true },
          });
    if (!owner?.tenantId || !owner?.userId) return null;
    return { tenantId: owner.tenantId, userId: owner.userId };
  }

  private async resolveRequestScope(required: true): Promise<EvidenceScope>;
  private async resolveRequestScope(
    required: false,
  ): Promise<EvidenceScope | null>;
  private async resolveRequestScope(required: boolean) {
    const user = this.authRequestContext.get()?.user;
    const userId = user?.id?.trim() || '';
    if (!userId) {
      if (required) throw new UnauthorizedException('请先登录后查看执行证据');
      return null;
    }

    try {
      const membership = await this.prisma.tenantMember.findFirst({
        where: { userId, status: 'active' },
        orderBy: [{ joinedAt: 'asc' }, { createdAt: 'asc' }],
        select: { tenantId: true },
      });
      if (membership?.tenantId) {
        return { tenantId: membership.tenantId, userId };
      }
    } catch (error) {
      if (user?.kaypalLocalOnly !== true) throw error;
    }

    if (user?.kaypalLocalOnly === true) {
      return { tenantId: `local-desktop:${userId}`, userId };
    }
    throw new ForbiddenException('当前账号尚未绑定可用组织');
  }
}
