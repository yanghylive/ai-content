import { Module } from '@nestjs/common';
import { RuntimeModule } from '../runtime/runtime.module';
import { VideoFaceSwapController } from './video-face-swap.controller';
import { VideoFaceSwapService } from './video-face-swap.service';

@Module({
  imports: [RuntimeModule],
  controllers: [VideoFaceSwapController],
  providers: [VideoFaceSwapService],
  exports: [VideoFaceSwapService],
})
export class VideoFaceSwapModule {}
