"use client";

import { useCountUp } from "@/lib/hooks/use-count-up";

/**
 * 数字 count-up 动画包装组件。
 *
 * - loading 时显示 "-"
 * - number 类型直接 count-up
 * - string 类型先 parseInt，成功则动画数字 + 保留后缀（如 "1.2万"→数字+"万"）
 * - 无法解析的字符串原样显示
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
  const str = String(value);
  const parsed = parseInt(str, 10);
  const hasNum = !isNaN(parsed) && parsed !== 0;
  const suffix = hasNum ? str.replace(/^\d+/, "") : "";
  const target = loading ? 0 : parsed;
  const animated = useCountUp(target, { duration, startDelay });

  if (loading) return <>-</>;
  if (!hasNum) return <>{value}</>;
  return (
    <>
      {animated}
      {suffix}
    </>
  );
}
