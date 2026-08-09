import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Logger,
  Optional,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import type { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { AUTH_COOKIE_NAME, AUTH_SESSION_DAYS } from './auth.constants';
import { Public } from './auth.decorator';
import { KaypalAuthClient } from './kaypal-auth.client';
import {
  createSessionToken,
  hashPassword,
  hashSessionToken,
} from './auth.utils';
import { shouldUseSecureAuthCookie } from './cookie-options';
import { ensureLocalMcpAuthToken } from './local-mcp-auth';
import { PrismaService } from '../../prisma/prisma.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import type { AuthenticatedUser } from './auth.types';

class StartDto {
  @IsString()
  @MinLength(1)
  deviceId!: string;

  @IsString()
  @MinLength(1)
  deviceName!: string;

  @IsString()
  @MinLength(1)
  platform!: string;

  @IsOptional()
  @IsString()
  callbackUrl?: string;
}

class PollDto {
  @IsString()
  @MinLength(1)
  deviceCode!: string;

  @IsString()
  @MinLength(1)
  deviceId!: string;

  @IsOptional()
  @IsBoolean()
  forceReauth?: boolean;
}

class OpenDto {
  @IsString()
  @MinLength(1)
  verificationUrl!: string;
}

class McpSessionDto {
  @IsOptional()
  @IsString()
  deviceId?: string;
}

@Controller('kaypal/desktop-auth')
export class KaypalDesktopAuthController {
  private readonly logger = new Logger(KaypalDesktopAuthController.name);
  private readonly mcpWebSessionNonces = new Map<
    string,
    {
      expiresAt: Date;
      sessionToken: string;
    }
  >();

  constructor(
    private readonly kaypalClient: KaypalAuthClient,
    private readonly prisma: PrismaService,
    @Optional()
    private readonly entitlements?: EntitlementsService,
  ) {
    const authFile = ensureLocalMcpAuthToken();
    this.logger.log(`本机 MCP 会话桥已就绪：${authFile.filePath}`);
  }

  @Public()
  @Post('start')
  @HttpCode(200)
  async start(@Body() body: StartDto) {
    const result = await this.kaypalClient.startDesktopAuth({
      deviceId: body.deviceId,
      deviceName: body.deviceName,
      platform: body.platform,
    });
    return {
      deviceCode: result.device_code,
      userCode: result.user_code,
      verificationUrl: result.verification_url,
      expiresIn: result.expires_in,
      interval: result.interval ?? 5,
    };
  }

  @Post('open')
  @HttpCode(200)
  open(@Body() body: OpenDto, @Req() req: Request) {
    if (!this.isLoopbackRequest(req)) {
      throw new UnauthorizedException('打开授权页接口只允许本机调用');
    }
    if (!this.kaypalClient.isDesktopVerificationUrl(body.verificationUrl)) {
      throw new BadRequestException('Kaypal 授权地址无效');
    }
    const verificationUrl = this.kaypalClient.normalizeDesktopVerificationUrl(
      body.verificationUrl,
    );

    this.openExternalBrowser(verificationUrl);
    return { ok: true };
  }

  @Public()
  @Post('poll')
  @HttpCode(200)
  async poll(@Body() body: PollDto, @Res({ passthrough: true }) res: Response) {
    const restored = body.forceReauth
      ? null
      : await this.restoreExistingDesktopSession(body.deviceId, res);
    if (restored) {
      return restored;
    }

    const result = await this.kaypalClient.pollDesktopAuth({
      deviceCode: body.deviceCode,
      deviceId: body.deviceId,
    });

    if (result.status === 'denied') {
      return { status: 'denied' };
    }
    if (result.status === 'pending') {
      return { status: 'pending' };
    }

    // authorized: 拿 token → 查 Kaypal 用户 → 找/建本地用户 → 建 session
    const cloudUser = await this.kaypalClient.getUserFromDesktopToken(
      result.access_token,
    );
    if (!cloudUser?.id) {
      throw new BadRequestException('Kaypal 登录返回数据不完整');
    }

    let localUser = await this.prisma.user.findUnique({
      where: { kaypalUserId: cloudUser.id },
    });

    if (!localUser) {
      const safeId = cloudUser.id.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 40);
      const username = `kaypal_${safeId}`;
      const email = cloudUser.email || `${cloudUser.id}@kaypal.local`;
      const existingEmailUser = await this.prisma.user.findUnique({
        where: { email },
      });
      if (existingEmailUser) {
        if (
          existingEmailUser.kaypalUserId &&
          existingEmailUser.kaypalUserId !== cloudUser.id
        ) {
          throw new BadRequestException('该邮箱已绑定其他 Kaypal 账号');
        }
        localUser = await this.prisma.user.update({
          where: { id: existingEmailUser.id },
          data: {
            kaypalUserId: cloudUser.id,
            name:
              existingEmailUser.name ||
              cloudUser.name ||
              cloudUser.email ||
              'Kaypal 用户',
          },
        });
      } else {
        // 本地账号设个不可登录的随机密码，Kaypal 才是真正的认证入口。
        const randomPassword = `${Date.now()}-${Math.random()}-${cloudUser.id}`;
        const passwordHash = await hashPassword(randomPassword);
        try {
          localUser = await this.prisma.user.create({
            data: {
              username,
              email,
              name: cloudUser.name || cloudUser.email || 'Kaypal 用户',
              passwordHash,
              kaypalUserId: cloudUser.id,
              status: 'active',
            },
          });
        } catch (error) {
          this.logger.error(
            `创建 Kaypal 关联本地用户失败: ${
              error instanceof Error ? error.message : 'unknown'
            }`,
          );
          throw new BadRequestException('本地账号初始化失败，请稍后重试');
        }
      }
    } else if (localUser.status !== 'active') {
      throw new BadRequestException('本地账号已停用');
    }

    await this.prisma.user.update({
      where: { id: localUser.id },
      data: { lastLoginAt: new Date() },
    });

    const sessionToken = createSessionToken();
    const expiresAt = new Date(
      Date.now() + AUTH_SESSION_DAYS * 24 * 60 * 60 * 1000,
    );
    const sessionMetadata = {
      kaypalDesktopAccessToken: result.access_token,
      kaypalDesktopRefreshToken: result.refresh_token,
      kaypalDesktopTokenExpiresAt: new Date(
        Date.now() + result.expires_in * 1000,
      ).toISOString(),
      kaypalDesktopDeviceId: body.deviceId,
      kaypalSubscriptionPlan: cloudUser.subscriptionPlan,
      kaypalSubscriptionPeriodEnd:
        cloudUser.subscriptionPeriodEnd?.toISOString() || null,
      kaypalMetadataSyncedAt: new Date().toISOString(),
      kaypalRole: this.normalizeKaypalRole(
        cloudUser.role,
        cloudUser.userPermissionNames,
      ),
      kaypalPlatformRole:
        cloudUser.platformRoleName || cloudUser.platformRoleId,
      kaypalPermissionNames: cloudUser.userPermissionNames,
    };
    const tenantId = await this.ensureDesktopTenant(localUser, sessionMetadata);
    await this.prisma.userSession.create({
      data: {
        userId: localUser.id,
        tokenHash: hashSessionToken(sessionToken),
        expiresAt,
        metadata: sessionMetadata,
      },
    });

    res.cookie(AUTH_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: shouldUseSecureAuthCookie(),
      maxAge: AUTH_SESSION_DAYS * 24 * 60 * 60 * 1000,
      path: '/',
    });

    return {
      status: 'authorized',
      tenantId,
      user: {
        id: localUser.id,
        username: localUser.username,
        name: localUser.name,
        email: localUser.email,
        kaypalUserId: localUser.kaypalUserId,
      },
    };
  }

  @Public()
  @Post('mcp-session')
  @HttpCode(200)
  async createMcpSession(
    @Body() body: McpSessionDto,
    @Headers('x-kaypal-local-mcp-token') token: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.assertLocalMcpRequest(req, token);

    const restored = await this.restoreDesktopSession(body.deviceId?.trim());
    if (!restored) {
      throw new UnauthorizedException(
        '本机没有可恢复的 JIUZHANG AI 登录会话，请先在 JIUZHANG AI 桌面应用里登录。',
      );
    }

    res.cookie(AUTH_COOKIE_NAME, restored.sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: shouldUseSecureAuthCookie(),
      maxAge: AUTH_SESSION_DAYS * 24 * 60 * 60 * 1000,
      path: '/',
    });

    return {
      status: 'authorized',
      tenantId: restored.tenantId,
      cookieName: AUTH_COOKIE_NAME,
      sessionToken: restored.sessionToken,
      cookieHeader: `${AUTH_COOKIE_NAME}=${restored.sessionToken}`,
      expiresAt: restored.expiresAt.toISOString(),
      webRecoveryPath: this.createMcpWebSessionRecoveryPath(restored),
      user: {
        id: restored.user.id,
        username: restored.user.username,
        name: restored.user.name,
        email: restored.user.email,
        kaypalUserId: restored.user.kaypalUserId,
      },
    };
  }

  @Public()
  @Get('mcp-session/consume')
  consumeMcpSession(
    @Query('nonce') nonce: string | undefined,
    @Query('next') nextPath: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!this.isLoopbackRequest(req)) {
      throw new UnauthorizedException('本机网页登录恢复接口只允许本机调用');
    }

    const normalizedNonce = nonce?.trim();
    const payload = normalizedNonce
      ? this.mcpWebSessionNonces.get(normalizedNonce)
      : undefined;
    if (!normalizedNonce || !payload || payload.expiresAt <= new Date()) {
      if (normalizedNonce) {
        this.mcpWebSessionNonces.delete(normalizedNonce);
      }
      throw new UnauthorizedException('本机网页登录恢复链接已失效');
    }

    this.mcpWebSessionNonces.delete(normalizedNonce);
    res.cookie(AUTH_COOKIE_NAME, payload.sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: shouldUseSecureAuthCookie(),
      maxAge: AUTH_SESSION_DAYS * 24 * 60 * 60 * 1000,
      path: '/',
    });
    res.redirect(302, this.normalizeLocalFrontendNextPath(nextPath));
  }

  private async restoreExistingDesktopSession(deviceId: string, res: Response) {
    const restored = await this.restoreDesktopSession(deviceId);
    if (!restored) {
      return null;
    }

    res.cookie(AUTH_COOKIE_NAME, restored.sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: shouldUseSecureAuthCookie(),
      maxAge: AUTH_SESSION_DAYS * 24 * 60 * 60 * 1000,
      path: '/',
    });

    return {
      status: 'authorized',
      tenantId: restored.tenantId,
      user: {
        id: restored.user.id,
        username: restored.user.username,
        name: restored.user.name,
        email: restored.user.email,
        kaypalUserId: restored.user.kaypalUserId,
      },
    };
  }

  private async restoreDesktopSession(deviceId?: string) {
    // 安全：deviceId 必须非空——否则 !deviceId 分支会匹配到任意活跃的桌面会话，
    // 导致会话恢复绕过设备绑定（mcp-session 路径 deviceId 可空时尤为危险）。
    const normalizedDeviceId = this.toOptionalString(deviceId);
    if (!normalizedDeviceId) {
      return null;
    }
    const sessions = await this.prisma.userSession.findMany({
      include: { user: true },
      orderBy: [{ lastUsedAt: 'desc' }, { createdAt: 'desc' }],
      take: 50,
    });
    const candidates = sessions.filter((item) => {
      const metadata = this.toMetadataRecord(item.metadata);
      return (
        this.isSessionUnexpired(item.expiresAt) &&
        item.user.status === 'active' &&
        typeof metadata.kaypalDesktopDeviceId === 'string' &&
        metadata.kaypalDesktopDeviceId === normalizedDeviceId
      );
    });

    for (const session of candidates) {
      const metadata = this.toMetadataRecord(session.metadata);
      const candidateDeviceId =
        this.toOptionalString(metadata.kaypalDesktopDeviceId) || deviceId || '';
      const restorableMetadata = await this.resolveRestorableDesktopMetadata(
        metadata,
        candidateDeviceId,
      );
      if (!restorableMetadata) {
        await this.clearDesktopSessionMetadata(session.id, metadata);
        continue;
      }

      const tenantId = await this.ensureDesktopTenant(
        session.user,
        restorableMetadata,
      );

      const sessionToken = createSessionToken();
      const expiresAt = new Date(
        Date.now() + AUTH_SESSION_DAYS * 24 * 60 * 60 * 1000,
      );
      await this.prisma.userSession.create({
        data: {
          userId: session.userId,
          tokenHash: hashSessionToken(sessionToken),
          expiresAt,
          metadata: restorableMetadata as Prisma.InputJsonObject,
        },
      });

      return {
        sessionToken,
        expiresAt,
        tenantId,
        user: session.user,
      };
    }

    return null;
  }

  private isSessionUnexpired(value: unknown) {
    const expiresAt = this.toEpochMs(value);
    return Number.isFinite(expiresAt) && expiresAt > Date.now();
  }

  private toEpochMs(value: unknown) {
    if (value instanceof Date) {
      return value.getTime();
    }
    if (typeof value === 'number') {
      return value;
    }
    if (typeof value === 'bigint') {
      return Number(value);
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return Number.NaN;
      if (/^\d+$/.test(trimmed)) {
        return Number(trimmed);
      }
      return new Date(trimmed).getTime();
    }
    return Number.NaN;
  }

  private assertLocalMcpRequest(req: Request, token: string | undefined) {
    if (!this.isLoopbackRequest(req)) {
      throw new UnauthorizedException('本机 MCP 会话接口只允许本机调用');
    }

    const expected = ensureLocalMcpAuthToken().token;
    if (!token || token !== expected) {
      throw new UnauthorizedException('本机 MCP 会话密钥无效');
    }
  }

  private createMcpWebSessionRecoveryPath(restored: { sessionToken: string }) {
    const nonce = randomBytes(32).toString('base64url');
    this.mcpWebSessionNonces.set(nonce, {
      sessionToken: restored.sessionToken,
      expiresAt: new Date(Date.now() + 2 * 60 * 1000),
    });
    return `/api/kaypal/desktop-auth/mcp-session/consume?nonce=${encodeURIComponent(
      nonce,
    )}&next=${encodeURIComponent('/apps/ai-employee')}`;
  }

  private normalizeLocalFrontendNextPath(value?: string | null) {
    const fallback = '/apps/ai-employee';
    const nextPath = value?.trim() || fallback;
    if (
      !nextPath.startsWith('/') ||
      nextPath.startsWith('//') ||
      nextPath.includes('\\') ||
      /^[a-z][a-z\d+.-]*:/i.test(nextPath) ||
      Array.from(nextPath).some((character) => {
        const code = character.charCodeAt(0);
        return code <= 0x1f || code === 0x7f;
      })
    ) {
      return `http://localhost:3010${fallback}`;
    }
    return `http://localhost:3010${nextPath}`;
  }

  private isLoopbackRequest(req: Request) {
    const remoteAddress = String(
      req.socket?.remoteAddress || req.ip || '',
    ).toLowerCase();
    return (
      remoteAddress === '127.0.0.1' ||
      remoteAddress === '::1' ||
      remoteAddress === '::ffff:127.0.0.1'
    );
  }

  private async resolveRestorableDesktopMetadata(
    metadata: Record<string, unknown>,
    deviceId: string,
  ) {
    const accessToken = this.toOptionalString(
      metadata.kaypalDesktopAccessToken,
    )?.trim();
    const expiresAt = this.toOptionalString(
      metadata.kaypalDesktopTokenExpiresAt,
    );
    if (accessToken && !this.isDesktopTokenExpiring(expiresAt)) {
      return {
        ...metadata,
        kaypalMetadataSyncedAt:
          this.toOptionalString(metadata.kaypalMetadataSyncedAt) ||
          new Date().toISOString(),
      };
    }

    const refreshToken = this.toOptionalString(
      metadata.kaypalDesktopRefreshToken,
    )?.trim();
    if (!refreshToken) {
      return null;
    }

    try {
      const refreshed = await this.kaypalClient.refreshDesktopAuthToken({
        refreshToken,
        deviceId:
          this.toOptionalString(metadata.kaypalDesktopDeviceId) || deviceId,
      });
      return {
        ...metadata,
        kaypalDesktopAccessToken: refreshed.access_token,
        kaypalDesktopRefreshToken: refreshed.refresh_token,
        kaypalDesktopTokenExpiresAt: new Date(
          Date.now() + refreshed.expires_in * 1000,
        ).toISOString(),
        kaypalDesktopDeviceId: refreshed.device_id || deviceId,
        kaypalMetadataSyncedAt:
          this.toOptionalString(metadata.kaypalMetadataSyncedAt) ||
          new Date().toISOString(),
      };
    } catch (error) {
      this.logger.warn(
        `本地 Kaypal 会话恢复失败，将继续等待线上授权结果: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
      return null;
    }
  }

  private toMetadataRecord(value: unknown) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        return {};
      }
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {};
      } catch {
        return {};
      }
    }
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private async clearDesktopSessionMetadata(
    sessionId: string,
    metadata: Record<string, unknown>,
  ) {
    await this.prisma.userSession
      .update({
        where: { id: sessionId },
        data: {
          metadata: this.stripDesktopSessionMetadata(
            metadata,
          ) as Prisma.InputJsonObject,
        },
      })
      .catch(() => undefined);
  }

  private stripDesktopSessionMetadata(metadata: Record<string, unknown>) {
    const rest = { ...metadata };
    for (const key of [
      'kaypalDesktopAccessToken',
      'kaypalDesktopRefreshToken',
      'kaypalDesktopTokenExpiresAt',
      'kaypalDesktopDeviceId',
      'kaypalSubscriptionPlan',
      'kaypalSubscriptionPeriodEnd',
      'kaypalRole',
      'kaypalPlatformRole',
      'kaypalPermissionNames',
      'kaypalMetadataSyncedAt',
    ]) {
      delete rest[key];
    }
    return rest;
  }

  private toOptionalString(value: unknown) {
    return typeof value === 'string' ? value : null;
  }

  private isDesktopTokenExpiring(value?: string | null) {
    if (!value) return true;
    const expiresAt = new Date(value).getTime();
    if (!Number.isFinite(expiresAt)) return true;
    return expiresAt - Date.now() < 60_000;
  }

  private openExternalBrowser(verificationUrl: string) {
    const platform = process.platform;
    const command =
      platform === 'darwin'
        ? 'open'
        : platform === 'win32'
          ? 'cmd'
          : 'xdg-open';
    const args =
      platform === 'win32'
        ? ['/c', 'start', '""', verificationUrl]
        : [verificationUrl];

    execFile(command, args, { timeout: 3000 }, (error) => {
      if (error) {
        this.logger.warn(
          `打开 Kaypal 授权页失败: ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        );
      }
    });
  }

  private normalizeKaypalRole(role: string | null, permissionNames: string[]) {
    if (role) {
      return role;
    }
    return permissionNames.some((name) => name.endsWith(':role:owner'))
      ? 'SUPER_ADMIN'
      : null;
  }

  private async ensureDesktopTenant(
    user: {
      id: string;
      username: string;
      email: string;
      name: string;
      status: string;
      lastLoginAt: Date | null;
      kaypalUserId?: string | null;
      role: string;
      commercialExecutionAllowed: boolean;
      planMode: string;
      createdAt: Date;
      updatedAt: Date;
    },
    metadata: Record<string, unknown>,
  ) {
    if (!this.entitlements) return null;
    const periodEnd = this.toOptionalString(
      metadata.kaypalSubscriptionPeriodEnd,
    );
    const authenticatedUser: AuthenticatedUser = {
      ...user,
      kaypalPlan:
        this.toOptionalString(metadata.kaypalSubscriptionPlan) || 'FREE',
      kaypalPlanExpired: periodEnd
        ? new Date(periodEnd).getTime() <= Date.now()
        : false,
      kaypalRole: this.toOptionalString(metadata.kaypalRole),
      kaypalPlatformRole: this.toOptionalString(metadata.kaypalPlatformRole),
      kaypalPermissionNames: Array.isArray(metadata.kaypalPermissionNames)
        ? metadata.kaypalPermissionNames.filter(
            (value): value is string => typeof value === 'string',
          )
        : [],
      kaypalDesktopAccessToken: this.toOptionalString(
        metadata.kaypalDesktopAccessToken,
      ),
      kaypalDesktopRefreshToken: this.toOptionalString(
        metadata.kaypalDesktopRefreshToken,
      ),
      kaypalDesktopTokenExpiresAt: this.toOptionalString(
        metadata.kaypalDesktopTokenExpiresAt,
      ),
      kaypalDesktopDeviceId: this.toOptionalString(
        metadata.kaypalDesktopDeviceId,
      ),
    };
    const entitlement =
      await this.entitlements.getEffectiveEntitlementForUser(authenticatedUser);
    return entitlement.tenant.source === 'persisted-default'
      ? entitlement.tenant.tenantId
      : null;
  }
}
