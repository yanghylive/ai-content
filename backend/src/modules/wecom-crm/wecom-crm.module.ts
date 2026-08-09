import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { WecomCrmController } from './wecom-crm.controller';
import { WecomCrmService } from './wecom-crm.service';

@Module({
  imports: [PrismaModule],
  controllers: [WecomCrmController],
  providers: [WecomCrmService],
  exports: [WecomCrmService],
})
export class WecomCrmModule {}
