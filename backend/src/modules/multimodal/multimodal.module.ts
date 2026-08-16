import { Module } from '@nestjs/common';
import { MultimodalService } from './multimodal.service';
import { AutoUploadModule } from '../auto-upload/auto-upload.module';
import { AuthModule } from '../auth/auth.module';

/**
 * 多模态模块（P4）：Qwen-Image 生图 + qwen3-tts 配音。
 * 2026-08-09 起实现统一走 kaypal 云端网关 v1 端点（/api/ai/v1/images/generations、
 * /api/ai/v1/audio/speech），云端按用户归属记账，本地不持有云厂商 Key。
 * 路由由 DashscopeModule（/api/ai/image、/api/ai/speech）提供。
 */
@Module({
  imports: [AutoUploadModule, AuthModule],
  providers: [MultimodalService],
  exports: [MultimodalService],
})
export class MultimodalModule {}
