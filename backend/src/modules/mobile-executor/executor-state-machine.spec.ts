import { canTransition, normalizeStatus } from './executor-state-machine';

describe('executor-state-machine', () => {
  it('归一化旧状态别名', () => {
    expect(normalizeStatus('claimed')).toBe('leasing');
    expect(normalizeStatus('running')).toBe('executing');
    expect(normalizeStatus('done')).toBe('completed');
    expect(normalizeStatus('executing')).toBe('executing');
  });

  it('正向流转允许（含跳级）', () => {
    expect(canTransition('queued', 'leasing').ok).toBe(true);
    expect(canTransition('leasing', 'preparing').ok).toBe(true);
    expect(canTransition('leasing', 'executing').ok).toBe(true); // 跳级允许
    expect(canTransition('executing', 'verifying').ok).toBe(true);
    expect(canTransition('verifying', 'crm_sync').ok).toBe(true);
    expect(canTransition('crm_sync', 'completed').ok).toBe(true);
  });

  it('兼容旧状态（claimed→running→done）', () => {
    expect(canTransition('claimed', 'running').ok).toBe(true);
    expect(canTransition('running', 'done').ok).toBe(true);
  });

  it('任何非终态可转异常态', () => {
    expect(canTransition('executing', 'failed').ok).toBe(true);
    expect(canTransition('executing', 'unknown').ok).toBe(true);
    expect(canTransition('observing', 'failed').ok).toBe(true);
  });

  it('终态不可转出', () => {
    expect(canTransition('completed', 'failed').ok).toBe(false);
    expect(canTransition('failed', 'executing').ok).toBe(false);
    expect(canTransition('cancelled', 'executing').ok).toBe(false);
  });

  it('unknown 可人工回读转 completed/failed', () => {
    expect(canTransition('unknown', 'completed').ok).toBe(true);
    expect(canTransition('unknown', 'failed').ok).toBe(true);
    expect(canTransition('unknown', 'executing').ok).toBe(false);
  });

  it('禁止倒退', () => {
    expect(canTransition('executing', 'observing').ok).toBe(false);
    expect(canTransition('verifying', 'executing').ok).toBe(false);
    expect(canTransition('completed', 'verifying').ok).toBe(false);
  });

  it('非法状态拒绝', () => {
    expect(canTransition('executing', 'bogus').ok).toBe(false);
    expect(canTransition('bogus', 'executing').ok).toBe(false);
  });
});
