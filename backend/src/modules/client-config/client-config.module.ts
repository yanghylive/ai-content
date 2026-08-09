import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ClientConfigController } from './client-config.controller';
import { ClientConfigService } from './client-config.service';

@Module({
  imports: [PrismaModule],
  controllers: [ClientConfigController],
  providers: [ClientConfigService],
  exports: [ClientConfigService],
})
export class ClientConfigModule {}
