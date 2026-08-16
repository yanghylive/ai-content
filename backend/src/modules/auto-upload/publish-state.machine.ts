/**
 * 发布状态机白名单（报告 15.4#2「publish-state.machine.ts」）。
 *
 * durable publish 的真实状态（核验自 publish-record.store.ts）：
 *   queued / claimed / waiting / completed / failed / cancelled
 *
 * 与报告理想 6 态的差异（以代码为准）：
 * - claimed 会因租约过期回到 queued（reclaimStaleClaims）；
 * - waiting 会因改期到点回到 queued（reenqueueDueScheduled）；
 * - failed 是终态——「重试」是新建记录，不是 failed → queued/claimed 的转移。
 */
export const PUBLISH_STATES = [
  'queued',
  'claimed',
  'waiting',
  'completed',
  'failed',
  'cancelled',
] as const;

export type PublishState = (typeof PUBLISH_STATES)[number];

/** 合法状态转移白名单（终态为空数组） */
const TRANSITIONS: Record<PublishState, readonly PublishState[]> = {
  queued: ['claimed', 'cancelled'],
  // claimed 可：执行完成 / 失败 / 结果不确定(waiting) / 租约过期回排(queued)
  claimed: ['completed', 'failed', 'waiting', 'queued'],
  // waiting 可：改期到点回排(queued) / 取消
  waiting: ['queued', 'cancelled'],
  failed: [],
  completed: [],
  cancelled: [],
};

/** 校验状态转移合法，非法时抛错（供所有落库点调用） */
export function assertPublishTransition(
  from: PublishState,
  to: PublishState,
): void {
  if (from === to) return; // 幂等：同状态刷新（如改期仍为 waiting）放行
  if (!TRANSITIONS[from].includes(to)) {
    throw new Error(`invalid publish transition: ${from} -> ${to}`);
  }
}

/** 只判断不抛错 */
export function canTransition(from: PublishState, to: PublishState): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

/** 是否为终态（不可再转移） */
export function isTerminalState(state: PublishState): boolean {
  return TRANSITIONS[state].length === 0;
}

/** 是否可取消（真实语义：只有排队中 / 等待中可取消） */
export function isCancellable(state: PublishState): boolean {
  return state === 'queued' || state === 'waiting';
}

/** 是否可重试（真实语义：重试 = 新建记录，源记录为 failed 且不可改） */
export function isRetryable(state: PublishState): boolean {
  return state === 'failed';
}
