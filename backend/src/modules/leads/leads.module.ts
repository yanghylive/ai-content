import { Module } from '@nestjs/common';
import { LeadRepository } from './lead.repository';
import { LeadEventBus } from './lead-event-bus';
import { LeadAttributionService } from './lead-attribution.service';
import { AttributionLinkService } from './attribution-link.service';
import { LeadConvertService } from './lead-convert.service';
import { LeadsController } from './leads.controller';
import { IdentityResolverService } from '../lead-intelligence/identity-resolver.service';

/**
 * 统一线索模块（一期）。
 * 提供写入层 LeadRepository + 事件总线 LeadEventBus（lead.created / lead.converted），
 * 供 comment-acquisition / growth 等模块接入，收敛到统一 leads 表。
 * 二期加 LeadConvertService（原子转客户，报告 6.3 P0）+ LeadsController。
 * Sprint 4 T4.1：LeadConvertService 注入 IdentityResolverService（原子转 CRM 第 3 步）。
 */
@Module({
  controllers: [LeadsController],
  providers: [
    LeadRepository,
    LeadEventBus,
    LeadAttributionService,
    AttributionLinkService,
    LeadConvertService,
    IdentityResolverService,
  ],
  exports: [
    LeadRepository,
    LeadEventBus,
    LeadAttributionService,
    AttributionLinkService,
    LeadConvertService,
  ],
})
export class LeadsModule {}
