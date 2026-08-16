import { Module } from '@nestjs/common';
import { ReportingService } from './reporting.service';
import { ReportingController } from './reporting.controller';
import { FunnelReportService } from './funnel-report.service';
import { ReviewRunService } from './review-run.service';

/**
 * 效果报告模块（2026-08-09 商用能力补齐 R3）：
 * AI 生成数 / 发布数 / 曝光 / 互动统计，供前端效果看板与周报卡。
 * 2026-08-16 补六步漏斗（FunnelReportService）+ 复盘运行（ReviewRunService）。
 */
@Module({
  controllers: [ReportingController],
  providers: [ReportingService, FunnelReportService, ReviewRunService],
  exports: [ReportingService, FunnelReportService, ReviewRunService],
})
export class ReportingModule {}
