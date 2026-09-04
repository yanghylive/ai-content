import { Module } from '@nestjs/common';
import { AiModelsModule } from '../ai-models/ai-models.module';
import { LeadRepository } from './lead.repository';
import { LeadAttributionService } from './lead-attribution.service';
import { AttributionLinkService } from './attribution-link.service';
import { LeadConvertService } from './lead-convert.service';
import { LeadsController } from './leads.controller';
import { IdentityResolverService } from '../lead-intelligence/identity-resolver.service';
import { LeadScoreService } from '../lead-intelligence/lead-score.service';
import { LeadSignalStore } from '../lead-intelligence/lead-signal.store';
import { KeywordIntelligenceService } from '../lead-intelligence/keyword-intelligence.service';

/**
 * 统一线索模块（一期）。
 * 提供写入层 LeadRepository，供 comment-acquisition / growth 等模块接入，收敛到统一 leads 表。
 * 二期加 LeadConvertService（原子转客户，报告 6.3 P0）+ LeadsController。
 * Sprint 4 T4.1：LeadConvertService 注入 IdentityResolverService（原子转 CRM 第 3 步）。
 * 注：LeadEventBus 事件流已废弃（业务动作在 leadRepository/convert 同步落地，不走事件消费者）。
 */
@Module({
  imports: [AiModelsModule],
  controllers: [LeadsController],
  providers: [
    LeadRepository,
    LeadAttributionService,
    AttributionLinkService,
    LeadConvertService,
    IdentityResolverService,
    LeadScoreService,
    LeadSignalStore,
    KeywordIntelligenceService,
  ],
  exports: [
    LeadRepository,
    LeadAttributionService,
    AttributionLinkService,
    LeadConvertService,
    KeywordIntelligenceService,
  ],
})
export class LeadsModule {}
