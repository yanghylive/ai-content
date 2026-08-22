import { Module } from '@nestjs/common';
import { GrowthModule } from '../growth/growth.module';
import { LeadsModule } from '../leads/leads.module';
import { AiAssistantController } from './ai-assistant.controller';
import { AiAssistantNestService } from './ai-assistant.service';

@Module({
  imports: [GrowthModule, LeadsModule],
  controllers: [AiAssistantController],
  providers: [AiAssistantNestService],
  exports: [AiAssistantNestService],
})
export class AiAssistantModule {}
