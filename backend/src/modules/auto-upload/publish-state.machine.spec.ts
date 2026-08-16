import {
  assertPublishTransition,
  canTransition,
  isCancellable,
  isRetryable,
  isTerminalState,
  PUBLISH_STATES,
} from './publish-state.machine';

describe('publish-state.machine', () => {
  it('覆盖全部 7 个状态', () => {
    expect(PUBLISH_STATES).toEqual([
      'queued',
      'claimed',
      'waiting',
      'completed',
      'failed',
      'cancelled',
    ]);
  });

  it('合法转移不抛错', () => {
    expect(() =>
      assertPublishTransition('queued', 'claimed'),
    ).not.toThrow();
    expect(() =>
      assertPublishTransition('queued', 'cancelled'),
    ).not.toThrow();
    expect(() =>
      assertPublishTransition('claimed', 'completed'),
    ).not.toThrow();
    expect(() =>
      assertPublishTransition('claimed', 'failed'),
    ).not.toThrow();
    expect(() =>
      assertPublishTransition('claimed', 'waiting'),
    ).not.toThrow();
    expect(() =>
      assertPublishTransition('claimed', 'queued'),
    ).not.toThrow();
    expect(() =>
      assertPublishTransition('waiting', 'queued'),
    ).not.toThrow();
    expect(() =>
      assertPublishTransition('waiting', 'cancelled'),
    ).not.toThrow();
  });

  it('非法转移抛错', () => {
    // 终态不可再转移
    expect(() =>
      assertPublishTransition('completed', 'queued'),
    ).toThrow(/invalid publish transition/);
    expect(() =>
      assertPublishTransition('failed', 'queued'),
    ).toThrow(/invalid publish transition/);
    expect(() =>
      assertPublishTransition('cancelled', 'queued'),
    ).toThrow(/invalid publish transition/);
    // queued 不能直接到终态
    expect(() =>
      assertPublishTransition('queued', 'completed'),
    ).toThrow(/invalid publish transition/);
    // waiting 不能直接认领（改期到点先回 queued）
    expect(() =>
      assertPublishTransition('waiting', 'claimed'),
    ).toThrow(/invalid publish transition/);
    // claimed 不能直接取消（先回 queued 再取消）
    expect(() =>
      assertPublishTransition('claimed', 'cancelled'),
    ).toThrow(/invalid publish transition/);
  });

  it('同状态刷新幂等放行（如改期仍为 waiting）', () => {
    expect(() =>
      assertPublishTransition('waiting', 'waiting'),
    ).not.toThrow();
  });

  it('canTransition 只判断不抛错', () => {
    expect(canTransition('queued', 'claimed')).toBe(true);
    expect(canTransition('completed', 'queued')).toBe(false);
  });

  it('isTerminalState 识别终态', () => {
    expect(isTerminalState('completed')).toBe(true);
    expect(isTerminalState('failed')).toBe(true);
    expect(isTerminalState('cancelled')).toBe(true);
    expect(isTerminalState('queued')).toBe(false);
    expect(isTerminalState('claimed')).toBe(false);
  });

  it('isCancellable 只有排队中/等待中可取消', () => {
    expect(isCancellable('queued')).toBe(true);
    expect(isCancellable('waiting')).toBe(true);
    expect(isCancellable('claimed')).toBe(false);
    expect(isCancellable('failed')).toBe(false);
  });

  it('isRetryable 只有 failed 可重试（重试=新建记录）', () => {
    expect(isRetryable('failed')).toBe(true);
    expect(isRetryable('waiting')).toBe(false);
    expect(isRetryable('completed')).toBe(false);
  });
});
