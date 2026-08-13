import { Injectable } from '@nestjs/common';
import type {
  InteractionAdapter,
  InteractionCapability,
} from './interaction-adapter.interface';

/**
 * 互动适配器注册表：按平台键注册/查询互动 adapter 与能力。
 * 对齐发布侧 PlatformAdapterRegistry 的语义（能力只读查询 + 重复注册即抛错）。
 */
@Injectable()
export class InteractionAdapterRegistry {
  private readonly adapters = new Map<string, InteractionAdapter>();

  register(adapter: InteractionAdapter): void {
    const key = adapter.capability.platform;
    if (!key) {
      throw new Error('InteractionAdapter.capability.platform 不能为空');
    }
    if (this.adapters.has(key)) {
      throw new Error(`互动 adapter 重复注册: ${key}`);
    }
    this.adapters.set(key, adapter);
  }

  has(platform: string): boolean {
    return this.adapters.has(platform);
  }

  get(platform: string): InteractionAdapter {
    const adapter = this.adapters.get(platform);
    if (!adapter) {
      throw new Error(`未注册的互动 adapter: ${platform}`);
    }
    return adapter;
  }

  getCapability(platform: string): InteractionCapability | undefined {
    return this.adapters.get(platform)?.capability;
  }

  listCapabilities(): InteractionCapability[] {
    return [...this.adapters.values()].map((adapter) => ({
      ...adapter.capability,
      supportedTasks: [...adapter.capability.supportedTasks],
    }));
  }

  listPlatforms(): string[] {
    return [...this.adapters.keys()];
  }
}
