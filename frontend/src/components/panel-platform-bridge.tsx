"use client";

import React from "react";
import { useRouter } from "next/navigation";

/**
 * 面板平台联动桥（全局挂载于根 layout，渲染 null）：
 * 内置浏览器「快捷打开/地址栏」导航到某平台站点时，主进程广播
 * browser-panel:platform-focus——左侧系统功能跟着切到该平台的评论获客页
 * （点小红书 → 左侧就是小红书获客，"看哪干哪"）。
 * 与 OctopLaunchBridge 同一模式：走 electronAPI.on 通用订阅 + 卸载清理。
 */
const TARGET = "/engagement/comment-acquisition";

export function PanelPlatformBridge() {
  const router = useRouter();

  React.useEffect(() => {
    const key = window.electronAPI?.on?.(
      "browser-panel:platform-focus",
      (...args: unknown[]) => {
        const platform = (args[0] as { platform?: string } | undefined)?.platform;
        if (!platform) return;
        const href = `${TARGET}?platform=${encodeURIComponent(platform)}`;
        if (window.location.pathname !== TARGET) {
          // 换页：query 由目标页挂载时读取（同源跳转，不打断用户会话）
          router.push(href);
        } else {
          // 已停在获客页：只同步 URL（刷新/分享可复原），状态由事件驱动切换
          window.history.replaceState(null, "", href);
        }
        window.dispatchEvent(
          new CustomEvent("kaypal:panel-platform", { detail: { platform } }),
        );
      },
    );
    return () => {
      if (key) window.electronAPI?.removeListener?.(key);
    };
  }, [router]);

  return null;
}
