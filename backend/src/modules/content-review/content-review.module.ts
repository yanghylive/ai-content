import { Module } from '@nestjs/common';
import { AiModelsModule } from '../ai-models/ai-models.module';
import { ContentReviewController } from './content-review.controller';
import { ContentReviewService } from './content-review.service';

@Module({
  imports: [AiModelsModule],
  controllers: [ContentReviewController],
  providers: [ContentReviewService],
  exports: [ContentReviewService],
})
export class ContentReviewModule {}
