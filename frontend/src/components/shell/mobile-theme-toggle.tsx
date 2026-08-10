"use client";

/**
 * 移动端主题切换（浅色/深色，2026-08-09）
 *
 * 桌面端在 AppShell 左侧 rail 有切换按钮，移动端（<768px MobileShell）此前没有入口。
 * 本组件：
 *  - 用 next-themes 切换 theme（localStorage key=`theme`，html 加 .dark class）
 *  - 同步 documentElement 的 data-theme 属性（mobile.css 的暗色规则挂在
 *    html[data-theme="dark"] 选择器下，与桌面 shell.css 同一机制）
 *  - 渲染为「我的」页外观设置行（复用 mx-row 列表样式）
 */
import React from "react";
import { useTheme } from "next-themes";
import { ShellIcon } from "./icons";

export function MobileThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  const dark = theme === "dark";

  React.useEffect(() => setMounted(true), []);
  React.useEffect(() => {
    if (!mounted) return;
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "");
  }, [dark, mounted]);

  if (!mounted) return null; // SSR 一致性：主题未知前不渲染，避免闪烁

  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label="切换深色/浅色模式"
      className="mx-row"
      style={{ width: "100%", textAlign: "left", background: "none", border: "none" }}
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      <span
        className="mx-row-ic"
        style={{ background: "rgba(99,102,241,.12)", color: "#6366f1" }}
      >
        <ShellIcon name={dark ? "sun" : "moon"} size={18} />
      </span>
      <div className="mx-row-main">
        <div className="mx-row-title">外观</div>
        <div className="mx-row-desc">{dark ? "深色模式已开启，点按切换浅色" : "浅色模式已开启，点按切换深色"}</div>
      </div>
      <div className="mx-row-right">
        <span
          className="mx-badge"
          style={{
            fontSize: 10,
            padding: "2px 9px",
            borderRadius: 999,
            color: dark ? "#eebd72" : "#a9671f",
            background: dark ? "rgba(238,189,114,.12)" : "rgba(234,161,75,.14)",
            border: dark ? "1px solid rgba(238,189,114,.35)" : "1px solid rgba(222,150,57,.35)",
            fontWeight: 700,
          }}
        >
          {dark ? "🌙 深色" : "☀️ 浅色"}
        </span>
      </div>
    </button>
  );
}
