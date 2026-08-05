import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { PushNotificationsService } from './push-notifications.service';

type AuthRequest = Request & {
  authUser?: { id?: string; tenantId?: string } | null;
};

@Controller('push-notifications')
export class PushNotificationsController {
  constructor(
    private readonly pushService: PushNotificationsService,
  ) {}

  @Get('vapid-public-key')
  getVapidPublicKey() {
    return {
      success: true,
      data: { publicKey: this.pushService.getVapidPublicKey() },
      message: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  @Post('subscriptions')
  async subscribe(
    @Body()
    body: {
      endpoint?: string;
      p256dh?: string;
      auth?: string;
      userAgent?: string;
    },
    @Req() req: AuthRequest,
  ) {
    const userId = req.authUser?.id || 'local-user';
    const tenantId = req.authUser?.tenantId ?? null;
    if (!body?.endpoint || !body?.p256dh || !body?.auth) {
      return {
        success: false,
        data: null,
        message: '订阅参数不完整（endpoint/p256dh/auth 必填）',
        timestamp: new Date().toISOString(),
      };
    }
    const sub = await this.pushService.upsertSubscription({
      userId,
      tenantId,
      endpoint: body.endpoint,
      p256dh: body.p256dh,
      auth: body.auth,
      userAgent: body.userAgent ?? null,
    });
    return {
      success: true,
      data: { id: sub.id },
      message: '订阅已保存',
      timestamp: new Date().toISOString(),
    };
  }

  @Delete('subscriptions')
  async unsubscribe(
    @Query('endpoint') endpoint: string,
    @Req() req: AuthRequest,
  ) {
    const userId = req.authUser?.id || 'local-user';
    if (!endpoint) {
      return {
        success: false,
        data: null,
        message: '缺少 endpoint 参数',
        timestamp: new Date().toISOString(),
      };
    }
    await this.pushService.removeSubscription(userId, endpoint);
    return {
      success: true,
      data: null,
      message: '订阅已删除',
      timestamp: new Date().toISOString(),
    };
  }
}
