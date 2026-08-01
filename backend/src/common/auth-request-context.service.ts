import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantMembershipReader {
  tenantMember: {
    findMany(args: unknown): Promise<Array<{ tenantId: string }>>;
  };
}

export interface AuthRequestContextUser {
  id: string;
  kaypalUserId?: string | null;
  kaypalPlan?: string;
  kaypalPlanExpired?: boolean;
  kaypalRole?: string | null;
  kaypalPlatformRole?: string | null;
  kaypalPermissionNames?: string[];
  kaypalDesktopAccessToken?: string | null;
  kaypalDesktopRefreshToken?: string | null;
  kaypalDesktopTokenExpiresAt?: string | null;
  kaypalDesktopDeviceId?: string | null;
  kaypalLocalOnly?: boolean;
  planMode?: string;
  commercialExecutionAllowed?: boolean;
}

export interface AuthRequestContext {
  sessionId?: string;
  requestedTenantId?: string;
  tenantId?: string;
  user?: AuthRequestContextUser;
}

@Injectable()
export class AuthRequestContextService {
  private readonly storage = new AsyncLocalStorage<AuthRequestContext>();

  run<T>(context: AuthRequestContext, callback: () => T): T {
    return this.storage.run(context, callback);
  }

  enter(context: AuthRequestContext) {
    const current = this.storage.getStore();
    if (current) {
      Object.assign(current, context);
      return;
    }

    this.storage.enterWith(context);
  }

  get() {
    return this.storage.getStore();
  }

  hasContext() {
    return this.storage.getStore() !== undefined;
  }

  async resolveTenantId(prisma: TenantMembershipReader): Promise<string> {
    const context = this.storage.getStore();
    if (!context) {
      throw new UnauthorizedException('缺少登录上下文，不能选择租户。');
    }

    const userId = context.user?.id?.trim() || '';
    if (!userId) {
      throw new UnauthorizedException('请先登录后选择租户。');
    }

    const requestedTenantId = context.requestedTenantId?.trim() || '';
    if (context.tenantId) {
      if (!requestedTenantId || context.tenantId === requestedTenantId) {
        return context.tenantId;
      }
    }

    const memberships = await prisma.tenantMember.findMany({
      where: {
        userId,
        status: 'active',
        tenant: { status: 'active' },
      },
      orderBy: [{ joinedAt: 'asc' }, { createdAt: 'asc' }],
      select: { tenantId: true },
    });
    const tenantIds = Array.from(
      new Set(
        memberships
          .map((membership) => membership.tenantId?.trim())
          .filter((tenantId): tenantId is string => Boolean(tenantId)),
      ),
    );

    if (requestedTenantId) {
      if (tenantIds.includes(requestedTenantId)) {
        context.tenantId = requestedTenantId;
        return requestedTenantId;
      }

      throw new ForbiddenException({
        code: 'TENANT_MEMBERSHIP_REQUIRED',
        message:
          'x-tenant-id 指向的租户没有当前用户的 active membership，请选择当前账号所属的 active 租户。',
        publicDetails: {
          header: 'x-tenant-id',
          requestedTenantId,
          availableTenantIds: tenantIds,
          nextAction: '将 x-tenant-id 改为当前账号所属的 active 租户。',
        },
      });
    }

    if (tenantIds.length > 1) {
      throw new ConflictException({
        code: 'TENANT_SELECTION_REQUIRED',
        message:
          '当前账号属于多个 active 租户，请在请求头 x-tenant-id 中明确选择一个。',
        publicDetails: {
          header: 'x-tenant-id',
          availableTenantIds: tenantIds,
          nextAction: '从 availableTenantIds 中选择一个并重试请求。',
        },
      });
    }

    if (tenantIds.length === 1) {
      context.tenantId = tenantIds[0];
      return tenantIds[0];
    }

    if (context.user?.kaypalLocalOnly === true) {
      const localTenantId = `local-desktop:${userId}`;
      context.tenantId = localTenantId;
      return localTenantId;
    }

    throw new ForbiddenException('当前账号尚未绑定可用组织。');
  }
}
