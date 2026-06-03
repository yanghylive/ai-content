/**
 * RuntimeModule · 浏览器执行 + 路由模块
 *
 * 详见：
 *  - docs/kaypal-ai-runtime-unification-development-plan-2026-06-03.html
 *  - docs/adr/001-executor-router-capability-interface.md
 *
 * P1 骨架阶段：
 *  - 提供 ExecutorRouter（仅 LocalRuntimeClient 注入）
 *  - 不导入 LocalEngineModule，避免循环依赖
 *  - 不在 LocalEngineModule 内使用 ExecutorRouter（P2 wire-up）
 *
 * P2 实施阶段（计划）：
 *  - 引入 AgentSService（通过 forwardRef 或独立 AgentSModule 拆分）
 *  - 添加 EvidenceService
 *  - 添加 runtime/platforms/{douyin,channel}/
 */

import { Module } from '@nestjs/common';
import { AutoUploadModule } from '../auto-upload/auto-upload.module';
import { ExecutorRouter } from './executor-router';
import { LocalRuntimeClient } from './local-runtime.client';

@Module({
  imports: [AutoUploadModule],
  providers: [LocalRuntimeClient, ExecutorRouter],
  exports: [ExecutorRouter],
})
export class RuntimeModule {}
