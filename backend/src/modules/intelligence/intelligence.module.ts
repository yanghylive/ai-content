import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CommentInsightsModule } from '../comment-insights/comment-insights.module';
import { RedfoxModule } from '../redfox/redfox.module';
import { RuntimeModule } from '../runtime/runtime.module';
import { IntelligenceController } from './intelligence.controller';
import { IntelligenceImportService } from './intelligence-import.service';
import { IntelligenceMonitorRunnerService } from './intelligence-monitor-runner.service';
import { IntelligenceNormalizerService } from './intelligence-normalizer.service';
import { IntelligenceService } from './intelligence.service';

@Module({
  imports: [PrismaModule, RedfoxModule, CommentInsightsModule, RuntimeModule],
  controllers: [IntelligenceController],
  providers: [
    IntelligenceService,
    IntelligenceImportService,
    IntelligenceMonitorRunnerService,
    IntelligenceNormalizerService,
  ],
  exports: [
    IntelligenceService,
    IntelligenceImportService,
    IntelligenceMonitorRunnerService,
    IntelligenceNormalizerService,
  ],
})
export class IntelligenceModule {}
