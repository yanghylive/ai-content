"use client";

import React from "react";
import toast from "@/lib/toast";
import { api } from "@/lib/api/client";

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

/**
 * Octop 高级模式拉起逻辑（全局可用，登录页/任意页面均生效）。
 * 链路：GET /api/octop/launch（会话鉴权）→ {octopBaseUrl, healthy, token}
 * → electronAPI.workspaceTabs.openOctop（桌面壳建标签 + localStorage 自举免登录）。
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
      const res = (await api.get("/octop/launch")) as {
        octopBaseUrl: string;
        healthy: boolean;
        token: string | null;
        isolated?: boolean;
      };
      if (!res.healthy) {
        toast.error("本机 Octop 未运行（127.0.0.1:8088 健康检查失败），请先启动 Octop");
        return;
      }
      if (!res.token) {
        toast.error("Octop 凭据未配置（后端需 OCTOP_USERNAME/PASSWORD 或 OCTOP_ACCESS_TOKEN）");
        return;
      }
      // 审计 #6：isolated=false 说明后端回退到共享 Octop 账号，
      // 多用户部署下浏览器会话/cookie 会跨用户共享（跨租户越权风险），前端需显式提示。
      if (res.isolated === false) {
        toast.error(
          "当前 Octop 使用共享账号（未启用每用户隔离）。多用户部署下浏览器会话将跨用户共享，请为每位用户配置独立 Octop 账号。",
        );
      }
      await tabs.openOctop(res.octopBaseUrl, res.token);
      toast.success("已打开 Octop 高级模式");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "打开 Octop 失败");
    } finally {
      busyRef.current = false;
    }
  }, [tabs]);

  return { launchOctop, hasTabs: !!tabs };
}
