import { Module } from '@nestjs/common';
import { PublishingService } from './publishing.service';
import { PublishingController } from './publishing.controller';
import { PlatformPreflightService } from './platform-preflight.service';
import { WechatPublisherService } from './wechat-publisher/wechat-publisher.service';
import { AutoUploadModule } from '../auto-upload/auto-upload.module';
import { AuthModule } from '../auth/auth.module';
import { CredentialEnvelopeService } from '../../common/credential-envelope.service';
import { JpagePreviewClientService } from './jpage-preview/jpage-preview-client.service';

@Module({
  imports: [AutoUploadModule, AuthModule],
  providers: [
    CredentialEnvelopeService,
    PublishingService,
    PlatformPreflightService,
    WechatPublisherService,
    JpagePreviewClientService,
  ],
  controllers: [PublishingController],
  exports: [PublishingService],
})
export class PublishingModule {}
