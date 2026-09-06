"use client";

import { SkeletonRow } from "@/components/skeleton";

import { BrandLogo } from "@/components/brand-logo";

import React from "react";
import { useRouter } from "next/navigation";
import { INTERACTION_CHANNELS } from "@/lib/nav-registry";
import { ScenePage } from "@/components/shell/scene-page";
import { ShellIcon } from "@/components/shell/icons";
import { BrandIcon, type BrandIconName } from "@/components/shell/brand-icons";
import { localEngineApi, type AgentConfirmation } from "@/lib/api/local-engine";
import { statsApi } from "@/lib/api/stats";
import { useIsMobile } from "@/lib/hooks/use-media-query";

export default function MessageScene() {
  const router = useRouter();
  const [waitingCount, setWaitingCount] = React.useState(0);
  const [confirmations, setConfirmations] = React.useState<AgentConfirmation[]>([]);
  const [confirmationsLoading, setConfirmationsLoading] = React.useState(true);
  const isMobile = useIsMobile();

  React.useEffect(() => {
    let active = true;
    // 待确认徽章数：统一走后端 StatsSnapshot（approval 域，后端 count 口径）
    statsApi
      .snapshot("approval")
      .then((snap) => {
        if (!active) return;
        const waiting = snap?.metrics?.find(
          (m) => m.key === "approval.waiting_tasks",
        )?.value;
        setWaitingCount(typeof waiting === "number" ? waiting : 0);
      })
      .catch(() => undefined);

    localEngineApi
      .confirmations()
      .then((items) => {
        if (!active) return;
        setConfirmations(
          (Array.isArray(items) ? items : []).filter(
            (c) => c.status === "pending",
          ),
        );
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setConfirmationsLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  if (isMobile) {
    return (
      <MobileMessageView
        router={router}
        waitingCount={waitingCount}
        confirmations={confirmations}
        confirmationsLoading={confirmationsLoading}
      />
    );
  }

  return (
    <div className="kx-view">
      <ScenePage
        title="消息"
        sub="所有渠道的客户消息，一个地方处理"
        before={
          <div style={{ marginTop: 8 }}>
            <div className="kx-section-title">
              <BrandIcon name="inbox" size={20} />
              统一收件箱
            </div>
            <button
              type="button"
              className="kx-agg-card"
              style={{ width: "100%", textAlign: "left" }}
              onClick={() => router.push("/engagement")}
            >
              <div className="kx-agg-ico kx-agg-ico-bare" aria-hidden="true">
                <BrandIcon name="inbox" size={32} tone="gold" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="kx-agg-title">查看全部客户消息</div>
                <div className="kx-agg-desc">评论、私信、转人工，一个收件箱集中处理</div>
              </div>
            </button>
          </div>
        }
        hint={
          waitingCount > 0
            ? {
                brand: "replyPen",
                text: `${waitingCount} 条回复等你确认，AI 已写好草稿`,
                actionLabel: "去确认",
                href: "/tasks/confirmations",
              }
            : undefined
        }
        cards={INTERACTION_CHANNELS.filter((ch) => ch.key !== "inbox").map((ch) => ({
          icon: ch.icon,
          brand: CHANNEL_BRAND[ch.key],
          tint: ch.tint,
          title: ch.title,
          desc: ch.desc,
          href: ch.href,
          badge:
            ch.key === "inbox" && waitingCount > 0
              ? `${waitingCount} 待确认`
              : undefined,
        }))}
      />
    </div>
  );
}

/* ================= 移动端视图（<768px，明德 VP 风格） ================= */

/** 移动端渠道：由 INTERACTION_CHANNELS 派生（与桌面 cards 同源，防止双份漂移） */
/** 消息渠道 key -> 品牌图形(语义集中在渲染层,不动 nav-registry 共用数据) */
const CHANNEL_BRAND: Record<string, BrandIconName> = {
  inbox: "inbox",
  "ai-service": "botHead",
  "douyin-messages": "douyin",
  "channel-messages": "channelVideo",
  wechat: "wechat",
  "wecom-assistant": "wecom",
  reply: "replyPen",
  records: "historyClock",
  "wechat-plans": "groupSend",
};

const MOBILE_CHANNELS = INTERACTION_CHANNELS.map((ch) => ({
  label: ch.title,
  sub: ch.sub,
  icon: ch.icon,
  brand: ch.brand,
  brandIcon: CHANNEL_BRAND[ch.key],
  href: ch.href,
}));

function riskTint(level: string): string {
  if (level === "critical" || level === "high") return "mx-badge mx-badge-red";
  if (level === "medium") return "mx-badge mx-badge-gold";
  return "mx-badge mx-badge-blue";
}

function riskLabel(level: string): string {
  if (level === "critical") return "高危";
  if (level === "high") return "高风险";
  if (level === "medium") return "中风险";
  return "低风险";
}

function MobileMessageView({
  router,
  waitingCount,
  confirmations,
  confirmationsLoading,
}: {
  router: ReturnType<typeof useRouter>;
  waitingCount: number;
  confirmations: AgentConfirmation[];
  confirmationsLoading: boolean;
}) {
  const pending = confirmations;

  return (
    <div>
      {/* 页面头 */}
      <header className="mx-header">
        <div className="mx-header-row">
          <div>
            <div className="mx-brand-eyebrow">
              <BrandLogo />
              JIUZHANG AI
            </div>
            <h1 className="mx-page-title">消息</h1>
            <p className="mx-page-sub">会话 · 待确认 · 互动记录</p>
          </div>
          <button
            type="button"
            className="mx-control"
            aria-label="搜索消息/联系人"
            title="搜索消息/联系人"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              height: 36,
              padding: "0 12px",
              borderRadius: 999,
              color: "var(--kaypal-v3-accent)",
              fontSize: 12,
              flexShrink: 0,
            }}
            onClick={() => router.push("/engagement/records")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="15" height="15"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
            <span style={{ color: "var(--kaypal-v3-accent)", opacity: 0.55, whiteSpace: "nowrap" }}>搜索消息/联系人</span>
          </button>
        </div>
      </header>

      {/* 待确认 hero */}
      <section className="mx-px" style={{ marginTop: 14 }}>
        <div className="mx-hero" style={{ padding: 20 }}>
          <div className="mx-hero-ring" style={{ width: 130, height: 130, top: -34, right: -26 }} />
          <div className="mx-hero-ring" style={{ width: 82, height: 82, top: 14, right: 22, borderColor: "rgba(240,179,90,.15)" }} />
          <div style={{ position: "relative", zIndex: 2 }}>
            <span className="mx-badge mx-badge-white" style={{ marginBottom: 10 }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="12" height="12"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" /></svg>
              消息待办
            </span>
            {confirmationsLoading ? (
              <h2 style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.3 }}>正在汇总消息…</h2>
            ) : pending.length > 0 ? (
              <h2 style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.3 }}>
                {pending.length} 条回复等你确认<br />
                <span style={{ color: "var(--kaypal-v3-amber)" }}>AI 已写好草稿，你放行才发出</span>
              </h2>
            ) : (
              <h2 style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.3 }}>
                没有待确认的消息<br />
                <span style={{ color: "var(--kaypal-v3-amber)" }}>{waitingCount > 0 ? `${waitingCount} 条回复建议已就绪` : "全部处理完毕"}</span>
              </h2>
            )}
            <p className="mx-page-sub" style={{ marginTop: 8, fontSize: 12, lineHeight: 1.6, color: "rgba(219,234,254,.78)" }}>
              所有渠道的客户消息，一个地方处理
            </p>
            {!confirmationsLoading && pending.length > 0 ? (
              <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                <button
                  type="button"
                  className="mx-btn-gold"
                  onClick={() => router.push("/tasks/confirmations")}
                >
                  去确认
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="13" height="13"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {/* 渠道宫格 */}
      <section className="mx-px mx-mt-lg">
        <div className="mx-section-head">
          <div>
            <div className="mx-section-title">
              <span className="mx-sec-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="5" /><path d="M8 12h8" /><path d="M12 8v8" /></svg></span>
              渠道
            </div>
            <p className="mx-section-eyebrow">各渠道客户消息入口</p>
          </div>
        </div>
        <div className="mx-svc-grid" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
          {MOBILE_CHANNELS.slice(0, 12).map((ch) => (
            <button
              key={ch.label}
              type="button"
              className="mx-svc-item mx-control"
              onClick={() => router.push(ch.href)}
            >
              <span
                className="mx-svc-ic"
                style={{
                  background: `color-mix(in srgb, ${ch.brand} 10%, transparent)`,
                  color: ch.brand,
                  borderRadius: 999,
                }}
              >
                {ch.brandIcon ? (
                  <BrandIcon name={ch.brandIcon} size={22} tone="tint" />
                ) : (
                  <ShellIcon name={ch.icon} size={19} />
                )}
              </span>
              <span className="mx-svc-name">{ch.label}</span>
              <span className="mx-svc-sub" style={{ fontSize: 8.5 }}>{ch.sub.slice(0, 7)}</span>
            </button>
          ))}
        </div>
      </section>

      {/* 待确认列表 */}
      <section className="mx-px mx-mt-lg" style={{ paddingBottom: 28 }}>
        <div className="mx-section-head">
          <div>
            <div className="mx-section-title">
              <span className="mx-sec-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" /></svg></span>
              待确认
            </div>
            <p className="mx-section-eyebrow">需要你放行的操作</p>
          </div>
          <button type="button" className="mx-section-action" onClick={() => router.push("/tasks/confirmations")}>
            全部
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
          </button>
        </div>
        <div className="mx-card mx-list-card">
          {confirmationsLoading ? (
            <div>
              <SkeletonRow width="64%" />
              <SkeletonRow width="72%" />
            </div>
          ) : pending.length === 0 ? (
            <div className="mx-empty">
              <p>没有待确认的操作</p>
            </div>
          ) : (
            pending.map((c) => (
              <div className="mx-row" key={c.id}>
                <span className="mx-row-ic" style={{ background: "rgba(37,99,235,.1)", color: "var(--kaypal-v3-cobalt)" }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" /></svg>
                </span>
                <div className="mx-row-main">
                  <div className="mx-row-title">{c.title}</div>
                  <div className="mx-row-desc">{c.description?.slice(0, 30) || c.actionLabel}</div>
                </div>
                <div className="mx-row-right">
                  <span className={riskTint(c.riskLevel || "medium")}>
                    {riskLabel(c.riskLevel || "medium")}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
