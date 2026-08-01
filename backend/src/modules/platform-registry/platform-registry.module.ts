import { Module } from '@nestjs/common';
import { PlatformAdapterRegistry } from './platform-adapter.registry';
import { BilibiliPublishAdapter } from '../runtime/platforms/publishing/bilibili-publish.adapter';
import { DouyinPublishAdapter } from '../runtime/platforms/publishing/douyin-publish.adapter';
import { KuaishouPublishAdapter } from '../runtime/platforms/publishing/kuaishou-publish.adapter';
import { WechatChannelPublishAdapter } from '../runtime/platforms/publishing/wechat-channel-publish.adapter';
import { XiaohongshuPublishAdapter } from '../runtime/platforms/publishing/xiaohongshu-publish.adapter';

/**
 * 平台注册表模块：从 5 个内置发布 adapter 派生 capability 注册，
 * 单一真相源（adapter 类本身）。Xiaohongshu/Douyin 构造需 deps；
 * 这里只用 capability 不调业务方法，传空对象即可。
 */
@Module({
  providers: [
    {
      provide: PlatformAdapterRegistry,
      useFactory: () => {
        const registry = new PlatformAdapterRegistry();
        // 注册顺序决定 listCapabilities() 输出顺序；保持 xhs/wechat/douyin/ks/bili
        // （与原 BUILTIN_PLATFORM_ADAPTERS 一致；前端已按此顺序展示）
        // 这里只用 capability 不调业务方法，Xiaohongshu/Douyin 传空 deps 即可
        registry.register(
          new XiaohongshuPublishAdapter({
            cleanTags: (t) => t,
            fillFirstEditable: () => Promise.resolve(),
            waitGenericVideoUploaded: () => Promise.resolve(),
          }),
        );
        registry.register(new WechatChannelPublishAdapter());
        registry.register(
          new DouyinPublishAdapter({
            gotoBestEffort: () => Promise.resolve(),
            waitGenericPublishButton: () =>
              Promise.resolve({ click: () => Promise.resolve() }),
          }),
        );
        registry.register(new KuaishouPublishAdapter());
        registry.register(new BilibiliPublishAdapter());
        return registry;
      },
    },
  ],
  exports: [PlatformAdapterRegistry],
})
export class PlatformRegistryModule {}
