import { Module } from '@nestjs/common';
import { PublishingService } from './publishing.service';
import { PublishingController } from './publishing.controller';
import { WechatPublisherService } from './wechat-publisher/wechat-publisher.service';
import { AutoUploadModule } from '../auto-upload/auto-upload.module';

@Module({
  imports: [AutoUploadModule],
  providers: [PublishingService, WechatPublisherService],
  controllers: [PublishingController],
  exports: [PublishingService],
})
export class PublishingModule {}
