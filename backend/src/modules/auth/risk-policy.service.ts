import { Injectable } from '@nestjs/common';
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
    const storedPolicies = await this.prisma.riskPolicy.findMany({
      orderBy: { action: 'asc' },
    });
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
    return this.prisma.riskPolicy.findUnique({ where: { action } });
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
}
