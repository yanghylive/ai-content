import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { WechatPayController } from './wechat-pay.controller';
import { WechatPayService } from './wechat-pay.service';

@Module({
  imports: [TenantsModule],
  controllers: [BillingController, WechatPayController],
  providers: [BillingService, WechatPayService],
  exports: [BillingService, WechatPayService],
})
export class BillingModule {}
