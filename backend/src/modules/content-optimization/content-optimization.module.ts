import { Module } from '@nestjs/common';
import { AiModelsModule } from '../ai-models/ai-models.module';
import { MultimodalModule } from '../multimodal/multimodal.module';
import { AiFlavorModule } from '../ai-flavor/ai-flavor.module';
import { ContentReviewModule } from '../content-review/content-review.module';
import { ContentOptimizationController } from './content-optimization.controller';
import { ContentOptimizationService } from './content-optimization.service';
import { ContentQualityGateService } from './content-quality-gate.service';
import { OutlineService } from './outline.service';

@Module({
  imports: [
    AiModelsModule,
    MultimodalModule,
    AiFlavorModule,
    ContentReviewModule,
  ],
  controllers: [ContentOptimizationController],
  providers: [
    ContentOptimizationService,
    ContentQualityGateService,
    OutlineService,
  ],
  exports: [
    ContentOptimizationService,
    ContentQualityGateService,
    OutlineService,
  ],
})
export class ContentOptimizationModule {}
