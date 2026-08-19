import { Module } from '@nestjs/common';
import { AppMarketModule } from '../app-market/app-market.module';
import { OutboxModule } from '../outbox/outbox.module';
import { CrmAppGuard } from './crm-app.guard';
import { CrmController } from './crm.controller';
import { CrmOutboxConsumer } from './crm-outbox.consumer';
import { CrmService } from './crm.service';

@Module({
  imports: [AppMarketModule, OutboxModule],
  controllers: [CrmController],
  providers: [CrmAppGuard, CrmService, CrmOutboxConsumer],
  exports: [CrmService],
})
export class CrmModule {}
