import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { TenantsService } from './tenants.service';

@Module({
  imports: [PrismaModule],
  providers: [TenantsService],
  exports: [TenantsService],
})
export class TenantsModule {}
