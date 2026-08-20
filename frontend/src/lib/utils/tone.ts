/**
 * 数值色块语义工具（2026-08-20）：
 * 统一"颜色 = 语义"规则：0 值中性灰、告警红、等级用统一色阶。
 * 替代"今日 0/0/0 用黄绿绿、高意向 4 用橙"这类误导性配色。
 *
 * 用法：toneOf(value, opts) → 'neutral' | 'danger' | 'warn' | 'good' | 'accent'
 */

export type ToneName = "neutral" | "danger" | "warn" | "good" | "accent";

export interface ToneOptions {
  /** 0 值语义：默认中性（非告警）。若 0 本身是异常（如应>0 却为 0）可传 'warn' | 'danger' */
  zero?: ToneName;
  /** 该指标是否有"数值越大越危险"语义（如失败率），默认越大越好 */
  higherIsWorse?: boolean;
}

/**
 * 默认语义：
 * - 0 / null / undefined → neutral（中性灰，不吓人也不邀功）
 * - >0 → good（正常态，绿）
 * - 异常阈值由调用方显式传，工具不做魔法
 */
export function toneOf(
  value: number | null | undefined,
  opts: ToneOptions = {},
): ToneName {
  if (value === null || value === undefined || value === 0) {
    return opts.zero ?? "neutral";
  }
  if (opts.higherIsWorse) {
    return value > 0 ? "danger" : "neutral";
  }
  return "good";
}

/** 等级色阶（0-100 分）：<40 低意向、40-69 中、70+ 高意向 → 统一色阶 */
export function scoreTone(score: number): ToneName {
  if (score >= 70) return "good";
  if (score >= 40) return "warn";
  return "neutral";
}

/** 告警：有异常数 > 0 → danger；否则 neutral */
export function alertTone(abnormalCount: number): ToneName {
  return abnormalCount > 0 ? "danger" : "neutral";
}
