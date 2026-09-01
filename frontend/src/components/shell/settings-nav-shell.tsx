"use client";

/**
 * 设置页内容壳（2026-09-01 WorkBuddy 化改造 P4）
 *
 * 设置导航面板由 app-shell 统一管理（SettingsNavPanel，点 rail「我的」滑出）。
 * 本壳只负责隐藏双栏时代遗留的返回按钮；内容区布局/边距保持系统默认，
 * 不做任何全宽或限宽覆盖。
 * - 移动端 <768px 直接透传 children
 */
import { useIsMobile } from "@/lib/hooks/use-media-query";

export function SettingsNavShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return <>{children}</>;
  }

  return (
    <main className="settings-pane min-w-0 flex-1">
      {children}
      <style>{`
        .settings-pane .v2-back-btn { display: none; }
      `}</style>
    </main>
  );
}
