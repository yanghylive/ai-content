"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  FolderOpen,
  Loader2,
  Play,
  RefreshCcw,
  Search,
  Trash2,
  XCircle,
} from "lucide-react";
import {
  V2Section,
  V2StatusChip,
  V2GhostButton,
  V2PrimaryButton,
  V2DangerButton,
  V2EmptyState,
  V2Input,
  V2Select,
} from "@/components/v2/ui-kit";
import {
  buildMaterialRiskConfirmation,
  materialsApi,
  type Material,
  type MaterialCollectStatus,
} from "@/lib/api/materials";
import { toPublicError } from "@/lib/public-error";

const STATUS_LABELS: Record<Material["status"], { label: string; tone: "success" | "warning" | "danger" }> = {
  unmined: { label: "待挖掘", tone: "warning" },
  mined: { label: "已挖掘", tone: "success" },
  failed: { label: "采集失败", tone: "danger" },
};

const PLATFORM_NAMES: Record<string, string> = {
  "36Kr": "36氪",
  Juejin: "掘金",
  Zhihu: "知乎",
  WeChat: "公众号",
  Tophub: "今日热榜",
  redfox: "外部数据",
  RedFox: "外部数据",
};

export function MaterialsCenter() {
  const router = useRouter();
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 筛选
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [query, setQuery] = useState("");

  // 采集
  const [collectStatus, setCollectStatus] = useState<MaterialCollectStatus | null>(null);
  const [collecting, setCollecting] = useState(false);
  const collectJobIdsRef = useRef<string[]>([]);

  // 删除
  const [deleteTarget, setDeleteTarget] = useState<Material | null>(null);
  const [deleting, setDeleting] = useState(false);
  // 无采集来源引导
  const [noSources, setNoSources] = useState(false);
  // 多选（批量删除用）
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);
  // 详情弹窗
  const [viewing, setViewing] = useState<Material | null>(null);

  const flash = (text: string) => {
    setNotice(text);
    setTimeout(() => setNotice(null), 3000);
  };

  const fetchMaterials = useCallback(async () => {
    try {
      const data = await materialsApi.list();
      setMaterials(
        Array.isArray(data) ? data : (data as { items?: Material[] }).items || [],
      );
    } catch (err: unknown) {
      console.error(toPublicError(err, "加载素材失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchCollectStatus = useCallback(async (silent = false) => {
    try {
      const status = await materialsApi.collectStatus(collectJobIdsRef.current);
      setCollectStatus(status);
      return status;
    } catch (err: unknown) {
      if (!silent) console.error(toPublicError(err, "采集状态读取失败"));
      return null;
    }
  }, []);

  useEffect(() => {
    void fetchMaterials();
    void fetchCollectStatus(true);
  }, [fetchMaterials, fetchCollectStatus]);

  /* 采集活跃时 3 秒轮询（与旧版一致） */
  useEffect(() => {
    if (!collectStatus?.active) return;
    const timer = setInterval(async () => {
      const status = await fetchCollectStatus(true);
      if (status && !status.active) {
        void fetchMaterials();
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [collectStatus?.active, fetchCollectStatus, fetchMaterials]);

  const handleCollect = async () => {
    setCollecting(true);
    setError(null);
    setNoSources(false);
    try {
      const result = await materialsApi.collect();
      collectJobIdsRef.current = result.jobIds || [];
      // 0 个来源：系统没配置内容来源，采集没东西可抓
      if (!result.jobCount) {
        setNoSources(true);
        return;
      }
      flash(`采集任务已创建（${result.jobCount} 个来源），正在自动采集`);
      await fetchCollectStatus();
    } catch (err: unknown) {
      const rawMessage = err instanceof Error ? err.message : "";
      setError(
        rawMessage
          ? `启动采集失败：${rawMessage}`
          : toPublicError(err, "启动采集失败，请稍后重试"),
      );
    } finally {
      setCollecting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setError(null);
    try {
      await materialsApi.remove(deleteTarget.id);
      setDeleteTarget(null);
      await fetchMaterials();
      flash("已删除");
    } catch (err: unknown) {
      setError(toPublicError(err, "删除失败，请稍后重试"));
    } finally {
      setDeleting(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((m) => m.id)));
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    setBatchDeleting(true);
    setError(null);
    try {
      await materialsApi.batchRemove(
        Array.from(selectedIds),
        buildMaterialRiskConfirmation("material-batch-delete", "high"),
      );
      setSelectedIds(new Set());
      await fetchMaterials();
      flash(`已删除 ${selectedIds.size} 条素材`);
    } catch (err: unknown) {
      const rawMessage = err instanceof Error ? err.message : "";
      setError(rawMessage || toPublicError(err, "批量删除失败"));
    } finally {
      setBatchDeleting(false);
    }
  };

  const platforms = useMemo(() => {
    const set = new Set(materials.map((m) => m.platform).filter(Boolean));
    return Array.from(set);
  }, [materials]);

  const filtered = useMemo(() => {
    return materials.filter((m) => {
      if (statusFilter !== "all" && m.status !== statusFilter) return false;
      if (platformFilter !== "all" && m.platform !== platformFilter) return false;
      if (query.trim()) {
        const q = query.trim().toLowerCase();
        const haystack = `${m.title} ${m.author} ${m.summary || ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [materials, statusFilter, platformFilter, query]);

  const collecting_ = collectStatus?.active;

  return (
    <div className="flex flex-col gap-6">
      {/* 顶部 */}
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">素材库</h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              系统自动采集的内容素材，可直接用于创作
            </p>
          </div>
          <V2PrimaryButton
            icon={collecting ? Loader2 : Play}
            loading={collecting}
            disabled={collecting_}
            onClick={handleCollect}
          >
            {collecting ? "正在启动..." : collecting_ ? "采集中..." : "开始采集"}
          </V2PrimaryButton>
        </div>
      </section>

      {notice && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-success)]">{notice}</p>
        </div>
      )}
      {noSources && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-accent-border)] bg-[var(--kaypal-v3-accent-soft)] p-5">
          <div className="flex items-start gap-3">
            <FolderOpen className="mt-0.5 h-5 w-5 text-[var(--kaypal-v3-accent-ink)]" />
            <div className="flex-1">
              <p className="font-medium text-[var(--kaypal-v3-ink)]">
                还没有配置采集来源
              </p>
              <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
                采集是从「内容来源」里抓内容的。先去设置里添加来源（比如 36氪、知乎热榜），回来再点采集。
              </p>
              <div className="mt-3">
                <V2PrimaryButton onClick={() => router.push("/settings?legacy=1")}>
                  去添加内容来源
                </V2PrimaryButton>
              </div>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      {/* 采集进度面板 */}
      {collectStatus && (collecting_ || collectStatus.counts.completed > 0 || collectStatus.counts.failed > 0) && (
        <div className="kaypal-v3-panel p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {collecting_ ? (
                <Loader2 className="h-5 w-5 animate-spin text-[var(--kaypal-v3-accent)]" />
              ) : collectStatus.counts.failed > 0 ? (
                <XCircle className="h-5 w-5 text-[var(--kaypal-v3-danger)]" />
              ) : (
                <CheckCircle2 className="h-5 w-5 text-[var(--kaypal-v3-success)]" />
              )}
              <p className="font-medium text-[var(--kaypal-v3-ink)]">
                {collecting_
                  ? `正在采集... 队列 ${collectStatus.pendingCount} 个`
                  : "最近一轮采集"}
              </p>
            </div>
            <V2GhostButton icon={RefreshCcw} onClick={() => void fetchCollectStatus()}>
              刷新
            </V2GhostButton>
          </div>
          <div className="mt-4 grid grid-cols-4 gap-3 text-center">
            <div>
              <p className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">
                {collectStatus.counts.active + collectStatus.counts.waiting}
              </p>
              <p className="text-xs text-[var(--kaypal-v3-muted)]">进行中</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-[var(--kaypal-v3-success)]">
                {collectStatus.counts.completed}
              </p>
              <p className="text-xs text-[var(--kaypal-v3-muted)]">完成</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-[var(--kaypal-v3-danger)]">
                {collectStatus.counts.failed}
              </p>
              <p className="text-xs text-[var(--kaypal-v3-muted)]">失败</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">
                {collectStatus.counts.delayed}
              </p>
              <p className="text-xs text-[var(--kaypal-v3-muted)]">等待重试</p>
            </div>
          </div>
        </div>
      )}

      {/* 筛选 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1" style={{ minWidth: 200 }}>
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--kaypal-v3-muted)]" />
          <V2Input
            placeholder="搜标题、作者..."
            className="pl-9"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="w-36">
          <V2Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">全部状态</option>
            <option value="unmined">待挖掘</option>
            <option value="mined">已挖掘</option>
            <option value="failed">采集失败</option>
          </V2Select>
        </div>
        <div className="w-36">
          <V2Select value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)}>
            <option value="all">全部来源</option>
            {platforms.map((p) => (
              <option key={p} value={p}>
                {PLATFORM_NAMES[p] || p}
              </option>
            ))}
          </V2Select>
        </div>
      </div>

      {/* 素材列表 */}
      <V2Section padding={false}>
        {loading ? (
          <div className="p-12 text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-[var(--kaypal-v3-accent)] border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <V2EmptyState
            icon={FolderOpen}
            title={materials.length === 0 ? "还没有素材" : "筛选条件下没有素材"}
            description={materials.length === 0 ? "点右上角「开始采集」，系统自动帮你找素材" : "换个筛选条件试试"}
            action={
              materials.length === 0 ? (
                <V2PrimaryButton icon={Play} onClick={handleCollect}>
                  开始采集
                </V2PrimaryButton>
              ) : undefined
            }
          />
        ) : (
          <div className="divide-y divide-[var(--kaypal-v3-border)]">
            {filtered.map((material) => {
              const status = STATUS_LABELS[material.status];
              return (
                <div key={material.id} className="flex items-center justify-between p-5">
                  <div className="flex items-center gap-3 flex-1">
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0 accent-[var(--kaypal-v3-accent)]"
                      checked={selectedIds.has(material.id)}
                      onChange={() => toggleSelect(material.id)}
                    />
                    <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="font-medium text-[var(--kaypal-v3-ink)] transition hover:text-[var(--kaypal-v3-accent-ink)] hover:underline"
                        onClick={() => setViewing(material)}
                      >
                        {material.title || "未命名"}
                      </button>
                      <V2StatusChip tone={status.tone}>{status.label}</V2StatusChip>
                    </div>
                    <p className="mt-1 line-clamp-1 text-sm text-[var(--kaypal-v3-muted)]">
                      {PLATFORM_NAMES[material.platform] || material.platform}
                      {material.author ? ` · ${material.author}` : ""}
                      {material.publishDate
                        ? ` · ${new Date(material.publishDate).toLocaleDateString("zh-CN")}`
                        : ""}
                      {material.summary ? ` · ${material.summary}` : ""}
                    </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {deleteTarget?.id === material.id ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-[var(--kaypal-v3-danger)]">确认删除？</span>
                        <V2DangerButton loading={deleting} onClick={() => void handleDelete()}>
                          确认
                        </V2DangerButton>
                        <V2GhostButton onClick={() => setDeleteTarget(null)}>取消</V2GhostButton>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-danger-soft)] hover:text-[var(--kaypal-v3-danger)]"
                        onClick={() => setDeleteTarget(material)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </V2Section>

      <section className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-[var(--kaypal-v3-muted)]">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--kaypal-v3-accent)]"
              checked={filtered.length > 0 && selectedIds.size === filtered.length}
              onChange={toggleSelectAll}
            />
            全选
          </label>
          <span className="text-sm text-[var(--kaypal-v3-muted)]">
            共 {filtered.length} 条{selectedIds.size > 0 ? `，已选 ${selectedIds.size}` : ""}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <V2DangerButton loading={batchDeleting} onClick={() => void handleBatchDelete()}>
              {batchDeleting ? "正在删除..." : `删除选中（${selectedIds.size}）`}
            </V2DangerButton>
          )}
          <V2GhostButton icon={RefreshCcw} onClick={() => void fetchMaterials()}>
            刷新
          </V2GhostButton>
        </div>
      </section>

      {/* 素材详情弹窗 */}
      {viewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-[var(--kaypal-v3-radius)] bg-[var(--kaypal-v3-paper)] shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--kaypal-v3-border)] p-5">
              <div className="flex-1">
                <h3 className="text-lg font-bold text-[var(--kaypal-v3-ink)]">
                  {viewing.title || "未命名"}
                </h3>
                <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
                  {PLATFORM_NAMES[viewing.platform] || viewing.platform}
                  {viewing.author ? ` · ${viewing.author}` : ""}
                  {viewing.publishDate
                    ? ` · ${new Date(viewing.publishDate).toLocaleDateString("zh-CN")}`
                    : ""}
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
            <div className="flex-1 overflow-y-auto p-5">
              {viewing.summary && (
                <p className="mb-4 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-paper-soft)] p-3 text-sm text-[var(--kaypal-v3-soft-ink)]">
                  {viewing.summary}
                </p>
              )}
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--kaypal-v3-soft-ink)]">
                {viewing.content || "（无正文内容）"}
              </div>
            </div>
            {viewing.sourceUrl && (
              <div className="border-t border-[var(--kaypal-v3-border)] p-4">
                <a
                  href={viewing.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-[var(--kaypal-v3-accent-ink)] hover:underline"
                >
                  查看原文 →
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
