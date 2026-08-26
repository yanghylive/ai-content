"use client";

import { SkeletonList, SkeletonRow } from "@/components/skeleton";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCcw, Target } from "lucide-react";
import { api } from "@/lib/api/client";
import { toPublicError } from "@/lib/public-error";
import {
  V2EmptyState,
  V2GhostButton,
  V2PrimaryButton,
  V2Section,
  V2StatusChip,
} from "@/components/v2/ui-kit";
import { useIsMobile } from "@/lib/hooks/use-media-query";
import { V2BackButton } from "@/components/v2/v2-back-button";
import { OpportunityDetailModal } from "./opportunity-detail";

interface Opportunity {
  id: string;
  name: string;
  stage?: string;
  expectedAmount?: number | null;
  customerId?: string | null;
  customerName?: string | null;
  nextAction?: string | null;
}

const STAGE_LABELS: Record<string, string> = {
  new: "新商机",
  qualified: "资格确认",
  discovery: "发现阶段",
  proposal: "提案",
  negotiation: "谈判",
  won: "成交",
  lost: "失单",
  nurture: "暂缓",
};

/** 看板列顺序（报告 7.4：商机 Kanban 按阶段分列） */
const STAGE_ORDER = [
  "new",
  "qualified",
  "discovery",
  "proposal",
  "negotiation",
  "won",
  "lost",
  "nurture",
] as const;

