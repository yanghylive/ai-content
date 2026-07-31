"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, MonitorPlay, RefreshCcw } from "lucide-react";
import {
  V2Section,
  V2StatusChip,
  V2GhostButton,
} from "@/components/v2/ui-kit";
import { localEngineApi, type LocalEngineDesktopStatus } from "@/lib/api/local-engine";
import { toPublicError } from "@/lib/public-error";

export function EngineRemote() {
  const router = useRouter();
  const [status, setStatus] = useState<LocalEngineDesktopStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      setLoading(true);
      const data = await localEngineApi.desktopStatus();
      setStatus(data);
    } catch (err: unknown) {
      setError(toPublicError(err, "加载远程状态失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const available = Boolean(status?.available);
  const screenshot = status?.screenshot as
    | { dataUrl?: string; url?: string; capturedAt?: string }
    | undefined;
  const screenshotSrc = screenshot?.dataUrl || screenshot?.url;

  return (
    <div className="flex flex-col gap-6">
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)] hover:text-[var(--kaypal-v3-ink)]"
            onClick={() => router.push("/local-engine")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">
              远程接管
            </h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              查看本机桌面实时画面，了解系统正在做什么
            </p>
          </div>
          <V2StatusChip tone={available ? "success" : "danger"}>
            {loading ? "连接中" : available ? "画面可用" : "画面不可用"}
          </V2StatusChip>
        </div>
      </section>

      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      <V2Section title="当前桌面画面">
        {loading ? (
          <div className="p-12 text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-[var(--kaypal-v3-accent)] border-t-transparent" />
          </div>
        ) : screenshotSrc ? (
          <div>
            <div className="overflow-hidden rounded-[var(--kaypal-v3-radius)] border border-[var(--kaypal-v3-border)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={screenshotSrc} alt="当前桌面画面" className="w-full" />
            </div>
            {screenshot?.capturedAt && (
              <p className="mt-2 text-xs text-[var(--kaypal-v3-muted)]">
                截取于 {new Date(screenshot.capturedAt).toLocaleString("zh-CN")}
              </p>
            )}
          </div>
        ) : (
          <div className="py-8 text-center">
            <MonitorPlay className="mx-auto h-12 w-12 text-[var(--kaypal-v3-muted)]" />
            <p className="mt-4 text-sm text-[var(--kaypal-v3-muted)]">
              暂时获取不到桌面画面
            </p>
            <p className="mt-1 text-xs text-[var(--kaypal-v3-muted)]">
              请确认本地引擎助手已启动，且已授予屏幕录制权限
            </p>
          </div>
        )}
      </V2Section>

      {status?.window && (
        <V2Section title="窗口信息" padding={false}>
          <div className="divide-y divide-[var(--kaypal-v3-border)]">
            {Object.entries(status.window as unknown as Record<string, unknown>)
              .filter(([, v]) => v !== undefined && v !== null && v !== "")
              .slice(0, 6)
              .map(([key, value]) => (
                <div key={key} className="flex items-center justify-between p-4">
                  <span className="text-sm text-[var(--kaypal-v3-muted)]">{key}</span>
                  <span className="text-sm font-medium text-[var(--kaypal-v3-ink)]">
                    {String(value)}
                  </span>
                </div>
              ))}
          </div>
        </V2Section>
      )}

      <section className="flex items-center justify-between">
        <V2GhostButton icon={ArrowLeft} onClick={() => router.push("/local-engine")}>
          返回
        </V2GhostButton>
        <V2GhostButton icon={RefreshCcw} onClick={() => void fetchStatus()}>
          刷新画面
        </V2GhostButton>
      </section>
    </div>
  );
}
