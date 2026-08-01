import { Module } from '@nestjs/common';
import { PlatformAdapterRegistry } from './platform-adapter.registry';
import type { PublishAdapterFactory } from './platform-adapter.interface';
import { BilibiliPublishAdapter } from '../runtime/platforms/publishing/bilibili-publish.adapter';
import {
  DouyinPublishAdapter,
  type DouyinPublishDeps,
} from '../runtime/platforms/publishing/douyin-publish.adapter';
import { KuaishouPublishAdapter } from '../runtime/platforms/publishing/kuaishou-publish.adapter';
import { WechatChannelPublishAdapter } from '../runtime/platforms/publishing/wechat-channel-publish.adapter';
import { WechatOfficialPublishAdapter } from '../runtime/platforms/publishing/wechat-official-publish.adapter';
import {
  XiaohongshuPublishAdapter,
  type XiaohongshuPublishDeps,
} from '../runtime/platforms/publishing/xiaohongshu-publish.adapter';

/**
 * 平台注册表模块：从 6 个内置发布 adapter 派生能力 + 工厂注册。
 *
 * 注册顺序：xhs→wechat-channel→wechat-official→douyin→ks→bili
 */
@Module({
  providers: [
    {
      provide: PlatformAdapterRegistry,
      useFactory: () => {
        const registry = new PlatformAdapterRegistry();

        const xhs = new XiaohongshuPublishAdapter({
          cleanTags: (tags) => tags,
          fillFirstEditable: () => Promise.resolve(),
          waitGenericVideoUploaded: () => Promise.resolve(),
        });
        const wechat = new WechatChannelPublishAdapter();
        const wechatOfficial = new WechatOfficialPublishAdapter();
        const douyin = new DouyinPublishAdapter({
          gotoBestEffort: () => Promise.resolve(),
          waitGenericPublishButton: () =>
            Promise.resolve({ click: () => Promise.resolve() }),
        });
        const kuaishou = new KuaishouPublishAdapter();
        const bilibili = new BilibiliPublishAdapter();
        for (const adapter of [xhs, wechat, wechatOfficial, douyin, kuaishou, bilibili]) {
          registry.register(adapter);
        }

        const factories: Record<string, PublishAdapterFactory> = {
          xiaohongshu: (deps) =>
            new XiaohongshuPublishAdapter(
              deps as unknown as XiaohongshuPublishDeps,
            ),
          'wechat-channel': () => new WechatChannelPublishAdapter(),
          'wechat-official': () => new WechatOfficialPublishAdapter(),
          douyin: (deps) =>
            new DouyinPublishAdapter(deps as unknown as DouyinPublishDeps),
          kuaishou: () => new KuaishouPublishAdapter(),
          bilibili: () => new BilibiliPublishAdapter(),
        };
        for (const [platform, factory] of Object.entries(factories)) {
          registry.registerPublishFactory(platform, factory);
        }

        return registry;
      },
    },
  ],
  exports: [PlatformAdapterRegistry],
})
export class PlatformRegistryModule {}