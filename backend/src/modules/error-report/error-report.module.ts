import { Module } from '@nestjs/common';
import { ErrorReportController } from './error-report.controller';

@Module({
  controllers: [ErrorReportController],
})
export class ErrorReportModule {}
