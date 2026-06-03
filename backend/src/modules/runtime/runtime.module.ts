/**
 * RuntimeModule · 浏览器执行 + 路由模块
 *
 * 详见：
 *  - docs/kaypal-ai-runtime-unification-development-plan-2026-06-03.html
 *  - docs/adr/001-executor-router-capability-interface.md
 *  - docs/adr/002-copy-first-migration-strategy.md
 *
 * P2 D2 状态（2026-06-03）：
 *  - 双执行器（LocalRuntimeClient + AgentSExecutorAdapter）经 ExecutorRouter 路由
 *  - 4 个 platform service 真接通抖音/视频号 comment-reply + dm-reply
 *  - 浏览器路径不依赖 AutoUploadService（Copy-first 守护）
 *  - 通过 LocalEngineModule.exports 注入 AgentSService（无循环依赖）
 */

import { Module } from '@nestjs/common';
import { LocalEngineModule } from '../local-engine/local-engine.module';
import { AgentSExecutorAdapter } from './agent-s-adapter';
import { BrowserControlService } from './browser-control/browser-control.service';
import { ExecutorRouter } from './executor-router';
import { LocalRuntimeClient } from './local-runtime.client';
import { LocalRuntimeEngineClient } from './local-runtime-engine.client';
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
    LocalRuntimeClient,
    AgentSExecutorAdapter,
    ExecutorRouter,
  ],
  exports: [
    ExecutorRouter,
    LocalRuntimeEngineClient,
    BrowserControlService,
    DouyinCommentReplyService,
    DouyinDirectMessageReplyService,
    WechatChannelCommentReplyService,
    WechatChannelDirectMessageReplyService,
  ],
})
export class RuntimeModule {}
