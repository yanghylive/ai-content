import { Module } from '@nestjs/common';
import { AiModelsModule } from '../ai-models/ai-models.module';
import { CommentInsightsController } from './comment-insights.controller';
import { CommentInsightsService } from './comment-insights.service';

@Module({
  imports: [AiModelsModule],
  controllers: [CommentInsightsController],
  providers: [CommentInsightsService],
  exports: [CommentInsightsService],
})
export class CommentInsightsModule {}
