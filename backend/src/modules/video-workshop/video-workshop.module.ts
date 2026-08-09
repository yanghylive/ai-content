import { Module } from '@nestjs/common';
import { RuntimeModule } from '../runtime/runtime.module';
import { AutoUploadModule } from '../auto-upload/auto-upload.module';
import { VideoWorkshopController } from './video-workshop.controller';
import { VideoWorkshopDownloader } from './video-workshop-downloader';
import { VideoWorkshopPhoneUploadService } from './video-workshop-phone-upload';
import { VideoWorkshopRenderer } from './video-workshop-renderer';
import { VideoWorkshopService } from './video-workshop.service';
import { StudioCoreClient } from './studio-core.client';

@Module({
  imports: [RuntimeModule, AutoUploadModule],
  controllers: [VideoWorkshopController],
  providers: [
    VideoWorkshopService,
    VideoWorkshopRenderer,
    VideoWorkshopDownloader,
    VideoWorkshopPhoneUploadService,
    StudioCoreClient,
  ],
  exports: [VideoWorkshopService],
})
export class VideoWorkshopModule {}
