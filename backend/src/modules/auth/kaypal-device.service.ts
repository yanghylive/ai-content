import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'pg';

export interface KaypalDesktopDevice {
  id: string;
  deviceId: string;
  name: string;
  platform: string;
  status: string;
  capabilities: Record<string, any> | null;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
}

@Injectable()
export class KaypalDeviceService {
  constructor(private readonly config: ConfigService) {}

  private getDatabaseUrl() {
    return this.config.get<string>('KAYPAL_DATABASE_URL')?.trim() || '';
  }

  async listUserDevices(userId: string): Promise<KaypalDesktopDevice[]> {
    const databaseUrl = this.getDatabaseUrl();
    if (!databaseUrl) {
      throw new ServiceUnavailableException('Kaypal 数据库未配置');
    }
    const client = new Client({ connectionString: databaseUrl });
    try {
      await client.connect();
      const result = await client.query<KaypalDesktopDevice>(
        `SELECT id, "deviceId", name, platform, status,
                capabilities, "lastSeenAt", "revokedAt"
         FROM "DesktopDevice"
         WHERE "userId" = $1 AND "revokedAt" IS NULL
         ORDER BY "lastSeenAt" DESC`,
        [userId],
      );
      return result.rows;
    } catch {
      throw new ServiceUnavailableException('Kaypal 设备数据库不可用');
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  async isDeviceBound(userId: string, deviceId: string): Promise<boolean> {
    const devices = await this.listUserDevices(userId);
    return devices.some(
      (d) => d.deviceId === deviceId && d.status === 'active',
    );
  }

  getDeviceLimitForPlan(plan: string): number {
    const limits: Record<string, number> = {
      FREE: 1,
      STUDY: 2,
      STANDARD: 3,
      PRO: 5,
      ADVANCED: 10,
      FLAGSHIP: 999,
    };
    return limits[plan] ?? 1;
  }

  async canBindDevice(
    userId: string,
    plan: string,
  ): Promise<{ allowed: boolean; reason?: string }> {
    const devices = await this.listUserDevices(userId);
    const limit = this.getDeviceLimitForPlan(plan);
    if (devices.length >= limit) {
      return {
        allowed: false,
        reason: `设备数量已达上限（${plan} 套餐最多 ${limit} 台），请升级套餐或解绑旧设备`,
      };
    }
    return { allowed: true };
  }
}
