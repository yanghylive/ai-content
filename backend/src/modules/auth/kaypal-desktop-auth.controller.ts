import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Logger,
  Post,
  Res,
} from '@nestjs/common';
import { IsOptional, IsString, MinLength } from 'class-validator';
import { execFile } from 'node:child_process';
import type { Response } from 'express';
import {
  AUTH_COOKIE_NAME,
  AUTH_SESSION_DAYS,
} from './auth.constants';
import { Public } from './auth.decorator';
import { KaypalAuthClient } from './kaypal-auth.client';
import {
  createSessionToken,
  hashPassword,
  hashSessionToken,
} from './auth.utils';
import { shouldUseSecureAuthCookie } from './cookie-options';
import { PrismaService } from '../../prisma/prisma.service';

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
}

class OpenDto {
  @IsString()
  @MinLength(1)
  verificationUrl!: string;
}

@Controller('kaypal/desktop-auth')
export class KaypalDesktopAuthController {
  private readonly logger = new Logger(KaypalDesktopAuthController.name);

  constructor(
    private readonly kaypalClient: KaypalAuthClient,
    private readonly prisma: PrismaService,
  ) {}

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

  @Public()
  @Post('open')
  @HttpCode(200)
  async open(@Body() body: OpenDto) {
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
  async poll(
    @Body() body: PollDto,
    @Res({ passthrough: true }) res: Response,
  ) {
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
      const safeId = cloudUser.id
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .slice(0, 40);
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
    await this.prisma.userSession.create({
      data: {
        userId: localUser.id,
        tokenHash: hashSessionToken(sessionToken),
        expiresAt,
        metadata: {
          kaypalDesktopAccessToken: result.access_token,
          kaypalDesktopRefreshToken: result.refresh_token,
          kaypalDesktopTokenExpiresAt: new Date(
            Date.now() + result.expires_in * 1000,
          ).toISOString(),
          kaypalDesktopDeviceId: body.deviceId,
          kaypalSubscriptionPlan: cloudUser.subscriptionPlan,
          kaypalSubscriptionPeriodEnd:
            cloudUser.subscriptionPeriodEnd?.toISOString() || null,
          kaypalRole: this.normalizeKaypalRole(
            cloudUser.role,
            cloudUser.userPermissionNames,
          ),
          kaypalPlatformRole:
            cloudUser.platformRoleName || cloudUser.platformRoleId,
          kaypalPermissionNames: cloudUser.userPermissionNames,
        },
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
      user: {
        id: localUser.id,
        username: localUser.username,
        name: localUser.name,
        email: localUser.email,
        kaypalUserId: localUser.kaypalUserId,
      },
    };
  }

  private openExternalBrowser(verificationUrl: string) {
    const platform = process.platform;
    const command =
      platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
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
}
