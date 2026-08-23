"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  FileText,
  Folder,
  RefreshCcw,
  XCircle,
} from "lucide-react";
import {
  V2Section,
  V2StatusChip,
  V2GhostButton,
  V2EmptyState,
  V2PrimaryButton,
} from "@/components/v2/ui-kit";
import { localEngineApi, type LocalEngineFileAccessItem } from "@/lib/api/local-engine";
import { toPublicError } from "@/lib/public-error";
import { useIsMobile } from "@/lib/hooks/use-media-query";

export function EngineFiles() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [items, setItems] = useState<LocalEngineFileAccessItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    setError(null);
    try {
      const data = await localEngineApi.fileAccessStatus();
      const list = Array.isArray(data)
        ? data
        : (data as { items?: LocalEngineFileAccessItem[] }).items || [];
      setItems(list);
    } catch (err: unknown) {
      setError(toPublicError(err, "加载文件状态失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchItems();
  }, [fetchItems]);

  const handleRecheck = async () => {
    setChecking(true);
    await fetchItems();
    setChecking(false);
  };

  const okCount = items.filter((i) => i.exists && i.readable).length;
  const failCount = items.length - okCount;

  /* 移动端原生视图（mx-* 明德 VP 风格）——local-engine-v2/files */
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
                <div className="mx-page-title" style={{ fontSize: 18 }}>文件与凭证</div>
                <div className="mx-page-sub" style={{ marginTop: 1 }}>系统需要的文件和目录是否可访问</div>
              </div>
              <span style={{ flexShrink: 0, width: 44 }} />
            </div>
          </div>

          {/* 状态 + 重新检查 */}
          <div className="mx-card" style={{ marginTop: 12, padding: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span className={`mx-badge ${failCount > 0 ? "mx-badge-gold" : "mx-badge-green"}`} style={{ fontSize: 10.5 }}>
              {loading ? "检查中…" : failCount > 0 ? `${failCount} 项异常` : "全部可访问"}
            </span>
            <button type="button" className="mx-btn-gold" style={{ flexShrink: 0, padding: "8px 14px", fontSize: 11.5 }} disabled={checking} onClick={() => void handleRecheck()}>
              {checking ? "检查中…" : "重新检查"}
            </button>
          </div>

          {error && (
            <div className="mx-card" style={{ marginTop: 10, padding: 11, borderColor: "rgba(220,80,80,.4)" }}>
              <p style={{ fontSize: 12.5, color: "var(--kaypal-v3-danger)" }}>{error}</p>
            </div>
          )}

          {/* 访问状态列表 */}
          <div className="mx-section-head" style={{ marginTop: 14 }}>访问状态（{okCount}/{items.length}）</div>
          {loading ? (
            <div style={{ padding: "32px 0", textAlign: "center" }}>
              <div style={{ width: 26, height: 26, margin: "0 auto", borderRadius: "50%", border: "2px solid rgba(222,150,57,.9)", borderTopColor: "transparent", animation: "spin 0.8s linear infinite" }} />
            </div>
          ) : items.length === 0 ? (
            <div className="mx-card mx-empty" style={{ padding: 24, textAlign: "center" }}>
              <Folder width={26} height={26} style={{ color: "var(--mx-muted)", margin: "0 auto" }} />
              <p style={{ fontSize: 12.5, color: "var(--mx-muted)", marginTop: 9 }}>没有需要检查的文件</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {items.map((item) => {
                const ok = item.exists && item.readable;
                return (
                  <div key={item.key} className="mx-card" style={{ padding: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                        {item.kind === "directory" ? (
                          <Folder width={16} height={16} style={{ color: "var(--mx-muted)", flexShrink: 0 }} />
                        ) : (
                          <FileText width={16} height={16} style={{ color: "var(--mx-muted)", flexShrink: 0 }} />
                        )}
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--mx-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</span>
                      </span>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, color: ok ? "var(--kaypal-v3-success)" : "var(--kaypal-v3-danger)", flexShrink: 0 }}>
                        {ok ? <CheckCircle2 width={13} height={13} /> : <XCircle width={13} height={13} />}
                        {ok ? "可访问" : !item.exists ? "不存在" : !item.readable ? "不可读" : "异常"}
                      </span>
                    </div>
                    <p style={{ fontFamily: "monospace", fontSize: 10, color: "var(--mx-muted)", marginTop: 6, wordBreak: "break-all" }}>{item.path}</p>
                    {ok && item.fileCount !== undefined && (
                      <p style={{ fontSize: 10.5, color: "var(--mx-muted)", marginTop: 3 }}>{item.fileCount} 个文件</p>
                    )}
                  </div>
                );
              })}
            </div>
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
              文件与凭证
            </h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              系统需要的文件和目录是否可访问
            </p>
          </div>
          <V2StatusChip tone={failCount > 0 ? "warning" : "success"}>
            {loading ? "检查中" : failCount > 0 ? `${failCount} 项异常` : "全部可访问"}
          </V2StatusChip>
        </div>
      </section>

      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      <V2Section title="访问状态" padding={false}>
        {loading ? (
          <div className="p-12 text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-[var(--kaypal-v3-accent)] border-t-transparent" />
          </div>
        ) : items.length === 0 ? (
          <V2EmptyState icon={Folder} title="没有需要检查的文件" />
        ) : (
          <div className="divide-y divide-[var(--kaypal-v3-border)]">
            {items.map((item) => {
              const ok = item.exists && item.readable;
              return (
                <div key={item.key} className="flex items-center justify-between p-5">
                  <div className="flex items-center gap-4">
                    {item.kind === "directory" ? (
                      <Folder className="h-5 w-5 text-[var(--kaypal-v3-muted)]" />
                    ) : (
                      <FileText className="h-5 w-5 text-[var(--kaypal-v3-muted)]" />
                    )}
                    <div>
                      <p className="font-medium text-[var(--kaypal-v3-ink)]">
                        {item.name}
                      </p>
                      <p className="mt-0.5 font-mono text-xs text-[var(--kaypal-v3-muted)]">
                        {item.path}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {ok ? (
                      <span className="inline-flex items-center gap-1 text-sm text-[var(--kaypal-v3-success)]">
                        <CheckCircle2 className="h-4 w-4" />
                        可访问{item.fileCount !== undefined ? `（${item.fileCount} 个文件）` : ""}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-sm text-[var(--kaypal-v3-danger)]">
                        <XCircle className="h-4 w-4" />
                        {!item.exists ? "不存在" : !item.readable ? "不可读" : "异常"}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </V2Section>

      <section className="flex items-center justify-between">
        <V2GhostButton icon={ArrowLeft} onClick={() => router.push("/local-engine")}>
          返回
        </V2GhostButton>
        <V2PrimaryButton icon={RefreshCcw} loading={checking} onClick={() => void handleRecheck()}>
          {checking ? "正在检查..." : "重新检查"}
        </V2PrimaryButton>
      </section>
    </div>
  );
}
