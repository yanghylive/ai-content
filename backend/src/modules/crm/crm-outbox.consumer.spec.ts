import { CrmOutboxConsumer } from './crm-outbox.consumer';
import type { OutboxDomainEvent } from '../outbox/outbox-relay.service';

function makeEvent(
  overrides: Partial<OutboxDomainEvent> = {},
): OutboxDomainEvent {
  return {
    type: 'lead.action.executed',
    aggregateType: 'lead',
    aggregateId: 'lead-1',
    tenantId: 't1',
    userId: 'u-1',
    payload: { actionType: 'convert_crm', customerId: 'c-1' },
    ...overrides,
  };
}

function makeConsumer() {
  const outboxRelay = {
    onDomainEvent: jest.fn(),
  };
  const crm = {
    getCustomer: jest.fn().mockResolvedValue({ id: 'c-1' }),
    appendWelcomePendingTimeline: jest.fn().mockResolvedValue(undefined),
  };
  const consumer = new CrmOutboxConsumer(outboxRelay as never, crm as never);
  return { consumer, outboxRelay, crm };
}

/** 捕获 onModuleInit 注册的 handler（即真实 relay 会调用的那个） */
function handlerOf(outboxRelay: { onDomainEvent: jest.Mock }) {
  return outboxRelay.onDomainEvent.mock.calls[0][0] as (
    event: OutboxDomainEvent,
  ) => Promise<void>;
}

describe('CrmOutboxConsumer（lead.action.executed → 欢迎语时间线）', () => {
  it('onModuleInit：声明只关注 lead.action.executed（供 relay 精确判断消费者）', () => {
    const { consumer, outboxRelay } = makeConsumer();
    consumer.onModuleInit();
    expect(outboxRelay.onDomainEvent).toHaveBeenCalledWith(
      expect.any(Function),
      ['lead.action.executed'],
    );
  });

  it('handle：非 lead.action.executed → 不处理', async () => {
    const { consumer, outboxRelay, crm } = makeConsumer();
    consumer.onModuleInit();
    await handlerOf(outboxRelay)(makeEvent({ type: 'lead.created' }));
    expect(crm.appendWelcomePendingTimeline).not.toHaveBeenCalled();
  });

  it('handle：actionType 非 convert_crm → 不处理', async () => {
    const { consumer, outboxRelay, crm } = makeConsumer();
    consumer.onModuleInit();
    await handlerOf(outboxRelay)(
      makeEvent({ payload: { actionType: 'other', customerId: 'c-1' } }),
    );
    expect(crm.appendWelcomePendingTimeline).not.toHaveBeenCalled();
  });

  it('handle：convert_crm → 调 appendWelcomePendingTimeline(userId, customerId)', async () => {
    const { consumer, outboxRelay, crm } = makeConsumer();
    consumer.onModuleInit();
    await handlerOf(outboxRelay)(makeEvent());
    expect(crm.appendWelcomePendingTimeline).toHaveBeenCalledWith('u-1', 'c-1');
  });

  it('handle：appendWelcomePendingTimeline 失败 → 抛错（不吞，触发 relay 重试）', async () => {
    const { consumer, outboxRelay, crm } = makeConsumer();
    consumer.onModuleInit();
    crm.appendWelcomePendingTimeline.mockRejectedValue(
      new Error('timeline write fail'),
    );
    await expect(handlerOf(outboxRelay)(makeEvent())).rejects.toThrow(
      'timeline write fail',
    );
  });

  it('handle：客户已删除 → 跳过（不写时间线，不抛错，防 outbox 重试到 dead）', async () => {
    const { consumer, outboxRelay, crm } = makeConsumer();
    consumer.onModuleInit();
    crm.getCustomer.mockRejectedValue(
      Object.assign(new Error('客户不存在'), { status: 404 }),
    );
    await expect(handlerOf(outboxRelay)(makeEvent())).resolves.toBeUndefined();
    expect(crm.appendWelcomePendingTimeline).not.toHaveBeenCalled();
  });
});
