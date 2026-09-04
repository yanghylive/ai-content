"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toActionableError } from "@/lib/public-error";
import { SkeletonCard } from "@/components/skeleton";

/**
 * 加载守卫（2026-08-20）：
 * 所有接口 loading 8s 超时 → 显示"加载超时，点击重试"，不再永久转圈。
 * 用法：
 *   const { loading, error, timeout, run } = useLoadingGuard(() => fetchData());
 * 或组件：
 *   <LoadingGuard loading={loading} error={error} timeout={timeout} onRetry={run}>
 */

export const LOADING_TIMEOUT_MS = 8000;

export interface LoadingState {
  loading: boolean;
  /** 业务/网络错误（人类可读） */
  error: string | null;
  /** 是否超时（区别于普通错误） */
  timeout: boolean;
  run: () => Promise<void>;
  reset: () => void;
}

/**
 * 包装异步任务：loading 8s 兜底超时；失败可重试。
 * @param task 异步任务（应自行处理业务数据 setState）
 */
export function useLoadingGuard(task: () => Promise<void>): LoadingState {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeout, setTimeoutFlag] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const taskRef = useRef(task);
  taskRef.current = task;

  const clearTimer = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    setTimeoutFlag(false);
    clearTimer();
    timer.current = setTimeout(() => {
      setTimeoutFlag(true);
      setLoading(false);
    }, LOADING_TIMEOUT_MS);
    try {
      await taskRef.current();
    } catch (e) {
      setError(toActionableError(e, "加载失败，请重试"));
    } finally {
      clearTimer();
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    clearTimer();
    setLoading(false);
    setError(null);
    setTimeoutFlag(false);
  }, []);

  useEffect(() => clearTimer, []);

  return { loading, error, timeout, run, reset };
}

/** 加载守卫 UI：loading 转圈 / 超时重试 / 错误重试 */
export function LoadingGuard({
  loading,
  error,
  timeout,
  onRetry,
  children,
}: {
  loading: boolean;
  error: string | null;
  timeout: boolean;
  onRetry: () => void;
  children: React.ReactNode;
}) {
  if (loading && !timeout) {
    return (
      <div className="kaypal-v3-panel p-6" aria-hidden="true" inert>
        <SkeletonCard height={80} />
        <div style={{ height: 12 }} />
        <SkeletonCard height={120} />
      </div>
    );
  }

  if (timeout) {
    return (
      <div className="kaypal-v3-panel flex flex-col items-center justify-center gap-3 p-12 text-center">
        <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">
          加载超时，请检查网络后重试
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center justify-center h-11 rounded-[var(--kaypal-v3-radius-sm)] bg-[image:var(--kaypal-v3-gradient-primary)] px-4 text-sm font-semibold text-white transition duration-150 ease-out hover:opacity-90 active:scale-[0.97]"
        >
          重试
        </button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="kaypal-v3-panel flex flex-col items-center justify-center gap-3 p-12 text-center">
        <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center justify-center h-11 rounded-[var(--kaypal-v3-radius-sm)] bg-[image:var(--kaypal-v3-gradient-primary)] px-4 text-sm font-semibold text-white transition duration-150 ease-out hover:opacity-90 active:scale-[0.97]"
        >
          重试
        </button>
      </div>
    );
  }

  return (
    <div className="kx-fade-in-up">{children}</div>
  );
}
