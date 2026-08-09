"use client";

import React from "react";
import { usePathname, useRouter } from "next/navigation";
import { ShellIcon } from "./icons";
import "./mobile.css";

/**
 * 移动端底部导航（Mingde VP 玻璃拟态风格）。
 *
 * 5 个 Tab 对齐 PRD 一级导航：
 *   今天 → /today · 内容 → /content · 发布 → /distribution
 *   消息 → /message · 我的 → /mine
 *
 * 通过 URL 路径点亮对应 Tab；发布 Tab 归入 content 场景高亮。
 */
const MOBILE_TABS = [
  { key: "today", href: "/today", label: "今天", icon: "home" as const },
  { key: "content", href: "/content", label: "内容", icon: "fileText" as const },
  { key: "publish", href: "/distribution", label: "发布", icon: "send" as const },
  { key: "message", href: "/message", label: "消息", icon: "message" as const },
  { key: "mine", href: "/mine", label: "我的", icon: "user" as const },
];

function activeTabOf(pathname: string): string {
  if (pathname === "/" || pathname.startsWith("/today")) return "today";
  if (
    pathname.startsWith("/content") ||
    pathname.startsWith("/materials") ||
    pathname.startsWith("/articles") ||
    pathname.startsWith("/distribution") ||
    pathname.startsWith("/compliance")
  )
    return "content";
  if (
    pathname.startsWith("/message") ||
    pathname.startsWith("/engagement") ||
    pathname.startsWith("/tasks") ||
    pathname.startsWith("/confirmations")
  )
    return "message";
  if (pathname.startsWith("/mine") || pathname.startsWith("/settings")) return "mine";
  return "today";
}

/**
 * 各 Tab 徽章的语义文案（用于 title 提示，说明数字含义）。
 */
const BADGE_LABELS: Record<string, string> = {
  today: "待办",
  content: "草稿",
  publish: "待发",
  message: "未读",
};

export function MobileShell({
  children,
  badges,
  onOpenPalette,
}: {
  children: React.ReactNode;
  badges?: { today?: number; publish?: number; message?: number };
  /** 移动端命令面板入口（替代桌面 ⌘K） */
  onOpenPalette?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname() || "";
  const active = activeTabOf(pathname);

  const badgeOf = (key: string) => {
    if (!badges) return 0;
    if (key === "today") return badges.today ?? 0;
    if (key === "publish") return badges.publish ?? 0;
    if (key === "message") return badges.message ?? 0;
    return 0;
  };

  return (
    <div className="kx-mobile-ambient">
      {children}

      {/* 移动端命令面板入口（FAB，替代桌面 ⌘K；触摸设备无键盘） */}
      {onOpenPalette && (
        <button
          type="button"
          className="mx-palette-fab"
          aria-label="快捷命令"
          title="快捷命令"
          onClick={onOpenPalette}
        >
          <ShellIcon name="search" size={20} strokeWidth={2} />
        </button>
      )}

      {/* 底部固定导航 */}
      <nav className="mx-tabbar" aria-label="移动端主导航">
        <div className="mx-tabbar-inner">
          {MOBILE_TABS.map((tab) => {
            const isActive = tab.key === active;
            const badge = badgeOf(tab.key);
            return (
              <button
                key={tab.key}
                type="button"
                className={`mx-tab${isActive ? " active" : ""}`}
                aria-label={tab.label}
                aria-current={isActive ? "page" : undefined}
                onClick={() => router.push(tab.href)}
              >
                <span className="mx-tab-ic">
                  <ShellIcon name={tab.icon} size={19} strokeWidth={1.8} />
                  {badge > 0 ? (
                    <span
                      className="mx-mini-badge"
                      title={`${BADGE_LABELS[tab.key] ?? "提醒"} ${badge > 99 ? "99+" : badge}`}
                    >
                      {badge > 99 ? "99+" : badge}
                    </span>
                  ) : null}
                  <span className="mx-dot" />
                </span>
                {tab.label}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
