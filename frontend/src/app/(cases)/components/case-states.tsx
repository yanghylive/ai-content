"use client";

import { AlertTriangle, Inbox, RotateCcw, SearchX } from "lucide-react";
import { CaseCardSkeleton } from "./case-card";

/**
 * 列表状态组件：骨架屏 / 空数据 / 无结果 / 错误重试。
 * 骨架屏固定占位，防加载前后布局跳动。
 */

export function CaseGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <CaseCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function EmptyState({
  title = "暂无案例",
  description = "案例中心正在筹备内容，敬请期待。",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="kaypal-v3-panel flex flex-col items-center justify-center gap-3 p-12 text-center">
      <span
        className="kaypal-v3-icon-tile"
        style={{ height: 48, width: 48 }}
      >
        <Inbox className="h-6 w-6" aria-hidden />
      </span>
      <p className="text-base font-semibold text-[var(--kaypal-v3-ink)]">
        {title}
      </p>
      <p className="text-sm text-[var(--kaypal-v3-muted)]">{description}</p>
    </div>
  );
}

export function NoResults({ onClear }: { onClear?: () => void }) {
  return (
    <div className="kaypal-v3-panel flex flex-col items-center justify-center gap-3 p-12 text-center">
      <span
        className="kaypal-v3-icon-tile"
        style={{ height: 48, width: 48 }}
      >
        <SearchX className="h-6 w-6" aria-hidden />
      </span>
      <p className="text-base font-semibold text-[var(--kaypal-v3-ink)]">
        没有找到匹配的案例
      </p>
      <p className="text-sm text-[var(--kaypal-v3-muted)]">
        试试调整关键词或清除筛选条件。
      </p>
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="mt-1 inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--kaypal-v3-accent-ink)]"
        >
          <RotateCcw className="h-4 w-4" aria-hidden />
          清除筛选
        </button>
      )}
    </div>
  );
}

export function ErrorState({
  message = "加载失败，请稍后重试。",
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="kaypal-v3-panel flex flex-col items-center justify-center gap-3 p-12 text-center">
      <span
        className="kaypal-v3-icon-tile"
        style={{
          background: "var(--kaypal-v3-danger-soft)",
          color: "var(--kaypal-v3-danger)",
          height: 48,
          width: 48,
        }}
      >
        <AlertTriangle className="h-6 w-6" aria-hidden />
      </span>
      <p className="text-base font-semibold text-[var(--kaypal-v3-ink)]">
        出错了
      </p>
      <p className="text-sm text-[var(--kaypal-v3-muted)]">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--kaypal-v3-accent-ink)]"
        >
          <RotateCcw className="h-4 w-4" aria-hidden />
          重试
        </button>
      )}
    </div>
  );
}
