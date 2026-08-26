"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 数字 count-up 动画：从 0 滚动到目标值。
 * - 尊重 prefers-reduced-motion（直接返回目标值）
 * - 使用 requestAnimationFrame + ease-out
 * - duration 默认 600ms
 */
export function useCountUp(
  target: number,
  options?: { duration?: number; startDelay?: number },
): number {
  const { duration = 600, startDelay = 0 } = options ?? {};
  const [value, setValue] = useState(0);
  const rafRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    // 尊重 reduced-motion
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq.matches || target === 0) {
      setValue(target);
      return;
    }

    const startDelayTimer = window.setTimeout(() => {
      startTimeRef.current = 0;
      const tick = (now: number) => {
        if (!startTimeRef.current) startTimeRef.current = now;
        const elapsed = now - startTimeRef.current;
        const progress = Math.min(elapsed / duration, 1);
        // ease-out cubic
        const eased = 1 - Math.pow(1 - progress, 3);
        setValue(Math.round(target * eased));
        if (progress < 1) {
          rafRef.current = requestAnimationFrame(tick);
        }
      };
      rafRef.current = requestAnimationFrame(tick);
    }, startDelay);

    return () => {
      window.clearTimeout(startDelayTimer);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration, startDelay]);

  return value;
}
