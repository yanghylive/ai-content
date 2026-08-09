import { BadRequestException } from '@nestjs/common';
import type { RiskPolicyService } from './risk-policy.service';

export type BackendRiskLevel = 'low' | 'medium' | 'high';

export type BackendRiskAction =
  | 'publish'
  | 'retry-publish'
  | 'resume-blocked-publish'
  | 'batch-touch'
  | 'material-delete'
  | 'material-batch-delete'
  | 'remote-collect'
  | 'source-delete'
  | 'source-seed'
  | 'style-delete'
  | 'style-default-change'
  | 'strategy-delete'
  | 'strategy-default-change'
  | 'storage-remote-test'
  | 'schedule-enable'
  | 'local-file-delete'
  | 'platform-account-delete'
  | 'runtime-control'
  | 'remote-control'
  | 'agent-confirmation-approve'
  | 'interaction-approval';

export type BackendRiskConfirmationInput = {
  confirmed?: boolean;
  confirmedAction?: string;
  confirmedRiskLevel?: string;
  confirmationId?: string;
  operator?: string;
  reason?: string;
  note?: string;
  confirmedAt?: string;
  checklist?: Record<string, boolean>;
  fullPermission?: boolean;
};

export type BackendRiskContext = {
  accountId?: string;
  accountName?: string;
  deviceId?: string;
  deviceName?: string;
  ip?: string;
  userAgent?: string;
};

export type BackendRiskAuditEvent = {
  id: string;
  account: {
    id?: string;
    name: string;
  };
  device: {
    id: string;
    name: string;
    ip?: string;
    userAgent?: string;
  };
  action: BackendRiskAction;
  target?: string;
  riskLevel: BackendRiskLevel;
  status: 'allowed' | 'approval_required' | 'blocked';
  reason: string;
  confirmationRecord?: {
    confirmed: boolean;
    confirmationId?: string;
    operator: string;
    reason?: string;
    confirmedAt: string;
    confirmedAction?: string;
    confirmedRiskLevel?: string;
    checklist?: Record<string, boolean>;
    fullPermission?: boolean;
  };
  forbiddenActionHits: string[];
  createdAt: string;
};

export type BackendRiskGateInput = {
  action: BackendRiskAction;
  target?: string;
  riskLevel: BackendRiskLevel;
  requiresConfirmation?: boolean;
  confirmation?: BackendRiskConfirmationInput;
  context?: BackendRiskContext;
  forbiddenActionHits?: string[];
  reason?: string;
  policyResult?: { allowed: boolean; requireConfirm: boolean; reason?: string };
};

export function createRiskContextFromRequest(
  request:
    | {
        authUser?: {
          id?: string;
          username?: string;
          email?: string;
          name?: string;
        };
        authSessionId?: string;
        headers?: Record<string, string | string[] | undefined>;
        ip?: string;
        socket?: { remoteAddress?: string };
      }
    | undefined,
): BackendRiskContext {
  const authUser = request?.authUser;
  const headers = request?.headers || {};
  const userAgent = normalizeHeader(headers['user-agent']);
  const forwardedFor = normalizeHeader(headers['x-forwarded-for']);
  const ip =
    forwardedFor?.split(',')[0]?.trim() ||
    request?.ip ||
    request?.socket?.remoteAddress;

  return {
    accountId: authUser?.id,
    accountName:
      authUser?.name || authUser?.username || authUser?.email || '当前登录用户',
    deviceId:
      request?.authSessionId ||
      shortHash(`${userAgent || 'unknown'}:${ip || 'local'}`),
    deviceName: userAgent ? userAgent.slice(0, 120) : 'local-backend',
    ip,
    userAgent,
  };
}

