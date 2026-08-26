"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  Mail,
  Pencil,
  Send,
  MessageSquareText,
  Phone,
  User,
  UserRound,
  Building2,
} from "lucide-react";
import {
  V2Section,
  V2StatusChip,
  V2GhostButton,
  V2EmptyState,
  V2PrimaryButton,
} from "@/components/v2/ui-kit";
import { getCrmCustomer, prepareCrmWelcomeMessage, type CrmCustomer } from "@/lib/api/crm";
import { toPublicError } from "@/lib/public-error";
import { useIsMobile } from "@/lib/hooks/use-media-query";
import { SkeletonList } from "@/components/skeleton";

const STATUS_LABELS: Record<string, { label: string; tone: "success" | "warning" | "accent" | "muted" }> = {
  new: { label: "新客户", tone: "accent" },
  follow_up: { label: "跟进中", tone: "warning" },
  following: { label: "跟进中", tone: "warning" },
  won: { label: "已成交", tone: "success" },
  lost: { label: "已流失", tone: "muted" },
};

export function CustomerProfile({ customerId }: { customerId: string }) {
  const router = useRouter();
  const [customer, setCustomer] = useState<CrmCustomer | null>(null);
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCustomer = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getCrmCustomer(customerId);
      setCustomer(data);
    } catch (err: unknown) {
      setError(toPublicError(err, "加载客户详情失败"));
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  /* 必须在所有 early return 之前调用（React Hooks 规则） */
  const isMobile = useIsMobile();

  useEffect(() => {
    void fetchCustomer();
  }, [fetchCustomer]);

  // 抖音测试发送：先准备欢迎消息，再跳到私信台
  const handleTestSend = async () => {
    if (!customer) return;
    setPreparing(true);
    setError(null);
    try {
      const preparation = await prepareCrmWelcomeMessage(customer.id, {
        channel: "douyin",
      });
      router.push(
        `/engagement/douyin-messages?crmCustomerId=${encodeURIComponent(customer.id)}&crmPreparationId=${encodeURIComponent(preparation.id)}`,
      );
    } catch (err: unknown) {
      setError(toPublicError(err, "准备测试发送失败，请稍后重试"));
    } finally {
      setPreparing(false);
    }
  };

  if (loading) {
    return (
      <div className="kaypal-v3-panel p-12 text-center">
        <SkeletonList rows={5} />
      </div>
    );
  }

  if (!customer) {
    return (
      <V2Section>
        <V2EmptyState
          icon={UserRound}
          title="没找到这个客户"
          action={
            <V2GhostButton icon={ArrowLeft} onClick={() => router.push("/crm")}>
              返回客户列表
            </V2GhostButton>
          }
        />
      </V2Section>
    );
  }

  const status = STATUS_LABELS[customer.status] || {
    label: customer.status,
    tone: "muted" as const,
  };

  /* 移动端（<768px）：明德 VP 风格，复用同一批 state/handlers */
  if (isMobile) {
    const contactRows = [
      { label: "电话", value: customer.phone },
      { label: "微信", value: customer.wechat },
      { label: "邮箱", value: customer.email },
      { label: "公司", value: customer.companyName },
    ];
    return (
      <div className="kx-mobile-ambient">
        <header className="mx-header">
          <div className="mx-header-row">
            <button type="button" className="mx-control" aria-label="返回" style={{ width: 38, height: 38, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--kaypal-v3-ink)", flexShrink: 0 }} onClick={() => router.push("/crm")}>
              <ArrowLeft width={18} height={18} />
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="mx-page-sub" style={{ marginTop: 0, fontSize: 11, color: "#a9671f", fontWeight: 700, letterSpacing: ".12em" }}>客户详情</div>
              <h1 className="mx-page-title" style={{ fontSize: 19 }}>{customer.displayName}</h1>
            </div>
          </div>
        </header>

        <section className="mx-px" style={{ marginTop: 14, paddingBottom: 28 }}>
          {error && (
            <div style={{ marginBottom: 12, padding: 10, borderRadius: 10, background: "rgba(239,68,68,.09)", fontSize: 12, color: "var(--kaypal-v3-danger)" }}>{error}</div>
          )}

          {/* 名片 */}
          <div className="mx-hero" style={{ borderRadius: 22, padding: 18 }}>
            <div className="mx-hero-ring" style={{ width: 110, height: 110, top: -30, right: -22 }} />
            <div style={{ position: "relative", zIndex: 2, display: "flex", alignItems: "center", gap: 14 }}>
              <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 56, height: 56, borderRadius: 999, flexShrink: 0, background: "rgba(255,255,255,.14)" }}>
                <User width={26} height={26} style={{ color: "var(--kaypal-v3-amber)" }} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 19, fontWeight: 700, color: "#fff" }}>{customer.displayName}</span>
                  <span className="mx-badge mx-badge-white">{status.label}</span>
                  {customer.score > 0 ? <span className="mx-gold-text" style={{ fontSize: 13, fontWeight: 700 }}>评分 {customer.score}</span> : null}
                </div>
                <p style={{ fontSize: 12, color: "rgba(219,234,254,.72)", marginTop: 4 }}>
                  {customer.title || ""}
                  {customer.companyName ? ` · ${customer.companyName}` : ""}
                  {customer.sourcePlatform ? ` · 来自${customer.sourcePlatform}` : ""}
                </p>
              </div>
            </div>
          </div>

          {/* 联系方式 */}
          <div className="mx-card mx-list-card" style={{ marginTop: 14 }}>
            {contactRows.map((row) => (
              <div className="mx-row" key={row.label}>
                <span className="mx-row-ic" style={{ background: "rgba(37,99,235,.1)", color: "var(--kaypal-v3-cobalt)" }}>
                  <Mail width={18} height={18} />
                </span>
                <div className="mx-row-main">
                  <div className="mx-row-title">{row.label}</div>
                  <div className="mx-row-desc">{row.value || "—"}</div>
                </div>
              </div>
            ))}
          </div>

          {/* 客户来源 */}
          {(customer.sourceText || customer.sourceKeyword) ? (
            <div className="mx-card" style={{ marginTop: 14, padding: 16 }}>
              <div className="mx-section-title" style={{ marginBottom: 10, fontSize: 15 }}>
                <span className="mx-sec-icon"><Pencil /></span>
                客户来源
              </div>
              {customer.sourceKeyword ? (
                <p style={{ fontSize: 12.5, color: "var(--kaypal-v3-soft-ink)" }}>匹配关键词：{customer.matchedKeyword || customer.sourceKeyword}</p>
              ) : null}
              {customer.sourceText ? (
                <p style={{ fontSize: 12.5, lineHeight: 1.7, color: "var(--kaypal-v3-soft-ink)", marginTop: 8, padding: 10, borderRadius: 10, background: "rgba(148,163,184,.1)" }}>{customer.sourceText}</p>
              ) : null}
            </div>
          ) : null}

          {/* 最新互动 */}
          {customer.latestReply ? (
            <div className="mx-card" style={{ marginTop: 14, padding: 16 }}>
              <div className="mx-section-title" style={{ marginBottom: 10, fontSize: 15 }}>
                <span className="mx-sec-icon"><Send /></span>
                最新互动
              </div>
              <p style={{ fontSize: 12.5, lineHeight: 1.7, color: "var(--kaypal-v3-soft-ink)" }}>{customer.latestReply}</p>
            </div>
          ) : null}

          {/* 标签 */}
          {customer.tags && customer.tags.length > 0 ? (
            <div style={{ marginTop: 14 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: "var(--kaypal-v3-muted)", marginBottom: 8 }}>标签</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {customer.tags.map((tag) => <span key={tag} className="mx-badge mx-badge-gold">{tag}</span>)}
              </div>
            </div>
          ) : null}

          {/* 操作 */}
          <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
            <button type="button" className="mx-btn-gold" style={{ flex: 1.4, fontSize: 12, padding: "11px 0" }} disabled={preparing} onClick={handleTestSend}>
              {preparing ? "正在准备…" : "抖音测试发送"}
            </button>
            <button type="button" style={{ flex: 1, fontSize: 12, padding: "11px 0", background: "var(--kaypal-v3-field-bg)", color: "var(--kaypal-v3-soft-ink)", border: "1px solid var(--kaypal-v3-border)" }} onClick={() => router.push("/crm")}>返回列表</button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* 客户名片 */}
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)] hover:text-[var(--kaypal-v3-ink)]"
            onClick={() => router.push("/crm")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--kaypal-v3-accent-soft)]">
            <UserRound className="h-7 w-7 text-[var(--kaypal-v3-accent-ink)]" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">
                {customer.displayName}
              </h1>
              <V2StatusChip tone={status.tone}>{status.label}</V2StatusChip>
              {customer.score > 0 && (
                <span className="text-sm font-medium text-[var(--kaypal-v3-amber)]">
                  评分 {customer.score}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              {customer.title || ""}
              {customer.companyName ? ` · ${customer.companyName}` : ""}
              {customer.sourcePlatform ? ` · 来自${customer.sourcePlatform}` : ""}
            </p>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      {/* 联系方式 */}
      <V2Section title="联系方式" padding={false}>
        <div className="divide-y divide-[var(--kaypal-v3-border)]">
          {[
            { icon: Phone, label: "电话", value: customer.phone },
            { icon: MessageSquareText, label: "微信", value: customer.wechat },
            { icon: Mail, label: "邮箱", value: customer.email },
            { icon: Building2, label: "公司", value: customer.companyName },
          ].map(({ icon: Icon, label, value }) => (
            <div key={label} className="flex items-center gap-4 p-4">
              <Icon className="h-5 w-5 text-[var(--kaypal-v3-muted)]" />
              <span className="w-16 text-sm text-[var(--kaypal-v3-muted)]">{label}</span>
              <span className="text-sm font-medium text-[var(--kaypal-v3-ink)]">
                {value || "—"}
              </span>
            </div>
          ))}
        </div>
      </V2Section>

      {/* 来源 */}
      {(customer.sourceText || customer.sourceKeyword) && (
        <V2Section title="客户来源">
          {customer.sourceKeyword && (
            <p className="text-sm text-[var(--kaypal-v3-soft-ink)]">
              匹配关键词：{customer.matchedKeyword || customer.sourceKeyword}
            </p>
          )}
          {customer.sourceText && (
            <p className="mt-2 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-paper-soft)] p-3 text-sm text-[var(--kaypal-v3-soft-ink)]">
              {customer.sourceText}
            </p>
          )}
        </V2Section>
      )}

      {/* 最新互动 */}
      {customer.latestReply && (
        <V2Section title="最新互动">
          <p className="text-sm text-[var(--kaypal-v3-soft-ink)]">{customer.latestReply}</p>
        </V2Section>
      )}

      {/* 标签 */}
      {customer.tags && customer.tags.length > 0 && (
        <V2Section title="标签">
          <div className="flex flex-wrap gap-2">
            {customer.tags.map((tag) => (
              <V2StatusChip key={tag} tone="accent">
                {tag}
              </V2StatusChip>
            ))}
          </div>
        </V2Section>
      )}

      <section className="flex items-center justify-between">
        <V2GhostButton icon={ArrowLeft} onClick={() => router.push("/crm")}>
          返回客户列表
        </V2GhostButton>
        <V2PrimaryButton
          icon={preparing ? Loader2 : Send}
          loading={preparing}
          onClick={handleTestSend}
        >
          {preparing ? "正在准备..." : "抖音测试发送"}
        </V2PrimaryButton>
      </section>
    </div>
  );
}
