import { describe, it, expect } from '@jest/globals';
import { EventBus } from './core/event-bus';

describe('事件总线', () => {
  it('sequence 单调递增、eventId 唯一', () => {
    const bus = new EventBus();
    const e1 = bus.publish('s1', 'message', 't1', { content: 'a' });
    const e2 = bus.publish('s1', 'message', 't1', { content: 'b' });
    expect(e2.sequence).toBe(e1.sequence + 1);
    expect(e1.eventId).not.toBe(e2.eventId);
  });

  it('getEventsSince(lastEventId) 只返回之后事件', () => {
    const bus = new EventBus();
    bus.publish('s1', 'message', 't1', { content: 'a' });
    const e2 = bus.publish('s1', 'message', 't1', { content: 'b' });
    bus.publish('s1', 'message', 't1', { content: 'c' });
    const since = bus.getEventsSince('s1', e2.eventId);
    expect(since.map((e) => e.payload.content)).toEqual(['c']);
  });

  it('未知 lastEventId → RESUME_WINDOW_EXPIRED', () => {
    const bus = new EventBus();
    bus.publish('s1', 'message', 't1', { content: 'a' });
    let code = '';
    try {
      bus.getEventsSince('s1', 'evt_999999');
    } catch (e) {
      code = (e as { code: string }).code;
    }
    expect(code).toBe('RESUME_WINDOW_EXPIRED');
  });

  it('subscribe 收到实时事件', () => {
    const bus = new EventBus();
    const got: string[] = [];
    bus.subscribe('s1', (e) => got.push(e.type));
    bus.publish('s1', 'tool_started', 't1', { toolCallId: 'c', toolName: 'x' });
    expect(got).toContain('tool_started');
  });
});
