import { Module } from '@nestjs/common';
import { LeadRepository } from './lead.repository';

/**
 * 统一线索模块（一期）。
 * 只提供写入层 LeadRepository，供 comment-acquisition / growth 等模块
 * 在双写阶段逐步接入，收敛到统一 leads 表。
 */
@Module({
  providers: [LeadRepository],
  exports: [LeadRepository],
})
export class LeadsModule {}
