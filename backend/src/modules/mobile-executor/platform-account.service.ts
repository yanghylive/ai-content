import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 平台账号实体（P2-27）：账号昵称/登录态/绑定设备/风控，
 * 供「发送前确认登录的是哪个账号」+ 账号锁/租约关联。
 */
@Injectable()
export class PlatformAccountService {
  private readonly logger = new Logger(PlatformAccountService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 注册/更新账号（同用户+平台+accountId upsert） */
  async upsert(
    userId: string,
    input: {
      platform: string;
      accountId: string;
      nickname?: string;
      loginStatus?: string;
      boundDeviceId?: string;
      riskStatus?: string;
    },
  ): Promise<{ id: string; accountId: string; platform: string }> {
    const platform = (input.platform || '').trim();
    const accountId = (input.accountId || '').trim();
    if (!platform || !accountId) {
      throw new BadRequestException('platform/accountId 不能为空');
    }
    const row = await this.prisma.platformAccount.upsert({
      where: { userId_platform_accountId: { userId, platform, accountId } },
      update: {
        nickname: input.nickname ?? null,
        loginStatus: input.loginStatus ?? 'unknown',
        boundDeviceId: input.boundDeviceId ?? null,
        riskStatus: input.riskStatus ?? 'normal',
      },
      create: {
        userId,
        platform,
        accountId,
        nickname: input.nickname ?? null,
        loginStatus: input.loginStatus ?? 'unknown',
        boundDeviceId: input.boundDeviceId ?? null,
        riskStatus: input.riskStatus ?? 'normal',
      },
    });
    this.logger.log(`平台账号已登记：${platform}/${accountId}（${row.id}）`);
    return { id: row.id, accountId, platform };
  }

  /** 账号列表 */
  async list(userId: string) {
    const rows = await this.prisma.platformAccount.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      platform: r.platform,
      accountId: r.accountId,
      nickname: r.nickname,
      loginStatus: r.loginStatus,
      boundDeviceId: r.boundDeviceId,
      riskStatus: r.riskStatus,
      updatedAt: r.updatedAt,
    }));
  }

  /** 更新账号状态（登录态/绑定设备/风控） */
  async update(
    userId: string,
    accountId: string,
    input: {
      nickname?: string;
      loginStatus?: string;
      boundDeviceId?: string | null;
      riskStatus?: string;
    },
  ): Promise<{ id: string }> {
    const existing = await this.prisma.platformAccount.findFirst({
      where: { userId, accountId },
    });
    if (!existing) throw new BadRequestException('账号不存在');
    const updated = await this.prisma.platformAccount.update({
      where: { id: existing.id },
      data: {
        ...(input.nickname !== undefined ? { nickname: input.nickname } : {}),
        ...(input.loginStatus !== undefined
          ? { loginStatus: input.loginStatus }
          : {}),
        ...(input.boundDeviceId !== undefined
          ? { boundDeviceId: input.boundDeviceId }
          : {}),
        ...(input.riskStatus !== undefined
          ? { riskStatus: input.riskStatus }
          : {}),
      },
    });
    return { id: updated.id };
  }
}
