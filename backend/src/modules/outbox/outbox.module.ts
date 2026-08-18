// Outbox 模块（P1-8，2026-08-17）
// DomainEventOutboxStore（事件落库）+ OutboxRelayService（worker 消费发布）。
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DomainEventOutboxStore } from './domain-event-outbox.store';
import { OutboxRelayService } from './outbox-relay.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [DomainEventOutboxStore, OutboxRelayService],
  exports: [DomainEventOutboxStore, OutboxRelayService],
})
export class OutboxModule {}
