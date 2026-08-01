import { Module } from '@nestjs/common';
import { CommentInsightsController } from './comment-insights.controller';
import { CommentInsightsService } from './comment-insights.service';

@Module({
  controllers: [CommentInsightsController],
  providers: [CommentInsightsService],
  exports: [CommentInsightsService],
})
export class CommentInsightsModule {}
