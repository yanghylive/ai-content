import { Module } from '@nestjs/common';
import { AppMarketModule } from '../app-market/app-market.module';
import { BillingModule } from '../billing/billing.module';
import { CrmModule } from '../crm/crm.module';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { CommercialReadinessController } from './commercial-readiness.controller';
import { CommercialReadinessService } from './commercial-readiness.service';

@Module({
  imports: [AppMarketModule, BillingModule, CrmModule, EntitlementsModule],
  controllers: [CommercialReadinessController],
  providers: [CommercialReadinessService],
  exports: [CommercialReadinessService],
})
export class CommercialReadinessModule {}