export async function assertRiskWithPolicy(
  riskPolicyService: RiskPolicyService,
  input: BackendRiskGateInput,
  userContext: {
    plan: string;
    role: string | null;
    platformRole: string | null;
    tenantId?: string;
    userId?: string;
    sessionId?: string;
    operator?: string;
  },
): Promise<BackendRiskAuditEvent> {
  const policyResult = await riskPolicyService.checkPolicy(
    input.action,
    userContext,
  );
  if (!policyResult.allowed) {
    throw new BadRequestException({
      message: policyResult.reason || `风控策略已阻止操作：${input.action}`,
      policyResult,
    });
  }
  const requiresConfirmation =
    input.requiresConfirmation ?? policyResult.requireConfirm;
  const forbiddenActionHits =
    input.forbiddenActionHits || findForbiddenActionHits(input);
  if (forbiddenActionHits.length) {
    return assertBackendRiskGate({
      ...input,
      forbiddenActionHits,
      requiresConfirmation: false,
      policyResult,
    });
  }

  let confirmation = input.confirmation;
  if (requiresConfirmation && input.riskLevel === 'high') {
    const userId = userContext.userId || input.context?.accountId;
    const sessionId = userContext.sessionId || input.context?.deviceId;
    if (!userId || !sessionId) {
      throw new BadRequestException('高风险操作需要当前登录会话的一次性确认');
    }
    confirmation = await riskPolicyService.consumeHighRiskApproval(
      {
        confirmationId: input.confirmation?.confirmationId,
        action: input.action,
        riskLevel: input.riskLevel,
        target: input.target,
        reason: input.reason,
      },
      {
        tenantId: userContext.tenantId,
        userId,
        sessionId,
        operator:
          userContext.operator || input.context?.accountName || '当前登录用户',
      },
    );
  }

  const mergedInput = {
    ...input,
    confirmation,
    requiresConfirmation,
    policyResult,
  };
  return assertBackendRiskGate(mergedInput);
}

export function assertBackendRiskGate(
  input: BackendRiskGateInput,
): BackendRiskAuditEvent {
  if (input.policyResult && !input.policyResult.allowed) {
    throw new BadRequestException({
      message:
        input.policyResult.reason || `风控策略已阻止操作：${input.action}`,
      policyResult: input.policyResult,
    });
  }
  const forbiddenActionHits =
    input.forbiddenActionHits || findForbiddenActionHits(input);
  const confirmation = normalizeConfirmation(input.confirmation);

  const requiresConfirmation = input.requiresConfirmation ?? false;
  const audit = createBackendRiskAuditEvent(input, {
    status: requiresConfirmation ? 'approval_required' : 'allowed',
    forbiddenActionHits,
    confirmation,
  });

  if (forbiddenActionHits.length > 0) {
    audit.status = 'blocked';
    throw new BadRequestException({
      message: `后端风控已阻断禁止动作：${forbiddenActionHits.join('、')}`,
      riskAudit: audit,
    });
  }

  if (!requiresConfirmation) {
    audit.status = 'allowed';
    return audit;
  }

  if (!confirmation?.confirmed) {
    throw new BadRequestException({
      message: `后端风控要求人工确认后才能执行：${describeRiskAction(input.action)}`,
      riskAudit: audit,
    });
  }

  if (
    confirmation.confirmedAction &&
    confirmation.confirmedAction !== input.action
  ) {
    audit.status = 'blocked';
    throw new BadRequestException({
      message: `确认动作不匹配：期望 ${input.action}，收到 ${confirmation.confirmedAction}`,
      riskAudit: audit,
    });
  }

  if (
    confirmation.confirmedRiskLevel &&
    confirmation.confirmedRiskLevel !== input.riskLevel
  ) {
    audit.status = 'blocked';
    throw new BadRequestException({
      message: `确认风险等级不匹配：期望 ${input.riskLevel}，收到 ${confirmation.confirmedRiskLevel}`,
      riskAudit: audit,
    });
  }

  audit.status = 'allowed';
  audit.confirmationRecord = confirmation;
  return audit;
}

