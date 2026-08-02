import { Module } from '@nestjs/common';
import { VideoGenerationController } from './video-generation.controller';
import { WanI2vService } from './wan-i2v.service';

@Module({
  controllers: [VideoGenerationController],
  providers: [WanI2vService],
  exports: [WanI2vService],
})
export class VideoGenerationModule {}
