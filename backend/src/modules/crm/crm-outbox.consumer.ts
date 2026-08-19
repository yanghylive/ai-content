// CRM 领域事件消费者：订阅 outbox 广播的领域事件，触发 CRM 侧的异步后续动作。
// 首个消费者：lead.action.executed（convert_crm）→ 追加「欢迎语待准备」时间线。
import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  OutboxDomainEvent,
  OutboxRelayService,
} from '../outbox/outbox-relay.service';
import { CrmService } from './crm.service';

@Injectable()
export class CrmOutboxConsumer implements OnModuleInit {
  constructor(
    private readonly outboxRelay: OutboxRelayService,
    private readonly crm: CrmService,
  ) {}

  onModuleInit(): void {
    // 声明只关注 lead.action.executed：让 relay 精确判断「该 type 是否有消费者」，
    // 未消费的其它 type（如 lead.created/lead.converted）不会被误标 consumed。
    this.outboxRelay.onDomainEvent(
      (event) => this.handle(event),
      ['lead.action.executed'],
    );
  }

  private async handle(event: OutboxDomainEvent): Promise<void> {
    if (event.type !== 'lead.action.executed') return;
    const payload = event.payload as {
      actionType?: string;
      customerId?: string;
    } | null;
    if (payload?.actionType !== 'convert_crm') return;
    const customerId = payload.customerId;
    if (!customerId || !event.userId) return;
    // 失败抛错（不静默吞），让 relay 的 markFailed + 重试机制生效：
    // 欢迎语时间线是可重试的幂等动作，重试到成功或死信（dead）为止。
    await this.crm.appendWelcomePendingTimeline(event.userId, customerId);
  }
}
