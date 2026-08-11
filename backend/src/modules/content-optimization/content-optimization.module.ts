import { Module } from '@nestjs/common';
import { AiModelsModule } from '../ai-models/ai-models.module';
import { MultimodalModule } from '../multimodal/multimodal.module';
import { AiFlavorModule } from '../ai-flavor/ai-flavor.module';
import { ContentReviewModule } from '../content-review/content-review.module';
import { ContentOptimizationController } from './content-optimization.controller';
import { ContentOptimizationService } from './content-optimization.service';
import { OutlineService } from './outline.service';

@Module({
  imports: [AiModelsModule, MultimodalModule, AiFlavorModule, ContentReviewModule],
  controllers: [ContentOptimizationController],
  providers: [ContentOptimizationService, OutlineService],
  exports: [ContentOptimizationService, OutlineService],
})
export class ContentOptimizationModule {}
