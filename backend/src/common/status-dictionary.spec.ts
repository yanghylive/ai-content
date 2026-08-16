import {
  CRM_STATUS,
  INTERACTION_STATUS,
  LEAD_STATUS,
  PUBLISH_STATUS,
  statusOf,
} from './status-dictionary';

describe('status-dictionary（报告 2.2 统一状态字典）', () => {
  it('发布状态覆盖报告 2.2 的全部 11 态', () => {
    expect(Object.keys(PUBLISH_STATUS).sort()).toEqual(
      [
        'cancelled',
        'claimed',
        'completed',
        'draft',
        'failed',
        'permanent_failed',
        'queued',
        'uncertain',
        'waiting',
      ].sort(),
    );
  });

  it('互动状态覆盖报告 2.2 的态', () => {
    expect(INTERACTION_STATUS.overdue.label).toBe('已超时');
    expect(INTERACTION_STATUS.needs_human.label).toBe('已转人工');
  });

  it('线索状态覆盖 replied/ignored/blocked', () => {
    expect(LEAD_STATUS.replied).toBeDefined();
    expect(LEAD_STATUS.ignored).toBeDefined();
    expect(LEAD_STATUS.blocked).toBeDefined();
  });

  it('CRM 商机阶段覆盖 new→qualified→…→won/lost/nurture', () => {
    expect(CRM_STATUS.won.label).toBe('成交');
    expect(CRM_STATUS.lost.label).toBe('失单');
    expect(CRM_STATUS.nurture.label).toBe('暂缓');
  });

  it('statusOf 未知状态回退「未知」', () => {
    const entry = statusOf('publish', 'unknown_x');
    expect(entry.tone).toBe('neutral');
    expect(entry.nextAction).toBe('查看详情');
  });

  it('statusOf 按域取正确字典', () => {
    expect(statusOf('publish', 'completed').label).toBe('已发布');
    expect(statusOf('lead', 'qualified').label).toBe('高意向');
  });
});
