import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { Approval } from '../core/types';
import { makeError } from '../contracts/error-codes';
import { genId, hashJson, nowIso } from '../core/util';

/**
 * 审批仓储 DB 版：落 agent_gateway_approvals 表。
 * 与内存版 ApprovalService 方法形状一致（create/get/validate/consume/reject），
 * 绑定 taskId+toolCallId、一次性消费、过期/预览变化语义相同。
 */
@Injectable()
export class PrismaApprovalStore {
  constructor(private readonly prisma: PrismaService) {}

  private toDomain(r: {
    id: string; taskId: string; toolCallId: string; tenantId: string;
    previewHash: string; approvedBy: string | null; consumed: boolean;
    expiresAt: Date; status: string; createdAt: Date;
  }): Approval {
    return {
      id: r.id,
      taskId: r.taskId,
      toolCallId: r.toolCallId,
      previewHash: r.previewHash,
      approvedBy: r.approvedBy ?? undefined,
      consumed: r.consumed,
      expiresAt: r.expiresAt.toISOString(),
      status: r.status as Approval['status'],
      createdAt: r.createdAt.toISOString(),
    };
  }

  async create(taskId: string, toolCallId: string, preview: unknown, ttlMs: number, nowMs = Date.now()): Promise<Approval> {
    // tenantId 从 task 回查（表 NOT NULL；审批必须归属租户）
    const task = await this.prisma.agentGatewayTask.findUnique({ where: { id: taskId } });
    const row = await this.prisma.agentGatewayApproval.create({
      data: {
        taskId,
        toolCallId,
        tenantId: task?.tenantId ?? '',
        previewHash: hashJson(preview),
        expiresAt: new Date(nowMs + ttlMs),
        status: 'pending',
        consumed: false,
      },
    });
    return this.toDomain(row);
  }

  async get(id: string): Promise<Approval | undefined> {
    const row = await this.prisma.agentGatewayApproval.findUnique({ where: { id } });
    return row ? this.toDomain(row) : undefined;
  }

  async validate(
    approvalId: string,
    currentPreview: unknown,
    currentTaskId: string,
    currentToolCallId: string,
    nowMs = Date.now(),
  ): Promise<Approval> {
    const row = await this.prisma.agentGatewayApproval.findUnique({ where: { id: approvalId } });
    if (!row) throw makeError('APPROVAL_MISMATCH', { details: { approvalId, reason: '未知审批' } });
    if (row.status === 'rejected') throw makeError('PREVIEW_CHANGED', { details: { approvalId, reason: '审批已被拒绝' } });
    if (row.consumed) throw makeError('APPROVAL_MISMATCH', { details: { approvalId, reason: '审批已被一次性消费' } });
    if (row.taskId !== currentTaskId) {
      throw makeError('APPROVAL_MISMATCH', { details: { approvalId, expectedTaskId: row.taskId, gotTaskId: currentTaskId } });
    }
    if (row.toolCallId !== currentToolCallId) {
      throw makeError('APPROVAL_MISMATCH', { details: { approvalId, expectedToolCall: row.toolCallId, gotToolCall: currentToolCallId } });
    }
    if (row.expiresAt.getTime() <= nowMs) {
      await this.prisma.agentGatewayApproval.update({ where: { id: approvalId }, data: { status: 'expired' } });
      throw makeError('APPROVAL_EXPIRED', { details: { approvalId } });
    }
    const currentHash = hashJson(currentPreview);
    if (currentHash !== row.previewHash) {
      throw makeError('PREVIEW_CHANGED', {
        details: { approvalId, approvedPreviewHash: row.previewHash, currentPreviewHash: currentHash },
      });
    }
    const updated = await this.prisma.agentGatewayApproval.update({
      where: { id: approvalId },
      data: { status: 'approved', approvedBy: 'user' },
    });
    return this.toDomain(updated);
  }

  async consume(approvalId: string): Promise<void> {
    await this.prisma.agentGatewayApproval.update({ where: { id: approvalId }, data: { consumed: true } });
  }

  async reject(approvalId: string): Promise<Approval> {
    const row = await this.prisma.agentGatewayApproval.findUnique({ where: { id: approvalId } });
    if (!row) throw makeError('APPROVAL_MISMATCH', { details: { approvalId, reason: '未知审批' } });
    const updated = await this.prisma.agentGatewayApproval.update({ where: { id: approvalId }, data: { status: 'rejected' } });
    return this.toDomain(updated);
  }
}

// 保持模块可独立编译（genId/nowIso 备用，避免未使用告警）
export const _prismaApprovalHelpers = { genId, nowIso };
