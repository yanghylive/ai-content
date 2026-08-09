import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { EntitlementsService } from './entitlements.service';

@Module({
  imports: [TenantsModule],
  providers: [EntitlementsService],
  exports: [EntitlementsService],
})
export class EntitlementsModule {}
