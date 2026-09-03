"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, FlaskConical, X } from "@/components/iconpark";

/**
 * 灰度测试遮罩（2026-08-20 大王指令）：
 * 不藏整页——页面内容保留可见（可预览），背景模糊，上层铺"灰度测试/暂未开放"说明浮层。
 * 用户可滚动只读预览，但所有点击/输入/焦点被拦截，操作不可达。
 * 样式跟随 kaypal-v3 主题 token，暗/亮色自适应；移动端浮层降级为底部吸附卡片（Bottom Sheet）。
 */
export function GrayTestOverlay({
  feature,
  status = "gray",
  children,
}: {
  /** 功能名，如「BOSS 直聘」「朋友圈发布」 */
  feature: string;
  /** gray=灰度测试中 / pending=暂未开放 */
  status?: "gray" | "pending";
  /** 页面原有内容（保留可见） */
  children: React.ReactNode;
}) {
  const router = useRouter();
  const dismissKey = useMemo(() => `kaypal_gray_overlay_dismissed:${feature}`, [feature]);
  const [dismissed, setDismissed] = useState(false);
  const announced = useRef(false);

  // 「知道了」：本次会话内不再弹（刷新恢复）
  useEffect(() => {
    try {
      if (sessionStorage.getItem(dismissKey) === "1") setDismissed(true);
    } catch {
      // 隐私模式等场景忽略
    }
  }, [dismissKey]);

  // Esc 返回上一页
  useEffect(() => {
    if (dismissed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismissed, router]);

  // 读屏播报：进入即提示灰度状态
  useEffect(() => {
    if (dismissed || announced.current) return;
    announced.current = true;
    const el = document.getElementById(`gray-overlay-announce-${feature}`);
    if (el) el.textContent = `页面处于灰度测试中，仅可预览`;
  }, [dismissed, feature]);

  const statusText = status === "gray" ? "灰度测试中，暂未开放使用" : "暂未开放";
  const statusTag = status === "gray" ? "灰度测试中" : "暂未开放";

  const dismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(dismissKey, "1");
    } catch {
      // ignore
    }
  };

  return (
    <div className="relative min-h-dvh">
      <div
        id={`gray-overlay-announce-${feature}`}
        role="status"
        aria-live="polite"
        className="sr-only"
      />
      {/* 页面原有内容：保留可见 */}
      {children}

      {!dismissed && (
        <div
          className="fixed inset-0 z-[100] overflow-y-auto bg-[var(--kaypal-v3-overlay, rgba(15,13,22,0.45))] backdrop-blur-[10px]"
          aria-modal="true"
          role="dialog"
          aria-label={`${feature}${statusTag}`}
        >
          {/* 移动端底部吸附卡片 / 桌面居中卡片 */}
          <div className="flex min-h-full items-end justify-center p-4 sm:items-center">
            <div className="kaypal-v3-panel w-full max-w-md p-6 text-center shadow-2xl">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-[var(--kaypal-v3-radius-md)] bg-[var(--kaypal-v3-amber)] text-white">
                <FlaskConical className="h-6 w-6" />
              </div>
              <h2 className="mt-4 text-lg font-bold text-[var(--kaypal-v3-ink)]">
                {feature}
              </h2>
              <p className="mt-1 text-sm font-semibold text-[var(--kaypal-v3-amber)]">
                {statusText}
              </p>
              <p className="mt-3 text-sm leading-relaxed text-[var(--kaypal-v3-muted)]">
                该功能正在内部灰度验证，正式开放前暂不可用。页面内容仅供预览，
                操作暂不开放。如有疑问请联系运营。
              </p>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
                <button
                  type="button"
                  onClick={() => router.back()}
                  className="inline-flex items-center justify-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] bg-[image:var(--kaypal-v3-gradient-primary)] px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
                >
                  <ArrowLeft className="h-4 w-4" />
                  返回
                </button>
                <button
                  type="button"
                  onClick={dismiss}
                  className="inline-flex items-center justify-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border, var(--kaypal-v3-muted))] px-5 py-2.5 text-sm font-medium text-[var(--kaypal-v3-muted)] transition hover:text-[var(--kaypal-v3-ink)]"
                >
                  <X className="h-4 w-4" />
                  知道了
                </button>
              </div>
              <p className="mt-4 text-xs text-[var(--kaypal-v3-muted)]">
                提示：按 Esc 可返回上一页
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
