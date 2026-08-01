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
import {
  XiaohongshuPublishAdapter,
  type XiaohongshuPublishDeps,
} from '../runtime/platforms/publishing/xiaohongshu-publish.adapter';

/**
 * 平台注册表模块：从 5 个内置发布 adapter 派生能力 + 工厂注册。
 *
 * 单一真相源 = 5 个 publish adapter 类本身：
 * - capability 通过临时 new + 读 readonly 字面量获取（registry 不存 adapter 实例，
 *   只存 capability 与 factory）；临时实例构造时 Xiaohongshu/Douyin 需 deps，
 *   但 capability 不引用 deps，传 noop 占位即可（不调任何业务方法）。
 * - publish factory 是 (deps) => PlatformPublishAdapter 箭头函数；
 *   service 端在派发到具体平台时，自己注入共享方法（cleanTags/fillFirstEditable/
 *   waitGenericVideoUploaded/gotoBestEffort/waitGenericPublishButton）。
 *
 * 注册顺序决定 listCapabilities() 输出顺序；保持 xhs→wechat→douyin→ks→bili
 * （与原 BUILTIN_PLATFORM_ADAPTERS 一致，前端已按此顺序展示）。
 */
@Module({
  providers: [
    {
      provide: PlatformAdapterRegistry,
      useFactory: () => {
        const registry = new PlatformAdapterRegistry();

        // capability —— 用临时实例读 readonly 字面量（不引用 deps，安全）
        const xhs = new XiaohongshuPublishAdapter({
          cleanTags: (tags) => tags,
          fillFirstEditable: () => Promise.resolve(),
          waitGenericVideoUploaded: () => Promise.resolve(),
        });
        const wechat = new WechatChannelPublishAdapter();
        const douyin = new DouyinPublishAdapter({
          gotoBestEffort: () => Promise.resolve(),
          waitGenericPublishButton: () =>
            Promise.resolve({ click: () => Promise.resolve() }),
        });
        const kuaishou = new KuaishouPublishAdapter();
        const bilibili = new BilibiliPublishAdapter();
        for (const adapter of [xhs, wechat, douyin, kuaishou, bilibili]) {
          registry.register(adapter);
        }

        // publish factory —— service 端自己注入共享 deps
        const factories: Record<string, PublishAdapterFactory> = {
          xiaohongshu: (deps) =>
            new XiaohongshuPublishAdapter(
              deps as unknown as XiaohongshuPublishDeps,
            ),
          'wechat-channel': () => new WechatChannelPublishAdapter(),
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