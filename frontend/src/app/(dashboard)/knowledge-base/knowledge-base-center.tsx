"use client";

import { useConfirm } from "@/hooks/use-confirm";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  CloudUpload,
  FileText,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "@/components/iconpark";
import {
  V2EmptyState,
  V2GhostButton,
  V2PrimaryButton,
  V2Section,
  V2StatusChip,
} from "@/components/v2/ui-kit";
import {
  kaypalApi,
  type KaypalKnowledgeSearchHit,
  type LocalKnowledgeItem,
} from "@/lib/api/auth";
import { toPublicError } from "@/lib/public-error";
import { useIsMobile } from "@/lib/hooks/use-media-query";
import { SkeletonList } from "@/components/skeleton";

const SYNC_LABELS: Record<string, string> = {
  synced: "已同步",
  pending: "待同步",
  failed: "同步失败",
};

function fileSizeLabel(size: number | null) {
  if (!size || !Number.isFinite(size)) return "文本知识";
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function dateTimeLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function scoreLabel(score: number) {
  if (!Number.isFinite(score)) return "相关度未知";
  return `相关度 ${Math.round(score * 100)}%`;
}

export function KnowledgeBaseCenter() {
  const { confirm, modal } = useConfirm();
  const router = useRouter();
  const isMobile = useIsMobile();

  const [items, setItems] = useState<LocalKnowledgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 检索验证
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [matches, setMatches] = useState<KaypalKnowledgeSearchHit[]>([]);
  const [diagnostics, setDiagnostics] = useState("");
  const [hasSearched, setHasSearched] = useState(false);

  // 列表操作
  const [syncingId, setSyncingId] = useState("");
  const [deletingId, setDeletingId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await kaypalApi.listLocalKnowledge();
      setItems(result.items || []);
    } catch (err: unknown) {
      setError(toPublicError(err, "本机知识库加载失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runSearch = async () => {
    const keyword = query.trim();
    if (!keyword) return;
    setSearching(true);
    setError(null);
    try {
      const result = await kaypalApi.searchKnowledge({ query: keyword, limit: 8 });
      setMatches(result.matches || []);
      setHasSearched(true);
      setDiagnostics(
        [
          `命中 ${result.total} 条`,
          `本地 ${result.diagnostics?.localHitCount ?? 0} 条`,
          `云端 ${result.diagnostics?.cloudHitCount ?? 0} 条`,
          result.diagnostics?.cloudWarning ? `云端提示：${result.diagnostics.cloudWarning}` : "",
        ]
          .filter(Boolean)
          .join("，"),
      );
    } catch (err: unknown) {
      setError(toPublicError(err, "知识库检索失败"));
    } finally {
      setSearching(false);
    }
  };

  const handleSync = async (id: string) => {
    setSyncingId(id);
    setError(null);
    try {
      const result = await kaypalApi.syncKnowledge(id);
      if (result.cloudWarning || result.ok === false) {
        setError(result.cloudWarning || "云端权限未开通，本机知识仍可用");
      }
      void load();
    } catch (err: unknown) {
      setError(toPublicError(err, "云端同步未完成"));
    } finally {
      setSyncingId("");
    }
  };

  const handleDelete = async (id: string) => {
    const ok = await confirm({ kind: "danger", title: "删除知识", description: "确定从本机知识库删除这条知识吗？" });
    if (!ok) return;
    setDeletingId(id);
    setError(null);
    try {
      await kaypalApi.deleteLocalKnowledge(id);
      setItems((prev) => prev.filter((item) => item.id !== id));
      setMatches((prev) => prev.filter((item) => item.assetId !== id));
    } catch (err: unknown) {
      setError(toPublicError(err, "删除失败"));
    } finally {
      setDeletingId("");
    }
  };

  const syncBadgeTone = (status: string) =>
    status === "synced" ? "success" : status === "failed" ? "danger" : "warning";

  /* 移动端原生视图（mx-* 明德 VP 风格） */
  if (isMobile) {
    return (
      <div className="kx-mobile-ambient">
        <div className="mx-px" style={{ paddingTop: 10, paddingBottom: 28 }}>
          <div className="mx-header">
            <div className="mx-header-row">
              <div style={{ minWidth: 0 }}>
                <div className="mx-brand-eyebrow">JIUZHANG AI</div>
                <div className="mx-page-title">知识库</div>
                <div className="mx-page-sub">把资料喂给 AI，生成的内容更懂你的业务</div>
              </div>
              <button type="button" className="mx-btn-gold" style={{ fontSize: 12, padding: "8px 14px", whiteSpace: "nowrap" }} onClick={() => router.push("/knowledge-base/new")}>
                <Plus size={14} style={{ marginRight: 3 }} /> 新增知识
              </button>
            </div>
          </div>

          {error && (
            <div className="mx-card" style={{ marginTop: 10, padding: 12, borderColor: "rgba(220,80,80,.4)" }}>
              <p style={{ fontSize: 12.5, color: "var(--kaypal-v3-danger)" }}>{error}</p>
            </div>
          )}

          {/* 检索验证 */}
          <div className="mx-section-head" style={{ marginTop: 16 }}>检索验证</div>
          <div className="mx-card" style={{ padding: 12 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void runSearch();
                }}
                placeholder="输入客户问题、产品名、活动政策…"
                style={{ flex: 1, minWidth: 0, padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(142,165,190,.3)", background: "rgba(255,255,255,.06)", color: "var(--kaypal-v3-ink)", fontSize: 12.5 }}
              />
              <button type="button" className="mx-btn-gold" style={{ flexShrink: 0, padding: "0 14px", display: "inline-flex", alignItems: "center", gap: 5 }} disabled={searching} onClick={() => void runSearch()}>
                <Search width={14} height={14} /> 检索
              </button>
            </div>
            {diagnostics ? (
              <p style={{ fontSize: 11, color: "var(--kaypal-v3-muted)", marginTop: 8 }}>{diagnostics}</p>
            ) : null}
            {matches.length > 0 ? (
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                {matches.map((m) => (
                  <div key={`${m.assetId}-${m.chunkId || "asset"}`} style={{ padding: 10, borderRadius: 10, background: "rgba(255,255,255,.05)", border: "1px solid rgba(142,165,190,.16)" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--kaypal-v3-ink)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.title}</span>
                      <span style={{ fontSize: 10, color: "var(--kaypal-v3-muted)", flexShrink: 0 }}>{m.sourceType === "local" ? "本机" : "云端"} · {scoreLabel(m.relevanceScore)}</span>
                    </div>
                    <p style={{ fontSize: 11.5, color: "var(--kaypal-v3-muted)", marginTop: 4, lineHeight: 1.5 }}>{m.snippet}</p>
                    {m.sourceType === "local" ? (
                      <button type="button" style={{ marginTop: 6, fontSize: 11, fontWeight: 600, color: "var(--kaypal-v3-amber)", background: "none", border: "none", padding: 0 }} disabled={syncingId === m.assetId} onClick={() => void handleSync(m.assetId)}>
                        {syncingId === m.assetId ? "同步中…" : "同步云端"}
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : hasSearched && query.trim() && !searching ? (
              <p style={{ fontSize: 11.5, color: "var(--kaypal-v3-muted)", marginTop: 8 }}>没有命中本机或云端知识库内容。</p>
            ) : null}
          </div>

          {/* 本机知识库 */}
          <div className="mx-section-head" style={{ marginTop: 16 }}>本机知识库（{items.length}）</div>
          {loading ? (
            <div className="mx-card mx-list-card" style={{ padding: "22px 0", textAlign: "center" }}>
              <SkeletonList rows={5} />
            </div>
          ) : items.length === 0 ? (
            <div className="mx-card mx-empty">
              <p>本机知识库还没有内容</p>
              <p style={{ fontSize: 11, marginTop: 4 }}>上传文件或写入文本后，会显示在这里</p>
            </div>
          ) : (
            <div className="mx-card mx-list-card">
              {items.map((item) => (
                <div key={item.id} className="mx-row" style={{ alignItems: "flex-start", cursor: "default" }}>
                  <span className="mx-row-ic" style={{ background: "rgba(37,99,235,.1)", color: "var(--kaypal-v3-cobalt)", borderRadius: 999 }}>
                    <FileText size={18} strokeWidth={1.8} />
                  </span>
                  <div className="mx-row-main">
                    <div className="mx-row-title" style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title || item.fileName || "未命名"}</span>
                      <span className={`mx-badge ${item.syncStatus === "synced" ? "mx-badge-green" : "mx-badge-gold"}`} style={{ fontSize: 10, flexShrink: 0 }}>
                        {SYNC_LABELS[item.syncStatus] || item.syncStatus}
                      </span>
                    </div>
                    <div className="mx-row-desc">
                      {fileSizeLabel(item.fileSize)} · 更新 {dateTimeLabel(item.updatedAt)}
                    </div>
                    <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
                      {item.syncStatus !== "synced" ? (
                        <button type="button" style={{ fontSize: 11.5, fontWeight: 600, color: "var(--kaypal-v3-cobalt)", background: "none", border: "none", padding: 0 }} disabled={syncingId === item.id} onClick={() => void handleSync(item.id)}>
                          {syncingId === item.id ? "同步中…" : "同步云端"}
                        </button>
                      ) : null}
                      <button type="button" style={{ fontSize: 11.5, fontWeight: 600, color: "var(--kaypal-v3-danger)", background: "none", border: "none", padding: 0 }} disabled={deletingId === item.id} onClick={() => void handleDelete(item.id)}>
                        {deletingId === item.id ? "删除中…" : "删除"}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  /* 桌面端 */
  return (
    <div className="flex flex-col gap-6">
      {modal}
      <section className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="kaypal-v3-icon-tile h-12 w-12">
            <BookOpen className="h-6 w-6" />
          </div>
          <div>
            <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">知识库</h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              把资料喂给 AI，生成的内容更懂你的业务
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <V2GhostButton icon={RefreshCw} onClick={() => void load()}>刷新</V2GhostButton>
          <V2PrimaryButton icon={Plus} onClick={() => router.push("/knowledge-base/new")}>
            新增知识
          </V2PrimaryButton>
        </div>
      </section>

      {error && (
        <p className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4 text-sm text-[var(--kaypal-v3-danger)]">
          {error}
        </p>
      )}

      {/* 检索验证 */}
      <V2Section title="检索验证" description="确认你存的知识能不能被 AI 检索到（本机 + Kaypal 云端）">
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void runSearch();
            }}
            placeholder="输入客户问题、产品名、活动政策或内容主题"
            className="h-11 flex-1 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-field-border)] bg-[var(--kaypal-v3-field-bg)] px-4 text-sm text-[var(--kaypal-v3-ink)] outline-none transition placeholder:text-[var(--kaypal-v3-muted)] focus:border-[var(--kaypal-v3-accent)] focus:ring-4 focus:ring-[var(--kaypal-v3-field-focus-ring)]"
          />
          <V2PrimaryButton icon={Search} loading={searching} onClick={runSearch}>
            检索
          </V2PrimaryButton>
        </div>
        {diagnostics ? (
          <p className="mt-2 text-xs text-[var(--kaypal-v3-muted)]">{diagnostics}</p>
        ) : null}
        {matches.length > 0 ? (
          <div className="mt-3 flex flex-col gap-3">
            {matches.map((m) => (
              <div key={`${m.assetId}-${m.chunkId || "asset"}`} className="kaypal-v3-surface p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-medium text-[var(--kaypal-v3-ink)]">{m.title}</h3>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-[var(--kaypal-v3-muted)]">
                      {m.sourceType === "local" ? "本机知识" : "云端知识"} · {scoreLabel(m.relevanceScore)}
                    </span>
                    {m.sourceType === "local" ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-xs font-medium text-[var(--kaypal-v3-accent-ink)] hover:underline"
                        disabled={syncingId === m.assetId}
                        onClick={() => void handleSync(m.assetId)}
                      >
                        <CloudUpload className="h-3.5 w-3.5" />
                        {syncingId === m.assetId ? "同步中…" : "同步云端"}
                      </button>
                    ) : null}
                  </div>
                </div>
                <p className="mt-1 text-sm leading-6 text-[var(--kaypal-v3-muted)]">{m.snippet}</p>
              </div>
            ))}
          </div>
        ) : hasSearched && query.trim() && !searching ? (
          <p className="mt-3 text-sm text-[var(--kaypal-v3-muted)]">没有命中本机或 Kaypal 主知识库内容。</p>
        ) : null}
      </V2Section>

      {/* 本机知识库 */}
      <V2Section title={`本机知识库（${items.length}）`} description="已经保存到电脑里的知识，内容生产、互动回复和 AI 员工会先从这里取用">
        {loading ? (
          <div className="py-10 text-center">
            <SkeletonList rows={5} />
          </div>
        ) : items.length === 0 ? (
          <V2EmptyState
            icon={BookOpen}
            title="本机知识库还没有内容"
            description="上传文件或写入文本后，会显示在这里"
          />
        ) : (
          <div className="flex flex-col gap-3">
            {items.map((item) => (
              <div key={item.id} className="kaypal-v3-surface flex items-center justify-between gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 shrink-0 text-[var(--kaypal-v3-muted)]" />
                    <h3 className="truncate text-sm font-medium text-[var(--kaypal-v3-ink)]">
                      {item.title || item.fileName || "未命名"}
                    </h3>
                    <V2StatusChip tone={syncBadgeTone(item.syncStatus)}>
                      {SYNC_LABELS[item.syncStatus] || item.syncStatus}
                    </V2StatusChip>
                  </div>
                  <p className="mt-1 text-xs text-[var(--kaypal-v3-muted)]">
                    {fileSizeLabel(item.fileSize)} · 更新 {dateTimeLabel(item.updatedAt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {item.syncStatus !== "synced" ? (
                    <V2GhostButton
                      icon={CloudUpload}
                      loading={syncingId === item.id}
                      onClick={() => void handleSync(item.id)}
                    >
                      同步
                    </V2GhostButton>
                  ) : null}
                  <V2GhostButton
                    icon={Trash2}
                    loading={deletingId === item.id}
                    onClick={() => void handleDelete(item.id)}
                    className="text-[var(--kaypal-v3-danger)]"
                  >
                    删除
                  </V2GhostButton>
                </div>
              </div>
            ))}
          </div>
        )}
      </V2Section>
    </div>
  );
}
