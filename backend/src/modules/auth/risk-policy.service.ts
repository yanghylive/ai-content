import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

type RiskPolicyDefaults = {
  action: string;
  riskLevel: string;
  requireConfirm: boolean;
  autoExecute: boolean;
  forbidden: boolean;
  minPlan: string | null;
  allowedRoles: string[];
  whitelist: string[];
  description: string;
};

export type RiskApprovalActor = {
  tenantId?: string;
  userId: string;
  sessionId: string;
  operator: string;
};

export type RiskApprovalInput = {
  action: string;
  riskLevel: string;
  target?: string;
  reason?: string;
};

const DEFAULT_RISK_POLICIES: RiskPolicyDefaults[] = [
  {
    action: 'publish',
    riskLevel: 'high',
    requireConfirm: false,
    autoExecute: true,
    forbidden: false,
    minPlan: null,
    allowedRoles: [],
    whitelist: [],
    description:
      '发布到抖音、小红书、视频号、快手、B站等外部平台；默认自动执行并保留审计。',
  },
  {
    action: 'retry-publish',
    riskLevel: 'high',
    requireConfirm: false,
    autoExecute: true,
    forbidden: false,
    minPlan: null,
    allowedRoles: [],
    whitelist: [],
    description: '重试发布会重新触达外部平台；默认自动执行并保留审计。',
  },
  {
    action: 'resume-blocked-publish',
    riskLevel: 'high',
    requireConfirm: false,
    autoExecute: true,
    forbidden: false,
    minPlan: null,
    allowedRoles: [],
    whitelist: [],
    description: '恢复被阻断的发布任务；默认自动执行并记录失败原因和登录态。',
  },
  {
    action: 'platform-account-delete',
    riskLevel: 'high',
    requireConfirm: false,
    autoExecute: true,
    forbidden: false,
    minPlan: null,
    allowedRoles: [],
    whitelist: [],
    description: '删除平台账号会影响发布和互动任务；默认自动执行并保留审计。',
  },
  {
    action: 'interaction-approval',
    riskLevel: 'high',
    requireConfirm: false,
    autoExecute: true,
    forbidden: false,
    minPlan: null,
    allowedRoles: [],
    whitelist: [],
    description: '评论、私信、微信草稿或发送动作默认自动执行并保留审计。',
  },
  {
    action: 'agent-confirmation-approve',
    riskLevel: 'high',
    requireConfirm: false,
    autoExecute: true,
    forbidden: false,
    minPlan: null,
    allowedRoles: [],
    whitelist: [],
    description: '批准智能任务继续执行时保留操作者上下文；默认自动执行。',
  },
  {
    action: 'remote-control',
    riskLevel: 'high',
    requireConfirm: false,
    autoExecute: true,
    forbidden: false,
    minPlan: null,
    allowedRoles: [],
    whitelist: [],
    description: '微信人工接管、远程控制和桌面控制写入审计并允许随时停止。',
  },
  {
    action: 'runtime-control',
    riskLevel: 'medium',
    requireConfirm: false,
    autoExecute: true,
    forbidden: false,
    minPlan: null,
    allowedRoles: [],
    whitelist: [],
    description: '启动、停止、重启本机服务默认自动执行并保留审计。',
  },
  {
    action: 'material-delete',
    riskLevel: 'medium',
    requireConfirm: false,
    autoExecute: true,
    forbidden: false,
    minPlan: null,
    allowedRoles: [],
    whitelist: [],
    description: '删除素材会影响选题、文章和发布证据；默认自动执行并保留审计。',
  },
  {
    action: 'material-batch-delete',
    riskLevel: 'high',
    requireConfirm: false,
    autoExecute: true,
    forbidden: false,
    minPlan: null,
    allowedRoles: [],
    whitelist: [],
    description: '批量删除素材属于高影响操作；默认自动执行并保留审计。',
  },
  {
    action: 'storage-remote-test',
    riskLevel: 'medium',
    requireConfirm: false,
    autoExecute: true,
    forbidden: false,
    minPlan: null,
    allowedRoles: [],
    whitelist: [],
    description: '对象存储测试会访问外部服务；默认自动执行并保留审计。',
  },
  {
    action: 'schedule-enable',
    riskLevel: 'medium',
    requireConfirm: false,
    autoExecute: true,
    forbidden: false,
    minPlan: null,
    allowedRoles: [],
    whitelist: [],
    description: '启用计划任务会持续触发采集、生成或发布链路；默认自动执行。',
  },
];

function isDefaultRiskPolicy(action: string) {
  return DEFAULT_RISK_POLICIES.some((policy) => policy.action === action);
}

