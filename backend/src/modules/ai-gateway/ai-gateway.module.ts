import { Module } from '@nestjs/common';
import { AiGatewayController } from './ai-gateway.controller';
import { AiGatewayService } from './ai-gateway.service';
import { AiModelsModule } from '../ai-models/ai-models.module';
import { RedfoxModule } from '../redfox/redfox.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { MemoryModule } from '../memory/memory.module';
import { AiAuditModule } from '../ai-audit/ai-audit.module';
import { SavingsModule } from '../savings/savings.module';
import { GrowthModule } from '../growth/growth.module';
import { AiAssistantModule } from '../ai-assistant/ai-assistant.module';

@Module({
  imports: [
    AiModelsModule,
    RedfoxModule,
    KnowledgeModule,
    MemoryModule,
    AiAuditModule,
    SavingsModule,
    GrowthModule,
    AiAssistantModule,
  ],
  controllers: [AiGatewayController],
  providers: [AiGatewayService],
})
export class AiGatewayModule {}
