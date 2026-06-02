import { Module } from '@nestjs/common';
import { AutoUploadModule } from '../auto-upload/auto-upload.module';
import { AiModelsModule } from '../ai-models/ai-models.module';
import { CloudApiModule } from '../cloud-api/cloud-api.module';
import { LocalInteractionExecutorService } from './local-interaction-executor.service';
import { LocalEngineController } from './local-engine.controller';
import { LocalEngineService } from './local-engine.service';
import { McpRuntimeService } from './mcp-runtime.service';
import { AgentSidecarService } from './agent-sidecar.service';
import { AgentSService } from './agent-s.service';
import { AgentSController } from './agent-s.controller';
import { SandboxRuntimeService } from './sandbox-runtime.service';
import { PluginRuntimeService } from './plugin-runtime.service';
import { MemoryRuntimeService } from './memory-runtime.service';
import { KaypalRuntimeService } from './kaypal-runtime.service';
import { LocalControllerBridgeService } from './local-controller-bridge.service';

@Module({
  imports: [AutoUploadModule, AiModelsModule, CloudApiModule],
  controllers: [LocalEngineController, AgentSController],
  providers: [
    KaypalRuntimeService,
    LocalControllerBridgeService,
    LocalEngineService,
    LocalInteractionExecutorService,
    McpRuntimeService,
    AgentSidecarService,
    AgentSService,
    SandboxRuntimeService,
    PluginRuntimeService,
    MemoryRuntimeService,
  ],
  exports: [
    LocalEngineService,
    AgentSService,
    KaypalRuntimeService,
    LocalControllerBridgeService,
  ],
})
export class LocalEngineModule {}
