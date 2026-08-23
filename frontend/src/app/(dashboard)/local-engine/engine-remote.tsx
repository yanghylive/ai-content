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
import { useIsMobile } from "@/lib/hooks/use-media-query";

export function EngineRemote() {
  const router = useRouter();
  const isMobile = useIsMobile();
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

  /* 移动端原生视图（mx-* 明德 VP 风格）——local-engine-v2/remote */
  if (isMobile) {
    return (
      <div className="kx-mobile-ambient">
        <div className="mx-px" style={{ paddingTop: 10, paddingBottom: 28 }}>
          <div className="mx-header">
            <div className="mx-header-row" style={{ alignItems: "center" }}>
              <button type="button" onClick={() => router.push("/local-engine")} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--mx-muted)", background: "none", border: "none", padding: 0, flexShrink: 0 }}>
                <ArrowLeft width={14} height={14} /> 返回设备状态
              </button>
              <div style={{ textAlign: "center", flex: 1 }}>
                <div className="mx-page-title" style={{ fontSize: 18 }}>远程接管</div>
                <div className="mx-page-sub" style={{ marginTop: 1 }}>查看本机桌面实时画面，了解系统正在做什么</div>
              </div>
              <span style={{ flexShrink: 0, width: 44 }} />
            </div>
          </div>

          {/* 状态 + 刷新 */}
          <div className="mx-card" style={{ marginTop: 12, padding: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span className={`mx-badge ${available ? "mx-badge-green" : "mx-badge-red"}`} style={{ fontSize: 10.5 }}>
              {loading ? "连接中…" : available ? "画面可用" : "画面不可用"}
            </span>
            <button type="button" onClick={() => void fetchStatus()} style={{ flexShrink: 0, padding: "7px 13px", borderRadius: 9, background: "rgba(120,148,179,.12)", color: "var(--mx-ink)", border: "1px solid rgba(142,165,190,.3)", fontSize: 11.5, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5 }}>
              <RefreshCcw width={13} height={13} /> 刷新画面
            </button>
          </div>

          {error && (
            <div className="mx-card" style={{ marginTop: 10, padding: 11, borderColor: "rgba(220,80,80,.4)" }}>
              <p style={{ fontSize: 12.5, color: "var(--kaypal-v3-danger)" }}>{error}</p>
            </div>
          )}

          {/* 桌面画面 */}
          <div className="mx-section-head" style={{ marginTop: 14 }}>当前桌面画面</div>
          {loading ? (
            <div style={{ padding: "32px 0", textAlign: "center" }}>
              <div style={{ width: 26, height: 26, margin: "0 auto", borderRadius: "50%", border: "2px solid rgba(222,150,57,.9)", borderTopColor: "transparent", animation: "spin 0.8s linear infinite" }} />
            </div>
          ) : screenshotSrc ? (
            <div className="mx-card" style={{ padding: 8 }}>
              <div style={{ overflow: "hidden", borderRadius: 8 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={screenshotSrc} alt="当前桌面画面" style={{ width: "100%", display: "block" }} />
              </div>
              {screenshot?.capturedAt && (
                <p style={{ fontSize: 10.5, color: "var(--mx-muted)", marginTop: 7 }}>
                  截取于 {new Date(screenshot.capturedAt).toLocaleString("zh-CN")}
                </p>
              )}
            </div>
          ) : (
            <div className="mx-card mx-empty" style={{ padding: 26, textAlign: "center" }}>
              <MonitorPlay width={28} height={28} style={{ color: "var(--mx-muted)", margin: "0 auto" }} />
              <p style={{ fontSize: 12.5, color: "var(--mx-muted)", marginTop: 9 }}>暂时获取不到桌面画面</p>
              <p style={{ fontSize: 11, color: "var(--mx-muted)", marginTop: 4 }}>请确认桌面助手已启动，且已授予屏幕录制权限</p>
            </div>
          )}

          {/* 窗口信息 */}
          {status?.window && (
            <>
              <div className="mx-section-head" style={{ marginTop: 16 }}>窗口信息</div>
              <div className="mx-card" style={{ padding: "4px 13px" }}>
                {Object.entries(status.window as unknown as Record<string, unknown>)
                  .filter(([, v]) => v !== undefined && v !== null && v !== "")
                  .slice(0, 6)
                  .map(([key, value], i) => (
                    <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderTop: i > 0 ? "1px solid rgba(142,165,190,.15)" : "none", gap: 10 }}>
                      <span style={{ fontSize: 11.5, color: "var(--mx-muted)", flexShrink: 0 }}>{key}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--mx-ink)", textAlign: "right", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {String(value)}
                      </span>
                    </div>
                  ))}
              </div>
            </>
          )}

          <button type="button" onClick={() => router.push("/local-engine")} style={{ marginTop: 16, padding: "9px 18px", borderRadius: 10, background: "rgba(120,148,179,.12)", color: "var(--mx-ink)", border: "1px solid rgba(142,165,190,.3)", fontSize: 12, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5 }}>
            <ArrowLeft width={14} height={14} /> 返回
          </button>
        </div>
      </div>
    );
  }

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
              请确认桌面助手已启动，且已授予屏幕录制权限
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
