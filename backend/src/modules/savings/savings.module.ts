import { Module } from '@nestjs/common';
import { SavingsService } from './savings.service';
import { SavingsController } from './savings.controller';
import { SavingsAdapterRegistry } from './savings-adapter/adapter.registry';
import { DatokeAdapter } from './savings-adapter/datoke.adapter';

/**
 * 智能省钱与返利抵算力模块（2026-08-09，需求清单 V1.1）：
 * 商品解析/比价/监控/CPS 转链/订单归因/返利账本/提现/兑换 AI 额度。
 * 供应商适配层可替换（大淘客 → 维易 → 官方直连），业务层不感知供应商。
 */
@Module({
  controllers: [SavingsController],
  providers: [SavingsService, SavingsAdapterRegistry, DatokeAdapter],
  exports: [SavingsService],
})
export class SavingsModule {}
