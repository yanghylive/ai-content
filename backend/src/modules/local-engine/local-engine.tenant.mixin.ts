// local-engine 租户/能力簇（god class 拆解阶段 2——mixin 化）
// 方法挂载到 LocalEngineService.prototype（Object.assign）；跨块依赖走 TenantHost 接口：
// authRequestContext/configService/prisma 字段。

import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuthRequestContextService } from '../../common/auth-request-context.service';
import { isKaypalPlanAtLeast } from '../auth/plan-order';
import type {
  InteractionTaskBillingIdentity,
  LocalEngineTenantScope,
} from './local-engine.types';

/** 租户/能力簇的 host 接口：簇方法访问的 service 成员 */
export interface TenantHost {
  authRequestContext?: AuthRequestContextService;
  configService: ConfigService;
  prisma: PrismaService;
}

export async function resolveTenantScope(
  this: TenantHost,
): Promise<LocalEngineTenantScope> {
  const context = this.authRequestContext?.get();
  const user = context?.user;
  const userId = user?.id?.trim() || '';
  if (!userId) {
    throw new UnauthorizedException('请先登录后访问客户互动数据。');
  }

  const requestedTenantId =
    context?.requestedTenantId?.trim() || context?.tenantId?.trim() || '';
  if (requestedTenantId) {
    if (
      user?.kaypalLocalOnly === true &&
      requestedTenantId === `local-desktop:${userId}`
    ) {
      return { tenantId: requestedTenantId, userId };
    }
    const membership = await this.prisma.tenantMember.findFirst({
      where: {
        userId,
        tenantId: requestedTenantId,
        status: 'active',
        tenant: { status: 'active' },
      },
      select: { tenantId: true },
    });
    if (membership?.tenantId === requestedTenantId) {
      return { tenantId: requestedTenantId, userId };
    }
    throw new ForbiddenException('当前账号无权访问指定组织。');
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
    if (user?.kaypalLocalOnly !== true) {
      throw error;
    }
  }

  if (user?.kaypalLocalOnly === true) {
    return { tenantId: `local-desktop:${userId}`, userId };
  }

  throw new ForbiddenException('当前账号尚未绑定可用组织。');
}

export function tenantScopeKey(
  this: TenantHost,
  scope: LocalEngineTenantScope,
) {
  return `${scope.tenantId}\u0000${scope.userId}`;
}

export function isInTenantScope(
  this: TenantHost,
  record: { tenantId?: string | null; userId?: string | null },
  scope: LocalEngineTenantScope,
) {
  return record.tenantId === scope.tenantId && record.userId === scope.userId;
}

export function tenantScopeForRecord(
  this: TenantHost,
  record: {
    tenantId?: string | null;
    userId?: string | null;
  },
): LocalEngineTenantScope {
  if (!record.tenantId || !record.userId) {
    throw new ForbiddenException('记录缺少租户归属，已拒绝访问。');
  }
  return { tenantId: record.tenantId, userId: record.userId };
}

export function useNodeAgentRuntime(this: TenantHost): boolean {
  const value = (
    this.configService.get<string>('KAYPAL_NODE_AGENT_RUNTIME') || ''
  )
    .trim()
    .toLowerCase();
  return value !== '0' && value !== 'false';
}

export function buildCurrentInteractionTaskBillingIdentity(
  this: TenantHost,
): InteractionTaskBillingIdentity | undefined {
  const context = this.authRequestContext?.get();
  const user = context?.user;
  const sessionId = context?.sessionId?.trim() || '';
  const localUserId = user?.id?.trim() || '';
  const kaypalUserId = user?.kaypalUserId?.trim() || '';
  const deviceId = user?.kaypalDesktopDeviceId?.trim() || '';

  if (!sessionId || !localUserId || !kaypalUserId) {
    return undefined;
  }

  return {
    sessionId,
    localUserId,
    kaypalUserId,
    kaypalDesktopTokenExpiresAt:
      user?.kaypalDesktopTokenExpiresAt?.trim() || undefined,
    kaypalDesktopDeviceId: deviceId || undefined,
    kaypalPlan: user?.kaypalPlan,
    kaypalRole: user?.kaypalRole,
    kaypalPlatformRole: user?.kaypalPlatformRole,
    commercialExecutionAllowed: user?.commercialExecutionAllowed,
    planMode: user?.planMode,
    capturedAt: new Date().toISOString(),
  };
}

export function allowLocalPlanBypass(this: TenantHost): boolean {
  return (
    this.configService.get<string>('KAYPAL_ALLOW_LOCAL_PLAN_BYPASS') === 'true'
  );
}

export function currentActorCommercialAllowed(this: TenantHost): boolean {
  const user = this.authRequestContext?.get()?.user;
  return (
    user?.commercialExecutionAllowed === true ||
    (Boolean(user?.kaypalPlan) &&
      user?.kaypalPlanExpired !== true &&
      isKaypalPlanAtLeast(user?.kaypalPlan, 'STANDARD'))
  );
}

export function isPrismaTableMissingError(
  this: TenantHost,
  error: unknown,
  tableName?: string,
) {
  const code =
    error instanceof Prisma.PrismaClientKnownRequestError
      ? error.code
      : undefined;
  const message =
    error instanceof Error ? error.message : JSON.stringify(error);
  const missing =
    code === 'P2021' ||
    /does not exist in the current database/i.test(message) ||
    /no such table/i.test(message);
  return missing && (!tableName || message.includes(tableName));
}

export const tenantMethods = {
  resolveTenantScope,
  tenantScopeKey,
  isInTenantScope,
  tenantScopeForRecord,
  useNodeAgentRuntime,
  buildCurrentInteractionTaskBillingIdentity,
  allowLocalPlanBypass,
  currentActorCommercialAllowed,
  isPrismaTableMissingError,
};
