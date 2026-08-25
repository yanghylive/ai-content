"use client";

import { useCallback, useRef } from "react";

/**
 * P0 规范层 · 滚动位置保持（对应 PRD 验收 check 4）
 *
 * 在筛选、分页、Load More、展开详情等异步操作前 save() 记录 scrollTop，
 * 操作完成导致列表重渲染后 restore() 恢复，避免列表跳回顶部、丢失浏览位置。
 * 与现有 use-body-lock 配合：body-lock 管「弹层打开时锁 body」，本 hook 管「列表自身滚动位置」。
 *
 * 用法：
 *   const { ref, save, restore } = useScrollRestoration();
 *   return <div ref={ref}>{list}</div>;
 *   const onChange = async () => { save(); await load(); restore(); };
 */
export function useScrollRestoration<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);
  const saved = useRef(0);

  const save = useCallback(() => {
    if (ref.current) saved.current = ref.current.scrollTop;
  }, []);

  const restore = useCallback(() => {
    // 等 DOM 提交后再恢复，确保重渲染已完成
    requestAnimationFrame(() => {
      if (ref.current) ref.current.scrollTop = saved.current;
    });
  }, []);

  return { ref, save, restore };
}
