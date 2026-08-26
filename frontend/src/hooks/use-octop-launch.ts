"use client";

import React from "react";
import toast from "@/lib/toast";
import { toActionableError } from "@/lib/public-error";

type WorkspaceTabsApi = NonNullable<Window["electronAPI"]>["workspaceTabs"];

function useElectronWorkspaceTabs(): WorkspaceTabsApi | null {
  const [tabs, setTabs] = React.useState<WorkspaceTabsApi | null>(null);
  React.useEffect(() => {
    setTabs(
      typeof window !== "undefined" && window.electronAPI?.workspaceTabs
        ? window.electronAPI.workspaceTabs
        : null,
    );
  }, []);
  return tabs;
}

/** Octop 本机默认 base URL（与后端 OCTOP_BASE_URL 默认值一致，loopback 固定 8088） */
const OCTOP_BASE_URL = "http://127.0.0.1:8088";

/**
 * Octop 高级模式拉起逻辑（全局可用，登录页/任意页面均生效）。
 *
 * 审计 #7：token 主进程侧交换——前端只发「打开」信号（url），**不再接触 Octop Bearer 令牌**。
 * 主进程（workspace-tabs.js）从 business 标签读登录 session cookie → 直接向后端换 token 注入。
 * 健康检查 / 免登录自举 / isolated 告警等全部收敛到主进程 + 后端，前端不持有任何 Octop 凭证。
 */
export function useOctopLaunch() {
  const tabs = useElectronWorkspaceTabs();
  const busyRef = React.useRef(false);

  const launchOctop = React.useCallback(async () => {
    if (!tabs) {
      toast.error("仅桌面端支持 Octop 高级模式");
      return;
    }
    if (busyRef.current) return; // 防按钮+事件并发双触发
    busyRef.current = true;
    try {
      const opened = await tabs.openOctop(OCTOP_BASE_URL);
      if (opened) toast.success("已打开 Octop 高级模式");
      else toast.error("打开 Octop 失败");
    } catch (err) {
      toast.error(toActionableError(err, "打开 Octop 失败"));
    } finally {
      busyRef.current = false;
    }
  }, [tabs]);

  return { launchOctop, hasTabs: !!tabs };
}
