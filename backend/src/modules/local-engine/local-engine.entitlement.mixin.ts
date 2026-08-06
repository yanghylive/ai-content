/**
 * entitlement 权益簇 mixin（Kaypal 权益能力构建）。
 * 由 local-engine.service.ts 的 god class 拆解而来，EngineHost 模式。
 */
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import { AgentSidecarService } from './agent-sidecar.service';
import { KaypalAuthClient } from '../auth/kaypal-auth.client';
import { isKaypalPlanAtLeast, normalizeKaypalPlan } from '../auth/plan-order';
import { NodeAgentRuntimeService } from '../runtime/node-agent-runtime/node-agent-runtime.service';
import { toRuntimeRecord, toRuntimeString } from './local-engine.utils';

import type {
  LocalEngineCapability,
  LocalEngineCapabilityStatus,
  LocalEngineEntitlementUser,
} from './local-engine.types';

/** entitlement 权益簇的 host 接口 */
export interface EntitlementHost {
  authRequestContext?: AuthRequestContextService;
  kaypalClient?: KaypalAuthClient;
  nodeAgentRuntime?: NodeAgentRuntimeService;
  buildBlockedKaypalEntitlementCapability(
    now: string,
    summary: string,
    nextAction: string,
    checks: NonNullable<LocalEngineCapability['checks']>,
  ): LocalEngineCapability;
  buildKaypalEntitlementTimeoutFallback(
    now: string,
    user?: LocalEngineEntitlementUser,
  ): LocalEngineCapability;
  buildCachedKaypalEntitlementCapability(
    now: string,
    user: LocalEngineEntitlementUser,
    plan: string,
    warning?: string,
  ): LocalEngineCapability | null;
  buildKaypalEntitlementCapability(
    now: string,
    explicitUser?: LocalEngineEntitlementUser,
  ): Promise<LocalEngineCapability>;
  buildNodeAgentRuntimeCapability(
    now: string,
    sidecarMessage?: unknown,
  ): Promise<LocalEngineCapability>;
  buildLegacyAgentSCapability(
    now: string,
    sidecarStatus: Awaited<ReturnType<AgentSidecarService['getStatus']>>,
  ): LocalEngineCapability;
  formatCreditBalance(balance: number | null): string;
}

export function buildBlockedKaypalEntitlementCapability(
  this: EntitlementHost,
  now: string,
  summary: string,
  nextAction: string,
  checks: NonNullable<LocalEngineCapability['checks']>,
): LocalEngineCapability {
  return {
    key: 'kaypal-entitlement',
    name: 'Kaypal 账号与权益',
    status: 'blocked',
    required: true,
    summary,
    checkedAt: now,
    nextAction,
    checks,
  };
}

export function buildKaypalEntitlementTimeoutFallback(
  this: EntitlementHost,
  now: string,
  user?: LocalEngineEntitlementUser,
): LocalEngineCapability {
  const cachedCapability = user
    ? this.buildCachedKaypalEntitlementCapability(
        now,
        user,
        user.kaypalPlan || '',
        '云端权益同步超过 6 秒；本机先按已登录套餐和本地会话继续验收。',
      )
    : null;
  if (cachedCapability) {
    return cachedCapability;
  }
  return this.buildBlockedKaypalEntitlementCapability(
    now,
    'Kaypal 账号、订阅套餐和积分余额同步超时。',
    '确认 test.kaypal.cn 可访问，或在账号与设备页重新登录后刷新。',
    [
      {
        name: 'Kaypal 测试站',
        status: 'blocked',
        message: '检查超过 6 秒，不能证明授权、订阅和积分可用。',
      },
    ],
  );
}

export function buildCachedKaypalEntitlementCapability(
  this: EntitlementHost,
  now: string,
  user: LocalEngineEntitlementUser,
  plan: string,
  warning?: string,
): LocalEngineCapability | null {
  const cachedPlan = normalizeKaypalPlan(plan || user.kaypalPlan);
  const cachedPlanAllowed = isKaypalPlanAtLeast(cachedPlan, 'PRO');
  const localExecutionAllowed =
    (user.planMode || 'trial') === 'commercial' ||
    user.commercialExecutionAllowed === true ||
    (Boolean(user.kaypalPlan) &&
      user.kaypalPlanExpired !== true &&
      isKaypalPlanAtLeast(user.kaypalPlan, 'STANDARD'));

  if (!localExecutionAllowed || !cachedPlanAllowed || user.kaypalPlanExpired) {
    return null;
  }

  return {
    key: 'kaypal-entitlement',
    name: 'Kaypal 账号与权益',
    status: 'ready',
    required: true,
    summary: warning
      ? `Kaypal 会话权益可用：套餐 ${cachedPlan}；${warning}`
      : `Kaypal 会话权益可用：套餐 ${cachedPlan}。`,
    checkedAt: now,
    nextAction: warning
      ? '云端权益会继续在账号与设备页同步；本机商用执行按当前登录态和本地权限继续验收。'
      : '',
    checks: [
      {
        name: 'Kaypal 授权',
        status: 'ready',
        message: `已绑定 Kaypal 用户 ${user.kaypalUserId}，本地会话保留商用执行授权。`,
      },
      {
        name: '订阅套餐',
        status: 'ready',
        message: `本地会话套餐 ${cachedPlan}；满足 PRO / ADVANCED / FLAGSHIP 要求。`,
      },
      {
        name: '本机商用执行权限',
        status: 'ready',
        message: `planMode=${user.planMode}，commercialExecutionAllowed=${user.commercialExecutionAllowed}，kaypalPlan=${user.kaypalPlan}`,
      },
      {
        name: '积分余额',
        status: warning ? 'warning' : 'ready',
        message: warning || '云端权益同步正常。',
      },
    ],
  };
}

