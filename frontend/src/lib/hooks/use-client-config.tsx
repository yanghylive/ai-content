"use client";

/**
 * 客户端配置（commercial/client-config 快照）全局上下文：
 * 启动时拉取运营下发的功能开关/资源 URL，任何组件可读。
 * 拉取失败静默（默认全开），不影响主流程。
 */
import React from "react";
import { clientConfigApi, type ClientConfigSnapshot } from "@/lib/api/client-config";

const ClientConfigContext = React.createContext<ClientConfigSnapshot | null>(null);

export function ClientConfigProvider({ children }: { children: React.ReactNode }) {
  const [snapshot, setSnapshot] = React.useState<ClientConfigSnapshot | null>(null);

  React.useEffect(() => {
    let active = true;
    clientConfigApi
      .snapshot()
      .then((s) => {
        if (active) setSnapshot(s);
      })
      .catch(() => {
        /* 拉取失败静默：功能开关默认可用 */
      });
    return () => {
      active = false;
    };
  }, []);

  return <ClientConfigContext.Provider value={snapshot}>{children}</ClientConfigContext.Provider>;
}

export function useClientConfig(): ClientConfigSnapshot | null {
  return React.useContext(ClientConfigContext);
}

/** 读单个功能开关（未配置/未拉取时默认 true=可用） */
export function useFeatureFlag(name: string): boolean {
  const snap = useClientConfig();
  if (!snap?.features) return true;
  return snap.features[name] !== false;
}
