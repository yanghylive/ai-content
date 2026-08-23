/**
 * 执行任务状态机（PRD §7，P0-2）：
 * queued → leasing → preparing → observing → awaiting_approval → executing → verifying → crm_sync → completed
 * 异常态：failed / cancelled / unknown（unknown 可人工回读转 completed/failed）。
 *
 * 兼容旧状态别名：claimed→leasing、running→executing、done→completed，
 * 避免存量 agent/壳代码破坏（正向流转允许跳级，禁止倒退）。
 */

export const EXECUTOR_STATUSES = [
  'queued',
  'leasing',
  'preparing',
  'observing',
  'awaiting_approval',
  'executing',
  'verifying',
  'crm_sync',
  'completed',
  'failed',
  'cancelled',
  'unknown',
] as const;

/** 旧状态别名 → 规范化状态 */
const STATUS_ALIAS: Record<string, string> = {
  claimed: 'leasing',
  running: 'executing',
  done: 'completed',
};

/** 正向序列（可跳级，禁止倒退） */
const STATUS_ORDER = [
  'queued',
  'leasing',
  'preparing',
  'observing',
  'awaiting_approval',
  'executing',
  'verifying',
  'crm_sync',
  'completed',
];

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

/** 规范化状态（别名映射） */
export function normalizeStatus(status: string): string {
  return STATUS_ALIAS[status] ?? status;
}

/** 校验状态流转合法性 */
export function canTransition(
  from: string,
  to: string,
): { ok: boolean; reason?: string } {
  const nFrom = normalizeStatus(from);
  const nTo = normalizeStatus(to);
  // unknown：仅允许人工回读转 completed/failed，其余不可转出
  if (nFrom === 'unknown') {
    if (nTo === 'completed' || nTo === 'failed') {
      return { ok: true };
    }
    return { ok: false, reason: `unknown 需人工回读后转 completed/failed` };
  }
  // 终态不可转出
  if (TERMINAL.has(nFrom)) {
    return { ok: false, reason: `任务已处于终态 ${nFrom}，不可再转为 ${nTo}` };
  }
  // 异常态：任何非终态可转
  if (nTo === 'failed' || nTo === 'unknown' || nTo === 'cancelled') {
    return { ok: true };
  }
  const fi = STATUS_ORDER.indexOf(nFrom);
  const ti = STATUS_ORDER.indexOf(nTo);
  if (fi < 0 || ti < 0) {
    return { ok: false, reason: `非法状态：${to}` };
  }
  if (ti <= fi) {
    return { ok: false, reason: `状态不可倒退（${nFrom} → ${nTo}）` };
  }
  return { ok: true };
}

/** 是否终态 */
export function isTerminal(status: string): boolean {
  return TERMINAL.has(normalizeStatus(status));
}
