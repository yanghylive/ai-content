"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Lightbulb, Loader2, RefreshCcw, Send, XCircle } from "lucide-react";
import { ResourceCenter, type ResourceItem } from "@/components/v2/resource-center";
import { topicsApi, type Topic } from "@/lib/api/topics";
import { toActionableError, toPublicError } from "@/lib/public-error";
import { V2GhostButton, V2PrimaryButton, V2StatusChip } from "@/components/v2/ui-kit";
import { useIsMobile } from "@/lib/hooks/use-media-query";

const SCORE_LABELS: Array<{ key: keyof NonNullable<Topic["scoreDetails"]>; label: string }> = [
  { key: "audienceFit", label: "受众契合" },
  { key: "emotionalValue", label: "情绪价值" },
  { key: "simplificationPotential", label: "易懂潜力" },
  { key: "networkVolume", label: "传播热度" },
  { key: "contentValue", label: "内容价值" },
];

export function TopicsCenter() {
  const router = useRouter();
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);

  // 原生详情弹窗（不再跳旧版页）
  const [viewing, setViewing] = useState<Topic | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchTopics = useCallback(async () => {
    try {
      setLoading(true);
      const data = await topicsApi.list();
      setTopics(Array.isArray(data) ? data : (data as { items?: Topic[] }).items || []);
    } catch (error: unknown) {
      console.error(toPublicError(error, "加载选题失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchTopics();
  }, [fetchTopics]);

  const openDetail = async (id: string) => {
    setLoadingDetail(true);
    setActionError(null);
    setViewing(null);
    try {
      const detail = await topicsApi.getById(id);
      setViewing(detail);
    } catch (error: unknown) {
      setActionError(toPublicError(error, "详情加载失败"));
    } finally {
      setLoadingDetail(false);
    }
  };

  const handlePublishToggle = async () => {
    if (!viewing) return;
    setActing(true);
    setActionError(null);
    try {
      const updated = viewing.isPublished
        ? await topicsApi.unpublish(viewing.id)
        : await topicsApi.publish(viewing.id);
      setViewing(updated);
      await fetchTopics();
    } catch (error: unknown) {
      setActionError(toActionableError(error, "操作失败"));
    } finally {
      setActing(false);
    }
  };

  const handleRescore = async () => {
    if (!viewing) return;
    setActing(true);
    setActionError(null);
    try {
      await topicsApi.generate(viewing.id);
      const fresh = await topicsApi.getById(viewing.id);
      setViewing(fresh);
      await fetchTopics();
    } catch (error: unknown) {
      setActionError(toActionableError(error, "评分失败"));
    } finally {
      setActing(false);
    }
  };

  const items: ResourceItem[] = topics.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description || t.summary || undefined,
    badges: [
      t.sourceType,
      t.aiScore !== null ? `评分 ${Math.round(t.aiScore)}` : null,
      t.isPublished ? "已发布" : null,
    ].filter(Boolean) as string[],
  }));

  /* 移动端（<768px）：明德 VP 风格，复用同一批 state/handlers */
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <div className="kx-mobile-ambient">
        <header className="mx-header">
          <div className="mx-header-row">
            <div>
              <div className="mx-brand-eyebrow">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 .304.377l6.001 4.1a.5.5 0 0 1-.29.908l-6.985.49a1 1 0 0 0-.673.42l-3.45 4.8a.5.5 0 0 1-.84 0l-3.45-4.8a1 1 0 0 0-.673-.42l-6.985-.49a.5.5 0 0 1-.29-.908l6.001-4.1a1 1 0 0 0 .304-.377z" /></svg>
                JIUZHANG AI
              </div>
              <h1 className="mx-page-title">选题</h1>
              <p className="mx-page-sub">AI 推荐的内容选题，看中就直接拿来写</p>
            </div>
            <button type="button" className="mx-btn-gold" style={{ fontSize: 12, padding: "8px 14px" }} onClick={() => router.push("/topics/new")}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" width="13" height="13"><path d="M5 12h14" /><path d="M12 5v14" /></svg>
              新建
            </button>
          </div>
        </header>

        <section className="mx-px" style={{ marginTop: 14, paddingBottom: 28 }}>
          <div className="mx-card mx-list-card">
            {loading ? (
              <div>
                <div className="mx-skeleton-row"><span className="mx-skeleton mx-skeleton-ic" /><div style={{ flex: 1 }}><div className="mx-skeleton mx-skeleton-line" style={{ width: "70%" }} /><div className="mx-skeleton mx-skeleton-line mx-skeleton-line-sm" style={{ marginTop: 7 }} /></div></div>
                <div className="mx-skeleton-row"><span className="mx-skeleton mx-skeleton-ic" /><div style={{ flex: 1 }}><div className="mx-skeleton mx-skeleton-line" style={{ width: "58%" }} /><div className="mx-skeleton mx-skeleton-line mx-skeleton-line-sm" style={{ marginTop: 7 }} /></div></div>
                <div className="mx-skeleton-row"><span className="mx-skeleton mx-skeleton-ic" /><div style={{ flex: 1 }}><div className="mx-skeleton mx-skeleton-line" style={{ width: "76%" }} /><div className="mx-skeleton mx-skeleton-line mx-skeleton-line-sm" style={{ marginTop: 7 }} /></div></div>
              </div>
            ) : topics.length === 0 ? (
              <div className="mx-empty">
                <p>还没有选题，先创建一个吧</p>
                <button type="button" className="mx-btn-gold" style={{ marginTop: 12 }} onClick={() => router.push("/topics/new")}>新建选题</button>
              </div>
            ) : (
              topics.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="mx-row"
                  style={{ width: "100%", textAlign: "left", background: "none", border: "none" }}
                  onClick={() => void openDetail(t.id)}
                >
                  <span className="mx-row-ic" style={{ background: "rgba(234,161,75,.12)", color: "#c87922" }}>
                    <Lightbulb size={18} />
                  </span>
                  <div className="mx-row-main">
                    <div className="mx-row-title">{t.title}</div>
                    <div className="mx-row-desc">
                      {t.sourceType}
                      {t.aiScore !== null ? ` · 评分 ${Math.round(t.aiScore)}` : ""}
                    </div>
                  </div>
                  <div className="mx-row-right">
                    {t.isPublished ? <span className="mx-badge mx-badge-green">已发布</span> : null}
                    <svg viewBox="0 0 24 24" fill="none" stroke="#b9c5d4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="15" height="15"><path d="m9 18 6-6-6-6" /></svg>
                  </div>
                </button>
              ))
            )}
          </div>
        </section>

        {/* 加载详情中 */}
        {loadingDetail && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <Loader2 className="h-8 w-8 animate-spin text-white" />
          </div>
        )}

        {/* 选题详情全屏页（移动端） */}
        {viewing && (
          <div className="fixed inset-0 z-50 flex flex-col bg-[var(--kaypal-v3-paper)]" style={{ paddingBottom: "calc(12px + env(safe-area-inset-bottom))" }}>
            <header className="mx-header">
              <div className="mx-header-row">
                <button type="button" className="mx-control" aria-label="返回" style={{ width: 38, height: 38, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", color: "#16335d", flexShrink: 0 }} onClick={() => setViewing(null)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></svg>
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="mx-page-sub" style={{ marginTop: 0, fontSize: 11, color: "#a9671f", fontWeight: 700, letterSpacing: ".12em" }}>选题详情</div>
                  <h1 className="mx-page-title" style={{ fontSize: 19 }}>{viewing.title}</h1>
                </div>
                <button type="button" className="mx-control" aria-label="关闭" style={{ width: 38, height: 38, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", color: "#16335d", flexShrink: 0 }} onClick={() => setViewing(null)}>
                  <XCircle size={18} />
                </button>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto" style={{ padding: "16px 16px 24px" }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {viewing.isPublished ? <span className="mx-badge mx-badge-green">已发布</span> : null}
                {viewing.aiScore !== null ? <span className="mx-badge mx-badge-gold">总评 {Math.round(viewing.aiScore)}</span> : null}
                <span className="mx-badge">{viewing.sourceType} · {viewing.createdAt ? new Date(viewing.createdAt).toLocaleDateString("zh-CN") : ""}</span>
              </div>

              {actionError && (
                <p style={{ marginTop: 12, padding: 10, borderRadius: 10, background: "rgba(239,68,68,.09)", fontSize: 12.5, color: "#dc2626" }}>{actionError}</p>
              )}

              {viewing.summary || viewing.description ? (
                <div className="mx-card" style={{ marginTop: 14, padding: 14 }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: "#8a95a5", marginBottom: 5 }}>摘要</p>
                  <p style={{ fontSize: 13, lineHeight: 1.7, color: "#334155" }}>{viewing.summary || viewing.description}</p>
                </div>
              ) : null}

              {viewing.keywords?.length ? (
                <div style={{ marginTop: 14 }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: "#8a95a5", marginBottom: 8 }}>关键词</p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {viewing.keywords.map((kw) => (
                      <span key={kw} className="mx-badge mx-badge-gold">{kw}</span>
                    ))}
                  </div>
                </div>
              ) : null}

              {viewing.scoreDetails ? (
                <div className="mx-card" style={{ marginTop: 14, padding: 14 }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: "#8a95a5", marginBottom: 10 }}>五维评分</p>
                  {SCORE_LABELS.map(({ key, label }) => {
                    const value = viewing.scoreDetails?.[key] ?? 0;
                    return (
                      <div key={key} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                        <span style={{ width: 56, fontSize: 11, color: "#8a95a5" }}>{label}</span>
                        <div className="mx-progress" style={{ flex: 1 }}><i style={{ width: `${Math.min(100, (value / 20) * 100)}%` }} /></div>
                        <span style={{ width: 40, textAlign: "right", fontSize: 11, fontWeight: 700, color: "#334155" }}>{Math.round(value)}<span style={{ fontWeight: 400, color: "#8a95a5" }}>/20</span></span>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {viewing.scoreReason ? (
                <div className="mx-card" style={{ marginTop: 14, padding: 14 }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: "#8a95a5", marginBottom: 5 }}>评分理由</p>
                  <p style={{ fontSize: 13, lineHeight: 1.7, color: "#334155" }}>{viewing.scoreReason}</p>
                </div>
              ) : null}

              {viewing.materials?.length ? (
                <div className="mx-card" style={{ marginTop: 14, padding: 14 }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: "#8a95a5", marginBottom: 5 }}>关联素材（{viewing.materials.length}）</p>
                  {viewing.materials.slice(0, 5).map((m) => (
                    <p key={m.id} style={{ fontSize: 13, color: "#334155", marginTop: 4 }}>· {m.title} <span style={{ fontSize: 11, color: "#8a95a5" }}>（{m.platform}）</span></p>
                  ))}
                </div>
              ) : null}
            </div>

            <div style={{ display: "flex", gap: 10, padding: "0 16px" }}>
              <button type="button" className="mx-btn-gold" style={{ flex: 1, fontSize: 12, padding: "11px 0", background: "rgba(255,255,255,.55)", color: "#334155", border: "1px solid rgba(148,163,184,.4)", boxShadow: "none", backgroundImage: "none" }} disabled={acting} onClick={handleRescore}>
                <RefreshCcw size={14} style={{ marginRight: 4 }} /> 重新评分
              </button>
              <button type="button" className="mx-btn-gold" style={{ flex: 1.4, fontSize: 12, padding: "11px 0" }} disabled={acting} onClick={handlePublishToggle}>
                <Send size={14} style={{ marginRight: 4 }} /> {viewing.isPublished ? "取消发布" : "发布这个选题"}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <ResourceCenter
        title="选题"
        subtitle="AI 推荐的内容选题，看中就直接拿来写"
        resourceName="选题"
        icon={Lightbulb}
        items={items}
        loading={loading}
        onCreate={() => router.push("/topics/new")}
        onItemClick={(item) => void openDetail(item.id)}
      />

      {/* 加载详情中 */}
      {loadingDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <Loader2 className="h-8 w-8 animate-spin text-white" />
        </div>
      )}

      {/* 选题详情弹窗（v2 原生，不再跳旧版） */}
      {viewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-[var(--kaypal-v3-radius)] bg-[var(--kaypal-v3-paper)] shadow-xl">
            <div className="flex items-start justify-between border-b border-[var(--kaypal-v3-border)] p-5">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold text-[var(--kaypal-v3-ink)]">
                    {viewing.title}
                  </h3>
                  {viewing.isPublished ? (
                    <V2StatusChip tone="success">已发布</V2StatusChip>
                  ) : null}
                  {viewing.aiScore !== null ? (
                    <V2StatusChip tone="accent">
                      总评 {Math.round(viewing.aiScore)}
                    </V2StatusChip>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
                  {viewing.sourceType} · {viewing.createdAt ? new Date(viewing.createdAt).toLocaleDateString("zh-CN") : ""}
                </p>
              </div>
              <button
                type="button"
                className="rounded-full p-1 text-[var(--kaypal-v3-muted)] hover:bg-[var(--kaypal-v3-paper-soft)]"
                onClick={() => setViewing(null)}
              >
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto p-5">
              {actionError && (
                <p className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-3 text-sm text-[var(--kaypal-v3-danger)]">
                  {actionError}
                </p>
              )}

              {viewing.summary || viewing.description ? (
                  <div>
                    <p className="mb-1 text-xs font-semibold text-[var(--kaypal-v3-muted)]">摘要</p>
                    <p className="text-sm leading-relaxed text-[var(--kaypal-v3-soft-ink)]">
                      {viewing.summary || viewing.description}
                    </p>
                  </div>
                ) : null}

              {viewing.keywords?.length ? (
                <div>
                  <p className="mb-2 text-xs font-semibold text-[var(--kaypal-v3-muted)]">关键词</p>
                  <div className="flex flex-wrap gap-2">
                    {viewing.keywords.map((kw) => (
                      <span
                        key={kw}
                        className="rounded-full bg-[var(--kaypal-v3-accent-soft)] px-3 py-1 text-xs font-medium text-[var(--kaypal-v3-accent-ink)]"
                      >
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {viewing.scoreDetails ? (
                <div>
                  <p className="mb-2 text-xs font-semibold text-[var(--kaypal-v3-muted)]">五维评分</p>
                  <div className="space-y-2">
                    {SCORE_LABELS.map(({ key, label }) => {
                      const value = viewing.scoreDetails?.[key] ?? 0;
                      // 单项满分 20（5 项合计 ≈ 总评 100），进度条按 20 分制渲染
                      return (
                        <div key={key} className="flex items-center gap-3">
                          <span className="w-16 text-xs text-[var(--kaypal-v3-muted)]">{label}</span>
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--kaypal-v3-paper-muted)]">
                            <div
                              className="h-full rounded-full bg-[var(--kaypal-v3-accent)]"
                              style={{ width: `${Math.min(100, (value / 20) * 100)}%` }}
                            />
                          </div>
                          <span className="w-12 text-right text-xs font-semibold text-[var(--kaypal-v3-ink)]">
                            {Math.round(value)}<span className="font-normal text-[var(--kaypal-v3-muted)]">/20</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {viewing.scoreReason ? (
                <div>
                  <p className="mb-1 text-xs font-semibold text-[var(--kaypal-v3-muted)]">评分理由</p>
                  <p className="text-sm leading-relaxed text-[var(--kaypal-v3-soft-ink)]">
                    {viewing.scoreReason}
                  </p>
                </div>
              ) : null}

              {viewing.materials?.length ? (
                <div>
                  <p className="mb-2 text-xs font-semibold text-[var(--kaypal-v3-muted)]">
                    关联素材（{viewing.materials.length}）
                  </p>
                  <div className="space-y-1.5">
                    {viewing.materials.slice(0, 5).map((m) => (
                      <p key={m.id} className="text-sm text-[var(--kaypal-v3-soft-ink)]">
                        · {m.title} <span className="text-xs text-[var(--kaypal-v3-muted)]">（{m.platform}）</span>
                      </p>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-[var(--kaypal-v3-border)] p-4">
              <V2GhostButton icon={RefreshCcw} loading={acting} onClick={handleRescore}>
                重新评分
              </V2GhostButton>
              <V2PrimaryButton icon={Send} loading={acting} onClick={handlePublishToggle}>
                {viewing.isPublished ? "取消发布" : "发布这个选题"}
              </V2PrimaryButton>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
