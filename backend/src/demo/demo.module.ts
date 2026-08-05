import { Module } from '@nestjs/common';
import { WechatPersonalDemoController } from './wechat-personal/wechat-personal.demo.controller';

@Module({
  controllers: [WechatPersonalDemoController],
})
export class DemoModule {}
