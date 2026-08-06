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
    // 2026-06-04: 8001 (kaypal-runtime) 已下线. 默认 URL 改成空, fail-fast 触发
    // 显式设 KAYPAL_RUNTIME_URL 才会真用; 否则 getStatus 返 unavailable
    return (this.config.get<string>('KAYPAL_RUNTIME_URL') || '').replace(
      /\/$/,
      '',
    );
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
    } catch { /* 容错：非关键路径失败忽略 */ }

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
