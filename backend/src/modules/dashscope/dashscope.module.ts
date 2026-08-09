import { Module } from '@nestjs/common';
import { DashscopeController } from './dashscope.controller';
import { DashscopeAsrService } from './dashscope-asr.service';
import { DashscopeMultimodalService } from './dashscope-multimodal.service';
import { AutoUploadModule } from '../auto-upload/auto-upload.module';

/**
 * 阿里百炼（B3 ASR + P4 多模态）
 * Key 仅存后端 env（DASHSCOPE_API_KEY），不入代码/DB
 */
@Module({
  imports: [AutoUploadModule],
  controllers: [DashscopeController],
  providers: [DashscopeAsrService, DashscopeMultimodalService],
  exports: [DashscopeAsrService, DashscopeMultimodalService],
})
export class DashscopeModule {}
