"use client";

import React from "react";
import "../shell/mobile.css";

/**
 * MobileTabBar · 移动端统一底部导航（P2 架构沉淀）
 *
 * 从 mobile-shell（URL 驱动全局导航）与 savings-shell（state 驱动模块内导航）
 * 中抽取的纯展示组件。导航机制由调用方决定（onChange），本组件只管视觉与交互：
 * 玻璃拟态底栏 + active 高亮 + 可选徽章 + 可选「更多」溢出（>5 项时收进 +N）。
 *
 * 用法：
 *   <MobileTabBar
 *     items={[{ key, label, icon: <ShellIcon name="home" size={19}/> }]}
 *     activeKey="today"
 *     onChange={(key) => router.push(hrefByKey[key])}
 *     badges={{ today: 3 }}
 *   />
 */
export type MobileTabItem = {
  key: string;
  label: string;
  /** 图标节点（调用方自备图标体系，如 ShellIcon / lucide） */
  icon: React.ReactNode;
  /** 徽章数字（>99 显示 99+）；不提供则不显示 */
  badge?: number;
};

export function MobileTabBar({
  items,
  activeKey,
  onChange,
  ariaLabel = "移动端主导航",
  badgeTitles = {},
  maxWidth,
}: {
  items: MobileTabItem[];
  activeKey: string;
  onChange: (key: string) => void;
  ariaLabel?: string;
  /** 徽章 title 提示文案，如 { today: "待办" } */
  badgeTitles?: Record<string, string>;
  /** 内容最大宽度（默认 767px 全宽；模块内场景可收窄对齐内容区） */
  maxWidth?: number;
}) {
  const showMore = items.length > 5;
  const visible = showMore ? items.slice(0, 4) : items;
  const moreCount = showMore ? items.length - 4 : 0;
  const moreActive = showMore && !visible.some((i) => i.key === activeKey);

  return (
    <nav
      className="mx-tabbar"
      aria-label={ariaLabel}
      style={maxWidth ? { maxWidth } : undefined}
    >
      <div className="mx-tabbar-inner">
        {visible.map((tab) => {
          const isActive = tab.key === activeKey;
          const badge = tab.badge ?? 0;
          return (
            <button
              key={tab.key}
              type="button"
              className={`mx-tab${isActive ? " active" : ""}`}
              aria-label={tab.label}
              aria-current={isActive ? "page" : undefined}
              onClick={() => onChange(tab.key)}
            >
              <span className="mx-tab-ic">
                {tab.icon}
                {badge > 0 ? (
                  <span
                    className="mx-mini-badge"
                    title={`${badgeTitles[tab.key] ?? "提醒"} ${badge > 99 ? "99+" : badge}`}
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

        {/* 「更多」溢出（>5 项场景，如模块内多工作台） */}
        {showMore && (
          <button
            type="button"
            className={`mx-tab${moreActive ? " active" : ""}`}
            aria-label="更多"
            onClick={() => onChange("__more__")}
          >
            <span className="mx-tab-ic">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ width: 19, height: 19 }}
              >
                <circle cx="12" cy="5" r="1" />
                <circle cx="12" cy="12" r="1" />
                <circle cx="12" cy="19" r="1" />
              </svg>
              <span className="mx-dot" />
            </span>
            {moreCount > 0 ? `更多 ${moreCount}` : "更多"}
          </button>
        )}
      </div>
    </nav>
  );
}
