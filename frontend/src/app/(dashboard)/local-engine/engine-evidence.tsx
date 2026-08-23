"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Image as ImageIcon, RefreshCcw, XCircle } from "lucide-react";
import {
  V2Section,
  V2StatusChip,
  V2GhostButton,
  V2EmptyState,
} from "@/components/v2/ui-kit";
import { localEngineApi, type LocalEngineDesktopStatus } from "@/lib/api/local-engine";
import { toPublicError } from "@/lib/public-error";
import { useIsMobile } from "@/lib/hooks/use-media-query";

type ViewingItem = {
  src?: string;
  label: string;
  path?: string;
  capturedAt?: string;
} | null;

export function EngineEvidence() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [status, setStatus] = useState<LocalEngineDesktopStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState<ViewingItem>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      setLoading(true);
      const data = await localEngineApi.desktopStatus();
      setStatus(data);
    } catch (err: unknown) {
      setError(toPublicError(err, "加载结果留存失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const evidence = status?.recentEvidence || [];
  const latest = status?.screenshot;

  /* 移动端原生视图（mx-* 明德 VP 风格）——local-engine-v2/evidence */
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
                <div className="mx-page-title" style={{ fontSize: 18 }}>结果留存</div>
                <div className="mx-page-sub" style={{ marginTop: 1 }}>系统执行过程的截图证据，随时可追溯</div>
              </div>
              <span style={{ flexShrink: 0, width: 44 }} />
            </div>
          </div>

          {/* 状态 + 刷新 */}
          <div className="mx-card" style={{ marginTop: 12, padding: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span className={`mx-badge ${evidence.length > 0 ? "mx-badge-blue" : "mx-badge-gold"}`} style={{ fontSize: 10.5 }}>
              {loading ? "加载中…" : `${evidence.length} 条留存`}
            </span>
            <button type="button" onClick={() => void fetchStatus()} style={{ flexShrink: 0, padding: "7px 13px", borderRadius: 9, background: "rgba(120,148,179,.12)", color: "var(--mx-ink)", border: "1px solid rgba(142,165,190,.3)", fontSize: 11.5, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5 }}>
              <RefreshCcw width={13} height={13} /> 刷新
            </button>
          </div>

          {error && (
            <div className="mx-card" style={{ marginTop: 10, padding: 11, borderColor: "rgba(220,80,80,.4)" }}>
              <p style={{ fontSize: 12.5, color: "var(--kaypal-v3-danger)" }}>{error}</p>
            </div>
          )}

          {/* 最新截图 */}
          {latest && (
            <>
              <div className="mx-section-head" style={{ marginTop: 14 }}>最新执行画面</div>
              <div className="mx-card" style={{ padding: 8 }}>
                <div style={{ overflow: "hidden", borderRadius: 8 }}>
                  {(latest as { dataUrl?: string; url?: string; path?: string }).dataUrl ||
                   (latest as { url?: string }).url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={(latest as { dataUrl?: string }).dataUrl || (latest as { url?: string }).url}
                      alt="最新执行画面"
                      style={{ width: "100%", display: "block" }}
                    />
                  ) : (
                    <p style={{ padding: 16, fontSize: 11.5, color: "var(--mx-muted)", wordBreak: "break-all" }}>
                      截图路径：{(latest as { path?: string }).path || "未知"}
                    </p>
                  )}
                </div>
              </div>
            </>
          )}

          {/* 历史留存 */}
          <div className="mx-section-head" style={{ marginTop: 16 }}>历史留存（{evidence.length}）</div>
          {loading ? (
            <div style={{ padding: "32px 0", textAlign: "center" }}>
              <div style={{ width: 26, height: 26, margin: "0 auto", borderRadius: "50%", border: "2px solid rgba(222,150,57,.9)", borderTopColor: "transparent", animation: "spin 0.8s linear infinite" }} />
            </div>
          ) : evidence.length === 0 ? (
            <div className="mx-card mx-empty" style={{ padding: 26, textAlign: "center" }}>
              <ImageIcon width={26} height={26} style={{ color: "var(--mx-muted)", margin: "0 auto" }} />
              <p style={{ fontSize: 13, fontWeight: 600, color: "var(--mx-ink)", marginTop: 9 }}>还没有留存记录</p>
              <p style={{ fontSize: 11.5, color: "var(--mx-muted)", marginTop: 4 }}>系统执行任务时会自动截图留存</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {evidence.map((item, i) => {
                const record = item as { label?: string; capturedAt?: string; path?: string; kind?: string; dataUrl?: string; url?: string };
                const imageSrc = record.dataUrl || record.url;
                return (
                  <button
                    key={i}
                    type="button"
                    className="mx-card"
                    style={{ padding: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, textAlign: "left" }}
                    onClick={() => setViewing({ src: imageSrc, label: record.label || record.kind || `留存 ${i + 1}`, path: record.path, capturedAt: record.capturedAt })}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                      <ImageIcon width={16} height={16} style={{ color: "var(--mx-muted)", flexShrink: 0 }} />
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--mx-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {record.label || record.kind || `留存 ${i + 1}`}
                        </span>
                        {record.capturedAt && (
                          <span style={{ display: "block", fontSize: 10, color: "var(--mx-muted)", marginTop: 2 }}>
                            {new Date(record.capturedAt).toLocaleString("zh-CN")}
                          </span>
                        )}
                      </span>
                    </span>
                    <span style={{ fontFamily: "monospace", fontSize: 10, color: "var(--mx-muted)", flexShrink: 0 }}>
                      {imageSrc ? "查看 ›" : record.path?.split("/").slice(-2).join("/")}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <button type="button" onClick={() => router.push("/local-engine")} style={{ marginTop: 16, padding: "9px 18px", borderRadius: 10, background: "rgba(120,148,179,.12)", color: "var(--mx-ink)", border: "1px solid rgba(142,165,190,.3)", fontSize: 12, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5 }}>
            <ArrowLeft width={14} height={14} /> 返回
          </button>
        </div>

        {/* 大图查看浮层（移动端全屏） */}
        {viewing && (
          <div
            style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,.72)", padding: 14 }}
            onClick={() => setViewing(null)}
          >
            <div style={{ maxHeight: "100%", maxWidth: "100%", overflow: "auto", borderRadius: 12, background: "var(--mx-surface, #10151c)", padding: 12, width: "100%" }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 9 }}>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: "var(--mx-ink)" }}>{viewing.label}</span>
                  {viewing.capturedAt && (
                    <span style={{ display: "block", fontSize: 10.5, color: "var(--mx-muted)", marginTop: 2 }}>
                      {new Date(viewing.capturedAt).toLocaleString("zh-CN")}
                    </span>
                  )}
                </span>
                <button type="button" onClick={() => setViewing(null)} style={{ padding: 6, color: "var(--mx-muted)", background: "none", border: "none", flexShrink: 0 }}>
                  <XCircle width={20} height={20} />
                </button>
              </div>
              {viewing.src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={viewing.src} alt={viewing.label} style={{ width: "100%", borderRadius: 8, display: "block" }} />
              ) : (
                <p style={{ padding: "28px 0", textAlign: "center", fontFamily: "monospace", fontSize: 12, color: "var(--mx-muted)", wordBreak: "break-all" }}>
                  {viewing.path || "无法预览"}
                </p>
              )}
            </div>
          </div>
        )}
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
              结果留存
            </h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              系统执行过程的截图证据，随时可追溯
            </p>
          </div>
          <V2StatusChip tone={evidence.length > 0 ? "accent" : "muted"}>
            {loading ? "加载中" : `${evidence.length} 条留存`}
          </V2StatusChip>
        </div>
      </section>

      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      {/* 最新截图 */}
      {latest && (
        <V2Section title="最新执行画面">
          <div className="overflow-hidden rounded-[var(--kaypal-v3-radius)] border border-[var(--kaypal-v3-border)]">
            {(latest as { dataUrl?: string; url?: string; path?: string }).dataUrl || 
             (latest as { url?: string }).url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={(latest as { dataUrl?: string }).dataUrl || (latest as { url?: string }).url}
                alt="最新执行画面"
                className="w-full"
              />
            ) : (
              <p className="p-6 text-sm text-[var(--kaypal-v3-muted)]">
                截图路径：{(latest as { path?: string }).path || "未知"}
              </p>
            )}
          </div>
        </V2Section>
      )}

      {/* 历史留存 */}
      <V2Section title={`历史留存（${evidence.length}）`} padding={false}>
        {loading ? (
          <div className="p-12 text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-[var(--kaypal-v3-accent)] border-t-transparent" />
          </div>
        ) : evidence.length === 0 ? (
          <V2EmptyState
            icon={ImageIcon}
            title="还没有留存记录"
            description="系统执行任务时会自动截图留存"
          />
        ) : (
          <div className="divide-y divide-[var(--kaypal-v3-border)]">
            {evidence.map((item, i) => {
              const record = item as { label?: string; capturedAt?: string; path?: string; kind?: string; dataUrl?: string; url?: string };
              const imageSrc = record.dataUrl || record.url;
              return (
                <button
                  key={i}
                  type="button"
                  className="flex w-full items-center justify-between p-5 text-left transition hover:bg-[var(--kaypal-v3-paper-soft)]"
                  onClick={() => setViewing({ src: imageSrc, label: record.label || record.kind || `留存 ${i + 1}`, path: record.path, capturedAt: record.capturedAt })}
                >
                  <div className="flex items-center gap-3">
                    <ImageIcon className="h-5 w-5 text-[var(--kaypal-v3-muted)]" />
                    <div>
                      <p className="text-sm font-medium text-[var(--kaypal-v3-ink)]">
                        {record.label || record.kind || `留存 ${i + 1}`}
                      </p>
                      {record.capturedAt && (
                        <p className="text-xs text-[var(--kaypal-v3-muted)]">
                          {new Date(record.capturedAt).toLocaleString("zh-CN")}
                        </p>
                      )}
                    </div>
                  </div>
                  <span className="font-mono text-xs text-[var(--kaypal-v3-muted)]">
                    {imageSrc ? "点击查看" : record.path?.split("/").slice(-2).join("/")}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </V2Section>

      {/* 大图查看 */}
      {viewing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
          onClick={() => setViewing(null)}
        >
          <div className="max-h-full max-w-4xl overflow-auto rounded-[var(--kaypal-v3-radius)] bg-[var(--kaypal-v3-paper)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="font-medium text-[var(--kaypal-v3-ink)]">{viewing.label}</p>
                {viewing.capturedAt && (
                  <p className="text-xs text-[var(--kaypal-v3-muted)]">
                    {new Date(viewing.capturedAt).toLocaleString("zh-CN")}
                  </p>
                )}
              </div>
              <button
                type="button"
                className="rounded-full p-1 text-[var(--kaypal-v3-muted)] hover:bg-[var(--kaypal-v3-paper-soft)]"
                onClick={() => setViewing(null)}
              >
                <XCircle className="h-5 w-5" />
              </button>
            </div>
            {viewing.src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={viewing.src} alt={viewing.label} className="w-full rounded-[var(--kaypal-v3-radius-sm)]" />
            ) : (
              <p className="py-8 text-center font-mono text-sm text-[var(--kaypal-v3-muted)]">
                {viewing.path || "无法预览"}
              </p>
            )}
          </div>
        </div>
      )}

      <section className="flex items-center justify-between">
        <V2GhostButton icon={ArrowLeft} onClick={() => router.push("/local-engine")}>
          返回
        </V2GhostButton>
        <V2GhostButton icon={RefreshCcw} onClick={() => void fetchStatus()}>
          刷新
        </V2GhostButton>
      </section>
    </div>
  );
}
