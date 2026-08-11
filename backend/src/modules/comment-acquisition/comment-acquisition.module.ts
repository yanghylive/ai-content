import { Module } from '@nestjs/common';
import { AiModelsModule } from '../ai-models/ai-models.module';
import { AutoUploadModule } from '../auto-upload/auto-upload.module';
import { LocalEngineModule } from '../local-engine/local-engine.module';
import { CommentAcquisitionController } from './comment-acquisition.controller';
import { CommentAcquisitionService } from './comment-acquisition.service';
import { ReplyEngineService } from './reply-engine.service';

@Module({
  imports: [AiModelsModule, AutoUploadModule, LocalEngineModule],
  controllers: [CommentAcquisitionController],
  providers: [CommentAcquisitionService, ReplyEngineService],
  exports: [CommentAcquisitionService, ReplyEngineService],
})
export class CommentAcquisitionModule {}
