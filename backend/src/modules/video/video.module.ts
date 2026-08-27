import { Module } from '@nestjs/common';
import { VideoController } from './video.controller';
import { VideoService } from './video.service';
import { StudioCoreProxyService } from './studio-core-proxy.service';
import { AutoUploadModule } from '../auto-upload/auto-upload.module';
import { MultimodalModule } from '../multimodal/multimodal.module';

@Module({
  imports: [AutoUploadModule, MultimodalModule],
  controllers: [VideoController],
  providers: [VideoService, StudioCoreProxyService],
  exports: [VideoService],
})
export class VideoModule {}
