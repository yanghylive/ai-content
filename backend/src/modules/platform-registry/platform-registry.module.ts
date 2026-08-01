import { Module } from '@nestjs/common';
import { PlatformAdapterRegistry } from './platform-adapter.registry';
import { BUILTIN_PLATFORM_ADAPTERS } from './platform-adapters';

/**
 * 平台注册表模块：集中注册内置平台 adapter，并对外暴露只读能力查询。
 * 供 local-bridge 等只读通道与后续发布编排复用同一份能力模型。
 */
@Module({
  providers: [
    {
      provide: PlatformAdapterRegistry,
      useFactory: () => {
        const registry = new PlatformAdapterRegistry();
        for (const adapter of BUILTIN_PLATFORM_ADAPTERS) {
          registry.register(adapter);
        }
        return registry;
      },
    },
  ],
  exports: [PlatformAdapterRegistry],
})
export class PlatformRegistryModule {}
