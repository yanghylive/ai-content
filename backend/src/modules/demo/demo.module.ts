import { Module } from '@nestjs/common';
import { WechatPersonalDemoController } from './wechat-personal/wechat-personal.controller';
import { WechatPersonalDemoService } from './wechat-personal/wechat-personal.service';

/**
 * 演示舱模块（Tier 2）
 *
 * 仅当 app.module.ts 条件注册（ENABLE_DEMO==='true'）时挂载；
 * 每个端点另有 requireDemoMode() 运行时守卫（双保险）。
 */
@Module({
  controllers: [WechatPersonalDemoController],
  providers: [WechatPersonalDemoService],
})
export class DemoModule {}
