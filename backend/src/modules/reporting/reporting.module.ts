import { Module } from '@nestjs/common';
import { ReportingService } from './reporting.service';
import { ReportingController } from './reporting.controller';

/**
 * 效果报告模块（2026-08-09 商用能力补齐 R3）：
 * AI 生成数 / 发布数 / 曝光 / 互动统计，供前端效果看板与周报卡。
 */
@Module({
  controllers: [ReportingController],
  providers: [ReportingService],
  exports: [ReportingService],
})
export class ReportingModule {}
