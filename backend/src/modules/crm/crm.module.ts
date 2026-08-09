import { Module } from '@nestjs/common';
import { AppMarketModule } from '../app-market/app-market.module';
import { CrmAppGuard } from './crm-app.guard';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';

@Module({
  imports: [AppMarketModule],
  controllers: [CrmController],
  providers: [CrmAppGuard, CrmService],
  exports: [CrmService],
})
export class CrmModule {}
