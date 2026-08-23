// 审批门（开发文档 §10.1-10.2，统一开发计划 §九，Sprint 3 T3.3）
// 高风险动作强制人工审批；low 可自动；medium confirm-first；high 强制人工。
// 审批卡内容：目标/拟动作/完整文本/受影响数量/排除数/可撤销/规则版本/审批人时间理由。
// 内容/目标集合变化后 inputHash 对比自动失效。
import { Injectable, BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { actionRiskLevel, type LeadActionInput } from './action-contract';

export type ApprovalAction =
  'approve' | 'reject' | 'request_changes' | 'expire' | 'resubmit';

/** 计算 inputHash（内容/目标集合变化 → hash 变化 → 旧审批自动失效） */
export function computeInputHash(input: LeadActionInput): string {
  const payload = JSON.stringify({
    action: input.action,
    leadId: input.leadId,
    reason: input.reason,
    evidenceIds: [...(input.evidenceIds ?? [])].sort(),
    payload: input.payload ?? null,
  });
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

@Injectable()
export class ApprovalGateService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 检查是否需要人工审批（low 自动通过；medium/high 走审批表）。
   * 返回：
   * - { needApproval: false; approvalId?: string } → 可直接执行
   * - { needApproval: true; approvalId: string } → 挂起等审批
   */
  async check(input: LeadActionInput): Promise<{
    needApproval: boolean;
    approvalId?: string;
    riskLevel: 'low' | 'medium' | 'high';
    reason?: string;
  }> {
    const riskLevel = actionRiskLevel(input.action);

    // low：内部任务/草稿/复核请求，自动放行（不落审批表）
    if (riskLevel === 'low') {
      return { needApproval: false, riskLevel };
    }

    // medium/high：查已有 pending 审批（幂等：同 inputHash 复用）
    const hash = computeInputHash(input);
    const existing = await this.prisma.approval.findFirst({
      where: {
        tenantId: input.tenantId,
        actionId: input.leadId,
        inputHash: hash,
        status: 'pending',
      },
    });
    if (existing) {
      return { needApproval: true, approvalId: existing.id, riskLevel };
    }

    // 新建审批
    const created = await this.prisma.approval.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        actionId: input.leadId,
        actionType: input.action,
        riskLevel,
        inputHash: hash,
        affectedLeadIds: input.payload?.targetIds ?? [input.leadId],
        excludedLeadIds: [],
      },
    });
    return {
      needApproval: true,
      approvalId: created.id,
      riskLevel,
      reason:
        riskLevel === 'high'
          ? '高风险动作需人工审批'
          : '中等风险动作，确认后执行',
    };
  }

  /**
   * 审批操作（approve/reject/request_changes/expire/resubmit）。
   * approve 时若 inputHash 与当前动作不一致（内容已变）→ 抛错，要求 resubmit。
   */
  async act(input: {
    tenantId: string;
    approvalId: string;
    action: ApprovalAction;
    approverId: string;
    reason?: string;
    currentInput?: LeadActionInput;
  }): Promise<{ status: string; appliedAt?: Date }> {
    const approval = await this.prisma.approval.findUnique({
      where: { id: input.approvalId },
    });
    if (!approval || approval.tenantId !== input.tenantId) {
      throw new BadRequestException('审批不存在或不在当前租户');
    }
    if (approval.status !== 'pending') {
      throw new BadRequestException(
        `审批已处理（${approval.status}），不能重复操作`,
      );
    }

    if (input.action === 'expire') {
      await this.prisma.approval.update({
        where: { id: input.approvalId },
        data: {
          status: 'expired',
          approverId: input.approverId,
          reason: input.reason,
        },
      });
      return { status: 'expired' };
    }

    if (input.action === 'resubmit') {
      if (!input.currentInput)
        throw new BadRequestException('resubmit 需要新的动作输入');
      const hash = computeInputHash(input.currentInput);
      await this.prisma.approval.update({
        where: { id: input.approvalId },
        data: {
          status: 'resubmitted',
          inputHash: hash,
          reason: input.reason ?? '内容已更新，重新提交审批',
          approverId: input.approverId,
        },
      });
      return { status: 'resubmitted' };
    }

    if (input.action === 'approve') {
      // 自动失效检查：审批内容与当前动作不一致 → 拒绝批准，要求 resubmit
      if (input.currentInput) {
        const currentHash = computeInputHash(input.currentInput);
        if (currentHash !== approval.inputHash) {
          throw new BadRequestException(
            '审批内容已变化（inputHash 不匹配），自动失效，请 resubmit 后重新审批',
          );
        }
      }
      const now = new Date();
      await this.prisma.approval.update({
        where: { id: input.approvalId },
        data: {
          status: 'approved',
          approverId: input.approverId,
          reason: input.reason,
          appliedAt: now,
        },
      });
      return { status: 'approved', appliedAt: now };
    }

    // reject / request_changes
    await this.prisma.approval.update({
      where: { id: input.approvalId },
      data: {
        status: input.action === 'reject' ? 'rejected' : 'requested_changes',
        approverId: input.approverId,
        reason: input.reason,
      },
    });
    return {
      status: input.action === 'reject' ? 'rejected' : 'requested_changes',
    };
  }

  /**
   * 执行前消费审批（P0-3）：校验审批已批准且未消费、内容 hash 未变、未过期，
   * 通过后标记 applied（一次性）。执行器在执行外发动作前调用。
   */
  async consume(
    tenantId: string,
    approvalId: string,
    currentHash?: string,
  ): Promise<{ status: string; appliedAt: Date }> {
    const approval = await this.prisma.approval.findUnique({
      where: { id: approvalId },
    });
    if (!approval || approval.tenantId !== tenantId) {
      throw new BadRequestException('审批不存在或不在当前租户');
    }
    if (approval.status !== 'approved') {
      throw new BadRequestException(
        `审批不可执行（当前 ${approval.status}），仅已批准且未消费的审批可执行`,
      );
    }
    if (currentHash && currentHash !== approval.inputHash) {
      throw new BadRequestException(
        '审批内容已变化（inputHash 不匹配），审批失效，请重新审批',
      );
    }
    if (approval.expiresAt && approval.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('审批已过期，请重新审批');
    }
    const now = new Date();
    // 原子消费：where 带 status='approved'，并发下仅一个执行器能消费成功（防重复外发）
    const applied = await this.prisma.approval.updateMany({
      where: { id: approvalId, status: 'approved' },
      data: { status: 'applied', appliedAt: now },
    });
    if (applied.count === 0) {
      throw new BadRequestException('审批已被消费或状态已变化，请勿重复执行');
    }
    return { status: 'applied', appliedAt: now };
  }

  /** 待审批列表 */
  async listPending(tenantId: string, limit = 50) {
    return this.prisma.approval.findMany({
      where: { tenantId, status: 'pending' },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
