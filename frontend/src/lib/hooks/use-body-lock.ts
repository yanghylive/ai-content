"use client";

/**
 * 移动端滚动穿透治理（批次 C #16）：
 * 弹层（bottom sheet / 全屏浮层）打开时锁住 body 滚动，关闭时恢复。
 * 用法：const lock = useBodyLock(); <弹层 open 时> lock(true)
 * 实现：body.style.overflow 切 hidden，同时记录原值以便恢复（多弹层嵌套安全）。
 */
import React from "react";

export function useBodyLock(): (locked: boolean) => void {
  const prevRef = React.useRef<string | null>(null);

  return React.useCallback((locked: boolean) => {
    try {
      if (locked) {
        if (prevRef.current === null) {
          prevRef.current = document.body.style.overflow;
        }
        document.body.style.overflow = "hidden";
      } else {
        if (prevRef.current !== null) {
          document.body.style.overflow = prevRef.current;
          prevRef.current = null;
        }
      }
    } catch {
      /* SSR/异常忽略 */
    }
  }, []);
}
