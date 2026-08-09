import { Module } from '@nestjs/common';
import { SavingsService } from './savings.service';
import { SavingsController } from './savings.controller';
import { SavingsAdapterRegistry } from './savings-adapter/adapter.registry';
import { DatokeAdapter } from './savings-adapter/datoke.adapter';
import { HaodankuAdapter } from './savings-adapter/haodanku.adapter';
import { SavingsLedgerService } from './savings-ledger.service';
import { CpsOrderSyncService } from './cps-order-sync.service';
import { PriceWatchSchedulerService } from './price-watch-scheduler.service';
import { SavingsExchangeService } from './savings-exchange.service';
import {
  SavingsWithdrawalService,
  MockWithdrawalChannel,
} from './savings-withdrawal.service';
import { PushNotificationsModule } from '../push-notifications/push-notifications.module';

/**
 * 智能省钱与返利抵算力模块（2026-08-09，需求清单 V1.1）：
 * 商品解析/比价/监控/CPS 转链/订单归因/返利账本/提现/兑换 AI 额度。
 * 供应商适配层可替换（大淘客+好单库双供应商 → 官方直连），业务层不感知供应商。
 * M2 新增：账本（SavingsLedgerService）+ 订单同步（CpsOrderSyncService）+ 监控调度（PriceWatchSchedulerService）。
 * P0b 前置：好单库适配器（HaodankuAdapter，补美团/饿了么 + 万能解析兜底）。
 */
@Module({
  imports: [PushNotificationsModule],
  controllers: [SavingsController],
  providers: [
    SavingsService,
    SavingsAdapterRegistry,
    DatokeAdapter,
    HaodankuAdapter,
    SavingsLedgerService,
    CpsOrderSyncService,
    PriceWatchSchedulerService,
    SavingsExchangeService,
    SavingsWithdrawalService,
    MockWithdrawalChannel,
  ],
  exports: [
    SavingsService,
    SavingsLedgerService,
    SavingsExchangeService,
    SavingsWithdrawalService,
  ],
})
export class SavingsModule {}
