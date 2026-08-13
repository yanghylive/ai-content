import { Module } from '@nestjs/common';
import { LeadRepository } from './lead.repository';
import { LeadEventBus } from './lead-event-bus';

/**
 * 统一线索模块（一期）。
 * 提供写入层 LeadRepository + 事件总线 LeadEventBus（lead.created / lead.converted），
 * 供 comment-acquisition / growth 等模块接入，收敛到统一 leads 表。
 */
@Module({
  providers: [LeadRepository, LeadEventBus],
  exports: [LeadRepository, LeadEventBus],
})
export class LeadsModule {}
