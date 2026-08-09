import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AiModelsModule } from '../ai-models/ai-models.module';
import { ArticlesModule } from '../articles/articles.module';
import { AgentWakerController } from './agentwaker.controller';
import { AgentWakerService } from './agentwaker.service';

@Module({
  imports: [PrismaModule, AiModelsModule, ArticlesModule],
  controllers: [AgentWakerController],
  providers: [AgentWakerService],
  exports: [AgentWakerService],
})
export class AgentWakerModule {}
