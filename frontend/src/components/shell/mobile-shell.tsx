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

export function MobileShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() || "";
  const active = activeTabOf(pathname);

  return (
    <div className="kx-mobile-ambient">
      {children}

      {/* 底部固定导航 */}
      <nav className="mx-tabbar" aria-label="移动端主导航">
        <div className="mx-tabbar-inner">
          {MOBILE_TABS.map((tab) => {
            const isActive = tab.key === active;
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
