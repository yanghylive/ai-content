import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { LocalEngineModule } from '../local-engine/local-engine.module';
import { DiscoveryModule } from '../discovery/discovery.module';
import { DiscoveryBrowserRunner } from '../discovery/discovery-browser-runner';
import { RpaDriverRegistry } from './rpa-driver-registry.service';
import { RpaExecutionStore } from './rpa-execution-store.service';
import {
  DouyinAcquisitionDriver,
  KuaishouAcquisitionDriver,
  XhsAcquisitionDriver,
} from './platform-acquisition-drivers';
import { WechatFamilyRpaDriver } from './wechat-family-rpa.driver';
import { RpaController } from './rpa.controller';

/** 启动期注册六个平台 driver（参照 InteractionAdapterRegistrar 模式） */
@Injectable()
export class RpaModuleBootstrapper implements OnModuleInit {
  constructor(
    private readonly registry: RpaDriverRegistry,
    private readonly runner: DiscoveryBrowserRunner,
  ) {}

  onModuleInit() {
    const drivers = [
      // P1-3：三平台独立 Driver（各自固化 platform/displayName，独立注册与验收）
      new DouyinAcquisitionDriver(this.runner),
      new KuaishouAcquisitionDriver(this.runner),
      new XhsAcquisitionDriver(this.runner),
      new WechatFamilyRpaDriver(
        'wechat-channel',
        '视频号',
        '视频号无独立网页搜索入口，自动发现需官方授权（当前仅支持人工导入视频链接）',
      ),
      new WechatFamilyRpaDriver(
        'wechat',
        '微信',
        '微信获客需桌面客户端会话（封号风险），当前仅支持人工导入',
      ),
      new WechatFamilyRpaDriver(
        'wecom',
        '企微',
        '企微获客需官方服务商授权，当前仅支持人工导入',
      ),
    ];
    for (const driver of drivers) this.registry.register(driver);
  }
}

/**
 * 统一 RPA 获客模块（复核#1）。
 *
 * 六个平台统一注册 RpaDriver：
 * - 抖音/快手/小红书：包装 DiscoveryBrowserRunner（用户已登录浏览器会话）；
 * - 视频号/微信/企微：显式 unsupported（不用手工模式伪装）。
 */
@Module({
  imports: [LocalEngineModule, DiscoveryModule],
  controllers: [RpaController],
  providers: [RpaDriverRegistry, RpaExecutionStore, RpaModuleBootstrapper],
  exports: [RpaDriverRegistry, RpaExecutionStore],
})
export class RpaModule {}
