import { Module } from '@nestjs/common';
import { AiAuditController } from './ai-audit.controller';
import { AiAuditService } from './ai-audit.service';

/**
 * AI 审计 + 配额（B6/P3，主文档 3.8 安全契约）
 * + Token 用量追踪（/api/usage/token 三个端点）
 */
@Module({
  controllers: [AiAuditController],
  providers: [AiAuditService],
  exports: [AiAuditService],
})
export class AiAuditModule {}
