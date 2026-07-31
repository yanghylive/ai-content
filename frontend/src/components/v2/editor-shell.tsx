"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Save, Send, type LucideIcon } from "lucide-react";
import { V2StatusChip } from "@/components/v2/ui-kit";

/**
 * 编辑器统一外壳：给内容/公众号/小红书/视频编辑器套 v2 顶部栏。
 * 编辑器本体（富文本/剪辑器）保持不变，外壳负责：
 * - 干净顶部栏（返回 + 标题 + 状态徽章 + 保存/发布主按钮）
 * - 草稿状态提示（"已自动保存 · 刚刚"）
 * - 渐进式披露（高级选项折叠在编辑器内部，外壳不管）
 */
export function V2EditorShell({
  title,
  subtitle,
  backHref,
  saveState = "idle",
  onSave,
  onPublish,
  publishLabel = "发布",
  children,
}: {
  title: string;
  subtitle?: string;
  backHref: string;
  saveState?: "idle" | "saving" | "saved" | "publishing";
  onSave?: () => void;
  onPublish?: () => void;
  publishLabel?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const handleSave = () => {
    onSave?.();
    setSavedAt(new Date());
  };

  const stateChip =
    saveState === "saving" ? (
      <V2StatusChip tone="accent">保存中...</V2StatusChip>
    ) : saveState === "saved" || savedAt ? (
      <V2StatusChip tone="success">
        已保存{savedAt ? ` · ${savedAt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}` : ""}
      </V2StatusChip>
    ) : saveState === "publishing" ? (
      <V2StatusChip tone="warning">发布中...</V2StatusChip>
    ) : null;

  return (
    <div className="flex h-full flex-col">
      {/* 统一顶部栏 */}
      <div className="kaypal-v3-panel flex items-center justify-between px-5 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)] hover:text-[var(--kaypal-v3-ink)]"
            onClick={() => router.push(backHref)}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-lg font-semibold text-[var(--kaypal-v3-ink)]">
              {title}
            </h1>
            {subtitle && (
              <p className="text-xs text-[var(--kaypal-v3-muted)]">{subtitle}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {stateChip}
          {onSave && (
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3.5 py-2 text-sm font-medium text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)]"
              onClick={handleSave}
              disabled={saveState === "saving" || saveState === "publishing"}
            >
              {saveState === "saving" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              保存
            </button>
          )}
          {onPublish && (
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--kaypal-v3-accent-ink)] disabled:opacity-60"
              onClick={onPublish}
              disabled={saveState === "publishing"}
            >
              {saveState === "publishing" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {publishLabel}
            </button>
          )}
        </div>
      </div>

      {/* 编辑器本体 */}
      <div className="kx-legacy-content mt-4 flex-1">{children}</div>
    </div>
  );
}
