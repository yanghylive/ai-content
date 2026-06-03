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
import { PrismaService } from '../../prisma/prisma.service';
import { KaypalAuthClient } from './kaypal-auth.client';

type AuthenticatedRequest = {
  authUser?: { id: string; kaypalUserId?: string | null };
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

  @Get('profile')
  async getProfile(@Req() req: AuthenticatedRequest) {
    const userId = await this.getLinkedKaypalUserId(req);
    return this.kaypalClient.getCloudProfile(userId);
  }

  @Get('devices')
  async getDevices(@Req() req: AuthenticatedRequest) {
    const userId = await this.getLinkedKaypalUserId(req);
    return this.kaypalClient.getCloudDevices(userId);
  }

  @Get('subscription')
  async getSubscription(@Req() req: AuthenticatedRequest) {
    const userId = await this.getLinkedKaypalUserId(req);
    return this.kaypalClient.getCloudSubscription(userId);
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
