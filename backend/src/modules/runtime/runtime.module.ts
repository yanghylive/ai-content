/**
 * RuntimeModule · 浏览器执行 + 路由模块
 *
 * 详见：
 *  - docs/kaypal-ai-runtime-unification-development-plan-2026-06-03.html
 *  - docs/adr/001-executor-router-capability-interface.md
 *  - docs/adr/002-copy-first-migration-strategy.md
 *
 * P3 D1 准备（2026-06-03）：
 *  - RuntimeOrchestrator 薄壳 wrapper 作为 P3-D1 切换目标
 *  - 旧入口（LocalEngineService）暂时不动；P3 真机切换时再一个个 caller 改
 *  - 通过 LocalEngineModule.exports 注入 AgentSService（无循环依赖）
 *  - PrismaService 通过 @Global() PrismaModule 注入
 */

import { forwardRef, Module } from '@nestjs/common';
import { AuthRequestContextModule } from '../../common/auth-request-context.module';
import { LocalEngineModule } from '../local-engine/local-engine.module';
import { AiModelsModule } from '../ai-models/ai-models.module';
import { AuthModule } from '../auth/auth.module';
import { AgentSExecutorAdapter } from './agent-s-adapter';
import { BrowserControlService } from './browser-control/browser-control.service';
import { EvidenceService } from './evidence/evidence.service';
import { ExecutorRouter } from './executor-router';
import { LocalInteractionEngineClient } from '../local-engine/local-interaction-engine.client';
import { LocalRuntimeClient } from './local-runtime.client';
import { LocalRuntimeEngineClient } from './local-runtime-engine.client';
import { RuntimeOrchestrator } from './orchestrator/runtime-orchestrator.service';
import { TaskQueueProcessor } from './task-queue-processor.service';
import { DouyinCommentReplyService } from './platforms/douyin/comment-reply.service';
import { DouyinDirectMessageReplyService } from './platforms/douyin/direct-message-reply.service';
import { DouyinExposureCollector } from './platforms/douyin/exposure-collector.service';
import { DouyinExposureService } from './platforms/douyin/exposure.service';
import { WechatChannelCommentReplyService } from './platforms/wechat-channel/comment-reply.service';
import { WechatChannelDirectMessageReplyService } from './platforms/wechat-channel/direct-message-reply.service';
import { PlatformPublishService } from './platforms/publishing/platform-publish.service';
import { PlatformRegistryModule } from '../platform-registry/platform-registry.module';
import { VideoFaceSwapService } from './platforms/video/video-face-swap.service';
import { VideoTemplateClipService } from './platforms/video/video-template-clip.service';
import { NodeAgentRuntimeService } from './node-agent-runtime/node-agent-runtime.service';

@Module({
  imports: [
    AuthRequestContextModule,
    forwardRef(() => LocalEngineModule),
    AiModelsModule,
    AuthModule,
    PlatformRegistryModule,
  ],
  providers: [
    LocalRuntimeEngineClient,
    LocalInteractionEngineClient,
    BrowserControlService,
    DouyinCommentReplyService,
    DouyinDirectMessageReplyService,
    DouyinExposureCollector,
    DouyinExposureService,
    WechatChannelCommentReplyService,
    WechatChannelDirectMessageReplyService,
    PlatformPublishService,
    VideoFaceSwapService,
    VideoTemplateClipService,
    NodeAgentRuntimeService,
    EvidenceService,
    LocalRuntimeClient,
    AgentSExecutorAdapter,
    ExecutorRouter,
    RuntimeOrchestrator,
    TaskQueueProcessor,
  ],
  exports: [
    ExecutorRouter,
    RuntimeOrchestrator,
    LocalRuntimeEngineClient,
    LocalInteractionEngineClient,
    BrowserControlService,
    EvidenceService,
    DouyinCommentReplyService,
    DouyinDirectMessageReplyService,
    DouyinExposureCollector,
    DouyinExposureService,
    WechatChannelCommentReplyService,
    WechatChannelDirectMessageReplyService,
    PlatformPublishService,
    VideoFaceSwapService,
    VideoTemplateClipService,
    NodeAgentRuntimeService,
    TaskQueueProcessor,
  ],
})
export class RuntimeModule {}
