import { Module } from '@nestjs/common';
import { ComplianceModule } from '../compliance/compliance.module';
import { ContentOptimizationModule } from '../content-optimization/content-optimization.module';
import { CrmModule } from '../crm/crm.module';
import { IntelligenceModule } from '../intelligence/intelligence.module';
import { RedfoxModule } from '../redfox/redfox.module';
import { SolutionsController } from './solutions.controller';
import { SolutionsService } from './solutions.service';

@Module({
  imports: [
    RedfoxModule,
    IntelligenceModule,
    CrmModule,
    ComplianceModule,
    ContentOptimizationModule,
  ],
  controllers: [SolutionsController],
  providers: [SolutionsService],
  exports: [SolutionsService],
})
export class SolutionsModule {}
