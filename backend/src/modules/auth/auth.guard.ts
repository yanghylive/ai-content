import { CanActivate, ExecutionContext, Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { IS_PUBLIC_KEY } from './auth.decorator';
import { AUTH_COOKIE_NAME } from './auth.constants';
import { hashSessionToken, parseCookieHeader } from './auth.utils';
import type { AuthenticatedUser } from './auth.types';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import { KaypalAuthClient } from './kaypal-auth.client';

type AuthenticatedRequest = Request & {
  authUser?: AuthenticatedUser;
  authSessionId?: string;
  kaypalPlan?: string;
  kaypalPlanExpired?: boolean;
  kaypalRole?: string | null;
  kaypalPlatformRole?: string | null;
  kaypalPermissionNames?: string[];
};

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly kaypalClient: KaypalAuthClient,
    @Optional()
    private readonly authRequestContext?: AuthRequestContextService,
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
      kaypalDesktopAccessToken: this.toString(metadata.kaypalDesktopAccessToken),
      kaypalDesktopRefreshToken: this.toString(
        metadata.kaypalDesktopRefreshToken,
      ),
      kaypalDesktopTokenExpiresAt: this.toString(
        metadata.kaypalDesktopTokenExpiresAt,
      ),
      kaypalDesktopDeviceId: this.toString(metadata.kaypalDesktopDeviceId),
      // 本地角色 / 商用权限 / 计划模式
      role: (session.user as any).role ?? 'operator',
      commercialExecutionAllowed:
        (session.user as any).commercialExecutionAllowed ?? false,
      planMode: (session.user as any).planMode ?? 'trial',
      createdAt: session.user.createdAt,
      updatedAt: session.user.updatedAt,
    };

    this.authRequestContext?.enter({
      sessionId: session.id,
      user: request.authUser,
    });

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
    const hasUsableMetadata = Boolean(metadata.kaypalSubscriptionPlan);

    if (!kaypalUserId) {
      return metadata;
    }

    if (!this.hasKaypalDesktopToken(metadata)) {
      const stripped = this.stripKaypalEntitlementMetadata(metadata);
      await this.persistSessionMetadata(sessionId, stripped);
      throw new UnauthorizedException(
        'Kaypal 测试站授权已失效，请重新登录 Kaypal 账号',
      );
    }

    if (!this.hasUsableKaypalDesktopAccessToken(metadata)) {
      return this.refreshAndSyncKaypalMetadata(sessionId, metadata);
    }

    if (hasUsableMetadata) {
      const nextMetadata = await this.normalizeAndPersistKaypalRole(
        sessionId,
        metadata,
        permissionNames,
      );
      return nextMetadata;
    }

    const accessToken = this.toString(metadata.kaypalDesktopAccessToken);
    if (accessToken) {
      return this.syncKaypalMetadataFromAccessToken(
        sessionId,
        metadata,
        accessToken,
      );
    }

    return this.refreshAndSyncKaypalMetadata(sessionId, metadata);
  }

  private async normalizeAndPersistKaypalRole(
    sessionId: string,
    metadata: Record<string, unknown>,
    permissionNames: string[],
  ) {
    const normalizedRole = this.normalizeKaypalRole(
      this.toString(metadata.kaypalRole),
      permissionNames,
    );
    if (normalizedRole === metadata.kaypalRole) {
      return metadata;
    }

    const nextMetadata = {
      ...metadata,
      kaypalRole: normalizedRole,
    };
    await this.persistSessionMetadata(sessionId, nextMetadata);
    return nextMetadata;
  }

  private async refreshAndSyncKaypalMetadata(
    sessionId: string,
    metadata: Record<string, unknown>,
  ) {
    const refreshToken = this.toString(metadata.kaypalDesktopRefreshToken);
    const deviceId = this.toString(metadata.kaypalDesktopDeviceId);
    if (!refreshToken || !deviceId) {
      await this.persistSessionMetadata(
        sessionId,
        this.stripKaypalDesktopSessionMetadata(metadata),
      );
      throw new UnauthorizedException(
        'Kaypal 测试站授权已失效，请重新登录 Kaypal 账号',
      );
    }

    try {
      const refreshed = await this.kaypalClient.refreshDesktopAuthToken({
        refreshToken,
        deviceId,
      });
      const tokenMetadata = {
        ...metadata,
        kaypalDesktopAccessToken: refreshed.access_token,
        kaypalDesktopRefreshToken: refreshed.refresh_token,
        kaypalDesktopTokenExpiresAt: new Date(
          Date.now() + refreshed.expires_in * 1000,
        ).toISOString(),
        kaypalDesktopDeviceId: refreshed.device_id || deviceId,
      };
      return await this.syncKaypalMetadataFromAccessToken(
        sessionId,
        tokenMetadata,
        refreshed.access_token,
      );
    } catch {
      const concurrentMetadata =
        await this.getConcurrentRefreshedKaypalMetadata(sessionId, metadata);
      if (concurrentMetadata) {
        return concurrentMetadata;
      }
      await this.persistSessionMetadata(
        sessionId,
        this.stripKaypalDesktopSessionMetadata(metadata),
      );
      throw new UnauthorizedException(
        'Kaypal 测试站授权已过期，请重新登录 Kaypal 账号',
      );
    }
  }

  private async syncKaypalMetadataFromAccessToken(
    sessionId: string,
    metadata: Record<string, unknown>,
    accessToken: string,
  ) {
    try {
      const cloudUser = await this.kaypalClient.getUserFromDesktopToken(
        accessToken,
      );
      const permissionNames = cloudUser.userPermissionNames || [];
      const nextMetadata = {
        ...metadata,
        kaypalSubscriptionPlan: cloudUser.subscriptionPlan,
        kaypalSubscriptionPeriodEnd:
          cloudUser.subscriptionPeriodEnd?.toISOString() || null,
        kaypalMetadataSyncedAt: new Date().toISOString(),
        kaypalRole: this.normalizeKaypalRole(cloudUser.role, permissionNames),
        kaypalPlatformRole:
          cloudUser.platformRoleName || cloudUser.platformRoleId,
        kaypalPermissionNames: permissionNames,
      };
      await this.persistSessionMetadata(sessionId, nextMetadata);
      return nextMetadata;
    } catch {
      const concurrentMetadata =
        await this.getConcurrentRefreshedKaypalMetadata(sessionId, metadata);
      if (concurrentMetadata) {
        return concurrentMetadata;
      }
      await this.persistSessionMetadata(
        sessionId,
        this.stripKaypalDesktopSessionMetadata(metadata),
      );
      throw new UnauthorizedException(
        'Kaypal 测试站授权已过期，请重新登录 Kaypal 账号',
      );
    }
  }

  private stripKaypalEntitlementMetadata(metadata: Record<string, unknown>) {
    const {
      kaypalSubscriptionPlan: _kaypalSubscriptionPlan,
      kaypalSubscriptionPeriodEnd: _kaypalSubscriptionPeriodEnd,
      kaypalRole: _kaypalRole,
      kaypalPlatformRole: _kaypalPlatformRole,
      kaypalPermissionNames: _kaypalPermissionNames,
      kaypalMetadataSyncedAt: _kaypalMetadataSyncedAt,
      ...rest
    } = metadata;
    return rest;
  }

  private stripKaypalDesktopSessionMetadata(metadata: Record<string, unknown>) {
    const {
      kaypalDesktopAccessToken: _kaypalDesktopAccessToken,
      kaypalDesktopRefreshToken: _kaypalDesktopRefreshToken,
      kaypalDesktopTokenExpiresAt: _kaypalDesktopTokenExpiresAt,
      kaypalDesktopDeviceId: _kaypalDesktopDeviceId,
      ...withoutDesktopTokens
    } = metadata;
    return this.stripKaypalEntitlementMetadata(withoutDesktopTokens);
  }

  private async getConcurrentRefreshedKaypalMetadata(
    sessionId: string,
    staleMetadata: Record<string, unknown>,
  ) {
    const currentSession = await this.prisma.userSession.findUnique({
      where: { id: sessionId },
      select: { metadata: true },
    });
    const currentMetadata = this.toSessionMetadata(currentSession?.metadata);
    const tokenChanged =
      this.toString(currentMetadata.kaypalDesktopAccessToken) !==
        this.toString(staleMetadata.kaypalDesktopAccessToken) ||
      this.toString(currentMetadata.kaypalDesktopRefreshToken) !==
        this.toString(staleMetadata.kaypalDesktopRefreshToken);

    if (
      tokenChanged &&
      this.hasUsableKaypalDesktopAccessToken(currentMetadata) &&
      Boolean(currentMetadata.kaypalSubscriptionPlan)
    ) {
      return currentMetadata;
    }

    return null;
  }

  private hasKaypalDesktopToken(metadata: Record<string, unknown>) {
    return Boolean(
      this.toString(metadata.kaypalDesktopAccessToken) ||
        this.toString(metadata.kaypalDesktopRefreshToken),
    );
  }

  private hasUsableKaypalDesktopAccessToken(metadata: Record<string, unknown>) {
    return Boolean(
      this.toString(metadata.kaypalDesktopAccessToken) &&
        !this.isDesktopTokenExpiring(metadata.kaypalDesktopTokenExpiresAt),
    );
  }

  private isDesktopTokenExpiring(value: unknown) {
    const expiresAt = this.toDate(value);
    if (!expiresAt) return true;
    return expiresAt.getTime() - Date.now() < 60_000;
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

  private async persistSessionMetadata(
    sessionId: string,
    metadata: Record<string, unknown>,
  ) {
    await this.prisma.userSession.update({
      where: { id: sessionId },
      data: { metadata: this.toJsonObject(metadata) },
    });
  }
}
