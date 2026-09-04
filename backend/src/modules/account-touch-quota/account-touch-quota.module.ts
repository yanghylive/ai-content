import { Module } from '@nestjs/common';
import { AccountTouchQuotaService } from './account-touch-quota.service';

/**
 * 账号维度触达配额模块（独立，零业务依赖）。
 * growth 与 comment-acquisition 各自 import 本模块，共用同一计数器，
 * 避免两模块互相引用产生循环依赖。
 */
@Module({
  providers: [AccountTouchQuotaService],
  exports: [AccountTouchQuotaService],
})
export class AccountTouchQuotaModule {}
