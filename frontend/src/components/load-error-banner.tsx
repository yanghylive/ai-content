"use client";

import { Button } from "@heroui/react";
import { useCallback, useState } from "react";
import { toPublicError } from "@/lib/public-error";

/**
 * 页面级加载失败横幅（2026-09-01 报错透明度审计 P0 修复）。
 *
 * 家规（crm-import-center.tsx:43 先例，升格为全站统一）：
 * 「加载失败不得静默显示空」——页面数据加载失败时必须上屏错误原因 + 重试入口，
 * 不允许 console 一躺、页面显示零状态让用户误以为"没数据"。
 *
 * 文案走 toPublicError（安全兜底，不外泄技术细节）；
 * 组件只管展示，各页面在 catch 里 report、成功路径 clear。
 */

export function LoadErrorBanner({
  message,
  onRetry,
  retryLabel = "重新加载",
  className = "",
}: {
  message: string;
  /** 传入则显示重试按钮，一般传页面的加载函数 */
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={`flex flex-col gap-3 rounded-[8px] border-small border-danger-200 bg-danger-50 p-3 text-small text-danger-700 sm:flex-row sm:items-center sm:justify-between ${className}`}
    >
      <span className="min-w-0 break-words">
        <span className="font-semibold">数据加载失败：</span>
        {message}
      </span>
      {onRetry ? (
        <Button
          className="shrink-0"
          color="danger"
          size="sm"
          variant="flat"
          onPress={onRetry}
        >
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * 页面加载失败状态 hook。
 * 用法：catch 里 `reportLoadError(error, "加载XX失败")`；成功路径 `clearLoadError()`；
 * JSX 里 `{loadError ? <LoadErrorBanner message={loadError} onRetry={load} /> : null}`。
 * console.error 保留（诊断链路不丢），banner 只是把原因上屏。
 */
export function useLoadError() {
  const [loadError, setLoadError] = useState<string | null>(null);

  const reportLoadError = useCallback((error: unknown, fallback: string) => {
    setLoadError(toPublicError(error, fallback));
  }, []);

  const clearLoadError = useCallback(() => {
    setLoadError(null);
  }, []);

  return { loadError, reportLoadError, clearLoadError, setLoadError };
}
