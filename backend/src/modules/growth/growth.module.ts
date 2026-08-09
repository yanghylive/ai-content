import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AiEmployeeModule } from '../ai-employee/ai-employee.module';
import { AutoUploadModule } from '../auto-upload/auto-upload.module';
import { AuthModule } from '../auth/auth.module';
import { CrmModule } from '../crm/crm.module';
import { RuntimeModule } from '../runtime/runtime.module';
import { GrowthController } from './growth.controller';
import { GrowthService } from './growth.service';

@Module({
  imports: [
    AiEmployeeModule,
    AutoUploadModule,
    AuthModule,
    CrmModule,
    PrismaModule,
    RuntimeModule,
  ],
  controllers: [GrowthController],
  providers: [GrowthService],
  exports: [GrowthService],
})
export class GrowthModule {}
