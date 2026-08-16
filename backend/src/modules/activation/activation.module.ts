import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ActivationService } from './activation.service';

@Module({
  imports: [PrismaModule],
  providers: [ActivationService],
  exports: [ActivationService],
})
export class ActivationModule {}
