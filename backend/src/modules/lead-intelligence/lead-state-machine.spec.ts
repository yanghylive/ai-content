import {
  assertLeadTransition,
  assertTaskTransition,
  canEnterReconcile,
  LEAD_TRANSITIONS,
  TASK_TRANSITIONS,
} from './lead-state-machine';

describe('LeadStateMachine', () => {
  it('合法流转：discovered → identity_pending → identified → researched → scored', () => {
    expect(() => assertLeadTransition('discovered', 'identity_pending')).not.toThrow();
    expect(() => assertLeadTransition('identity_pending', 'identified')).not.toThrow();
    expect(() => assertLeadTransition('identified', 'researched')).not.toThrow();
    expect(() => assertLeadTransition('researched', 'scored')).not.toThrow();
  });

  it('非法流转抛错：discovered → won', () => {
    expect(() => assertLeadTransition('discovered', 'won')).toThrow('非法状态流转');
  });

  it('合法流转：scored → needs_review → approved → contacted', () => {
    expect(() => assertLeadTransition('scored', 'needs_review')).not.toThrow();
    expect(() => assertLeadTransition('needs_review', 'approved')).not.toThrow();
    expect(() => assertLeadTransition('approved', 'contacted')).not.toThrow();
  });

  it('任意阶段可进 duplicate_candidate / suppressed', () => {
    for (const from of ['discovered', 'identified', 'contacted', 'qualified', 'opportunity']) {
      expect(LEAD_TRANSITIONS[from]).toContain('duplicate_candidate');
      expect(LEAD_TRANSITIONS[from]).toContain('suppressed');
    }
  });

  it('reconcile_required 可从任意运行态进入', () => {
    for (const from of ['identified', 'scored', 'approved', 'contacted', 'replied', 'qualifying', 'qualified', 'task_created', 'opportunity']) {
      expect(LEAD_TRANSITIONS[from]).toContain('reconcile_required');
    }
  });

  it('won/lost 是终点态', () => {
    expect(LEAD_TRANSITIONS.won).toHaveLength(0);
    expect(LEAD_TRANSITIONS.lost).toHaveLength(0);
  });

  it('原地刷新（from===to）允许', () => {
    expect(() => assertLeadTransition('scored', 'scored')).not.toThrow();
  });
});

describe('TaskStateMachine', () => {
  it('合法流转：queued → preflight → running → readback_pending → succeeded', () => {
    expect(() => assertTaskTransition('queued', 'preflight')).not.toThrow();
    expect(() => assertTaskTransition('preflight', 'running')).not.toThrow();
    expect(() => assertTaskTransition('running', 'readback_pending')).not.toThrow();
    expect(() => assertTaskTransition('readback_pending', 'succeeded')).not.toThrow();
  });

  it('非法流转：succeeded → running（不允许重发后回退）', () => {
    expect(() => assertTaskTransition('succeeded', 'running')).toThrow('非法任务状态流转');
  });

  it('failed_retryable → queued 重试合法', () => {
    expect(() => assertTaskTransition('failed_retryable', 'queued')).not.toThrow();
  });

  it('任意运行态可进 reconcile_required（cancelled 除外）', () => {
    for (const from of ['queued', 'preflight', 'running', 'readback_pending', 'succeeded', 'failed_permanent']) {
      expect(TASK_TRANSITIONS[from]).toContain('reconcile_required');
    }
    expect(canEnterReconcile('cancelled')).toBe(false);
  });
});
