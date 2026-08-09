import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface DeviceInfo {
  id: string;
  deviceName: string;
  platform: string;
  status: string;
  lastHeartbeatAt: Date | null;
}

/**
 * 设备注册中心（C 组/P5，主文档 4.3 C3）
 * 用户手机 agent 注册/心跳/列表/注销；超时设备标记离线。
 */
@Injectable()
export class DeviceRegistryService {
  private readonly logger = new Logger(DeviceRegistryService.name);
  private readonly heartbeatTimeoutMs = 5 * 60 * 1000; // 5 分钟无心跳视为离线

  constructor(private readonly prisma: PrismaService) {}

  /** 注册设备（同用户同设备名 upsert） */
  async register(
    userId: string,
    input: { deviceName: string; platform?: string; agentVersion?: string },
  ): Promise<DeviceInfo> {
    const deviceName = (input.deviceName || '').trim();
    if (!deviceName) throw new BadRequestException('请提供设备名称');
    const now = new Date();
    const existing = await this.prisma.mobileDevice.findFirst({
      where: { userId, deviceName },
    });
    const row = existing
      ? await this.prisma.mobileDevice.update({
          where: { id: existing.id },
          data: {
            platform: input.platform || 'android',
            agentVersion: input.agentVersion ?? null,
            status: 'online',
            lastHeartbeatAt: now,
          },
        })
      : await this.prisma.mobileDevice.create({
          data: {
            userId,
            deviceName,
            platform: input.platform || 'android',
            agentVersion: input.agentVersion ?? null,
            status: 'online',
            lastHeartbeatAt: now,
          },
        });
    this.logger.log(`设备注册/更新：${deviceName}（${row.id}）`);
    return this.toInfo(row);
  }

  /** 心跳（agent 周期性上报；标记在线） */
  async heartbeat(userId: string, deviceId: string): Promise<DeviceInfo> {
    const row = await this.prisma.mobileDevice.findFirst({
      where: { id: deviceId, userId },
    });
    if (!row) throw new BadRequestException('设备不存在');
    const updated = await this.prisma.mobileDevice.update({
      where: { id: deviceId },
      data: { status: 'online', lastHeartbeatAt: new Date() },
    });
    return this.toInfo(updated);
  }

  /** 我的设备列表（含在线状态，超时自动标记离线） */
  async list(userId: string): Promise<DeviceInfo[]> {
    const rows = await this.prisma.mobileDevice.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
    const now = Date.now();
    const out: DeviceInfo[] = [];
    for (const row of rows) {
      const online =
        row.lastHeartbeatAt &&
        now - row.lastHeartbeatAt.getTime() < this.heartbeatTimeoutMs;
      if (!online && row.status === 'online') {
        await this.prisma.mobileDevice.update({
          where: { id: row.id },
          data: { status: 'offline' },
        });
      }
      out.push(this.toInfo({ ...row, status: online ? 'online' : 'offline' }));
    }
    return out;
  }

  /** 注销设备 */
  async deregister(userId: string, deviceId: string): Promise<{ ok: boolean }> {
    const row = await this.prisma.mobileDevice.findFirst({
      where: { id: deviceId, userId },
    });
    if (!row) throw new BadRequestException('设备不存在');
    await this.prisma.mobileDevice.delete({ where: { id: deviceId } });
    this.logger.log(`设备注销：${row.deviceName}（${deviceId}）`);
    return { ok: true };
  }

  private toInfo(row: {
    id: string;
    deviceName: string;
    platform: string;
    status: string;
    lastHeartbeatAt: Date | null;
  }): DeviceInfo {
    return {
      id: row.id,
      deviceName: row.deviceName,
      platform: row.platform,
      status: row.status,
      lastHeartbeatAt: row.lastHeartbeatAt,
    };
  }
}
