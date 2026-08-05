"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 弱网草稿保护（PRD 16.x）：编辑内容本地暂存 + 断网提示 + 恢复。
 *
 * - 内容变化后 debounce 写入 localStorage（与云端自动保存互补，
 *   云端保存失败/断网时本地仍有一份）
 * - 监听 online/offline，断网时暴露 offline=true（UI 显示提示横幅）
 * - 页面重新打开时检测到本地暂存草稿，可恢复（restoreDraft）
 *
 * 存储键带版本号，避免未来结构变更后旧数据解析失败。
 */
const STORAGE_KEY = "jiuzhang-ai-offline-draft-v1";
const SAVE_DEBOUNCE_MS = 1200;

export type OfflineDraftPayload = {
  title: string;
  content: string;
  brief: unknown;
  outline: unknown;
  savedAt: number;
};

export function useOfflineDraft(value: {
  title: string;
  content: string;
  brief?: unknown;
  outline?: unknown;
}) {
  const [offline, setOffline] = useState<boolean>(() => {
    if (typeof navigator === "undefined") return false;
    return !navigator.onLine;
  });
  /* 仅在「上个会话留下的本地草稿」时提示恢复（当前会话的持续
     暂存不打扰），避免恢复后立即再次触发横幅 */
  const [pendingRestore, setPendingRestore] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionStart = useRef<number | null>(null);
  const mounted = useRef(false);

  /* 网络状态监听 + 会话起点（effect 内取时间，避免 render 期 impurity） */
  useEffect(() => {
    sessionStart.current ??= Date.now();
    const handleOnline = () => setOffline(false);
    const handleOffline = () => setOffline(true);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  /* 内容变化 → debounce 写入本地（弱网兜底，与云端自动保存互补） */
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try {
        const payload: OfflineDraftPayload = {
          title: value.title,
          content: value.content,
          brief: value.brief ?? null,
          outline: value.outline ?? null,
          savedAt: Date.now(),
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        setLastSavedAt(Date.now());
      } catch {
        /* 存储不可用（隐私模式/配额满）时静默降级 */
      }
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value.title, value.content, value.brief, value.outline]);

  /* 打开页面时：只认「上个会话留下的草稿」为待恢复 */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as OfflineDraftPayload;
      if (draft.savedAt && sessionStart.current && draft.savedAt < sessionStart.current - 3000) {
        setPendingRestore(true);
      }
    } catch {
      /* noop */
    }
  }, []);

  const restoreDraft = useCallback((): OfflineDraftPayload | null => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as OfflineDraftPayload;
    } catch {
      return null;
    }
  }, []);

  const clearDraft = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      setPendingRestore(false);
      setLastSavedAt(null);
    } catch {
      /* noop */
    }
  }, []);

  return { offline, pendingRestore, lastSavedAt, restoreDraft, clearDraft };
}
