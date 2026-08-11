import { CircuitBreaker } from './circuit-breaker';

describe('CircuitBreaker', () => {
  // 用短窗口方便测试：窗口 100ms、阈值 3、熔断 200ms
  const fast = () =>
    new CircuitBreaker({
      windowMs: 100,
      threshold: 3,
      openDurationMs: 200,
    });

  it('失败 < 阈值不熔断', () => {
    const cb = fast();
    cb.recordFailure('douyin:1');
    cb.recordFailure('douyin:1');
    expect(cb.isOpen('douyin:1')).toBe(false);
    expect(cb.getStatus('douyin:1').failureCount).toBe(2);
  });

  it('窗口内失败 ≥ 阈值触发熔断', () => {
    const cb = fast();
    cb.recordFailure('douyin:1');
    cb.recordFailure('douyin:1');
    const opened = cb.recordFailure('douyin:1');
    expect(opened).toBe(true);
    expect(cb.isOpen('douyin:1')).toBe(true);
    expect(cb.getStatus('douyin:1').retryAfterSeconds).toBeGreaterThan(0);
  });

  it('熔断期过后自动恢复', async () => {
    const cb = fast();
    cb.recordFailure('douyin:1');
    cb.recordFailure('douyin:1');
    cb.recordFailure('douyin:1');
    expect(cb.isOpen('douyin:1')).toBe(true);
    await new Promise((r) => setTimeout(r, 250));
    expect(cb.isOpen('douyin:1')).toBe(false);
    expect(cb.getStatus('douyin:1').failureCount).toBe(0);
  });

  it('不同 key 独立计数', () => {
    const cb = fast();
    cb.recordFailure('douyin:1');
    cb.recordFailure('douyin:1');
    cb.recordFailure('douyin:1');
    expect(cb.isOpen('douyin:1')).toBe(true);
    expect(cb.isOpen('wechat-channel:2')).toBe(false);
  });

  it('成功重置失败计数', () => {
    const cb = fast();
    cb.recordFailure('douyin:1');
    cb.recordFailure('douyin:1');
    cb.recordSuccess('douyin:1');
    expect(cb.getStatus('douyin:1').failureCount).toBe(0);
    expect(cb.isOpen('douyin:1')).toBe(false);
  });

  it('窗口过期后失败计数自动清理', async () => {
    const cb = fast();
    cb.recordFailure('douyin:1');
    await new Promise((r) => setTimeout(r, 150));
    cb.recordFailure('douyin:1');
    cb.recordFailure('douyin:1');
    // 第一次失败已过期，只剩 2 次 → 未熔断
    expect(cb.isOpen('douyin:1')).toBe(false);
    expect(cb.getStatus('douyin:1').failureCount).toBe(2);
  });

  it('reset 清空全部', () => {
    const cb = fast();
    cb.recordFailure('a:1');
    cb.recordFailure('a:1');
    cb.recordFailure('a:1');
    cb.reset();
    expect(cb.isOpen('a:1')).toBe(false);
  });
});
