"use client";

import { SWRConfig } from "swr";
import { api } from "@/lib/api/client";

/**
 * SWR 全局配置：
 * - fetcher 使用项目统一 ApiClient，自动处理鉴权 / 刷新 / 错误
 * - dedupingInterval 5s：同一 key 的并发请求自动去重
 * - revalidateOnFocus false：避免 focus 时重复请求（dashboard 已有自己的刷新逻辑）
 */
export function SWRProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher: (key: string) => api.get(key),
        dedupingInterval: 5000,
        revalidateOnFocus: false,
        errorRetryCount: 2,
        shouldRetryOnError: (err: unknown) => {
          // 401/403 不重试，避免无效请求堆积
          const status = (err as { status?: number })?.status;
          return status !== 401 && status !== 403;
        },
      }}
    >
      {children}
    </SWRConfig>
  );
}
