import {
  UNIFIED_TASK_STATUS_LABEL,
  normalizeTaskStatus,
} from './unified-task-status';

describe('normalizeTaskStatus', () => {
  it('auto-upload：completed/done → completed', () => {
    expect(normalizeTaskStatus('auto-upload', 'completed')).toBe('completed');
    expect(normalizeTaskStatus('auto-upload', 'failed')).toBe('failed');
    expect(normalizeTaskStatus('auto-upload', 'waiting')).toBe('waiting');
    expect(normalizeTaskStatus('auto-upload', 'running')).toBe('running');
  });

  it('video-workshop：succeeded → completed（命名不一致收敛）', () => {
    expect(normalizeTaskStatus('video-workshop', 'succeeded')).toBe('completed');
    expect(normalizeTaskStatus('video-workshop', 'cancelled')).toBe('cancelled');
  });

  it('interaction：WAITING_FOR_SEND_CONFIRMATION → waiting', () => {
    expect(
      normalizeTaskStatus('interaction', 'WAITING_FOR_SEND_CONFIRMATION'),
    ).toBe('waiting');
    expect(normalizeTaskStatus('interaction', 'BLOCKED')).toBe('failed');
    expect(normalizeTaskStatus('interaction', 'SKIPPED')).toBe('cancelled');
  });

  it('未知状态 → queued（兜底）', () => {
    expect(normalizeTaskStatus('auto-upload', '')).toBe('queued');
    expect(normalizeTaskStatus('local-engine', null)).toBe('queued');
  });

  it('7 个统一状态都有中文文案', () => {
    const statuses = [
      'queued',
      'running',
      'waiting',
      'completed',
      'failed',
      'cancelled',
      'stale',
    ] as const;
    for (const s of statuses) {
      expect(UNIFIED_TASK_STATUS_LABEL[s]).toBeTruthy();
    }
  });
});
