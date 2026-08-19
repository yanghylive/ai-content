import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AiEmployeeModule } from '../ai-employee/ai-employee.module';
import { AutoUploadModule } from '../auto-upload/auto-upload.module';
import { AuthModule } from '../auth/auth.module';
import { CrmModule } from '../crm/crm.module';
import { RuntimeModule } from '../runtime/runtime.module';
import { ActivationModule } from '../activation/activation.module';
import { LeadsModule } from '../leads/leads.module';
import { LeadSignalStore } from '../lead-intelligence/lead-signal.store';
import { LeadScoreService } from '../lead-intelligence/lead-score.service';
import { SuppressionService } from '../lead-intelligence/suppression.service';
import { QualificationService } from '../lead-intelligence/qualification.service';
import { AttributionEventStore } from '../attribution/attribution-event.store';
import { RpaModule } from '../rpa/rpa.module';
import { GrowthController } from './growth.controller';
import { GrowthService } from './growth.service';
import { GrowthLeadBridgeService } from './growth-lead-bridge.service';

@Module({
  imports: [
    AiEmployeeModule,
    AutoUploadModule,
    AuthModule,
    CrmModule,
    PrismaModule,
    RuntimeModule,
    ActivationModule,
    LeadsModule,
    RpaModule,
  ],
  controllers: [GrowthController],
  providers: [
    GrowthService,
    GrowthLeadBridgeService,
    LeadSignalStore,
    LeadScoreService,
    SuppressionService,
    QualificationService,
    AttributionEventStore,
  ],
  exports: [GrowthService],
})
export class GrowthModule {}
