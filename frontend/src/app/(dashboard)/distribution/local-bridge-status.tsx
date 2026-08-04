"use client";

import { StatusDot } from "@astryxdesign/core/StatusDot";
import { RefreshCw } from "lucide-react";
import { useLocalBridge } from "@/lib/local-bridge/use-local-bridge";

const STATUS_COPY = {
  checking: {
    label: "检查中",
    detail: "正在检查本机发布服务",
    variant: "accent" as const,
  },
  online: {
    label: "在线",
    detail: "本机发布服务已连接",
    variant: "success" as const,
  },
  offline: {
    label: "离线",
    detail: "请启动桌面应用后重试",
    variant: "neutral" as const,
  },
};

export function LocalBridgeStatus() {
  const { status, version, platformCount, refresh } = useLocalBridge();
  const copy = STATUS_COPY[status];

  return (
    <section
      aria-label="本机发布服务状态"
      aria-live="polite"
      className="kaypal-v3-surface flex flex-wrap items-center justify-between gap-3 px-4 py-3"
    >
      <div className="flex min-w-0 items-center gap-3">
        <StatusDot
          variant={copy.variant}
          label={`本机发布服务${copy.label}`}
          isPulsing={status === "checking"}
        />
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--kaypal-v3-ink)]">
            本机发布服务 · {copy.label}
          </p>
          <p className="text-xs text-[var(--kaypal-v3-muted)]">
            {copy.detail}
            {status === "online" && version ? ` · v${version}` : ""}
            {status === "online" && platformCount != null ? ` · ${platformCount} 个平台可用` : ""}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => void refresh()}
        disabled={status === "checking"}
        aria-label="重新检查本机发布服务"
        className="inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] px-3 py-2 text-sm font-medium text-[var(--kaypal-v3-soft-ink)] transition hover:bg-[var(--kaypal-v3-paper-muted)] disabled:cursor-wait disabled:opacity-60"
      >
        <RefreshCw
          aria-hidden="true"
          className={`h-4 w-4 ${status === "checking" ? "animate-spin" : ""}`}
        />
        重新检查
      </button>
    </section>
  );
}
