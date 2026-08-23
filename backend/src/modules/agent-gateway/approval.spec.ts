import { describe, it, expect } from '@jest/globals';
import { ApprovalService } from './core/approval';

describe('审批服务', () => {
  it('预览一致且未过期 → 标记 approved', () => {
    const a = new ApprovalService();
    const preview = { toolName: 'publish_execute', payload: { platform: 'douyin' } };
    const apr = a.create('task1', 'call1', preview, 60_000);
    const validated = a.validate(apr.id, preview, 'task1', 'call1');
    expect(validated.status).toBe('approved');
  });

  it('过期 → APPROVAL_EXPIRED', () => {
    const a = new ApprovalService();
    const apr = a.create('task1', 'call1', { x: 1 }, 10);
    let code = '';
    try {
      a.validate(apr.id, { x: 1 }, 'task1', 'call1', Date.now() + 20_000);
    } catch (e) {
      code = (e as { code: string }).code;
    }
    expect(code).toBe('APPROVAL_EXPIRED');
  });

  it('预览变化 → PREVIEW_CHANGED', () => {
    const a = new ApprovalService();
    const apr = a.create('task1', 'call1', { platform: 'douyin' }, 60_000);
    let code = '';
    try {
      a.validate(apr.id, { platform: 'xhs' }, 'task1', 'call1');
    } catch (e) {
      code = (e as { code: string }).code;
    }
    expect(code).toBe('PREVIEW_CHANGED');
  });

  it('跨任务复用审批 → APPROVAL_MISMATCH', () => {
    const a = new ApprovalService();
    const apr = a.create('task1', 'call1', { platform: 'douyin' }, 60_000);
    let code = '';
    try {
      a.validate(apr.id, { platform: 'douyin' }, 'OTHER_TASK', 'call1');
    } catch (e) {
      code = (e as { code: string }).code;
    }
    expect(code).toBe('APPROVAL_MISMATCH');
  });

  it('一次性消费：同一审批 ID 二次使用 → APPROVAL_MISMATCH', () => {
    const a = new ApprovalService();
    const preview = { platform: 'douyin' };
    const apr = a.create('task1', 'call1', preview, 60_000);
    a.validate(apr.id, preview, 'task1', 'call1');
    a.consume(apr.id);
    let code = '';
    try {
      a.validate(apr.id, preview, 'task1', 'call1');
    } catch (e) {
      code = (e as { code: string }).code;
    }
    expect(code).toBe('APPROVAL_MISMATCH');
  });

  it('previewHashOf 对相同输入稳定、不同输入不同', () => {
    expect(ApprovalService.previewHashOf({ a: 1, b: 2 })).toBe(ApprovalService.previewHashOf({ b: 2, a: 1 }));
    expect(ApprovalService.previewHashOf({ a: 1 })).not.toBe(ApprovalService.previewHashOf({ a: 2 }));
  });
});