export async function buildKaypalEntitlementCapability(
  this: EntitlementHost,
  now: string,
  explicitUser?: LocalEngineEntitlementUser,
): Promise<LocalEngineCapability> {
  const requestContext = this.authRequestContext?.get();
  const user = explicitUser || requestContext?.user;
  if (!user) {
    return this.buildBlockedKaypalEntitlementCapability(
      now,
      '当前请求没有登录上下文，不能确认 Kaypal 授权、订阅套餐和积分余额。',
      '重新登录 Kaypal 账号后刷新运行检查。',
      [
        {
          name: '登录上下文',
          status: 'blocked',
          message: 'AuthGuard 未提供当前用户上下文。',
        },
        {
          name: '订阅套餐',
          status: 'blocked',
          message: '未读取 Kaypal 测试站订阅信息。',
        },
        {
          name: '积分余额',
          status: 'blocked',
          message: '未读取 Kaypal 测试站积分余额。',
        },
      ],
    );
  }

  if (!user.kaypalUserId) {
    return this.buildBlockedKaypalEntitlementCapability(
      now,
      '当前本地账号未绑定 Kaypal 测试站账号。',
      '在账号与设备页重新登录 Kaypal 账号。',
      [
        {
          name: 'Kaypal 绑定',
          status: 'blocked',
          message: `本地用户 ${user.id} 没有 kaypalUserId。`,
        },
        {
          name: '订阅套餐',
          status: 'blocked',
          message: '未读取 Kaypal 测试站订阅信息。',
        },
        {
          name: '积分余额',
          status: 'blocked',
          message: '未读取 Kaypal 测试站积分余额。',
        },
      ],
    );
  }

  const accessToken = toRuntimeString(user.kaypalDesktopAccessToken);
  if (!accessToken) {
    const cachedCapability = this.buildCachedKaypalEntitlementCapability(
      now,
      user,
      user.kaypalPlan || '',
      '当前会话没有可刷新的 Kaypal desktop access token；已使用本地已同步套餐继续验收。需要重新拉取云端套餐和积分时，请重新登录 Kaypal 账号。',
    );
    if (cachedCapability) {
      return cachedCapability;
    }
    return this.buildBlockedKaypalEntitlementCapability(
      now,
      'Kaypal 测试站授权已失效，不能同步订阅套餐和积分余额。',
      '在账号与设备页重新登录 Kaypal 账号。',
      [
        {
          name: 'Kaypal 授权',
          status: 'blocked',
          message: '当前会话没有可用的 Kaypal desktop access token。',
        },
        {
          name: '订阅套餐',
          status: 'blocked',
          message: '未读取 Kaypal 测试站订阅信息。',
        },
        {
          name: '积分余额',
          status: 'blocked',
          message: '未读取 Kaypal 测试站积分余额。',
        },
      ],
    );
  }

  if (!this.kaypalClient) {
    return this.buildBlockedKaypalEntitlementCapability(
      now,
      'KaypalAuthClient 未注入，不能从测试站同步权益。',
      '检查 AuthModule 与 LocalEngineModule 的依赖装配。',
      [
        {
          name: 'KaypalAuthClient',
          status: 'blocked',
          message: '服务未注入。',
        },
      ],
    );
  }

  let billing: Awaited<ReturnType<KaypalAuthClient['getCloudBilling']>>;
  try {
    billing = await this.kaypalClient.getCloudBilling(accessToken, {
      userId: user.kaypalUserId || null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    const cachedCapability = this.buildCachedKaypalEntitlementCapability(
      now,
      user,
      user.kaypalPlan || '',
      `远端权益同步暂时失败：${message}`,
    );
    if (cachedCapability) {
      return cachedCapability;
    }
    return this.buildBlockedKaypalEntitlementCapability(
      now,
      `Kaypal 测试站权益同步失败：${message}`,
      '确认 test.kaypal.cn 可访问，或在账号与设备页重新授权后刷新。',
      [
        {
          name: 'Kaypal 授权',
          status: 'blocked',
          message,
        },
      ],
    );
  }

  const subscription = toRuntimeRecord(billing.subscription) || {};
  const subscriptionUnavailable = subscription.unavailable === true;
  const plan = normalizeKaypalPlan(subscription.plan || user.kaypalPlan);
  const subscriptionStatus = toRuntimeString(subscription.status) || 'unknown';
  const subscriptionExpired =
    user.kaypalPlanExpired === true ||
    subscription.expired === true ||
    subscriptionStatus.toLowerCase() === 'expired';
  const balanceUnavailable = billing.balance.unavailable === true;
  const balance = billing.balance.balance;
  const hasBalance = balance != null;
  const planAllowed = isKaypalPlanAtLeast(plan, 'PRO');
  const balanceReady = !balanceUnavailable && hasBalance && balance > 0;
  const remoteWarning = [
    subscriptionUnavailable
      ? toRuntimeString(subscription.message) || '订阅接口不可用'
      : '',
    balanceUnavailable ? billing.balance.message || '积分余额接口不可用' : '',
    !hasBalance ? '积分余额未同步' : '',
  ]
    .filter(Boolean)
    .join('；');
  const cachedCapability = this.buildCachedKaypalEntitlementCapability(
    now,
    user,
    plan,
    remoteWarning || undefined,
  );
  if (
    cachedCapability &&
    (subscriptionUnavailable || balanceUnavailable || !hasBalance)
  ) {
    return cachedCapability;
  }
  const ready =
    !subscriptionUnavailable &&
    !subscriptionExpired &&
    planAllowed &&
    balanceReady;

  const blockerMessages = [
    subscriptionExpired ? '订阅已过期' : '',
    subscriptionUnavailable
      ? toRuntimeString(subscription.message) || '订阅接口不可用'
      : '',
    !planAllowed
      ? `当前套餐 ${plan}，启动本地服务和真实自动化需要 PRO 及以上`
      : '',
    balanceUnavailable ? billing.balance.message || '积分余额接口不可用' : '',
    !hasBalance ? '积分余额未同步' : '',
    hasBalance && balance <= 0 ? '积分余额不足' : '',
  ].filter(Boolean);

  const subscriptionReady =
    !subscriptionUnavailable && !subscriptionExpired && planAllowed;

  return {
    key: 'kaypal-entitlement',
    name: 'Kaypal 账号与权益',
    status: ready ? 'ready' : 'blocked',
    required: true,
    summary: ready
      ? `Kaypal 权益已同步：套餐 ${plan}，积分 ${this.formatCreditBalance(balance)}。`
      : `Kaypal 权益未满足运行要求：${blockerMessages[0] || '未知阻断'}`,
    checkedAt: now,
    nextAction: ready
      ? ''
      : '在 Kaypal 测试站确认订阅套餐和积分余额，然后回到账号与设备页重新授权或刷新状态。',
    checks: [
      {
        name: 'Kaypal 授权',
        status: 'ready',
        message: `已绑定 Kaypal 用户 ${user.kaypalUserId}，当前授权可访问测试站。`,
      },
      {
        name: '订阅套餐',
        status: subscriptionReady ? 'ready' : 'blocked',
        message: `当前套餐 ${plan}；运行检查启动服务要求 PRO / ADVANCED / FLAGSHIP。`,
      },
      {
        name: '订阅状态',
        status:
          subscriptionUnavailable || subscriptionExpired ? 'blocked' : 'ready',
        message: subscriptionUnavailable
          ? toRuntimeString(subscription.message) || '订阅接口不可用。'
          : `订阅状态 ${subscriptionStatus}。`,
      },
      {
        name: '积分余额',
        status: balanceReady ? 'ready' : 'blocked',
        message: balanceUnavailable
          ? billing.balance.message || 'Kaypal 积分接口不可用。'
          : `当前积分 ${this.formatCreditBalance(balance)}。`,
      },
    ],
  };
}

export async function buildNodeAgentRuntimeCapability(
  this: EntitlementHost,
  now: string,
  sidecarMessage = 'Node Runtime 模式不要求外部 Python sidecar 监听 17777；旧实现仅作为兼容/诊断项。',
): Promise<LocalEngineCapability> {
  if (!this.nodeAgentRuntime) {
    return {
      key: 'agent-s-sidecar',
      name: 'Agent-S 执行能力',
      status: 'blocked',
      required: true,
      summary: 'Node Runtime 模式已启用，但 NodeAgentRuntimeService 未注入。',
      checkedAt: now,
      nextAction: '检查 RuntimeModule 与 LocalEngineModule 的依赖装配。',
      checks: [
        {
          name: 'NodeAgentRuntimeService',
          status: 'blocked',
          message: '服务未注入，/api/agent-s/* 不能提供包内 Agent-S 执行能力。',
        },
      ],
    };
  }

  const health = await this.nodeAgentRuntime.health();
  const blockers = health.blockers || health.reasons || [];
  const browserReady = health.capabilities.browserControl === true;
  const status: LocalEngineCapabilityStatus = health.ok
    ? health.status === 'degraded'
      ? 'degraded'
      : 'ready'
    : 'blocked';

  return {
    key: 'agent-s-sidecar',
    name: 'Agent-S 执行能力',
    status,
    required: true,
    summary: health.ok
      ? `Node Agent Runtime 已就绪（runner=${health.runner_mode}）。`
      : `Node Agent Runtime 未达到真实执行标准：${blockers[0] || health.status}`,
    checkedAt: now,
    nextAction:
      health.nextAction ||
      (health.ok
        ? ''
        : '接入非 mock 的包内 Agent-S 浏览器执行器，并完成真实读写、发送、回读和证据落库。'),
    checks: [
      {
        name: 'runner_mode',
        status: 'ready',
        message: `runner_mode=${health.runner_mode}`,
      },
      {
        name: 'browserControl',
        status: browserReady ? 'ready' : 'blocked',
        message: browserReady
          ? '已接入真实浏览器控制。'
          : '浏览器控制未开启，不能执行真实平台读取、发送和回读。',
      },
      {
        name: '证据读写',
        status: health.capabilities.evidenceStore ? 'ready' : 'blocked',
        message: health.capabilities.evidenceStore
          ? '平台执行截图、页面回读和动作结果会写入本地 evidence 目录；Node Runtime artifact 作为会话索引保存。'
          : '缺少真实截图/回读/动作证据落库。',
      },
      {
        name: '外部 17777 sidecar',
        status: 'optional',
        message: sidecarMessage,
      },
    ],
  };
}

export function buildLegacyAgentSCapability(
  this: EntitlementHost,
  now: string,
  sidecarStatus: Awaited<ReturnType<AgentSidecarService['getStatus']>>,
): LocalEngineCapability {
  const runnerReady =
    sidecarStatus.available &&
    sidecarStatus.runnerMode === 'real' &&
    sidecarStatus.sessionProtocol &&
    sidecarStatus.screenshotArtifacts &&
    sidecarStatus.executionControl;
  return {
    key: 'agent-s-sidecar',
    name: 'Agent-S 执行能力',
    status: runnerReady ? 'ready' : 'blocked',
    required: true,
    summary: runnerReady
      ? sidecarStatus.message
      : `Agent-S 真实执行能力未就绪：${sidecarStatus.message}`,
    checkedAt: now,
    nextAction: runnerReady
      ? 'Agent-S 真实执行能力已接入。'
      : '旧 Python sidecar 路径必须启动 real runner，或迁移到包内 Node Runtime 真实执行层；mock/不可达不能通过。',
    checks: [
      {
        name: '执行服务',
        status: sidecarStatus.available ? 'ready' : 'blocked',
        message: sidecarStatus.available
          ? 'Agent-S 服务可访问。'
          : sidecarStatus.message,
      },
      {
        name: 'runner_mode',
        status: sidecarStatus.runnerMode === 'real' ? 'ready' : 'blocked',
        message: sidecarStatus.runnerMode
          ? `runner_mode=${sidecarStatus.runnerMode}`
          : '未读取到 runner_mode。',
      },
      {
        name: '会话协议',
        status: sidecarStatus.sessionProtocol ? 'ready' : 'blocked',
        message: sidecarStatus.sessionProtocol
          ? '会话协议可用。'
          : '会话协议不可用。',
      },
      {
        name: '截图与执行控制',
        status:
          sidecarStatus.screenshotArtifacts && sidecarStatus.executionControl
            ? 'ready'
            : 'blocked',
        message:
          sidecarStatus.screenshotArtifacts && sidecarStatus.executionControl
            ? '截图证据和执行控制可用。'
            : '截图证据或执行控制不可用。',
      },
    ],
  };
}

export function formatCreditBalance(
  this: EntitlementHost,
  balance: number | null,
): string {
  if (balance == null) return '未同步';
  return Number.isInteger(balance)
    ? String(balance)
    : balance.toLocaleString('zh-CN', {
        maximumFractionDigits: 2,
      });
}

/** mixin 挂载对象（service 底部 Object.assign） */
export const entitlementMethods = {
  buildBlockedKaypalEntitlementCapability,
  buildKaypalEntitlementTimeoutFallback,
  buildCachedKaypalEntitlementCapability,
  buildKaypalEntitlementCapability,
  buildNodeAgentRuntimeCapability,
  buildLegacyAgentSCapability,
  formatCreditBalance,
};
