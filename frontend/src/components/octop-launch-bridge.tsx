"use client";

import React from "react";
import { useOctopLaunch } from "@/hooks/use-octop-launch";

/**
 * Octop 拉起桥（全局挂载于根 layout）：
 * 监听桌面 tab 条「＋ Octop 高级模式」转发的 octop:request-launch 事件。
 * 之前监听器只在 Dashboard 的 WorkspaceSwitcher 里注册——用户停留在登录页或
 * 非 Dashboard 页面时点顶部按钮没有前端处理者（2026-08-24 审计 #6）。
 * 此组件渲染 null，只提供全局事件接收能力；WorkspaceSwitcher 的按钮与
 * 本桥共用 useOctopLaunch（内部 busy 防并发双触发）。
 */
export function OctopLaunchBridge() {
  const { launchOctop } = useOctopLaunch();

  React.useEffect(() => {
    const key = window.electronAPI?.on?.("octop:request-launch", () => {
      void launchOctop();
    });
    return () => {
      if (key) window.electronAPI?.removeListener?.(key);
    };
  }, [launchOctop]);

  return null;
}
