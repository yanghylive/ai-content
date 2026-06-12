import { forwardRef, Module } from '@nestjs/common';
import { AutoUploadModule } from '../auto-upload/auto-upload.module';
import { AiModelsModule } from '../ai-models/ai-models.module';
import { CloudApiModule } from '../cloud-api/cloud-api.module';
import { AuthModule } from '../auth/auth.module';
import { LocalEngineController } from './local-engine.controller';
import { LocalEngineService } from './local-engine.service';
import { McpRuntimeService } from './mcp-runtime.service';
import { McpController } from './mcp.controller';
import { PlaywrightMcpService } from './playwright-mcp.service';
import { AgentSidecarService } from './agent-sidecar.service';
import { AgentSService } from './agent-s.service';
import { AgentSController } from './agent-s.controller';
import { SandboxRuntimeService } from './sandbox-runtime.service';
import { PluginRuntimeService } from './plugin-runtime.service';
import { MemoryRuntimeService } from './memory-runtime.service';
import { KaypalRuntimeService } from './kaypal-runtime.service';
import { LocalControllerBridgeService } from './local-controller-bridge.service';
import { RuntimeModule } from '../runtime/runtime.module';
import { CdpBrowserProfileService } from './cdp-browser-profile.service';
import { CdpBrowserSessionService } from './cdp-browser-session.service';
import { LocalBrowserEngine } from './local-browser-engine.service';
import { PlatformInteractionExecutor } from './platform-interaction-executor.service';
import { PlaywrightBrowserRuntimeService } from './playwright-browser-runtime.service';

@Module({
  imports: [
    forwardRef(() => AutoUploadModule),
    AiModelsModule,
    CloudApiModule,
    AuthModule,
    forwardRef(() => RuntimeModule),
  ],
  controllers: [LocalEngineController, AgentSController, McpController],
  providers: [
    KaypalRuntimeService,
    LocalControllerBridgeService,
    LocalEngineService,
    McpRuntimeService,
    PlaywrightMcpService,
    CdpBrowserProfileService,
    CdpBrowserSessionService,
    PlaywrightBrowserRuntimeService,
    LocalBrowserEngine,
    PlatformInteractionExecutor,
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
    PlaywrightMcpService,
    CdpBrowserProfileService,
    CdpBrowserSessionService,
    PlaywrightBrowserRuntimeService,
    LocalBrowserEngine,
    PlatformInteractionExecutor,
  ],
})
export class LocalEngineModule {}
