"use client";

import { useCountUp } from "@/lib/hooks/use-count-up";

/**
 * 数字 count-up 动画包装组件。
 *
 * - loading 时显示 "-"
 * - number 类型直接 count-up（支持负数和小数）
 * - string 类型先解析数字部分，成功则动画数字 + 保留前缀/后缀（如 "-10" / "1.2万"）
 * - 无法解析的字符串原样显示
 * - target 变化时先归零再重新动画（由 useCountUp 处理）
 * - 尊重 prefers-reduced-motion（由 useCountUp 处理）
 */
export function CountUpNumber({
  value,
  loading = false,
  duration = 600,
  startDelay = 100,
}: {
  value: number | string;
  loading?: boolean;
  duration?: number;
  startDelay?: number;
}) {
  // 解析数字部分：支持负号、小数点
  const str = String(value);
  // 匹配开头的数字（含负号和小数），如 "-10" / "1.2" / "1.2万"
  const match = str.match(/^(-?\d+(?:\.\d+)?)/);
  const parsed = match ? parseFloat(match[1]) : NaN;
  const hasNum = !isNaN(parsed);
  // 去掉数字部分，保留剩余文本作为前缀/后缀
  const remainder = hasNum ? str.slice(match![1].length) : "";
  const target = loading ? 0 : parsed;
  const animated = useCountUp(target, { duration, startDelay });

  if (loading) return <>-</>;
  if (!hasNum) return <>{value}</>;
  return (
    <>
      {animated}
      {remainder}
    </>
  );
}
