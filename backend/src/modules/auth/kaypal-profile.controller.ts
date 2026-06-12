import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { KaypalAuthClient } from './kaypal-auth.client';

type AuthenticatedRequest = {
  authSessionId?: string;
  authUser?: {
    id: string;
    kaypalUserId?: string | null;
    kaypalDesktopAccessToken?: string | null;
    kaypalDesktopRefreshToken?: string | null;
    kaypalDesktopTokenExpiresAt?: string | null;
    kaypalDesktopDeviceId?: string | null;
  };
};

class LinkByUserIdDto {
  @IsString()
  @MinLength(1)
  kaypalUserId!: string;
}

class BindWithCredentialsDto {
  @IsString()
  @MinLength(1)
  identifier!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}

@Controller('kaypal')
export class KaypalProfileController {
  private readonly desktopTokenRefreshes = new Map<string, Promise<string>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly kaypalClient: KaypalAuthClient,
  ) {}

  private async getLinkedKaypalUserId(req: AuthenticatedRequest) {
    const localUserId = req.authUser?.id;
    if (!localUserId) {
      throw new BadRequestException('当前用户未登录');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: localUserId },
      select: { kaypalUserId: true },
    });
    if (!user?.kaypalUserId) {
      throw new BadRequestException(
        '当前本地账号未绑定 Kaypal 账号，请先在账号页绑定',
      );
    }
    return user.kaypalUserId;
  }

  private async getKaypalAccessToken(req: AuthenticatedRequest) {
    await this.getLinkedKaypalUserId(req);
    const accessToken = req.authUser?.kaypalDesktopAccessToken?.trim();
    if (accessToken && !this.isDesktopTokenExpiring(req.authUser?.kaypalDesktopTokenExpiresAt)) {
      return accessToken;
    }

    const refreshToken = req.authUser?.kaypalDesktopRefreshToken?.trim();
    const deviceId = req.authUser?.kaypalDesktopDeviceId?.trim();
    if (!refreshToken || !deviceId || !req.authSessionId) {
      throw new UnauthorizedException(
        'Kaypal 测试站授权已失效，请重新登录 Kaypal 账号',
      );
    }

    const existingRefresh = this.desktopTokenRefreshes.get(req.authSessionId);
    if (existingRefresh) {
      return existingRefresh;
    }

    const refreshTask = this.refreshAndPersistKaypalAccessToken({
      sessionId: req.authSessionId,
      refreshToken,
      deviceId,
    });
    this.desktopTokenRefreshes.set(req.authSessionId, refreshTask);
    try {
      return await refreshTask;
    } finally {
      if (this.desktopTokenRefreshes.get(req.authSessionId) === refreshTask) {
        this.desktopTokenRefreshes.delete(req.authSessionId);
      }
    }
  }

  private async refreshAndPersistKaypalAccessToken(input: {
    sessionId: string;
    refreshToken: string;
    deviceId: string;
  }) {
    const currentSession = await this.prisma.userSession.findUnique({
      where: { id: input.sessionId },
      select: { metadata: true },
    });
    const currentMetadata = this.toMetadataRecord(currentSession?.metadata);
    const currentAccessToken = this.toOptionalString(
      currentMetadata.kaypalDesktopAccessToken,
    )?.trim();
    const currentExpiresAt = this.toOptionalString(
      currentMetadata.kaypalDesktopTokenExpiresAt,
    );
    const currentRefreshToken = this.toOptionalString(
      currentMetadata.kaypalDesktopRefreshToken,
    )?.trim();

    if (
      currentAccessToken &&
      currentRefreshToken &&
      currentRefreshToken !== input.refreshToken &&
      !this.isDesktopTokenExpiring(currentExpiresAt)
    ) {
      return currentAccessToken;
    }

    let refreshed;
    try {
      refreshed = await this.kaypalClient.refreshDesktopAuthToken({
        refreshToken: currentRefreshToken || input.refreshToken,
        deviceId:
          this.toOptionalString(currentMetadata.kaypalDesktopDeviceId) ||
          input.deviceId,
      });
    } catch (error) {
      await this.prisma.userSession
        .update({
          where: { id: input.sessionId },
          data: {
            metadata: this.stripKaypalDesktopTokens(
              currentMetadata,
            ) as Prisma.InputJsonObject,
          },
        })
        .catch(() => undefined);
      throw new UnauthorizedException(
        'Kaypal 测试站授权已过期，请重新登录 Kaypal 账号',
      );
    }
    const nextMetadata = {
      kaypalDesktopAccessToken: refreshed.access_token,
      kaypalDesktopRefreshToken: refreshed.refresh_token,
      kaypalDesktopTokenExpiresAt: new Date(
        Date.now() + refreshed.expires_in * 1000,
      ).toISOString(),
      kaypalDesktopDeviceId: refreshed.device_id || input.deviceId,
    };
    await this.prisma.userSession.update({
      where: { id: input.sessionId },
      data: {
        metadata: {
          ...currentMetadata,
          ...nextMetadata,
        } as Prisma.InputJsonObject,
      },
    });
    return refreshed.access_token;
  }

  private toMetadataRecord(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private toOptionalString(value: unknown) {
    return typeof value === 'string' ? value : null;
  }

  private stripKaypalDesktopTokens(metadata: Record<string, unknown>) {
    const {
      kaypalDesktopAccessToken: _accessToken,
      kaypalDesktopRefreshToken: _refreshToken,
      kaypalDesktopTokenExpiresAt: _tokenExpiresAt,
      kaypalDesktopDeviceId: _deviceId,
      ...rest
    } = metadata;
    return rest;
  }

  private extractSubscriptionMetadata(value: unknown) {
    const record = this.asRecord(value) || {};
    const data = this.asRecord(record.data) || record;
    const subscription =
      this.asRecord(data.subscription) ||
      this.asRecord(record.subscription) ||
      data;
    const planRecord = this.asRecord(subscription.plan);
    const plan =
      this.toOptionalString(planRecord?.legacyId) ||
      this.toOptionalString(planRecord?.code) ||
      this.toOptionalString(planRecord?.id) ||
      this.toOptionalString(subscription.plan) ||
      this.toOptionalString(subscription.subscriptionPlan);
    const periodEnd =
      this.toOptionalString(subscription.periodEnd) ||
      this.toOptionalString(subscription.currentPeriodEnd) ||
      this.toOptionalString(subscription.endDate) ||
      this.toOptionalString(subscription.nextBillingDate) ||
      this.toOptionalString(subscription.subscriptionPeriodEnd);

    return {
      plan: plan?.trim() || '',
      periodEnd: periodEnd?.trim() || null,
    };
  }

  private async syncSessionSubscriptionMetadata(
    req: AuthenticatedRequest,
    subscriptionPayload: unknown,
  ) {
    if (!req.authSessionId) return;
    const extracted = this.extractSubscriptionMetadata(subscriptionPayload);
    if (!extracted.plan) return;

    const session = await this.prisma.userSession.findUnique({
      where: { id: req.authSessionId },
      select: { metadata: true },
    });
    const metadata = this.toMetadataRecord(session?.metadata);
    await this.prisma.userSession.update({
      where: { id: req.authSessionId },
      data: {
        metadata: {
          ...metadata,
          kaypalSubscriptionPlan: extracted.plan,
          kaypalSubscriptionPeriodEnd: extracted.periodEnd,
          kaypalMetadataSyncedAt: new Date().toISOString(),
        } as Prisma.InputJsonObject,
      },
    });
  }

  private isDesktopTokenExpiring(value?: string | null) {
    if (!value) return true;
    const expiresAt = new Date(value).getTime();
    if (!Number.isFinite(expiresAt)) return true;
    return expiresAt - Date.now() < 60_000;
  }

  @Get('profile')
  async getProfile(@Req() req: AuthenticatedRequest) {
    const accessToken = await this.getKaypalAccessToken(req);
    return this.kaypalClient.getCloudProfile(accessToken);
  }

  @Get('devices')
  async getDevices(@Req() req: AuthenticatedRequest) {
    const accessToken = await this.getKaypalAccessToken(req);
    return this.kaypalClient.getCloudDevices(accessToken);
  }

  @Get('subscription')
  async getSubscription(@Req() req: AuthenticatedRequest) {
    const accessToken = await this.getKaypalAccessToken(req);
    const subscription = await this.kaypalClient.getCloudSubscription(accessToken);
    await this.syncSessionSubscriptionMetadata(req, subscription);
    return subscription;
  }

  @Get('billing')
  async getBilling(@Req() req: AuthenticatedRequest) {
    const accessToken = await this.getKaypalAccessToken(req);
    const billing = await this.kaypalClient.getCloudBilling(accessToken);
    await this.syncSessionSubscriptionMetadata(
      req,
      this.toMetadataRecord(billing).subscription || billing,
    );
    return billing;
  }

  @Post('link')
  @HttpCode(200)
  async linkKaypalAccount(
    @Req() req: AuthenticatedRequest,
    @Body() body: LinkByUserIdDto,
  ) {
    const localUserId = req.authUser?.id;
    if (!localUserId) {
      throw new BadRequestException('当前用户未登录');
    }
    const kaypalUserId = body.kaypalUserId.trim();
    if (!kaypalUserId) {
      throw new BadRequestException('kaypalUserId 不能为空');
    }
    const existing = await this.prisma.user.findUnique({
      where: { kaypalUserId },
      select: { id: true },
    });
    if (existing && existing.id !== localUserId) {
      throw new BadRequestException('该 Kaypal 账号已绑定到其他本地账号');
    }
    await this.prisma.user.update({
      where: { id: localUserId },
      data: { kaypalUserId },
    });
    return { ok: true, kaypalUserId };
  }

  @Post('bind-with-credentials')
  @HttpCode(200)
  async bindWithCredentials(
    @Req() req: AuthenticatedRequest,
    @Body() body: BindWithCredentialsDto,
  ) {
    const localUserId = req.authUser?.id;
    if (!localUserId) {
      throw new UnauthorizedException('当前用户未登录');
    }
    const identifier = body.identifier.trim();

    let cloudUser;
    try {
      cloudUser = await this.kaypalClient.login(identifier, body.password);
    } catch (err) {
      // KaypalAuthClient 已经把 401/400 转成 UnauthorizedException，其他转成 ServiceUnavailable
      throw err;
    }

    if (!cloudUser?.id) {
      throw new BadRequestException('Kaypal 登录返回数据不完整');
    }

    const existing = await this.prisma.user.findUnique({
      where: { kaypalUserId: cloudUser.id },
      select: { id: true },
    });
    if (existing && existing.id !== localUserId) {
      throw new BadRequestException('该 Kaypal 账号已绑定到其他本地账号');
    }

    await this.prisma.user.update({
      where: { id: localUserId },
      data: { kaypalUserId: cloudUser.id },
    });

    return {
      ok: true,
      kaypalUserId: cloudUser.id,
      email: cloudUser.email,
      displayName: cloudUser.name,
    };
  }

  @Post('unlink')
  @HttpCode(200)
  async unlinkKaypalAccount(@Req() req: AuthenticatedRequest) {
    const localUserId = req.authUser?.id;
    if (!localUserId) {
      throw new UnauthorizedException('当前用户未登录');
    }
    await this.prisma.user.update({
      where: { id: localUserId },
      data: { kaypalUserId: null },
    });
    return { ok: true };
  }
}
