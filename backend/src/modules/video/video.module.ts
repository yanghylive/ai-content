import { Module } from '@nestjs/common';
import { VideoController } from './video.controller';
import { VideoService } from './video.service';
import { StudioCoreProxyService } from './studio-core-proxy.service';

@Module({
  controllers: [VideoController],
  providers: [VideoService, StudioCoreProxyService],
  exports: [VideoService],
})
export class VideoModule {}
