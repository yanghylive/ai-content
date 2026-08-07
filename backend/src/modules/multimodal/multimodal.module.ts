import { Module } from '@nestjs/common';
import { MultimodalService } from './multimodal.service';
import { AiModelsModule } from '../ai-models/ai-models.module';
import { AutoUploadModule } from '../auto-upload/auto-upload.module';

/**
 * 多模态模块（P4）：早期版本——Qwen-Image / CosyVoice 经模型台（OpenAI 兼容）。
 * ⚠️ 2026-08-07 起 /api/ai/image 与 /api/ai/speech 路由由 DashscopeModule（百炼直连）接管；
 * 本模块保留 service 实现（模型台路径）但不暴露路由，避免与百炼版冲突。
 */
@Module({
  imports: [AiModelsModule, AutoUploadModule],
  providers: [MultimodalService],
  exports: [MultimodalService],
})
export class MultimodalModule {}
