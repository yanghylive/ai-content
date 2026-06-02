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
    requireConfirm: true,
    autoExecute: false,
    forbidden: false,
    minPlan: 'STANDARD',
    allowedRoles: [],
    whitelist: [],
    description:
      '发布到抖音、小红书、视频号、快手、B站等外部平台前必须进入确认。',
  },
  {
    action: 'retry-publish',
    riskLevel: 'high',
    requireConfirm: true,
    autoExecute: false,
    forbidden: false,
    minPlan: 'STANDARD',
    allowedRoles: [],
    whitelist: [],
    description: '重试发布会重新触达外部平台，必须确认账号、素材和目标平台。',
  },
  {
    action: 'resume-blocked-publish',
    riskLevel: 'high',
    requireConfirm: true,
    autoExecute: false,
    forbidden: false,
    minPlan: 'STANDARD',
    allowedRoles: [],
    whitelist: [],
    description: '恢复被阻断的发布任务前必须复核失败原因和当前账号登录态。',
  },
  {
    action: 'platform-account-delete',
    riskLevel: 'high',
    requireConfirm: true,
    autoExecute: false,
    forbidden: false,
    minPlan: 'PRO',
    allowedRoles: ['SUPER_ADMIN', 'OPS_ADMIN'],
    whitelist: [],
    description: '删除平台账号会影响发布和互动任务，必须由高权限角色确认。',
  },
  {
    action: 'interaction-approval',
    riskLevel: 'high',
    requireConfirm: true,
    autoExecute: false,
    forbidden: false,
    minPlan: 'STANDARD',
    allowedRoles: [],
    whitelist: [],
    description: '评论、私信、微信草稿或发送动作必须停在待确认节点。',
  },
  {
    action: 'agent-confirmation-approve',
    riskLevel: 'high',
    requireConfirm: true,
    autoExecute: false,
    forbidden: false,
    minPlan: 'STANDARD',
    allowedRoles: [],
    whitelist: [],
    description: '批准智能任务继续执行前必须保留确认记录和操作者上下文。',
  },
  {
    action: 'remote-control',
    riskLevel: 'high',
    requireConfirm: true,
    autoExecute: false,
    forbidden: false,
    minPlan: 'PRO',
    allowedRoles: [],
    whitelist: [],
    description: '微信人工接管、远程控制和桌面控制必须写入审计并允许随时停止。',
  },
  {
    action: 'runtime-control',
    riskLevel: 'medium',
    requireConfirm: true,
    autoExecute: false,
    forbidden: false,
    minPlan: 'PRO',
    allowedRoles: [],
    whitelist: [],
    description: '启动、停止、重启本机服务会影响正在执行的任务，需要确认。',
  },
  {
    action: 'material-delete',
    riskLevel: 'medium',
    requireConfirm: true,
    autoExecute: false,
    forbidden: false,
    minPlan: 'STANDARD',
    allowedRoles: [],
    whitelist: [],
    description: '删除素材会影响选题、文章和发布证据，默认需要确认。',
  },
  {
    action: 'material-batch-delete',
    riskLevel: 'high',
    requireConfirm: true,
    autoExecute: false,
    forbidden: false,
    minPlan: 'PRO',
    allowedRoles: [],
    whitelist: [],
    description: '批量删除素材属于高影响操作，必须确认数量和范围。',
  },
  {
    action: 'storage-remote-test',
    riskLevel: 'medium',
    requireConfirm: true,
    autoExecute: false,
    forbidden: false,
    minPlan: 'STANDARD',
    allowedRoles: [],
    whitelist: [],
    description: '对象存储测试会访问外部服务，需确认配置来源和账号权限。',
  },
  {
    action: 'schedule-enable',
    riskLevel: 'medium',
    requireConfirm: true,
    autoExecute: false,
    forbidden: false,
    minPlan: 'STANDARD',
    allowedRoles: [],
    whitelist: [],
    description: '启用计划任务会持续触发采集、生成或发布链路，需要确认。',
  },
];

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
    const mergedDefaults = DEFAULT_RISK_POLICIES.map((policy) => ({
      ...policy,
      ...(storedByAction.get(policy.action) || {}),
      source: storedByAction.has(policy.action) ? 'custom' : 'default',
    }));
    const customOnlyPolicies = storedPolicies
      .filter(
        (policy) =>
          !DEFAULT_RISK_POLICIES.some(
            (defaultPolicy) => defaultPolicy.action === policy.action,
          ),
      )
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
    return this.prisma.riskPolicy.upsert({
      where: { action: data.action },
      update: {
        riskLevel: data.riskLevel ?? 'medium',
        requireConfirm: data.requireConfirm ?? true,
        autoExecute: data.autoExecute ?? false,
        forbidden: data.forbidden ?? false,
        minPlan: data.minPlan,
        allowedRoles: data.allowedRoles ?? [],
        whitelist: data.whitelist ?? [],
        description: data.description,
      },
      create: {
        action: data.action,
        riskLevel: data.riskLevel ?? 'medium',
        requireConfirm: data.requireConfirm ?? true,
        autoExecute: data.autoExecute ?? false,
        forbidden: data.forbidden ?? false,
        minPlan: data.minPlan,
        allowedRoles: data.allowedRoles ?? [],
        whitelist: data.whitelist ?? [],
        description: data.description,
      },
    });
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

    // 本地商用模式：跳过套餐和角色限制，允许本地用户管理自己的账号
    const isLocalCommercialMode =
      process.env.LOCAL_ENGINE_PLAN_MODE === 'commercial' ||
      process.env.AI_CONTENT_PLAN === 'commercial';

    if (!isLocalCommercialMode && policy.minPlan) {
      const planOrder = [
        'FREE',
        'STUDY',
        'STANDARD',
        'PRO',
        'ADVANCED',
        'FLAGSHIP',
      ];
      if (planOrder.indexOf(context.plan) < planOrder.indexOf(policy.minPlan)) {
        return {
          allowed: false,
          requireConfirm: false,
          reason: `此操作需要 ${policy.minPlan} 及以上套餐`,
        };
      }
    }
    const allowedRoles = policy.allowedRoles as string[];
    if (!isLocalCommercialMode && allowedRoles.length > 0) {
      const hasRole = allowedRoles.some(
        (r) => r === context.role || r === context.platformRole,
      );
      if (!hasRole) {
        return {
          allowed: false,
          requireConfirm: false,
          reason: `此操作需要 ${allowedRoles.join('/')} 角色`,
        };
      }
    }
    return { allowed: true, requireConfirm: policy.requireConfirm };
  }
}
