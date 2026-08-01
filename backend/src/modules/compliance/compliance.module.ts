import { Module } from '@nestjs/common';
import { ContentOptimizationModule } from '../content-optimization/content-optimization.module';
import { ComplianceController } from './compliance.controller';
import { ComplianceService } from './compliance.service';

@Module({
  imports: [ContentOptimizationModule],
  controllers: [ComplianceController],
  providers: [ComplianceService],
  exports: [ComplianceService],
})
export class ComplianceModule {}
