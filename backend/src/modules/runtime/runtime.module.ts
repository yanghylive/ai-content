/**
 * RuntimeModule · 浏览器执行 + 路由模块
 *
 * 详见：
 *  - docs/kaypal-ai-runtime-unification-development-plan-2026-06-03.html
 *  - docs/adr/001-executor-router-capability-interface.md
 *  - docs/adr/002-copy-first-migration-strategy.md
 *
 * P2 D1 状态（2026-06-03）：
 *  - 提供 ExecutorRouter（LocalRuntimeClient + AgentSExecutorAdapter 双执行器注入）
 *  - LocalRuntimeEngineClient（仿 AutoUploadClient 但不引用旧 client）
 *  - BrowserControlService（preflight + status 抽象层）
 *  - LocalRuntimeClient.canHandle 对 douyin / wechat-channel 返 ok=true
 *  - 通过 LocalEngineModule.exports 注入 AgentSService（无循环依赖）
 *  - P2-D2 接入 platform services（P2-D2 阶段）
 */

import { Module } from '@nestjs/common';
import { LocalEngineModule } from '../local-engine/local-engine.module';
import { AgentSExecutorAdapter } from './agent-s-adapter';
import { BrowserControlService } from './browser-control/browser-control.service';
import { ExecutorRouter } from './executor-router';
import { LocalRuntimeClient } from './local-runtime.client';
import { LocalRuntimeEngineClient } from './local-runtime-engine.client';

@Module({
  imports: [LocalEngineModule],
  providers: [
    LocalRuntimeEngineClient,
    BrowserControlService,
    LocalRuntimeClient,
    AgentSExecutorAdapter,
    ExecutorRouter,
  ],
  exports: [ExecutorRouter, LocalRuntimeEngineClient, BrowserControlService],
})
export class RuntimeModule {}
