import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';

export interface DeviceInfo {
  id: string;
  deviceName: string;
  platform: string;
  status: string;
  lastHeartbeatAt: Date | null;
  capabilities: Record<string, unknown> | null;
}

/** 注册响应（含明文设备 token，仅注册时返回一次，P0-4） */
export interface DeviceRegistration extends DeviceInfo {
  deviceToken: string;
}

/**
 * 设备注册中心（C 组/P5，主文档 4.3 C3）
 * 用户手机 agent 注册/心跳/列表/注销；超时设备标记离线。
 */
@Injectable()
export class DeviceRegistryService {
  private readonly logger = new Logger(DeviceRegistryService.name);
  private readonly heartbeatTimeoutMs = 5 * 60 * 1000; // 5 分钟无心跳视为离线
  private readonly leaseTtlMs = 10 * 60 * 1000; // 租约 TTL（与 task-dispatch 一致，心跳续租）
  private readonly recoveryProtectionMs = 5 * 60 * 1000; // 恢复保护期（心跳超时后冻结外发 5 分钟，防重复外发）

  constructor(private readonly prisma: PrismaService) {}

  /** 注册设备（同用户同 deviceUuid 或设备名 upsert；生成设备 token，P0-4） */
  async register(
    userId: string,
    input: {
      deviceName: string;
      platform?: string;
      agentVersion?: string;
      deviceUuid?: string;
      capabilities?: Record<string, unknown>;
    },
  ): Promise<DeviceRegistration> {
    const deviceName = (input.deviceName || '').trim();
    if (!deviceName) throw new BadRequestException('请提供设备名称');
    const now = new Date();
    // P1-15：优先按 deviceUuid 定位稳定设备（避免同型号合并/重命名新建）
    const existing = input.deviceUuid
      ? await this.prisma.mobileDevice.findFirst({
          where: { userId, deviceUuid: input.deviceUuid },
        })
      : await this.prisma.mobileDevice.findFirst({
          where: { userId, deviceName },
        });
    // P0-4：每次注册轮换 token（旧 token 失效），仅本次响应返回明文
    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const row = existing
      ? await this.prisma.mobileDevice.update({
          where: { id: existing.id },
          data: {
            platform: input.platform || 'android',
            agentVersion: input.agentVersion ?? null,
            deviceUuid: input.deviceUuid ?? existing.deviceUuid,
            deviceTokenHash: tokenHash,
            capabilities: (input.capabilities ??
              existing.capabilities ??
              null) as never,
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
            deviceUuid: input.deviceUuid ?? null,
            deviceTokenHash: tokenHash,
            capabilities: (input.capabilities ?? null) as never,
            status: 'online',
            lastHeartbeatAt: now,
          },
        });
    this.logger.log(`设备注册/更新：${deviceName}（${row.id}）`);
    return { ...this.toInfo(row), deviceToken: token };
  }

  /** 校验设备 token → 返回 { userId, deviceId }（P0-4，设备侧接口认证） */
  async verifyDeviceToken(
    token: string,
  ): Promise<{ userId: string; deviceId: string } | null> {
    if (!token) return null;
    const hash = createHash('sha256').update(token).digest('hex');
    const device = await this.prisma.mobileDevice.findFirst({
      where: { deviceTokenHash: hash },
    });
    if (!device) return null;
    return { userId: device.userId, deviceId: device.id };
  }

  /** 心跳（agent 周期性上报；标记在线 + 续租设备活跃租约，PRD §5.1 必须续租） */
  async heartbeat(userId: string, deviceId: string): Promise<DeviceInfo> {
    const row = await this.prisma.mobileDevice.findFirst({
      where: { id: deviceId, userId },
    });
    if (!row) throw new BadRequestException('设备不存在');
    const now = new Date();
    const updated = await this.prisma.mobileDevice.update({
      where: { id: deviceId },
      data: { status: 'online', lastHeartbeatAt: now },
    });
    // 续租：该设备所有活跃租约刷新过期时间（防任务跑超租约并发窗口）
    await this.prisma.executorLease.updateMany({
      where: { deviceId, status: 'active' },
      data: {
        expiresAt: new Date(now.getTime() + this.leaseTtlMs),
        updatedAt: now,
      },
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
        // 心跳超时：撤销该设备活跃租约 + 冻结外发保护期（PRD §7：防旧设备网络恢复后重复外发）
        await this.prisma.executorLease.updateMany({
          where: { deviceId: row.id, status: 'active' },
          data: {
            status: 'released',
            frozenUntil: new Date(now + this.recoveryProtectionMs),
            updatedAt: new Date(),
          },
        });
        this.logger.warn(
          `设备心跳超时：${row.id} 已离线，其活跃租约已撤销（冻结外发 ${this.recoveryProtectionMs / 60000} 分钟）`,
        );
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
    capabilities?: unknown;
  }): DeviceInfo {
    return {
      id: row.id,
      deviceName: row.deviceName,
      platform: row.platform,
      status: row.status,
      lastHeartbeatAt: row.lastHeartbeatAt,
      capabilities:
        (row.capabilities as Record<string, unknown> | null) ?? null,
    };
  }
}
