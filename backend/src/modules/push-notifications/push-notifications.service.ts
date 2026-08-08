import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as webpush from 'web-push';

/**
 * Web Push 通知服务（PRD 16.x：移动端 PWA 推送）。
 *
 * - VAPID 密钥从环境变量读取（PUSH_VAPID_PUBLIC_KEY / PUSH_VAPID_PRIVATE_KEY），
 *   未配置时用内置开发密钥（仅限本地/内网，公网部署前必须替换）
 * - 订阅按 userId 维度存储，同一浏览器重复订阅时按 endpoint 去重
 * - 发送失败（订阅过期 410/404）自动清理失效订阅
 */
@Injectable()
export class PushNotificationsService implements OnModuleInit {
  private readonly logger = new Logger(PushNotificationsService.name);
  private readonly vapidSubject = 'mailto:admin@jiuzhang.ai';
  private readonly devPublicKey =
    'BIaVY6ZY3_xr0kRnHRgock3KYjkxVJ369sWX-qiVeHIcPM0MT1OtZyxX91c6U0kz149QJ9I9qGdPOVLlJb9Y5DQ';
  private readonly devPrivateKey =
    '5mlCdOC6K3tt4kEv30mvM59wrCQFwCrHn4yYc--pg30';

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    const publicKey = process.env.PUSH_VAPID_PUBLIC_KEY || this.devPublicKey;
    const privateKey = process.env.PUSH_VAPID_PRIVATE_KEY || this.devPrivateKey;
    webpush.setVapidDetails(this.vapidSubject, publicKey, privateKey);
    this.logger.log(
      `web-push 就绪（VAPID ${process.env.PUSH_VAPID_PUBLIC_KEY ? '来自环境变量' : '开发密钥'}）`,
    );
  }

  getVapidPublicKey(): string {
    return process.env.PUSH_VAPID_PUBLIC_KEY || this.devPublicKey;
  }

  async upsertSubscription(input: {
    userId: string;
    tenantId?: string | null;
    endpoint: string;
    p256dh: string;
    auth: string;
    userAgent?: string | null;
  }) {
    const existing = await this.prisma.pushSubscription.findUnique({
      where: { endpoint: input.endpoint },
    });
    if (existing) {
      return this.prisma.pushSubscription.update({
        where: { id: existing.id },
        data: {
          userId: input.userId,
          tenantId: input.tenantId ?? null,
          p256dh: input.p256dh,
          auth: input.auth,
          userAgent: input.userAgent ?? null,
        },
      });
    }
    return this.prisma.pushSubscription.create({
      data: {
        userId: input.userId,
        tenantId: input.tenantId ?? null,
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        userAgent: input.userAgent ?? null,
      },
    });
  }

  async removeSubscription(userId: string, endpoint: string) {
    const found = await this.prisma.pushSubscription.findUnique({
      where: { endpoint },
    });
    if (!found || found.userId !== userId) return;
    await this.prisma.pushSubscription.delete({ where: { id: found.id } });
  }

  async listSubscriptions(userId: string) {
    return this.prisma.pushSubscription.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** 向用户所有订阅发送通知；失效订阅自动清理 */
  async sendToUser(
    userId: string,
    payload: { title: string; body?: string; url?: string; tag?: string },
  ): Promise<{ sent: number; failed: number }> {
    const subs = await this.listSubscriptions(userId);
    if (subs.length === 0) return { sent: 0, failed: 0 };

    let sent = 0;
    let failed = 0;
    const serialized = JSON.stringify({
      title: payload.title,
      body: payload.body ?? '',
      url: payload.url ?? '/today',
      tag: payload.tag ?? 'default',
    });

    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          serialized,
        );
        sent += 1;
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          // 订阅已失效，清理
          await this.prisma.pushSubscription
            .delete({ where: { id: sub.id } })
            .catch(() => undefined);
          this.logger.warn(`清理失效订阅 ${sub.endpoint.slice(0, 40)}…`);
        } else {
          this.logger.warn(
            `推送失败 ${statusCode ?? ''} ${(err as Error).message.slice(0, 80)}`,
          );
        }
        failed += 1;
      }
    }
    return { sent, failed };
  }
}
