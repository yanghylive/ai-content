// 定时发布排期器（spec §5a）：基准时间 × 每天条数 + 随机浮动，钳制在当天。
// 思路借鉴 auto-upload files_times.py（Apache-2.0），已按本仓库风格重写为 TS 纯函数。
export type ScheduleTimeInput = string | number | Date;

function parseMinutes(value: ScheduleTimeInput): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 && value <= 1439
      ? Math.floor(value)
      : null;
  }
  if (value instanceof Date) {
    return value.getHours() * 60 + value.getMinutes();
  }
  if (typeof value === 'string') {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return null;
    return hours * 60 + minutes;
  }
  return null;
}

/**
 * 生成当天 N 条发布时间的 Date 列表。
 * - baseTimes：'HH:mm' / 当天第 N 分钟(0-1439) / Date；不足 count 个时按列表循环补足
 * - jitterMinutes：每条时间 ±jitter 分钟随机浮动，钳制在当天 00:00~23:59（不跨天）
 */
export function generateScheduleTimes(
  baseTimes: ScheduleTimeInput[],
  count = 1,
  jitterMinutes = 0,
  from = new Date(),
): Date[] {
  const parsed = (baseTimes || [])
    .map(parseMinutes)
    .filter((value): value is number => value !== null);
  if (parsed.length === 0) {
    return [];
  }
  const safeCount = Math.max(1, Math.floor(count));
  const safeJitter = Math.max(0, Math.floor(jitterMinutes));
  const dayStart = new Date(from);
  dayStart.setHours(0, 0, 0, 0);

  const result: Date[] = [];
  for (let i = 0; i < safeCount; i += 1) {
    const base = parsed[i % parsed.length];
    let minutes = base;
    if (safeJitter > 0) {
      const offset = Math.round((Math.random() * 2 - 1) * safeJitter);
      minutes = Math.min(1439, Math.max(0, base + offset));
    }
    const date = new Date(dayStart.getTime() + minutes * 60_000);
    result.push(date);
  }
  return result;
}
