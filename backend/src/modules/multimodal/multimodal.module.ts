import { Module } from '@nestjs/common';
import { MultimodalController } from './multimodal.controller';
import { MultimodalService } from './multimodal.service';
import { AiModelsModule } from '../ai-models/ai-models.module';
import { AutoUploadModule } from '../auto-upload/auto-upload.module';

/**
 * 多模态模块（P4）：Qwen-Image 生图 / CosyVoice 配音
 */
@Module({
  imports: [AiModelsModule, AutoUploadModule],
  controllers: [MultimodalController],
  providers: [MultimodalService],
})
export class MultimodalModule {}
