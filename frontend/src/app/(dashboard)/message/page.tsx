"use client";

import { SkeletonRow } from "@/components/skeleton";

import { BrandLogo } from "@/components/brand-logo";

import React from "react";
import { useRouter } from "next/navigation";
import { ScenePage } from "@/components/shell/scene-page";
import { ShellIcon } from "@/components/shell/icons";
import { localEngineApi, type AgentConfirmation, type InteractionTask } from "@/lib/api/local-engine";
import { statsApi } from "@/lib/api/stats";
import { useIsMobile } from "@/lib/hooks/use-media-query";

export default function MessageScene() {
  const router = useRouter();
  const [waitingCount, setWaitingCount] = React.useState(0);
  const [confirmations, setConfirmations] = React.useState<AgentConfirmation[]>([]);
  const [confirmationsLoading, setConfirmationsLoading] = React.useState(true);
  const [inbox, setInbox] = React.useState<InteractionTask[]>([]);
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
      .tasks(100)
      .then((tasks) => {
        if (!active) return;
        const list = Array.isArray(tasks) ? tasks : [];
        // 收件箱：待处理互动（待确认 + 转人工 + 执行中），按 SLA 超时/时间排序
        const pending = list.filter(
          (t) =>
            t.status === "waiting_for_send_confirmation" ||
            t.status === "running" ||
            t.status === "queued" ||
            t.handoffState === "needs_human",
        );
        setInbox(pending.slice(0, 30));
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
        inbox={inbox}
      />
    );
  }

  return (
    <div className="kx-view">
      <InboxSection inbox={inbox} router={router} />
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
          title: "群发计划",
          desc: "群发任务管理：暂停、继续、重试",
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
    </div>
  );
}

/* ================= 待处理互动收件箱（报告 16.3 第 15 项：统一收件箱） ================= */

function slaTint(task: InteractionTask): string {
  if (task.handoffState === "needs_human") return "kx-t-rose";
  if (task.slaDueAt && new Date(task.slaDueAt).getTime() < Date.now()) {
    return "kx-t-amber";
  }
  return "kx-t-blue";
}

function slaLabel(task: InteractionTask): string {
  if (task.handoffState === "needs_human") return "转人工";
  if (task.slaDueAt && new Date(task.slaDueAt).getTime() < Date.now()) {
    return "已超时";
  }
  if (task.status === "waiting_for_send_confirmation") return "待确认";
  if (task.status === "running") return "执行中";
  if (task.status === "queued") return "排队中";
  return task.statusLabel || task.status;
}

function InboxSection({
  inbox,
  router,
}: {
  inbox: InteractionTask[];
  router: ReturnType<typeof useRouter>;
}) {
  if (inbox.length === 0) return null;
  return (
    <>
      <div className="kx-section-title" style={{ marginTop: 8 }}>
        <ShellIcon name="message" />
        待处理互动
      </div>
      <div>
        {inbox.slice(0, 15).map((t) => (
          <div className="kx-done-item" key={t.id}>
            <span className={`kx-tag ${slaTint(t)}`}>{slaLabel(t)}</span>
            <span
              style={{
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                color: "var(--kx-ink)",
              }}
            >
              {t.targetName || t.sourceText?.slice(0, 24) || "客户"}
              {t.typeLabel ? ` · ${t.typeLabel}` : ""}
            </span>
            <span style={{ flexShrink: 0, color: "var(--kx-muted)", fontSize: 12 }}>
              {t.accountName || ""}
            </span>
          </div>
        ))}
        {inbox.length > 15 ? (
          <div
            className="kx-done-item"
            style={{ justifyContent: "center", color: "var(--kx-muted)" }}
          >
            还有 {inbox.length - 15} 条待处理，去
            <button
              type="button"
              onClick={() => router.push("/tasks/confirmations")}
              style={{ background: "none", border: "none", color: "#722ed1", cursor: "pointer", padding: 0 }}
            >
              确认中心
            </button>
            查看全部
          </div>
        ) : null}
      </div>
    </>
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
  { label: "群发计划", sub: "群发任务管理", icon: "megaphone", brand: "#d97706", href: "/engagement/wechat/plans" },
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
  inbox,
}: {
  router: ReturnType<typeof useRouter>;
  waitingCount: number;
  confirmations: AgentConfirmation[];
  confirmationsLoading: boolean;
  inbox: InteractionTask[];
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

      {/* 待处理互动收件箱（报告 16.3 第 15 项） */}
      {inbox.length > 0 ? (
        <section className="mx-px mx-mt-lg">
          <div className="mx-section-head">
            <div>
              <div className="mx-section-title">
                <span className="mx-sec-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4Z" /></svg></span>
                待处理互动
              </div>
              <p className="mx-section-eyebrow">跨渠道聚合 · 超时与转人工标记</p>
            </div>
          </div>
          <div className="mx-card mx-list-card">
            {inbox.slice(0, 15).map((t) => (
              <div className="mx-row" key={t.id}>
                <span
                  className="mx-row-ic"
                  style={{
                    background:
                      t.handoffState === "needs_human"
                        ? "rgba(220,38,38,.1)"
                        : "rgba(37,99,235,.1)",
                    color:
                      t.handoffState === "needs_human" ? "#dc2626" : "#2563eb",
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4Z" /></svg>
                </span>
                <div className="mx-row-main">
                  <div className="mx-row-title">
                    {t.targetName || t.sourceText?.slice(0, 24) || "客户"}
                  </div>
                  <div className="mx-row-desc">
                    {t.typeLabel || "互动"}
                    {t.accountName ? ` · ${t.accountName}` : ""}
                  </div>
                </div>
                <div className="mx-row-right">
                  <span className={`mx-badge ${slaTint(t) === "kx-t-rose" ? "mx-badge-red" : slaTint(t) === "kx-t-amber" ? "mx-badge-gold" : "mx-badge-blue"}`}>
                    {slaLabel(t)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

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
