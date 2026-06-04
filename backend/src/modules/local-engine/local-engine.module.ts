import { forwardRef, Module } from '@nestjs/common';
import { AutoUploadModule } from '../auto-upload/auto-upload.module';
import { AiModelsModule } from '../ai-models/ai-models.module';
import { CloudApiModule } from '../cloud-api/cloud-api.module';
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
import { RuntimeModule } from '../runtime/runtime.module';

@Module({
  imports: [
    AutoUploadModule,
    AiModelsModule,
    CloudApiModule,
    forwardRef(() => RuntimeModule),
  ],
  controllers: [LocalEngineController, AgentSController],
  providers: [
    KaypalRuntimeService,
    LocalControllerBridgeService,
    LocalEngineService,
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