@Injectable()
export class RiskPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  async listPolicies() {
    let storedPolicies: Awaited<
      ReturnType<typeof this.prisma.riskPolicy.findMany>
    > = [];
    try {
      storedPolicies = await this.prisma.riskPolicy.findMany({
        orderBy: { action: 'asc' },
      });
    } catch (error) {
      if (!this.isPrismaTableMissingError(error, 'risk_policies')) {
        throw error;
      }
    }
    const storedByAction = new Map(
      storedPolicies.map((policy) => [policy.action, policy]),
    );
    const mergedDefaults = DEFAULT_RISK_POLICIES.map((policy) => {
      const stored = storedByAction.get(policy.action);
      return {
        ...policy,
        ...(stored || {}),
        requireConfirm: stored?.requireConfirm ?? policy.requireConfirm,
        autoExecute: stored?.autoExecute ?? policy.autoExecute,
        minPlan: null,
        allowedRoles: [],
        source: stored ? 'custom' : 'default',
      };
    });
    const customOnlyPolicies = storedPolicies
      .filter((policy) => !isDefaultRiskPolicy(policy.action))
      .map((policy) => ({ ...policy, source: 'custom' }));

    return [...mergedDefaults, ...customOnlyPolicies].sort((left, right) =>
      left.action.localeCompare(right.action),
    );
  }

  async getPolicy(action: string) {
    try {
      return await this.prisma.riskPolicy.findUnique({ where: { action } });
    } catch (error) {
      if (this.isPrismaTableMissingError(error, 'risk_policies')) {
        return null;
      }
      throw error;
    }
  }

  async upsertPolicy(data: {
    action: string;
    riskLevel?: string;
    requireConfirm?: boolean;
    autoExecute?: boolean;
    forbidden?: boolean;
    minPlan?: string;
    allowedRoles?: string[];
    whitelist?: string[];
    description?: string;
  }) {
    const current = await this.resolvePolicy(data.action);

    const policy = await this.prisma.riskPolicy.upsert({
      where: { action: data.action },
      update: {
        riskLevel: data.riskLevel ?? current.riskLevel,
        requireConfirm: data.requireConfirm ?? current.requireConfirm,
        autoExecute: data.autoExecute ?? current.autoExecute,
        forbidden: data.forbidden ?? current.forbidden,
        minPlan: data.minPlan ?? null,
        allowedRoles: data.allowedRoles ?? [],
        whitelist: data.whitelist ?? current.whitelist,
        description: data.description ?? current.description,
      },
      create: {
        action: data.action,
        riskLevel: data.riskLevel ?? current.riskLevel,
        requireConfirm: data.requireConfirm ?? current.requireConfirm,
        autoExecute: data.autoExecute ?? current.autoExecute,
        forbidden: data.forbidden ?? current.forbidden,
        minPlan: data.minPlan ?? null,
        allowedRoles: data.allowedRoles ?? [],
        whitelist: data.whitelist ?? current.whitelist,
        description: data.description ?? current.description,
      },
    });
    return {
      ...policy,
      source: 'custom',
    };
  }

  async issueHighRiskApproval(
    input: RiskApprovalInput,
    actor: RiskApprovalActor,
  ) {
    const action = this.requireApprovalText(input.action, '操作类型');
    const riskLevel = this.requireApprovalText(input.riskLevel, '风险等级');
    if (riskLevel !== 'high') {
      throw new BadRequestException('只有高风险操作需要一次性确认');
    }
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60_000);
    const tenantId = await this.resolveApprovalTenantId(actor, '确认该操作');
    const target = this.optionalApprovalText(input.target);
    const approval = await this.prisma.agentConfirmation.create({
      data: {
        tenantId,
        userId: actor.userId,
        sessionId: actor.sessionId,
        action,
        status: 'approved',
        riskLevel,
        target,
        targetLabel: target,
        operator: actor.operator,
        note: this.optionalApprovalText(input.reason),
        decidedAt: now,
        confirmationJson: {
          kind: 'backend-risk-approval',
          action,
          riskLevel,
          target,
          issuedAt: now.toISOString(),
          expiresAt: expiresAt.toISOString(),
          issuedByUserId: actor.userId,
          issuedForSessionId: actor.sessionId,
          consumedAt: null,
        },
      },
      select: {
        id: true,
        action: true,
        riskLevel: true,
        target: true,
        createdAt: true,
      },
    });
    return {
      confirmationId: approval.id,
      action: approval.action,
      riskLevel: approval.riskLevel,
      target: approval.target,
      expiresAt: expiresAt.toISOString(),
      singleUse: true,
    };
  }

  async consumeHighRiskApproval(
    input: RiskApprovalInput & { confirmationId?: string },
    actor: RiskApprovalActor,
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;
    const confirmationId = this.requireApprovalText(
      input.confirmationId,
      '确认编号',
    );
    const action = this.requireApprovalText(input.action, '操作类型');
    const riskLevel = this.requireApprovalText(input.riskLevel, '风险等级');
    const target = this.optionalApprovalText(input.target);
    const tenantId = await this.resolveApprovalTenantId(actor, '使用该确认');
    const approval = await db.agentConfirmation.findFirst({
      where: {
        id: confirmationId,
        tenantId,
        userId: actor.userId,
        sessionId: actor.sessionId,
        action,
        riskLevel,
        target,
        status: 'approved',
      },
      select: {
        id: true,
        tenantId: true,
        operator: true,
        note: true,
        confirmationJson: true,
      },
    });
    if (!approval) {
      throw new BadRequestException('高风险确认不存在、已使用或不匹配');
    }
    const approvalData = this.toApprovalRecord(approval.confirmationJson);
    const expiresAt = this.optionalApprovalDate(approvalData.expiresAt);
    if (
      approvalData.kind !== 'backend-risk-approval' ||
      !expiresAt ||
      expiresAt <= new Date()
    ) {
      await db.agentConfirmation.updateMany({
        where: { id: approval.id, status: 'approved' },
        data: { status: 'expired' },
      });
      throw new BadRequestException('高风险确认已过期，请重新确认');
    }

    const consumedAt = new Date().toISOString();
    const consumed = await db.agentConfirmation.updateMany({
      where: {
        id: approval.id,
        tenantId: approval.tenantId,
        userId: actor.userId,
        sessionId: actor.sessionId,
        action,
        riskLevel,
        status: 'approved',
      },
      data: {
        status: 'expired',
        confirmationJson: {
          ...approvalData,
          consumedAt,
        },
      },
    });
    if (consumed.count !== 1) {
      throw new BadRequestException('高风险确认已被使用，请重新确认');
    }
    return {
      confirmed: true,
      confirmationId,
      confirmedAction: action,
      confirmedRiskLevel: riskLevel,
      operator: approval.operator || actor.operator,
      reason: approval.note || undefined,
      confirmedAt: consumedAt,
    };
  }

  async checkPolicy(
    action: string,
    context: { plan: string; role: string | null; platformRole: string | null },
  ): Promise<{
    allowed: boolean;
    requireConfirm: boolean;
    reason?: string;
  }> {
    const policy =
      (await this.getPolicy(action)) ||
      DEFAULT_RISK_POLICIES.find((item) => item.action === action);
    if (!policy) {
      return { allowed: true, requireConfirm: false };
    }
    if (policy.forbidden) {
      return {
        allowed: false,
        requireConfirm: false,
        reason: `操作 ${action} 已被禁止`,
      };
    }

    void context;
    return { allowed: true, requireConfirm: policy.requireConfirm };
  }

  private async resolvePolicy(action: string): Promise<RiskPolicyDefaults> {
    const storedPolicy = await this.getPolicy(action);
    if (storedPolicy) {
      return {
        action: storedPolicy.action,
        riskLevel: storedPolicy.riskLevel,
        requireConfirm: storedPolicy.requireConfirm,
        autoExecute: storedPolicy.autoExecute,
        forbidden: storedPolicy.forbidden,
        minPlan: storedPolicy.minPlan,
        allowedRoles: this.toStringArray(storedPolicy.allowedRoles),
        whitelist: this.toStringArray(storedPolicy.whitelist),
        description: storedPolicy.description || '',
      };
    }

    return (
      DEFAULT_RISK_POLICIES.find((policy) => policy.action === action) || {
        action,
        riskLevel: 'medium',
        requireConfirm: false,
        autoExecute: true,
        forbidden: false,
        minPlan: null,
        allowedRoles: [],
        whitelist: [],
        description: '',
      }
    );
  }

  private toStringArray(value: unknown) {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  }

  private requireApprovalText(value: unknown, label: string) {
    const text = this.optionalApprovalText(value);
    if (!text) throw new BadRequestException(`${label}不能为空`);
    return text;
  }

  private optionalApprovalText(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private optionalApprovalDate(value: unknown) {
    if (typeof value !== 'string' || !value.trim()) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private toApprovalRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private async resolveApprovalTenantId(
    actor: RiskApprovalActor,
    operation: string,
  ) {
    const requestedTenantId = this.optionalApprovalText(actor.tenantId);
    if (requestedTenantId === `local-desktop:${actor.userId}`) {
      return requestedTenantId;
    }

    const membership = await this.prisma.system.tenantMember.findFirst({
      where: {
        userId: actor.userId,
        status: 'active',
        ...(requestedTenantId ? { tenantId: requestedTenantId } : {}),
      },
      orderBy: [{ joinedAt: 'asc' }, { createdAt: 'asc' }],
      select: { tenantId: true },
    });
    if (!membership?.tenantId) {
      throw new BadRequestException(`当前账号不属于可用组织，不能${operation}`);
    }
    return membership.tenantId;
  }

  private isPrismaTableMissingError(error: unknown, tableName?: string) {
    const code =
      error instanceof Prisma.PrismaClientKnownRequestError
        ? error.code
        : undefined;
    const message = error instanceof Error ? error.message : String(error);
    const missing =
      code === 'P2021' ||
      /does not exist in the current database/i.test(message) ||
      /no such table/i.test(message);
    return missing && (!tableName || message.includes(tableName));
  }
}
