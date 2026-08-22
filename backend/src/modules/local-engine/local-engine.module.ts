import { Module } from '@nestjs/common';
import { AiModelsModule } from '../ai-models/ai-models.module';
import { CloudApiModule } from '../cloud-api/cloud-api.module';
import { AuthModule } from '../auth/auth.module';
import { LocalEngineController } from './local-engine.controller';
import { LocalEngineService } from './local-engine.service';
import { McpRuntimeService } from './mcp-runtime.service';
import { McpController } from './mcp.controller';
import { PlaywrightMcpService } from './playwright-mcp.service';
import { AgentSidecarService } from './agent-sidecar.service';
import { AgentSController } from './agent-s.controller';
import { AgentSModule } from '../agent-s/agent-s.module';
import { SandboxRuntimeService } from './sandbox-runtime.service';
import { PluginRuntimeService } from './plugin-runtime.service';
import { MemoryRuntimeService } from './memory-runtime.service';
import { KaypalRuntimeService } from './kaypal-runtime.service';
import { LocalControllerBridgeService } from './local-controller-bridge.service';
import { CdpBrowserProfileService } from './cdp-browser-profile.service';
import { CdpBrowserSessionService } from './cdp-browser-session.service';
import { AiBrowserActionService } from './ai-browser-action.service';
import { AgentBrowserController } from './agent-browser.controller';
import { AgentBrowserSessionService } from './agent-browser-session.service';
import { AgentBrowserPolicyService } from './agent-browser-policy.service';
import { AgentBrowserLoopService } from './agent-browser-loop.service';
import { LocalBrowserEngine } from './local-browser-engine.service';
import { PlatformInteractionExecutor } from './platform-interaction-executor.service';
import { XiaohongshuInteractionExecutor } from './xiaohongshu-interaction.executor';
import { PlaywrightBrowserRuntimeService } from './playwright-browser-runtime.service';
import { WechatPlanSchedulerService } from './wechat-plan-scheduler.service';
import { WechatPlanEditorController } from './wechat-plan-editor.controller';
import { WechatPlanEditorService } from './wechat-plan-editor.service';
import { EntitlementsModule } from '../entitlements/entitlements.module';

// AutoUploadModule 与 RuntimeModule 均为 @Global：其 exports 全局可见，
// 本模块的 provider 仍可注入 AutoUploadService / runtime 各服务，
// 无需反向 import 这两个模块 → 打破 madge 0 环门槛的双向文件级互引。
@Module({
  imports: [
    AiModelsModule,
    CloudApiModule,
    AuthModule,
    AgentSModule,
    EntitlementsModule,
  ],
  controllers: [
    LocalEngineController,
    WechatPlanEditorController,
    AgentSController,
    McpController,
    AgentBrowserController,
  ],
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
    XiaohongshuInteractionExecutor,
    AiBrowserActionService,
    AgentBrowserSessionService,
    AgentBrowserPolicyService,
    AgentBrowserLoopService,
    WechatPlanSchedulerService,
    WechatPlanEditorService,
    AgentSidecarService,
    SandboxRuntimeService,
    PluginRuntimeService,
    MemoryRuntimeService,
  ],
  exports: [
    LocalEngineService,
    KaypalRuntimeService,
    LocalControllerBridgeService,
    PlaywrightMcpService,
    CdpBrowserProfileService,
    CdpBrowserSessionService,
    PlaywrightBrowserRuntimeService,
    LocalBrowserEngine,
    PlatformInteractionExecutor,
    XiaohongshuInteractionExecutor,
    AiBrowserActionService,
    AgentBrowserSessionService,
    AgentBrowserPolicyService,
  ],
})
export class LocalEngineModule {}
