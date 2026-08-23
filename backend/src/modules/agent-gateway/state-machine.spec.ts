import { describe, it, expect } from '@jest/globals';
import { transition } from './core/task-state-machine';
import { makeError } from './contracts/error-codes';

describe('任务状态机', () => {
  it('正常迁移：draft → planned → running → succeeded', () => {
    expect(transition('draft', 'plan')).toBe('planned');
    expect(transition('planned', 'run')).toBe('running');
    expect(transition('running', 'succeed')).toBe('succeeded');
  });

  it('确认流：planned → awaiting_confirmation → running', () => {
    expect(transition('planned', 'request_confirmation')).toBe('awaiting_confirmation');
    expect(transition('awaiting_confirmation', 'approve')).toBe('running');
  });

  it('部分成功可继续：running → partially_succeeded → running', () => {
    expect(transition('running', 'partial_success')).toBe('partially_succeeded');
    expect(transition('partially_succeeded', 'resume')).toBe('running');
  });

  it('失败可分重试：running → failed_retryable → running', () => {
    expect(transition('running', 'fail_retryable')).toBe('failed_retryable');
    expect(transition('failed_retryable', 'resume')).toBe('running');
  });

  it('终态不可再执行：succeeded 抛 TASK_TERMINAL', () => {
    const err = makeError('TASK_TERMINAL');
    expect(() => transition('succeeded', 'run')).toThrow();
    expect(() => transition('cancelled', 'resume')).toThrow();
    expect(err.code).toBe('TASK_TERMINAL');
  });

  it('非运行态暂停抛 NOT_PAUSABLE', () => {
    const codeOf = (fn: () => unknown): string => {
      try {
        fn();
      } catch (e) {
        return (e as { code: string }).code;
      }
      throw new Error('expected throw');
    };
    expect(codeOf(() => transition('draft', 'pause'))).toBe('NOT_PAUSABLE');
    expect(codeOf(() => transition('planned', 'resume'))).toBe('NOT_PAUSABLE');
  });
});
