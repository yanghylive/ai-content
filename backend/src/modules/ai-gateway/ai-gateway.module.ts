import { Module } from '@nestjs/common';
import { AiGatewayController } from './ai-gateway.controller';
import { AiGatewayService } from './ai-gateway.service';
import { AiModelsModule } from '../ai-models/ai-models.module';
import { RedfoxModule } from '../redfox/redfox.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { MemoryModule } from '../memory/memory.module';

@Module({
  imports: [AiModelsModule, RedfoxModule, KnowledgeModule, MemoryModule],
  controllers: [AiGatewayController],
  providers: [AiGatewayService],
})
export class AiGatewayModule {}
