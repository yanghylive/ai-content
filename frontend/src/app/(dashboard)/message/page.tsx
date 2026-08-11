"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { ScenePage } from "@/components/shell/scene-page";
import { ShellIcon } from "@/components/shell/icons";
import { localEngineApi, type AgentConfirmation } from "@/lib/api/local-engine";
import { useIsMobile } from "@/lib/hooks/use-media-query";

export default function MessageScene() {
  const router = useRouter();
  const [waitingCount, setWaitingCount] = React.useState(0);
  const [confirmations, setConfirmations] = React.useState<AgentConfirmation[]>([]);
  const [confirmationsLoading, setConfirmationsLoading] = React.useState(true);
  const isMobile = useIsMobile();

  React.useEffect(() => {
    let active = true;
    localEngineApi
      .tasks(50)
      .then((tasks) => {
        if (!active) return;
        setWaitingCount(
          (Array.isArray(tasks) ? tasks : []).filter(
            (t) => t.status === "waiting_for_send_confirmation",
          ).length,
        );
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
    <ScenePage
      title="消息"
      sub="所有渠道的客户消息，一个地方处理"
      hint={
        waitingCount > 0
          ? {
              icon: "message",
              text: `${waitingCount} 条回复等你确认，AI 已写好草稿`,
              actionLabel: "去确认",
              href: "/tasks/confirmations",
            }
          : undefined
      }
      cards={[
        {
          icon: "messageSq",
          tint: "kx-t-slate",
          title: "AI 客服",
          desc: "配置机器人风格与规则，草稿确认后发出",
          href: "/engagement",
          badge: waitingCount > 0 ? `${waitingCount} 待确认` : undefined,
        },
        {
          icon: "messageSq",
          tint: "kx-t-green",
          title: "企微助手",
          desc: "企业微信客户智能回复助手",
          href: "/wecom-assistant",
        },
        {
          icon: "music",
          tint: "kx-t-slate",
          title: "抖音私信",
          desc: "私信和评论，读取真实的回复给你确认",
          href: "/engagement/douyin-messages",
        },
        {
          icon: "play",
          tint: "kx-t-cyan",
          title: "视频号私信",
          desc: "私信和评论",
          href: "/engagement/channel-messages",
        },
        {
          icon: "messageSq",
          tint: "kx-t-green",
          title: "微信",
          desc: "会话、加好友",
          href: "/engagement/wechat",
        },
        {
          icon: "history",
          tint: "kx-t-slate",
          title: "互动记录",
          desc: "所有发出过的回复，可追溯",
          href: "/engagement/records",
        },
        {
          icon: "megaphone",
          tint: "kx-t-amber",
          title: "朋友圈计划",
          desc: "朋友圈发布计划与排期",
          href: "/engagement/wechat/plans",
        },
        {
          icon: "cpu",
          tint: "kx-t-violet",
          title: "执行态势",
          desc: "跨平台执行任务态势总览",
          href: "/war-room",
        },
      ]}
    />
  );
}

/* ================= 移动端视图（<768px，明德 VP 风格） ================= */

const MOBILE_CHANNELS: Array<{
  label: string;
  sub: string;
  icon: React.ComponentProps<typeof ShellIcon>["name"];
  brand: string;
  href: string;
}> = [
  { label: "AI 客服", sub: "配置风格规则", icon: "messageSq", brand: "#20497f", href: "/engagement" },
  { label: "抖音私信", sub: "读取真实回复", icon: "music", brand: "#fe2c55", href: "/engagement/douyin-messages" },
  { label: "视频号私信", sub: "私信和评论", icon: "play", brand: "#007fff", href: "/engagement/channel-messages" },
  { label: "微信", sub: "会话 · 加好友", icon: "messageSq", brand: "#07c160", href: "/engagement/wechat" },
  { label: "企微助手", sub: "企微智能回复", icon: "messageSq", brand: "#07c160", href: "/wecom-assistant" },
  { label: "互动记录", sub: "所有回复可追溯", icon: "history", brand: "#76517e", href: "/engagement/records" },
  { label: "朋友圈计划", sub: "朋友圈排期", icon: "megaphone", brand: "#d97706", href: "/engagement/wechat/plans" },
  { label: "执行态势", sub: "跨平台任务态势", icon: "cpu", brand: "#7c3aed", href: "/war-room" },
];

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
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 .304.377l6.001 4.1a.5.5 0 0 1-.29.908l-6.985.49a1 1 0 0 0-.673.42l-3.45 4.8a.5.5 0 0 1-.84 0l-3.45-4.8a1 1 0 0 0-.673-.42l-6.985-.49a.5.5 0 0 1-.29-.908l6.001-4.1a1 1 0 0 0 .304-.377z" />
              </svg>
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
              color: "var(--mx-ic-tint)",
              fontSize: 12,
              flexShrink: 0,
            }}
            onClick={() => router.push("/engagement/records")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="15" height="15"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
            <span style={{ color: "var(--mx-ic-tint)", opacity: 0.55, whiteSpace: "nowrap" }}>搜索消息/联系人</span>
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
              <h2 style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.3 }}>正在汇总消息…</h2>
            ) : pending.length > 0 ? (
              <h2 style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.3 }}>
                {pending.length} 条回复等你确认<br />
                <span style={{ color: "#f4bb67" }}>AI 已写好草稿，你放行才发出</span>
              </h2>
            ) : (
              <h2 style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.3 }}>
                没有待确认的消息<br />
                <span style={{ color: "#f4bb67" }}>{waitingCount > 0 ? `${waitingCount} 条回复建议已就绪` : "全部处理完毕"}</span>
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
          {MOBILE_CHANNELS.slice(0, 8).map((ch) => (
            <button
              key={ch.label}
              type="button"
              className="mx-svc-item mx-control"
              onClick={() => router.push(ch.href)}
            >
              <span
                className="mx-svc-ic"
                style={{
                  background: `${ch.brand}1f`,
                  color: ch.brand,
                  borderRadius: 999,
                }}
              >
                <ShellIcon name={ch.icon} size={19} />
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
              <div className="mx-skeleton-row"><span className="mx-skeleton mx-skeleton-ic" /><div style={{ flex: 1 }}><div className="mx-skeleton mx-skeleton-line" style={{ width: "64%" }} /><div className="mx-skeleton mx-skeleton-line mx-skeleton-line-sm" style={{ marginTop: 7 }} /></div></div>
              <div className="mx-skeleton-row"><span className="mx-skeleton mx-skeleton-ic" /><div style={{ flex: 1 }}><div className="mx-skeleton mx-skeleton-line" style={{ width: "72%" }} /><div className="mx-skeleton mx-skeleton-line mx-skeleton-line-sm" style={{ marginTop: 7 }} /></div></div>
            </div>
          ) : pending.length === 0 ? (
            <div className="mx-empty">
              <p>没有待确认的操作</p>
            </div>
          ) : (
            pending.map((c) => (
              <div className="mx-row" key={c.id}>
                <span className="mx-row-ic" style={{ background: "rgba(37,99,235,.1)", color: "#2563eb" }}>
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
