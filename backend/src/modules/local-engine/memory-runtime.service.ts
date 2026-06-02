import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface MemoryRuntimeStatus {
  available: boolean;
  shortTermAvailable: boolean;
  dailyAvailable: boolean;
  longTermAvailable: boolean;
  runtimeApiAvailable: boolean;
  message: string;
}

@Injectable()
export class MemoryRuntimeService {
  constructor(private readonly config: ConfigService) {}

  private getRuntimeUrl(): string {
    return (
      this.config.get<string>('KAYPAL_RUNTIME_URL') || 'http://127.0.0.1:8001'
    ).replace(/\/$/, '');
  }

  async getStatus(): Promise<MemoryRuntimeStatus> {
    let runtimeApiAvailable = false;
    let shortTermAvailable = false;
    let dailyAvailable = false;
    let longTermAvailable = false;

    try {
      const response = await fetch(`${this.getRuntimeUrl()}/memory/stats`, {
        signal: AbortSignal.timeout(3000),
        headers: { Accept: 'application/json' },
      });
      if (response.ok) {
        runtimeApiAvailable = true;
        const data = await response.json();
        shortTermAvailable =
          data.shortTerm?.available || data.tiers?.short || false;
        dailyAvailable = data.daily?.available || data.tiers?.daily || true;
        longTermAvailable =
          data.longTerm?.available || data.tiers?.long || false;
      }
    } catch {}

    if (!runtimeApiAvailable) {
      const redisUrl =
        this.config.get<string>('REDIS_URL') ||
        this.config.get<string>('REDIS_HOST');
      if (redisUrl) {
        shortTermAvailable = true;
        dailyAvailable = true;
      }
    }

    const available =
      runtimeApiAvailable || shortTermAvailable || dailyAvailable;

    const tiers: string[] = [];
    if (shortTermAvailable) tiers.push('短期(Redis)');
    if (dailyAvailable) tiers.push('日常(PostgreSQL)');
    if (longTermAvailable) tiers.push('长期(向量库)');

    return {
      available,
      shortTermAvailable,
      dailyAvailable,
      longTermAvailable,
      runtimeApiAvailable,
      message: available
        ? `记忆系统可用：${tiers.join('、')}${runtimeApiAvailable ? '，Runtime API 在线' : ''}`
        : '记忆系统不可用：Runtime API 不可用且未配置 Redis',
    };
  }
}
