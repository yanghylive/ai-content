import { Module } from '@nestjs/common';
import { WechatPersonalDemoController } from './wechat-personal/wechat-personal.demo.controller';
import { VideoStudioDemoController } from './video-studio/video-studio.demo.controller';

@Module({
  controllers: [WechatPersonalDemoController, VideoStudioDemoController],
})
export class DemoModule {}
