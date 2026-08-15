"use client";

import React from "react";
import { usePathname, useRouter } from "next/navigation";
import { ShellIcon } from "./icons";
import { MobileTabBar, type MobileTabItem } from "./mobile-tab-bar";
import "./mobile.css";

/**
 * 移动端底部导航（Mingde VP 玻璃拟态风格）。
 *
 * 5 个 Tab 对齐 PRD 一级导航：
 *   今天 → /today · 内容 → /content · 发布 → /distribution
 *   消息 → /message · 我的 → /mine
 *
 * 通过 URL 路径点亮对应 Tab；发布 Tab 归入 content 场景高亮。
 * 视觉与交互由统一 MobileTabBar 组件承载（P2 架构沉淀）。
 */
const MOBILE_TABS: Array<{ key: string; href: string; label: string; icon: Parameters<typeof ShellIcon>[0]["name"] }> = [
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

  const items: MobileTabItem[] = MOBILE_TABS.map((tab) => ({
    key: tab.key,
    label: tab.label,
    icon: <ShellIcon name={tab.icon} size={19} strokeWidth={1.8} />,
    badge: badgeOf(tab.key),
  }));

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

      {/* 底部固定导航（统一 MobileTabBar；URL 驱动） */}
      <MobileTabBar
        items={items}
        activeKey={active}
        onChange={(key) => {
          const tab = MOBILE_TABS.find((t) => t.key === key);
          if (tab) router.push(tab.href);
        }}
        badgeTitles={BADGE_LABELS}
      />
    </div>
  );
}
