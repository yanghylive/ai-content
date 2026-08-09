import { Injectable } from '@nestjs/common';
import type {
  PlatformAdapter,
  PlatformCapability,
  PublishAdapterFactory,
} from './platform-adapter.interface';

/**
 * 平台适配器注册表：按平台键注册/查询 adapter 与能力。
 * Phase 2 第一阶段仅做能力注册与只读查询，不做真实发布。
 *
 * Phase 2 收口后：registry 同时存「能力 + publish 工厂」。
 * - adapter（按 capability 注册）：local-bridge 等只读通道查询用
 * - publish factory（按 platform 索引）：publish 编排 service 拿到 factory
 *   后自己 new + 注入共享 deps（保留原 9 个入口的注入语义）
 */
@Injectable()
export class PlatformAdapterRegistry {
  private readonly adapters = new Map<string, PlatformAdapter>();
  private readonly publishFactories = new Map<string, PublishAdapterFactory>();

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

  /**
   * 注册 publish adapter 工厂。publish adapter 自身也是 PlatformAdapter，
   * 通常与 register 配对调用；factory 单独也可，registry 不强制关联。
   */
  registerPublishFactory(
    platform: string,
    factory: PublishAdapterFactory,
  ): void {
    if (!platform) {
      throw new Error('registerPublishFactory 的 platform 不能为空');
    }
    if (!this.adapters.has(platform)) {
      throw new Error(`publish factory 缺少对应平台 adapter: ${platform}`);
    }
    if (this.publishFactories.has(platform)) {
      throw new Error(`publish factory 重复注册: ${platform}`);
    }
    this.publishFactories.set(platform, factory);
  }

  has(platform: string): boolean {
    return this.adapters.has(platform);
  }

  hasPublishFactory(platform: string): boolean {
    return this.publishFactories.has(platform);
  }

  get(platform: string): PlatformAdapter {
    const adapter = this.adapters.get(platform);
    if (!adapter) {
      throw new Error(`未注册的平台 adapter: ${platform}`);
    }
    return adapter;
  }

  /**
   * 取 publish adapter 工厂（service 端自己 new + 注入 deps）。
   * 工厂不存在则抛错（与 get 一致），确保运行时不会漏注册。
   */
  getPublishAdapterFactory(platform: string): PublishAdapterFactory {
    const factory = this.publishFactories.get(platform);
    if (!factory) {
      throw new Error(`未注册的 publish adapter factory: ${platform}`);
    }
    return (deps) => {
      const adapter = factory(deps);
      if (!adapter?.capability || adapter.capability.platform !== platform) {
        throw new Error(
          `publish factory 返回平台不匹配: 期望 ${platform}，实际 ${adapter?.capability?.platform ?? 'unknown'}`,
        );
      }
      return adapter;
    };
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
