import { CaseStatus } from './enums';
import {
  assertCanTransition,
  canTransition,
  getAllowedTransitions,
  transitionError,
} from './state-machine';

describe('case-showcase 状态机', () => {
  describe('合法跳转', () => {
    const valid: Array<[CaseStatus, CaseStatus]> = [
      [CaseStatus.Draft, CaseStatus.Submitted],
      [CaseStatus.Draft, CaseStatus.Archived],
      [CaseStatus.Submitted, CaseStatus.Approved],
      [CaseStatus.Submitted, CaseStatus.Draft],
      [CaseStatus.Approved, CaseStatus.Published],
      [CaseStatus.Approved, CaseStatus.Draft],
      [CaseStatus.Published, CaseStatus.Unpublished],
      [CaseStatus.Unpublished, CaseStatus.Published],
      [CaseStatus.Unpublished, CaseStatus.Archived],
    ];

    it.each(valid)('%s → %s 允许', (from, to) => {
      expect(canTransition(from, to)).toBe(true);
      expect(transitionError(from, to)).toBeNull();
      expect(() => assertCanTransition(from, to)).not.toThrow();
    });
  });

  describe('非法跳转（显式禁止）', () => {
    const invalid: Array<[CaseStatus, CaseStatus]> = [
      // Draft→Published、Submitted→Published、Published→Draft、Archived→Published
      [CaseStatus.Draft, CaseStatus.Published],
      [CaseStatus.Submitted, CaseStatus.Published],
      [CaseStatus.Published, CaseStatus.Draft],
      [CaseStatus.Archived, CaseStatus.Published],
      // 其余非法组合
      [CaseStatus.Draft, CaseStatus.Approved],
      [CaseStatus.Draft, CaseStatus.Unpublished],
      [CaseStatus.Submitted, CaseStatus.Unpublished],
      [CaseStatus.Submitted, CaseStatus.Archived],
      [CaseStatus.Approved, CaseStatus.Unpublished],
      [CaseStatus.Approved, CaseStatus.Archived],
      [CaseStatus.Published, CaseStatus.Published],
      [CaseStatus.Published, CaseStatus.Approved],
      [CaseStatus.Published, CaseStatus.Submitted],
      [CaseStatus.Unpublished, CaseStatus.Draft],
      [CaseStatus.Unpublished, CaseStatus.Submitted],
      [CaseStatus.Unpublished, CaseStatus.Approved],
      // Archived 为终态，无任何出边
      [CaseStatus.Archived, CaseStatus.Draft],
      [CaseStatus.Archived, CaseStatus.Submitted],
      [CaseStatus.Archived, CaseStatus.Approved],
      [CaseStatus.Archived, CaseStatus.Unpublished],
      [CaseStatus.Archived, CaseStatus.Archived],
    ];

    it.each(invalid)('%s → %s 禁止', (from, to) => {
      expect(canTransition(from, to)).toBe(false);
      expect(transitionError(from, to)).toContain('非法状态跳转');
      expect(() => assertCanTransition(from, to)).toThrow('非法状态跳转');
    });
  });

  it('Archived 是终态（无出边）', () => {
    expect(getAllowedTransitions()[CaseStatus.Archived]).toEqual([]);
  });

  it('暴露完整合法跳转表供核对', () => {
    const table = getAllowedTransitions();
    expect(table[CaseStatus.Draft]).toEqual([
      CaseStatus.Submitted,
      CaseStatus.Archived,
    ]);
    expect(table[CaseStatus.Published]).toEqual([CaseStatus.Unpublished]);
  });
});
