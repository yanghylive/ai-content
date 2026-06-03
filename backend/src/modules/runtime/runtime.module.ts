/**
 * RuntimeModule · 浏览器执行 + 路由模块
 *
 * 详见：
 *  - docs/kaypal-ai-runtime-unification-development-plan-2026-06-03.html
 *  - docs/adr/001-executor-router-capability-interface.md
 *  - docs/adr/002-copy-first-migration-strategy.md
 *
 * P2 D4 状态（2026-06-03）：
 *  - 提供 ExecutorRouter（LocalRuntimeClient + AgentSExecutorAdapter 双执行器注入）
 *  - 通过 LocalEngineModule.exports 注入 AgentSService（无循环依赖，
 *    AgentSService 已在 LocalEngineModule 中 export）
 *  - 暂未对接 EvidenceService 与 runtime/platforms/*（P2 D5+ 引入）
 */

import { Module } from '@nestjs/common';
import { AutoUploadModule } from '../auto-upload/auto-upload.module';
import { LocalEngineModule } from '../local-engine/local-engine.module';
import { AgentSExecutorAdapter } from './agent-s-adapter';
import { ExecutorRouter } from './executor-router';
import { LocalRuntimeClient } from './local-runtime.client';

@Module({
  imports: [AutoUploadModule, LocalEngineModule],
  providers: [LocalRuntimeClient, AgentSExecutorAdapter, ExecutorRouter],
  exports: [ExecutorRouter],
})
export class RuntimeModule {}
