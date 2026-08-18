import { CaseStatus } from './enums';

/**
 * 案例生命周期状态机。
 *
 * 合法链路：Draft → Submitted → Approved → Published → Unpublished → Archived。
 *
 * 合法跳转（含回退）：
 *   - Draft       → Submitted（提交审核）/ Archived（废弃）
 *   - Submitted   → Approved（审核通过）/ Draft（驳回退回）
 *   - Approved    → Published（发布）/ Draft（撤回重改）
 *   - Published   → Unpublished（下线）
 *   - Unpublished → Published（重新上线）/ Archived（归档）
 *   - Archived    → （终态，无出边）
 *
 * 非法跳转（显式禁止）：Draft→Published、Submitted→Published、Published→Draft、
 * Archived→Published 等。
 */

const CASE_STATE_TRANSITIONS: Readonly<
  Record<CaseStatus, readonly CaseStatus[]>
> = {
  [CaseStatus.Draft]: [CaseStatus.Submitted, CaseStatus.Archived],
  [CaseStatus.Submitted]: [CaseStatus.Approved, CaseStatus.Draft],
  [CaseStatus.Approved]: [CaseStatus.Published, CaseStatus.Draft],
  [CaseStatus.Published]: [CaseStatus.Unpublished],
  [CaseStatus.Unpublished]: [CaseStatus.Published, CaseStatus.Archived],
  [CaseStatus.Archived]: [],
};

/** 判断 from → to 是否为合法跳转 */
export function canTransition(from: CaseStatus, to: CaseStatus): boolean {
  return (CASE_STATE_TRANSITIONS[from] ?? []).includes(to);
}

/** 返回 from → to 的可读错误信息；合法时返回 null */
export function transitionError(
  from: CaseStatus,
  to: CaseStatus,
): string | null {
  if (!canTransition(from, to)) {
    return `非法状态跳转：${from} → ${to}（${from} 状态不允许直接转为 ${to}）`;
  }
  return null;
}

/** 断言 from → to 合法，非法则抛出可读错误 */
export function assertCanTransition(from: CaseStatus, to: CaseStatus): void {
  const error = transitionError(from, to);
  if (error) {
    throw new Error(error);
  }
}

/** 暴露全部合法跳转表（供测试与文档核对） */
export function getAllowedTransitions(): Readonly<
  Record<CaseStatus, readonly CaseStatus[]>
> {
  return CASE_STATE_TRANSITIONS;
}
