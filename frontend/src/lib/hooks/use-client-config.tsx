"use client";

/**
 * 客户端配置（commercial/client-config 快照）全局上下文：
 * 启动时拉取运营下发的功能开关/资源 URL，任何组件可读。
 * 拉取失败时 fail-closed：高风险能力（本地 helper/微信库读取）默认关闭，
 * 不因「请求失败」而全开，避免配置中心故障时危险能力重新暴露。
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
        /* 拉取失败静默：snapshot 保持 null，功能开关走 fail-closed */
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

/** 读单个功能开关（未拉取/未配置时 fail-closed，默认 false=关闭） */
export function useFeatureFlag(name: string): boolean {
  const snap = useClientConfig();
  if (!snap?.features) return false;
  return snap.features[name] !== false;
}
