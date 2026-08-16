import { Module } from '@nestjs/common';
import { MeteringService } from './metering.service';

/**
 * 用量计量（阶段 B）：reserved → confirmed / reversed 三态账本。
 * 供发布、AI、互动、获客等执行点调用 reserve/confirm/reverse。
 */
@Module({
  providers: [MeteringService],
  exports: [MeteringService],
})
export class MeteringModule {}
