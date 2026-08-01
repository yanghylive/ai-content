import { Injectable } from '@nestjs/common';
import type {
  PlatformAdapter,
  PlatformCapability,
} from './platform-adapter.interface';

/**
 * 平台适配器注册表：按平台键注册/查询 adapter 与能力。
 * Phase 2 第一阶段仅做能力注册与只读查询，不做真实发布。
 */
@Injectable()
export class PlatformAdapterRegistry {
  private readonly adapters = new Map<string, PlatformAdapter>();

  register(adapter: PlatformAdapter): void {
    const key = adapter.capability.platform;
    if (!key) {
      throw new Error('PlatformAdapter.capability.platform 不能为空');
    }
    if (this.adapters.has(key)) {
      throw new Error(`平台 adapter 重复注册: ${key}`);
    }
    this.adapters.set(key, adapter);
  }

  has(platform: string): boolean {
    return this.adapters.has(platform);
  }

  get(platform: string): PlatformAdapter {
    const adapter = this.adapters.get(platform);
    if (!adapter) {
      throw new Error(`未注册的平台 adapter: ${platform}`);
    }
    return adapter;
  }

  getCapability(platform: string): PlatformCapability | undefined {
    return this.adapters.get(platform)?.capability;
  }

  listCapabilities(): PlatformCapability[] {
    return [...this.adapters.values()].map((adapter) => ({
      ...adapter.capability,
      contentKinds: [...adapter.capability.contentKinds],
      executionModes: [...adapter.capability.executionModes],
    }));
  }

  listPlatforms(): string[] {
    return [...this.adapters.keys()];
  }
}
