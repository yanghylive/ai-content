import { Module } from '@nestjs/common';
import { TopicsController } from './topics.controller';
import { TopicsService } from './topics.service';
import { AiScorerService } from './ai-scorer.service';
import { TopicMiningService } from './topic-mining.service';
import { AiModelsModule } from '../ai-models/ai-models.module';
import { ContentStrategiesModule } from '../content-strategies/content-strategies.module';
import { MaterialsModule } from '../materials/materials.module';

@Module({
  imports: [AiModelsModule, ContentStrategiesModule, MaterialsModule],
  controllers: [TopicsController],
  providers: [TopicsService, AiScorerService, TopicMiningService],
  exports: [TopicsService, TopicMiningService],
})
export class TopicsModule {}