export function createBackendRiskAuditEvent(
  input: BackendRiskGateInput,
  options: {
    status?: BackendRiskAuditEvent['status'];
    forbiddenActionHits?: string[];
    confirmation?: BackendRiskAuditEvent['confirmationRecord'];
  } = {},
): BackendRiskAuditEvent {
  const now = new Date().toISOString();
  const context = input.context || {};

  return {
    id: `risk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    account: {
      id: context.accountId,
      name: context.accountName || options.confirmation?.operator || '未知账号',
    },
    device: {
      id: context.deviceId || 'local-backend',
      name: context.deviceName || 'local-backend',
      ip: context.ip,
      userAgent: context.userAgent,
    },
    action: input.action,
    target: input.target,
    riskLevel: input.riskLevel,
    status: options.status || 'allowed',
    reason: input.reason || describeRiskAction(input.action),
    confirmationRecord: options.confirmation,
    forbiddenActionHits: options.forbiddenActionHits || [],
    createdAt: now,
  };
}

function normalizeConfirmation(
  input?: BackendRiskConfirmationInput,
): BackendRiskAuditEvent['confirmationRecord'] | undefined {
  if (!input) {
    return undefined;
  }

  return {
    confirmed: input.confirmed === true,
    confirmationId: input.confirmationId,
    operator: input.operator?.trim() || '当前登录用户',
    reason: input.reason?.trim() || input.note?.trim(),
    confirmedAt: input.confirmedAt || new Date().toISOString(),
    confirmedAction: input.confirmedAction,
    confirmedRiskLevel: input.confirmedRiskLevel,
    checklist: input.checklist,
    fullPermission: false,
  };
}

function findForbiddenActionHits(input: BackendRiskGateInput) {
  const configured =
    process.env.LOCAL_ENGINE_FORBIDDEN_ACTIONS ||
    process.env.AI_CONTENT_FORBIDDEN_ACTIONS;
  const forbiddenActions = (
    configured || 'payment,transfer,clear-data,remote-shell'
  )
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const haystack =
    `${input.action} ${input.target || ''} ${input.reason || ''}`.toLowerCase();
  const patterns: Record<string, RegExp> = {
    payment: /(payment|pay|支付|扣费|购买)/i,
    transfer: /(transfer|转账)/i,
    'clear-data': /(clear-data|清空数据|清除数据|清库)/i,
    'remote-shell': /(remote-shell|ssh|sudo|chmod|rm -rf|远程命令)/i,
  };

  return forbiddenActions.filter(
    (action) =>
      patterns[action]?.test(haystack) ||
      haystack.includes(action.toLowerCase()),
  );
}

function describeRiskAction(action: BackendRiskAction) {
  const labels: Record<BackendRiskAction, string> = {
    publish: '发布内容',
    'retry-publish': '重试发布任务',
    'resume-blocked-publish': '恢复阻断发布任务',
    'batch-touch': '批量触达',
    'material-delete': '删除素材',
    'material-batch-delete': '批量删除素材',
    'remote-collect': '触发远程采集',
    'source-delete': '删除信息源',
    'source-seed': '初始化/重置信息源',
    'style-delete': '删除内容风格',
    'style-default-change': '切换默认内容风格',
    'strategy-delete': '删除内容策略',
    'strategy-default-change': '切换默认内容策略',
    'storage-remote-test': '测试对象存储远程连接',
    'schedule-enable': '启用定时任务',
    'local-file-delete': '删除本地文件或素材',
    'platform-account-delete': '删除平台账号',
    'runtime-control': '启动/停止本地运行服务',
    'remote-control': '远程或桌面接管控制',
    'agent-confirmation-approve': '批准 Agent 高风险动作',
    'interaction-approval': '批准互动发送/草稿动作',
  };
  return labels[action];
}

function normalizeHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function shortHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return `device_${Math.abs(hash).toString(36)}`;
}
