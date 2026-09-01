"use client";

/**
 * 设置页内容壳（2026-09-01 WorkBuddy 化改造 P4）
 *
 * 设置导航面板由 app-shell 统一管理（SettingsNavPanel，点 rail「我的」滑出）。
 * 本壳只负责：
 * - 内容区全宽（body.has-settings-drawer 绕过 kx-legacy-wrap 的 880px 限宽）
 * - 隐藏双栏时代遗留的返回按钮
 * - 移动端 <768px 直接透传 children
 */
import { useEffect } from "react";
import { useIsMobile } from "@/lib/hooks/use-media-query";

export function SettingsNavShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const isMobile = useIsMobile();

  // 标记 body：套壳页内容全宽
  useEffect(() => {
    document.body.classList.add("has-settings-drawer");
    return () => document.body.classList.remove("has-settings-drawer");
  }, []);

  if (isMobile) {
    return <>{children}</>;
  }

  return (
    <main className="settings-pane min-w-0 flex-1">
      {children}
      <style>{`
        .settings-pane .v2-back-btn { display: none; }
        body.has-settings-drawer .kx-legacy-wrap { max-width: none !important; }
      `}</style>
    </main>
  );
}
