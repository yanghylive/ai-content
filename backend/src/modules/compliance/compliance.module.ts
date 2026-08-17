import { Module } from '@nestjs/common';
import { ContentOptimizationModule } from '../content-optimization/content-optimization.module';
import { ComplianceController } from './compliance.controller';
import { ComplianceService } from './compliance.service';
import { PlatformComplianceAuditService } from './platform-compliance-audit.service';

@Module({
  imports: [ContentOptimizationModule],
  controllers: [ComplianceController],
  providers: [ComplianceService, PlatformComplianceAuditService],
  exports: [ComplianceService, PlatformComplianceAuditService],
})
export class ComplianceModule {}
