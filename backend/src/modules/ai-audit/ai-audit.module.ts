import { Module } from '@nestjs/common';
import { AiAuditService } from './ai-audit.service';

/**
 * AI 审计 + 配额（B6/P3，主文档 3.8 安全契约）
 */
@Module({
  providers: [AiAuditService],
  exports: [AiAuditService],
})
export class AiAuditModule {}
