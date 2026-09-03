"use client";

import React from "react";
import { usePathname, useRouter } from "next/navigation";
import { ShellIcon } from "./icons";
import { BrandIcon, type BrandIconName } from "./brand-icons";
import { MobileTabBar, type MobileTabItem } from "./mobile-tab-bar";
import "./mobile.css";

/**
 * 移动端底部导航（Mingde VP 玻璃拟态风格）。
 *
 * 5 个 Tab（Q5 拍板）：today / content / interaction / leads / customer。
 *   today → /today · content → /content · interaction → /message
 *   leads → /growth/leads（承载获客+线索，/growth* 归此）· customer → /crm（/crm*、/customer* 归此）
 * publish 下沉内容运营（发布中心在 content 页内可访问）。
 * 「我的」移入右上角头像入口（不占底部 Tab）。
 * 视觉与交互由统一 MobileTabBar 组件承载（P2 架构沉淀）。
 */
const MOBILE_TABS: Array<{ key: string; href: string; label: string; icon: Parameters<typeof ShellIcon>[0]["name"]; brand?: BrandIconName }> = [
  { key: "today", href: "/today", label: "今天", icon: "home" as const, brand: "home" as const },
  { key: "content", href: "/content", label: "内容", icon: "fileText" as const, brand: "generate" as const },
  { key: "interaction", href: "/message", label: "互动", icon: "message" as const, brand: "channels" as const },
  { key: "leads", href: "/growth/leads", label: "线索", icon: "target" as const, brand: "leads" as const },
  { key: "customer", href: "/crm", label: "客户", icon: "users" as const, brand: "customer" as const },
];

function activeTabOf(pathname: string): string {
  if (pathname === "/" || pathname.startsWith("/today")) return "today";
  if (
    pathname.startsWith("/content") ||
    pathname.startsWith("/materials") ||
    pathname.startsWith("/topics") ||
    pathname.startsWith("/distribution") ||
    pathname.startsWith("/schedules") ||
    pathname.startsWith("/compliance") ||
    pathname.startsWith("/styles") ||
    pathname.startsWith("/viral-analysis") ||
    pathname.startsWith("/knowledge-base")
  )
    return "content";
  // 互动（消息/互动/确认）
  if (
    pathname.startsWith("/message") ||
    pathname.startsWith("/engagement")
  )
    return "interaction";
  // 线索（获客中心，含 /growth*）
  if (
    pathname.startsWith("/growth") ||
    pathname.startsWith("/intelligence") ||
    pathname.startsWith("/engagement/comment-acquisition") ||
    pathname.startsWith("/effects")
  )
    return "leads";
  // 客户（CRM/客户）
  if (
    pathname.startsWith("/crm") ||
    pathname.startsWith("/customer") ||
    pathname.startsWith("/crm-closer") ||
    pathname.startsWith("/wecom-crm") ||
    pathname.startsWith("/boss-recruit")
  )
    return "customer";
  if (pathname.startsWith("/mine") || pathname.startsWith("/settings")) return "mine";
  return "today";
}

/**
 * 各 Tab 徽章的语义文案（用于 title 提示，说明数字含义）。
 */
const BADGE_LABELS: Record<string, string> = {
  today: "待办",
  content: "草稿",
  interaction: "未读",
  leads: "线索",
  customer: "客户",
};

export function MobileShell({
  children,
  badges,
  onOpenPalette,
}: {
  children: React.ReactNode;
  badges?: { today?: number; interaction?: number };
  /** 移动端命令面板入口（替代桌面 ⌘K） */
  onOpenPalette?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname() || "";
  const active = activeTabOf(pathname);

  const badgeOf = (key: string) => {
    if (!badges) return 0;
    if (key === "today") return badges.today ?? 0;
    if (key === "interaction") return badges.interaction ?? 0;
    return 0;
  };

  const items: MobileTabItem[] = MOBILE_TABS.map((tab) => ({
    key: tab.key,
    label: tab.label,
    icon: tab.brand ? (
      <BrandIcon name={tab.brand} size={19} tone="tint" />
    ) : (
      <ShellIcon name={tab.icon} size={19} strokeWidth={1.8} />
    ),
    badge: badgeOf(tab.key),
  }));

  return (
    <div className="kx-mobile-ambient">
      {children}

      {/* 「我的」右上角入口（不占底部 Tab） */}
      <button
        type="button"
        className="mx-mine-fab"
        aria-label="我的"
        title="我的"
        onClick={() => router.push("/mine")}
        style={{
          position: "fixed",
          top: 14,
          right: 16,
          zIndex: 55,
          width: 40,
          height: 40,
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: "1px solid rgba(142,165,190,.22)",
          background: "rgba(255,255,255,.72)",
          backdropFilter: "blur(8px)",
          cursor: "pointer",
          color: "var(--kaypal-v3-ink)",
        }}
      >
        <ShellIcon name="user" size={19} strokeWidth={1.8} />
      </button>

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
