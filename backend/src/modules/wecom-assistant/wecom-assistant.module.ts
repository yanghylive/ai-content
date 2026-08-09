import { Module } from '@nestjs/common';
import { WecomAssistantController } from './wecom-assistant.controller';
import { WecomAssistantService } from './wecom-assistant.service';

@Module({
  controllers: [WecomAssistantController],
  providers: [WecomAssistantService],
  exports: [WecomAssistantService],
})
export class WecomAssistantModule {}
