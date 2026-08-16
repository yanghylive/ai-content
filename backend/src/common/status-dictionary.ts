/**
 * 统一状态字典（报告 2.2 节）：把发布/互动/线索/CRM 四个域的状态词归一，
 * 每个状态带「用户文案 + 语义色 + 下一动作」，前后端共用，消除
 * pending/queued/running/未执行/待回执/失败 等混用。
 */

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface StatusEntry {
  key: string;
  label: string;
  tone: StatusTone;
  nextAction: string;
}

/** 发布状态（报告 2.2，对齐 publish-state.machine 的 7 态语义） */
export const PUBLISH_STATUS: Record<string, StatusEntry> = {
  draft: { key: 'draft', label: '草稿', tone: 'neutral', nextAction: '编辑内容' },
  queued: { key: 'queued', label: '排队中', tone: 'neutral', nextAction: '等待执行' },
  claimed: { key: 'claimed', label: '执行中', tone: 'info', nextAction: '等待回执' },
  waiting: { key: 'waiting', label: '待回读', tone: 'warning', nextAction: '回查结果' },
  completed: { key: 'completed', label: '已发布', tone: 'success', nextAction: '查看回执' },
  failed: { key: 'failed', label: '可重试失败', tone: 'danger', nextAction: '重试' },
  cancelled: { key: 'cancelled', label: '已取消', tone: 'neutral', nextAction: '重新发起' },
  uncertain: { key: 'uncertain', label: '结果不确定', tone: 'warning', nextAction: '人工确认' },
  permanent_failed: { key: 'permanent_failed', label: '永久失败', tone: 'danger', nextAction: '检查账号' },
};

/** 互动状态（报告 2.2） */
export const INTERACTION_STATUS: Record<string, StatusEntry> = {
  new: { key: 'new', label: '新事件', tone: 'info', nextAction: '分配负责人' },
  unassigned: { key: 'unassigned', label: '待分配', tone: 'warning', nextAction: '分配' },
  processing: { key: 'processing', label: '处理中', tone: 'info', nextAction: '等待回复' },
  pending: { key: 'pending', label: '待确认', tone: 'warning', nextAction: '确认发送' },
  sent: { key: 'sent', label: '已发送', tone: 'success', nextAction: '回读确认' },
  resolved: { key: 'resolved', label: '已解决', tone: 'success', nextAction: '无' },
  needs_human: { key: 'needs_human', label: '已转人工', tone: 'danger', nextAction: '人工接管' },
  ignored: { key: 'ignored', label: '已忽略', tone: 'neutral', nextAction: '无' },
  overdue: { key: 'overdue', label: '已超时', tone: 'danger', nextAction: '优先处理' },
};

/** 线索状态（报告 2.2） */
export const LEAD_STATUS: Record<string, StatusEntry> = {
  new: { key: 'new', label: '新线索', tone: 'info', nextAction: '验证' },
  verified: { key: 'verified', label: '已验证', tone: 'neutral', nextAction: '触达' },
  contacted: { key: 'contacted', label: '已触达', tone: 'info', nextAction: '等待回复' },
  replied: { key: 'replied', label: '已回复', tone: 'info', nextAction: '推进' },
  qualified: { key: 'qualified', label: '高意向', tone: 'success', nextAction: '转客户' },
  converted: { key: 'converted', label: '已转客户', tone: 'success', nextAction: 'CRM 跟进' },
  ignored: { key: 'ignored', label: '已忽略', tone: 'neutral', nextAction: '无' },
  blocked: { key: 'blocked', label: '已屏蔽', tone: 'danger', nextAction: '无' },
};

/** CRM 商机/客户状态（报告 2.2） */
export const CRM_STATUS: Record<string, StatusEntry> = {
  new: { key: 'new', label: '新客户', tone: 'info', nextAction: '联系' },
  contacting: { key: 'contacting', label: '联系中', tone: 'info', nextAction: '跟进' },
  qualified: { key: 'qualified', label: '资格确认', tone: 'warning', nextAction: '建商机' },
  discovery: { key: 'discovery', label: '发现阶段', tone: 'info', nextAction: '推进' },
  proposal: { key: 'proposal', label: '提案', tone: 'info', nextAction: '推进' },
  negotiation: { key: 'negotiation', label: '谈判', tone: 'info', nextAction: '推进' },
  won: { key: 'won', label: '成交', tone: 'success', nextAction: '履约' },
  lost: { key: 'lost', label: '失单', tone: 'danger', nextAction: '复盘' },
  nurture: { key: 'nurture', label: '暂缓', tone: 'neutral', nextAction: '定期触达' },
};

/** 按域取状态字典（缺省回退「未知」） */
export function statusOf(
  domain: 'publish' | 'interaction' | 'lead' | 'crm',
  key: string | null | undefined,
): StatusEntry {
  const dict =
    domain === 'publish'
      ? PUBLISH_STATUS
      : domain === 'interaction'
        ? INTERACTION_STATUS
        : domain === 'lead'
          ? LEAD_STATUS
          : CRM_STATUS;
  return (
    dict[key ?? ''] ?? {
      key: key ?? 'unknown',
      label: key ?? '未知',
      tone: 'neutral',
      nextAction: '查看详情',
    }
  );
}
