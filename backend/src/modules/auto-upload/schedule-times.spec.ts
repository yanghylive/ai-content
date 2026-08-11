import { generateScheduleTimes } from './schedule-times';

describe('generateScheduleTimes', () => {
  it('generates times from HH:mm base', () => {
    const from = new Date('2026-08-11T10:00:00');
    const times = generateScheduleTimes(['10:30', '20:00'], 2, 0, from);
    expect(times).toHaveLength(2);
    expect(times[0].getHours()).toBe(10);
    expect(times[0].getMinutes()).toBe(30);
    expect(times[1].getHours()).toBe(20);
    expect(times[1].getMinutes()).toBe(0);
  });

  it('keeps every result on the same day (no cross-day)', () => {
    const from = new Date('2026-08-11T23:00:00');
    const times = generateScheduleTimes(['23:30', '00:30'], 2, 0, from);
    for (const time of times) {
      expect(time.getDate()).toBe(11);
      expect(time.getMonth()).toBe(7); // 8 月
    }
  });

  it('applies jitter within ±jitter and clamps to day bounds', () => {
    const from = new Date('2026-08-11T00:00:00');
    const times = generateScheduleTimes(['00:00', '23:59'], 20, 5, from);
    expect(times).toHaveLength(20);
    for (const time of times) {
      expect(time.getDate()).toBe(11); // 不跨天
      const total = time.getHours() * 60 + time.getMinutes();
      // 00:00±5 → [0,5]；23:59±5 → [1434,1439]
      expect(total).toBeGreaterThanOrEqual(0);
      expect(total).toBeLessThanOrEqual(1439);
    }
  });

  it('cycles base times when count exceeds list length', () => {
    const from = new Date('2026-08-11T10:00:00');
    const times = generateScheduleTimes(['10:00', '18:00'], 5, 0, from);
    expect(times).toHaveLength(5);
    expect(times[2].getHours()).toBe(10); // 循环补足
    expect(times[3].getHours()).toBe(18);
    expect(times[4].getHours()).toBe(10);
  });

  it('returns empty for invalid base times', () => {
    expect(generateScheduleTimes([], 3)).toEqual([]);
    expect(generateScheduleTimes(['abc', '25:00'], 2)).toEqual([]);
  });

  it('accepts numeric minutes-of-day', () => {
    const from = new Date('2026-08-11T00:00:00');
    const times = generateScheduleTimes([600], 1, 0, from);
    expect(times[0].getHours()).toBe(10);
    expect(times[0].getMinutes()).toBe(0);
  });
});
