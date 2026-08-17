// 发现中心模块（Sprint 5 + 大王浏览器会话方案 2026-08-16）
// 提供：DiscoveryBrowserRunner（浏览器会话发现，复用 LocalBrowserEngine 登录态）
//       + 各平台 adapter 工厂。
import { Module } from '@nestjs/common';
import { LocalEngineModule } from '../local-engine/local-engine.module';
import { DiscoveryBrowserRunner } from './discovery-browser-runner';
import { DouyinAdapter } from './adapters/douyin.adapter';
import { ManualAdapter } from './adapters/manual.adapter';
import { VideoLinkAdapter } from './adapters/video-link.adapter';

@Module({
  imports: [LocalEngineModule],
  providers: [DiscoveryBrowserRunner, DouyinAdapter, ManualAdapter, VideoLinkAdapter],
  exports: [DiscoveryBrowserRunner, DouyinAdapter, ManualAdapter, VideoLinkAdapter],
})
export class DiscoveryModule {}
