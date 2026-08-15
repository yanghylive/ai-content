"use client";

import { SkeletonRow } from "@/components/skeleton";

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
  lead: "线索",
  qualified: "有意向",
  proposal: "已报价",
  negotiation: "谈判中",
  won: "已成交",
  lost: "已流失",
};

/** 成交跟进——真实商机列表（不再写死） */
export function CrmCloserCenter() {
  const router = useRouter();
  const [items, setItems] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = (await api.get("/crm/opportunities?limit=50").catch(() => null)) as
        | { items?: Opportunity[] }
        | Opportunity[]
        | null;
      const list = Array.isArray(result) ? result : result?.items || [];
      setItems(list.filter((o) => o.stage !== "won" && o.stage !== "lost"));
    } catch (err: unknown) {
      setError(toPublicError(err, "商机读取失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totalAmount = items.reduce((sum, o) => sum + (o.expectedAmount || 0), 0);
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
                跟进中 {items.length} 个
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
            <p style={{ fontSize: 12, color: "#dc2626", marginBottom: 10 }}>{error}</p>
          ) : null}

          {loading ? (
            <div className="mx-card mx-list-card">
              <SkeletonRow width="70%" />
              <SkeletonRow width="58%" />
            </div>
          ) : items.length === 0 ? (
            <div className="mx-card mx-empty">
              <p>没有跟进中的商机</p>
              <p style={{ fontSize: 11, marginTop: 4 }}>在 CRM 里给客户建商机（意向/报价/谈判），会出现在这里</p>
              <button type="button" className="mx-btn-gold" style={{ marginTop: 12 }} onClick={() => router.push("/crm")}>去 CRM 建商机</button>
            </div>
          ) : (
            <div className="mx-card mx-list-card">
              {items.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className="mx-row"
                  style={{ width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer" }}
                  onClick={() => router.push(o.customerId ? `/crm/customer?id=${o.customerId}` : "/crm")}
                >
                  <span className="mx-row-ic" style={{ background: "rgba(37,99,235,.1)", color: "#2563eb", borderRadius: 999 }}>
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
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">成交跟进</h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              盯紧每一个快要成交的客户 · 跟进中 {items.length} 个
              {totalAmount > 0 ? ` · 共 ¥${totalAmount.toLocaleString()}` : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
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
          <div className="mx-auto h-7 w-7 animate-spin rounded-full border-2 border-[var(--kaypal-v3-accent)] border-t-transparent" />
        </div>
      ) : items.length === 0 ? (
        <V2EmptyState
          icon={Target}
          title="没有跟进中的商机"
          description="在 CRM 里给客户建商机（意向/报价/谈判），会出现在这里盯进度"
          action={
            <V2GhostButton onClick={() => router.push("/crm")}>去 CRM 建商机</V2GhostButton>
          }
        />
      ) : (
        <V2Section title={`跟进中（${items.length}）`}>
          <div className="flex flex-col gap-3">
            {items.map((o) => (
              <button
                key={o.id}
                type="button"
                className="kaypal-v3-panel flex items-center justify-between p-5 text-left transition hover:border-[var(--kaypal-v3-accent)]"
                onClick={() => router.push(o.customerId ? `/crm/customer?id=${o.customerId}` : "/crm")}
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
    </div>
  );
}
