"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Lightbulb, Loader2, RefreshCcw, Send, XCircle } from "lucide-react";
import { ResourceCenter, type ResourceItem } from "@/components/v2/resource-center";
import { topicsApi, type Topic } from "@/lib/api/topics";
import { toActionableError, toPublicError } from "@/lib/public-error";
import { V2GhostButton, V2PrimaryButton, V2StatusChip } from "@/components/v2/ui-kit";

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
