import { Module } from '@nestjs/common';
import { GrowthModule } from '../growth/growth.module';
import { AiAssistantController } from './ai-assistant.controller';
import { AiAssistantNestService } from './ai-assistant.service';

@Module({
  imports: [GrowthModule],
  controllers: [AiAssistantController],
  providers: [AiAssistantNestService],
  exports: [AiAssistantNestService],
})
export class AiAssistantModule {}
