import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Client } from 'pg';
import type { Request } from 'express';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { IS_PUBLIC_KEY } from './auth.decorator';
import { AUTH_COOKIE_NAME } from './auth.constants';
import { hashSessionToken, parseCookieHeader } from './auth.utils';
import type { AuthenticatedUser } from './auth.types';

type AuthenticatedRequest = Request & {
  authUser?: AuthenticatedUser;
  authSessionId?: string;
  kaypalPlan?: string;
  kaypalPlanExpired?: boolean;
  kaypalRole?: string | null;
  kaypalPlatformRole?: string | null;
  kaypalPermissionNames?: string[];
};

const KAYPAL_METADATA_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const path = request.path || request.url || '';

    if (isPublic || path === '/api' || path.startsWith('/api/docs')) {
      return true;
    }

    const cookies = parseCookieHeader(request.headers.cookie);
    const token = cookies[AUTH_COOKIE_NAME];

    if (!token) {
      throw new UnauthorizedException('请先登录');
    }

    const tokenHash = hashSessionToken(token);
    const session = await this.prisma.userSession.findFirst({
      where: {
        tokenHash,
      },
      include: {
        user: true,
      },
    });

    if (!session) {
      throw new UnauthorizedException('登录状态已失效，请重新登录');
    }

    if (session.expiresAt <= new Date()) {
      await this.prisma.userSession.delete({ where: { id: session.id } });
      throw new UnauthorizedException('登录状态已过期，请重新登录');
    }

    if (session.user.status !== 'active') {
      throw new UnauthorizedException('账号已被停用');
    }

    request.authSessionId = session.id;
    const metadata = await this.resolveSessionMetadata(
      session.id,
      session.metadata,
      session.user.kaypalUserId,
    );
    const subscriptionPeriodEnd = this.toDate(
      metadata.kaypalSubscriptionPeriodEnd,
    );
    request.kaypalPlan = this.toString(metadata.kaypalSubscriptionPlan) || 'FREE';
    request.kaypalPlanExpired = subscriptionPeriodEnd
      ? subscriptionPeriodEnd <= new Date()
      : false;
    request.kaypalRole = this.toString(metadata.kaypalRole);
    request.kaypalPlatformRole = this.toString(metadata.kaypalPlatformRole);
    request.kaypalPermissionNames = this.toStringArray(
      metadata.kaypalPermissionNames,
    );
    request.authUser = {
      id: session.user.id,
      username: session.user.username,
      email: session.user.email,
      name: session.user.name,
      status: session.user.status,
      lastLoginAt: session.user.lastLoginAt,
      kaypalUserId: session.user.kaypalUserId,
      kaypalPlan: request.kaypalPlan,
      kaypalPlanExpired: request.kaypalPlanExpired,
      kaypalRole: request.kaypalRole,
      kaypalPlatformRole: request.kaypalPlatformRole,
      kaypalPermissionNames: request.kaypalPermissionNames,
      // 本地角色 / 商用权限 / 计划模式
      role: (session.user as any).role ?? 'operator',
      commercialExecutionAllowed:
        (session.user as any).commercialExecutionAllowed ?? false,
      planMode: (session.user as any).planMode ?? 'trial',
      createdAt: session.user.createdAt,
      updatedAt: session.user.updatedAt,
    };

    await this.prisma.userSession.update({
      where: { id: session.id },
      data: { lastUsedAt: new Date() },
    });

    return true;
  }

  private toSessionMetadata(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private async resolveSessionMetadata(
    sessionId: string,
    value: unknown,
    kaypalUserId?: string | null,
  ): Promise<Record<string, unknown>> {
    const metadata = this.toSessionMetadata(value);
    const permissionNames = this.toStringArray(metadata.kaypalPermissionNames);
    const hasUsableMetadata =
      Boolean(metadata.kaypalSubscriptionPlan) &&
      (Boolean(metadata.kaypalRole) ||
        Boolean(metadata.kaypalPlatformRole) ||
        permissionNames.length > 0);
    if (hasUsableMetadata && this.isFreshMetadata(metadata)) {
      const normalizedRole = this.normalizeKaypalRole(
        this.toString(metadata.kaypalRole),
        permissionNames,
      );
      if (normalizedRole !== metadata.kaypalRole) {
        const nextMetadata = {
          ...metadata,
          kaypalRole: normalizedRole,
        };
        await this.prisma.userSession.update({
          where: { id: sessionId },
          data: { metadata: this.toJsonObject(nextMetadata) },
        });
        return nextMetadata;
      }
      return metadata;
    }

    if (!kaypalUserId) {
      return metadata;
    }

    const kaypalSnapshot = await this.loadKaypalUserSnapshot(kaypalUserId);
    if (!kaypalSnapshot) {
      return {};
    }

    const nextMetadata = {
      ...metadata,
      ...kaypalSnapshot,
    };
    await this.prisma.userSession.update({
      where: { id: sessionId },
      data: { metadata: this.toJsonObject(nextMetadata) },
    });
    return nextMetadata;
  }

  private async loadKaypalUserSnapshot(kaypalUserId: string) {
    const databaseUrl = this.config.get<string>('KAYPAL_DATABASE_URL')?.trim();
    if (!databaseUrl) {
      return null;
    }

    const client = new Client({ connectionString: databaseUrl });
    try {
      await client.connect();
      const result = await client.query<{
        subscriptionPlan: string | null;
        subscriptionPeriodEnd: Date | null;
        role: string | null;
        platformRoleName: string | null;
        platformRoleId: string | null;
        permissions: unknown;
      }>(
        `
          SELECT u."subscriptionPlan",
                 u."subscriptionPeriodEnd",
                 u.role::text AS role,
                 pr.name AS "platformRoleName",
                 u."platformRoleId",
                 u.permissions
          FROM "User" u
          LEFT JOIN platform_roles pr ON pr.id = u."platformRoleId"
          WHERE u.id = $1
          LIMIT 1
        `,
        [kaypalUserId],
      );
      const user = result.rows[0];
      if (!user) {
        return null;
      }
      const permissionNames = this.extractPermissionNames(user.permissions);
      return {
        kaypalSubscriptionPlan: this.toString(user.subscriptionPlan) || 'FREE',
        kaypalSubscriptionPeriodEnd:
          user.subscriptionPeriodEnd?.toISOString() || null,
        kaypalRole: this.normalizeKaypalRole(user.role, permissionNames),
        kaypalPlatformRole:
          this.toString(user.platformRoleName) ||
          this.toString(user.platformRoleId),
        kaypalPermissionNames: permissionNames,
        kaypalMetadataSyncedAt: new Date().toISOString(),
      };
    } catch {
      return null;
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  private isFreshMetadata(metadata: Record<string, unknown>) {
    const syncedAt = this.toDate(metadata.kaypalMetadataSyncedAt);
    return syncedAt
      ? Date.now() - syncedAt.getTime() < KAYPAL_METADATA_TTL_MS
      : false;
  }

  private normalizeKaypalRole(
    role: string | null,
    permissionNames: string[],
  ) {
    if (permissionNames.some((name) => name.endsWith(':role:owner'))) {
      return 'SUPER_ADMIN';
    }
    if (role) {
      return role;
    }
    return null;
  }

  private extractPermissionNames(value: unknown) {
    if (!value) return [];
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === 'string');
    }
    if (typeof value !== 'object') {
      return [];
    }
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.permissions)) {
      return record.permissions.filter(
        (item): item is string => typeof item === 'string',
      );
    }
    return Object.entries(record)
      .filter(([, enabled]) => Boolean(enabled))
      .map(([permission]) => permission);
  }

  private toString(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private toDate(value: unknown) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private toStringArray(value: unknown) {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  }

  private toJsonObject(
    value: Record<string, unknown>,
  ): Prisma.InputJsonObject {
    return Object.fromEntries(
      Object.entries(value).filter(([, item]) => item !== undefined),
    ) as Prisma.InputJsonObject;
  }
}
