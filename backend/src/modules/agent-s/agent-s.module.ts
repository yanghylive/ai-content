import { Module } from '@nestjs/common';
import { AiModelsModule } from '../ai-models/ai-models.module';
import { AuthModule } from '../auth/auth.module';
import { AgentSService } from './agent-s.service';

/**
 * AgentS 本机助手模块（依赖环拆除：从 local-engine 独立）
 *
 * runtime / local-engine / redfox 三方都要注入 AgentSService，
 * 独立成模块后各模块只需单向 import 本模块，不再互相 forwardRef。
 */
@Module({
  imports: [AiModelsModule, AuthModule],
  providers: [AgentSService],
  exports: [AgentSService],
})
export class AgentSModule {}
