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

import { Module } from '@nestjs/common';
import { LocalEngineModule } from '../local-engine/local-engine.module';
import { AgentSExecutorAdapter } from './agent-s-adapter';
import { BrowserControlService } from './browser-control/browser-control.service';
import { EvidenceService } from './evidence/evidence.service';
import { ExecutorRouter } from './executor-router';
import { LocalRuntimeClient } from './local-runtime.client';
import { LocalRuntimeEngineClient } from './local-runtime-engine.client';
import { RuntimeOrchestrator } from './orchestrator/runtime-orchestrator.service';
import { DouyinCommentReplyService } from './platforms/douyin/comment-reply.service';
import { DouyinDirectMessageReplyService } from './platforms/douyin/direct-message-reply.service';
import { WechatChannelCommentReplyService } from './platforms/wechat-channel/comment-reply.service';
import { WechatChannelDirectMessageReplyService } from './platforms/wechat-channel/direct-message-reply.service';

@Module({
  imports: [LocalEngineModule],
  providers: [
    LocalRuntimeEngineClient,
    BrowserControlService,
    DouyinCommentReplyService,
    DouyinDirectMessageReplyService,
    WechatChannelCommentReplyService,
    WechatChannelDirectMessageReplyService,
    EvidenceService,
    LocalRuntimeClient,
    AgentSExecutorAdapter,
    ExecutorRouter,
    RuntimeOrchestrator,
  ],
  exports: [
    ExecutorRouter,
    RuntimeOrchestrator,
    LocalRuntimeEngineClient,
    BrowserControlService,
    EvidenceService,
    DouyinCommentReplyService,
    DouyinDirectMessageReplyService,
    WechatChannelCommentReplyService,
    WechatChannelDirectMessageReplyService,
  ],
})
export class RuntimeModule {}
