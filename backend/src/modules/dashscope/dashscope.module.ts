import { Module } from '@nestjs/common';
import { DashscopeController } from './dashscope.controller';
import { MultimodalModule } from '../multimodal/multimodal.module';

/**
 * 多模态（P4）：生图 + 配音路由（/api/ai/image、/api/ai/speech）。
 * 2026-08-09 起实现统一由 MultimodalService（模型台 / kaypal 网关 + 云端积分）提供，
 * 不再持有任何百炼直连凭据（直连 Key 环境变量已于当日移除）。
 * 门禁：backend/scripts/check-no-direct-provider.mjs
 */
@Module({
  imports: [MultimodalModule],
  controllers: [DashscopeController],
})
export class DashscopeModule {}