/** 成交跟进——真实商机列表 + 看板（不再写死） */
export function CrmCloserCenter() {
  const router = useRouter();
  const [items, setItems] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "kanban">("list");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = (await api.get("/crm/opportunities?limit=200")) as
        | { items?: Opportunity[] }
        | Opportunity[];
      const list = Array.isArray(result) ? result : result.items || [];
      // 保留全部阶段（看板要按阶段分列），列表视图再过滤跟进中
      setItems(list);
    } catch (err: unknown) {
      setError(toPublicError(err, "商机读取失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activeItems = items.filter(
    (o) => o.stage !== "won" && o.stage !== "lost",
  );
  const totalAmount = activeItems.reduce(
    (sum, o) => sum + (o.expectedAmount || 0),
    0,
  );
  const isMobile = useIsMobile();

  if (isMobile) {
    const stageBadge = (stage?: string) =>
      stage === "negotiation" ? "mx-badge mx-badge-gold"
        : stage === "proposal" ? "mx-badge mx-badge-blue"
          : "mx-badge";
    return (
      <div className="kx-mobile-ambient">
        <div className="mx-px" style={{ marginTop: 8 }}>
          <V2BackButton />
        </div>
        <header className="mx-header">
          <div className="mx-header-row">
            <div style={{ minWidth: 0 }}>
              <div className="mx-brand-eyebrow">JIUZHANG AI</div>
              <h1 className="mx-page-title">成交跟进</h1>
              <p className="mx-page-sub">
                跟进中 {activeItems.length} 个
                {totalAmount > 0 ? ` · 共 ¥${totalAmount.toLocaleString()}` : ""}
              </p>
            </div>
            <button
              type="button"
              className="mx-btn-gold"
              style={{ fontSize: 12, padding: "8px 14px", whiteSpace: "nowrap" }}
              onClick={() => router.push("/crm")}
            >
              去 CRM
            </button>
          </div>
        </header>

        <div className="mx-px" style={{ paddingTop: 14, paddingBottom: 28 }}>
          {error ? (
            <p style={{ fontSize: 12, color: "var(--kaypal-v3-danger)", marginBottom: 10 }}>{error}</p>
          ) : null}

          {loading ? (
            <div className="mx-card mx-list-card">
              <SkeletonRow width="70%" />
              <SkeletonRow width="58%" />
            </div>
          ) : activeItems.length === 0 ? (
            <div className="mx-card mx-empty">
              <p>没有跟进中的商机</p>
              <p style={{ fontSize: 11, marginTop: 4 }}>在 CRM 里给客户建商机（意向/报价/谈判），会出现在这里</p>
              <button type="button" className="mx-btn-gold" style={{ marginTop: 12 }} onClick={() => router.push("/crm")}>去 CRM 建商机</button>
            </div>
          ) : (
            <div className="mx-card mx-list-card">
              {activeItems.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className="mx-row"
                  style={{ width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer" }}
                  onClick={() => setSelectedId(o.id)}
                >
                  <span className="mx-row-ic" style={{ background: "rgba(37,99,235,.1)", color: "var(--kaypal-v3-cobalt)", borderRadius: 999 }}>
                    <Target size={18} strokeWidth={1.8} />
                  </span>
                  <div className="mx-row-main">
                    <div className="mx-row-title">{o.name}</div>
                    <div className="mx-row-desc">
                      {o.customerName ? `${o.customerName} · ` : ""}
                      {o.expectedAmount ? `¥${o.expectedAmount.toLocaleString()}` : "金额未填"}
                      {o.nextAction ? ` · 下一步:${o.nextAction}` : ""}
                    </div>
                  </div>
                  <div className="mx-row-right">
                    <span className={stageBadge(o.stage)}>{STAGE_LABELS[o.stage || ""] || o.stage || "跟进中"}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        {selectedId && (
          <OpportunityDetailModal
            opportunityId={selectedId}
            onClose={() => setSelectedId(null)}
            onChanged={() => void load()}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <V2BackButton />
      <section className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="kaypal-v3-icon-tile h-12 w-12">
            <Target className="h-6 w-6" />
          </div>
          <div>
            <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">成交跟进</h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              盯紧每一个快要成交的客户 · 跟进中 {activeItems.length} 个
              {totalAmount > 0 ? ` · 共 ¥${totalAmount.toLocaleString()}` : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* 列表 / 看板 切换（报告 7.4） */}
          <div className="flex items-center gap-1 rounded-[var(--kaypal-v3-radius)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-1">
            {(["list", "kanban"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setViewMode(m)}
                className={`rounded-[var(--kaypal-v3-radius-sm)] px-3 py-1.5 text-sm font-medium transition ${
                  viewMode === m
                    ? "bg-[var(--kaypal-v3-accent)] text-white"
                    : "text-[var(--kaypal-v3-soft-ink)] hover:bg-[var(--kaypal-v3-paper-muted)]"
                }`}
              >
                {m === "list" ? "列表" : "看板"}
              </button>
            ))}
          </div>
          <V2GhostButton icon={RefreshCcw} onClick={() => void load()}>刷新</V2GhostButton>
          <V2PrimaryButton onClick={() => router.push("/crm")}>去 CRM</V2PrimaryButton>
        </div>
      </section>

      {error && (
        <p className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4 text-sm text-[var(--kaypal-v3-danger)]">
          {error}
        </p>
      )}

      {loading ? (
        <div className="py-10 text-center">
          <SkeletonList rows={5} />
        </div>
      ) : viewMode === "kanban" ? (
        <OpportunityKanban items={items} onSelect={setSelectedId} />
      ) : activeItems.length === 0 ? (
        <V2EmptyState
          icon={Target}
          title="没有跟进中的商机"
          description="在 CRM 里给客户建商机（意向/报价/谈判），会出现在这里盯进度"
          action={
            <V2GhostButton onClick={() => router.push("/crm")}>去 CRM 建商机</V2GhostButton>
          }
        />
      ) : (
        <V2Section title={`跟进中（${activeItems.length}）`}>
          <div className="flex flex-col gap-3">
            {activeItems.map((o) => (
              <button
                key={o.id}
                type="button"
                className="kaypal-v3-panel flex items-center justify-between p-5 text-left transition hover:border-[var(--kaypal-v3-accent)]"
                onClick={() => setSelectedId(o.id)}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate font-medium text-[var(--kaypal-v3-ink)]">{o.name}</h3>
                    <V2StatusChip tone={o.stage === "negotiation" ? "warning" : o.stage === "proposal" ? "accent" : "muted"}>
                      {STAGE_LABELS[o.stage || ""] || o.stage || "跟进中"}
                    </V2StatusChip>
                  </div>
                  <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
                    {o.customerName ? `${o.customerName} · ` : ""}
                    {o.expectedAmount ? `¥${o.expectedAmount.toLocaleString()}` : "金额未填"}
                    {o.nextAction ? ` · 下一步:${o.nextAction}` : ""}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </V2Section>
      )}

      {selectedId && (
        <OpportunityDetailModal
          opportunityId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
}

/** 商机看板（报告 7.4）：按 8 阶段分列，点卡片打开商机详情推进阶段 */
function OpportunityKanban({
  items,
  onSelect,
}: {
  items: Opportunity[];
  onSelect: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <div className="flex gap-3" style={{ minWidth: 8 * 220 }}>
        {STAGE_ORDER.map((stage) => {
          const stageItems = items.filter((o) => (o.stage || "new") === stage);
          const stageTotal = stageItems.reduce(
            (sum, o) => sum + (o.expectedAmount || 0),
            0,
          );
          return (
            <div
              key={stage}
              className="kaypal-v3-surface flex w-[220px] shrink-0 flex-col p-3"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold text-[var(--kaypal-v3-ink)]">
                  {STAGE_LABELS[stage]}
                </span>
                <span className="rounded-full bg-[var(--kaypal-v3-paper-muted)] px-2 py-0.5 text-xs text-[var(--kaypal-v3-muted)]">
                  {stageItems.length}
                </span>
              </div>
              {stageTotal > 0 && (
                <p className="mb-2 text-xs text-[var(--kaypal-v3-muted)]">
                  ¥{stageTotal.toLocaleString()}
                </p>
              )}
              <div className="flex flex-col gap-2">
                {stageItems.length === 0 ? (
                  <p className="py-3 text-center text-xs text-[var(--kaypal-v3-muted)]">
                    暂无
                  </p>
                ) : (
                  stageItems.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      className="kaypal-v3-panel p-3 text-left transition hover:border-[var(--kaypal-v3-accent)]"
                      onClick={() => onSelect(o.id)}
                    >
                      <p className="truncate text-sm font-medium text-[var(--kaypal-v3-ink)]">
                        {o.name}
                      </p>
                      <p className="mt-1 truncate text-xs text-[var(--kaypal-v3-muted)]">
                        {o.customerName || "未关联客户"}
                        {o.expectedAmount ? ` · ¥${o.expectedAmount.toLocaleString()}` : ""}
                      </p>
                    </button>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
