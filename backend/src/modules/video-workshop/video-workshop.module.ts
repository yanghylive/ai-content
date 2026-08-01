import { Module } from '@nestjs/common';
import { RuntimeModule } from '../runtime/runtime.module';
import { VideoWorkshopController } from './video-workshop.controller';
import { VideoWorkshopDownloader } from './video-workshop-downloader';
import { VideoWorkshopPhoneUploadService } from './video-workshop-phone-upload';
import { VideoWorkshopRenderer } from './video-workshop-renderer';
import { VideoWorkshopService } from './video-workshop.service';

@Module({
  imports: [RuntimeModule],
  controllers: [VideoWorkshopController],
  providers: [
    VideoWorkshopService,
    VideoWorkshopRenderer,
    VideoWorkshopDownloader,
    VideoWorkshopPhoneUploadService,
  ],
  exports: [VideoWorkshopService],
})
export class VideoWorkshopModule {}
