import { Module } from '@nestjs/common';
import { LocalEngineModule } from '../local-engine/local-engine.module';
import {
  DouyinInteractionAdapter,
  InteractionAdapterRegistrar,
  WechatChannelInteractionAdapter,
  XiaohongshuInteractionAdapter,
} from './builtin-adapters';
import { InteractionAdapterRegistry } from './interaction-adapter.registry';

/**
 * 统一互动契约模块。
 *
 * 一期（已落地）：注册表 + 内置 adapter（抖音/视频号/小红书），
 * 把现有 PlatformInteractionExecutor / XiaohongshuInteractionExecutor 包装成
 * 统一 InteractionAdapter 契约，供 comment-acquisition 等上层按平台查询调用，
 * 消除 `platform === 'xiaohongshu' ? ... : ...` 平台分支。
 *
 * AutoUploadService 由 @Global AutoUploadModule 提供，无需在此 import。
 */
@Module({
  imports: [LocalEngineModule],
  providers: [
    InteractionAdapterRegistry,
    DouyinInteractionAdapter,
    WechatChannelInteractionAdapter,
    XiaohongshuInteractionAdapter,
    InteractionAdapterRegistrar,
  ],
  exports: [
    InteractionAdapterRegistry,
    DouyinInteractionAdapter,
    WechatChannelInteractionAdapter,
    XiaohongshuInteractionAdapter,
  ],
})
export class InteractionModule {}
