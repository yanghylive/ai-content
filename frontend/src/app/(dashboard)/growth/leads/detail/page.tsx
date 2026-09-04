"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  MessageSquareText,
  Sparkles,
  UserRound,
} from "@/components/iconpark";
import { useSearchParams } from "next/navigation";
import {
  growthApi,
  type GrowthLead,
  type GrowthLeadStatus,
  type LeadScoreHistoryDto,
  type LeadAttributionDto,
} from "@/lib/api/growth";
import { api } from "@/lib/api/client";
import { V2BackButton } from "@/components/v2/v2-back-button";
import {
  V2DangerButton,
  V2GhostButton,
  V2PrimaryButton,
  V2Section,
  V2StatusChip,
} from "@/components/v2/ui-kit";
import { SkeletonList } from "@/components/skeleton";
import { toActionableError, toPublicError } from "@/lib/public-error";

const PLATFORM_LABEL: Record<string, string> = {
  douyin: "抖音",
  xiaohongshu: "小红书",
  "wechat-channel": "视频号",
  wechat: "公众号",
  bilibili: "B站",
  kuaishou: "快手",
};

const STATUS_LABEL: Record<GrowthLeadStatus, { label: string; tone: "success" | "warning" | "accent" | "muted" }> = {
  new: { label: "新线索", tone: "accent" },
  contacted: { label: "已触达", tone: "warning" },
  replied: { label: "已回复", tone: "warning" },
  qualified: { label: "高意向", tone: "accent" },
  converted: { label: "已成交", tone: "success" },
  ignored: { label: "已忽略", tone: "muted" },
  blocked: { label: "待核对", tone: "warning" },
};

const LAYER_LABEL: Record<string, string> = {
  confirmed: "已确认（主键直连）",
  rule_matched: "规则匹配（弱关联）",
  inferred: "推断",
  unknown: "未知（缺来源）",
};

const HOP_LABEL: Record<string, string> = {
  content: "内容",
  publish: "发布",
  interaction: "互动",
  lead: "线索",
  customer: "客户",
  opportunity: "商机",
};

function fmtTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function ScoreBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-[var(--kaypal-v3-muted)]">{label}</span>
        <span className="font-semibold text-[var(--kaypal-v3-ink)]">
          {value}/{max}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--kaypal-v3-surface-2)]">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

/** blocked=留人工池：最新一条系统备注转成待核对原因，无则给兜底文案 */
function blockedReason(lead: GrowthLead): string | null {
  const notes = lead.notes ?? [];
  const last = [...notes]
    .reverse()
    .map((n) => n.text.trim())
    .find((t) => t.length > 0);
  return last ?? null;
}

/** LEAD-003 线索详情页: 基本信息 + 评分历史 + 归因链 + 跟进动作 */
export default function LeadDetailPage() {
  return (
    <React.Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-sm text-[var(--kaypal-v3-muted)]">
          加载线索…
        </div>
      }
    >
      <LeadDetailClient />
    </React.Suspense>
  );
}

function LeadDetailClient() {
  const searchParams = useSearchParams();
  const leadId = searchParams.get("leadId") ?? "";

  const [lead, setLead] = useState<GrowthLead | null>(null);
  const [scoreHistory, setScoreHistory] = useState<LeadScoreHistoryDto | null>(null);
  const [attribution, setAttribution] = useState<LeadAttributionDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [msgTone, setMsgTone] = useState<"success" | "danger" | "info">("info");
  const [acting, setActing] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [batchConfirmOpen, setBatchConfirmOpen] = useState(false);

  const flash = useCallback((text: string, tone: "success" | "danger" | "info" = "info") => {
    setMsg(text);
    setMsgTone(tone);
  }, []);

  const load = useCallback(async () => {
    if (!leadId) return;
    setLoading(true);
    try {
      const list = await growthApi.listLeads();
      const found = list.find((l) => l.id === leadId);
      setLead(found ?? null);
      const [scoreRes, attrRes] = await Promise.allSettled([
        growthApi.getLeadScoreHistory(leadId),
        growthApi.getLeadAttribution(leadId),
      ]);
      if (scoreRes.status === "fulfilled") setScoreHistory(scoreRes.value);
      if (attrRes.status === "fulfilled") setAttribution(attrRes.value);
      const rejected = [scoreRes, attrRes].filter(
        (r): r is PromiseRejectedResult => r.status === "rejected",
      );
      if (rejected.length > 0) {
        for (const r of rejected) console.error(r.reason);
        flash(
          toPublicError(
            rejected[0].reason,
            rejected.length === 2
              ? "评分历史与归因数据暂时无法读取"
              : "部分数据（评分历史/归因）暂时无法读取，可能显示不全",
          ),
          "danger",
        );
      }
    } catch {
      flash("加载失败，请稍后重试", "danger");
    } finally {
      setLoading(false);
    }
  }, [leadId, flash]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleConvert = useCallback(async () => {
    if (!lead) return;
    setActing(true);
    try {
      const res = await growthApi.syncLeadToCrm(lead.id);
      if (!res.ok || !res.enabled) {
        flash(toActionableError(res.message, "CRM 未启用，无法转客户"), "danger");
        return;
      }
      flash("已转 CRM 客户", "success");
      await load();
    } catch {
      flash("转 CRM 失败，请稍后重试", "danger");
    } finally {
      setActing(false);
    }
  }, [lead, load, flash]);

  const handleStatus = useCallback(
    async (status: GrowthLeadStatus) => {
      if (!lead) return;
      setActing(true);
      try {
        await growthApi.updateLead(lead.id, { status });
        flash(`已标记为 ${STATUS_LABEL[status]?.label ?? status}`, "success");
        await load();
      } catch {
        flash("操作失败", "danger");
      } finally {
        setActing(false);
      }
    },
    [lead, load, flash],
  );

  // 备注: 走后端 noteText 契约(服务端生成 {id,text,type,createdAt} 完整 note)
  const handleAddNote = useCallback(async () => {
    if (!lead || !noteText.trim()) return;
    setActing(true);
    try {
      await growthApi.updateLead(lead.id, { noteText: noteText.trim() } as never);
      setNoteText("");
      setNoteOpen(false);
      flash("备注已保存", "success");
      await load();
    } catch {
      flash("保存备注失败", "danger");
    } finally {
      setActing(false);
    }
  }, [lead, noteText, load, flash]);

  // 生成回复草稿(引导走 AI 助手)
  const handleReplyDraft = useCallback(() => {
    flash(
      `已基于来源生成回复草稿思路：针对「${(lead?.sourceText ?? "").slice(0, 40)}…」。建议在「AI 助手」中发送：帮我写一条回复这条评论的消息。`,
      "info",
    );
  }, [lead?.sourceText, flash]);

  // 高风险批量触达: 强制确认后走统一执行链
  const handleBatchTouch = useCallback(async () => {
    if (!lead) return;
    setActing(true);
    try {
      const confirmation = await api.post<{ confirmationId?: string }>(
        "/growth/risk-confirmations",
        {
          action: "batch-touch",
          riskLevel: "high",
          target: { leadId: lead.id },
        },
      );
      if (!confirmation?.confirmationId) {
        flash("高风险操作需先完成风险确认（未获取确认单）", "danger");
        return;
      }
      setBatchConfirmOpen(false);
      flash(
        `高风险批量触达已确认（${confirmation.confirmationId}）。当前账号需绑定真实平台账号后，由执行中心统一调度触达。`,
        "info",
      );
      await load();
    } catch (e) {
      flash(toActionableError(e, "风险确认失败，请稍后重试"), "danger");
    } finally {
      setActing(false);
    }
  }, [lead, load, flash]);

  if (loading) {
    return (
      <div className="kx-view flex flex-col gap-6">
        <div className="kx-page-head">
          <div>
            <V2BackButton to="/growth/leads" label="返回线索" />
            <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">线索详情</h1>
          </div>
        </div>
        <V2Section>
          <SkeletonList rows={6} />
        </V2Section>
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="kx-view flex flex-col gap-6">
        <div className="kx-page-head">
          <div>
            <V2BackButton to="/growth/leads" label="返回线索" />
            <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">线索详情</h1>
          </div>
        </div>
        <V2Section>
          <div className="py-16 text-center text-sm text-[var(--kaypal-v3-muted)]">
            线索不存在或已删除
          </div>
        </V2Section>
      </div>
    );
  }

  const latestSnapshot = scoreHistory?.snapshots?.[0] ?? null;
  const statusMeta = STATUS_LABEL[lead.status] ?? STATUS_LABEL.new;
  const notes = lead.notes ?? [];
  const reason = lead.status === "blocked" ? blockedReason(lead) : null;

  return (
    <div className="kx-view flex flex-col gap-6">
      {/* 页头: 返回 + 标题 + 状态 + 主操作 */}
      <div className="kx-page-head">
        <div>
          <V2BackButton to="/growth/leads" label="返回线索" />
          <h1 className="kx-greet flex items-center gap-2.5 text-[var(--kaypal-v3-ink)]">
            {lead.nickname || "未知线索"}
            <V2StatusChip tone={statusMeta.tone}>{statusMeta.label}</V2StatusChip>
          </h1>
          <p className="kx-greet-sub mt-1 text-[var(--kaypal-v3-muted)]">
            {PLATFORM_LABEL[lead.platform] ?? lead.platform}
            {lead.sourceType ? ` · ${lead.sourceType}` : ""}
            {lead.score > 0 ? ` · ${lead.score} 分` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lead.crmCustomerId ? (
            <V2StatusChip tone="success">
              <CheckCircle2 className="h-3.5 w-3.5" />
              已入 CRM
            </V2StatusChip>
          ) : (
            <V2PrimaryButton
              icon={CheckCircle2}
              loading={acting}
              onClick={() => void handleConvert()}
            >
              转 CRM 客户
            </V2PrimaryButton>
          )}
        </div>
      </div>

      {/* 待核对提示行 */}
      {lead.status === "blocked" && (
        <div className="flex items-start gap-2 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-amber)]/40 bg-[var(--kaypal-v3-amber)]/10 px-4 py-3 text-sm text-[var(--kaypal-v3-amber)]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            <span className="font-semibold">待人工核对：</span>
            {reason ??
              "触达已成功，但线索缺少可归因身份（用户 ID / 主页链接），请人工补录后转客户。"}
          </p>
        </div>
      )}

      {/* 概览卡: 身份 + 评分 */}
      <section className="kaypal-v3-panel p-6">
        <div className="grid gap-6 sm:grid-cols-[auto_1fr_auto] sm:items-center">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[var(--kaypal-v3-accent-soft)]">
            <UserRound className="h-8 w-8 text-[var(--kaypal-v3-accent-ink)]" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-base font-bold text-[var(--kaypal-v3-ink)]">
                {lead.nickname || "未知线索"}
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--kaypal-v3-muted)]">
              <span className="inline-flex items-center gap-1">
                <CalendarClock className="h-3.5 w-3.5" />
                创建于 {fmtTime(lead.createdAt)}
              </span>
              {lead.latestReply ? (
                <span className="inline-flex items-center gap-1">
                  <MessageSquareText className="h-3.5 w-3.5" />
                  最新回复 {fmtTime(lead.updatedAt)}
                </span>
              ) : null}
            </div>
            {lead.matchedKeywords?.length ? (
              <p className="mt-1.5 text-xs text-[var(--kaypal-v3-muted)]">
                命中关键：{lead.matchedKeywords.slice(0, 5).join("、")}
              </p>
            ) : null}
          </div>
          <div className="shrink-0 text-left sm:text-right">
            <div className="text-4xl font-black leading-none text-[var(--kaypal-v3-accent)]">
              {scoreHistory?.available &&
              scoreHistory.totalScore != null &&
              scoreHistory.totalScore > 0
                ? scoreHistory.totalScore
                : lead.score}
            </div>
            <div className="mt-1 text-xs text-[var(--kaypal-v3-muted)]">
              {scoreHistory?.available && scoreHistory.totalScore != null && scoreHistory.totalScore > 0
                ? "质量分（四维）"
                : "印象分"}
            </div>
            {scoreHistory?.available && scoreHistory.totalScore != null && scoreHistory.totalScore > 0 && (
              <div className="mt-0.5 text-sm font-semibold text-[var(--kaypal-v3-muted)]">
                印象分 {scoreHistory.roughScore ?? lead.score}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 来源内容 */}
      <section className="kaypal-v3-panel p-6">
        <div className="mb-2 flex items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--kaypal-v3-muted)]">
            来源内容
          </span>
          {lead.sourceUrl ? (
            <a
              href={lead.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="ml-auto text-xs text-[var(--kaypal-v3-accent)] hover:underline"
            >
              查看来源 ↗
            </a>
          ) : null}
        </div>
        <p className="rounded-lg bg-[var(--kaypal-v3-surface-2)] p-4 text-sm leading-relaxed text-[var(--kaypal-v3-ink)]">
          {lead.sourceText || "（无来源文本）"}
        </p>
        {(lead.sourceTaskId || lead.sourceRunId) && (
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 rounded-lg bg-[var(--kaypal-v3-surface-2)] px-4 py-2.5 text-xs text-[var(--kaypal-v3-muted)]">
            {lead.sourceTaskId && (
              <span>
                来源任务{" "}
                <code className="font-mono text-11">{lead.sourceTaskId}</code>
              </span>
            )}
            {lead.sourceRunId && (
              <span>
                来源运行{" "}
                <code className="font-mono text-11">{lead.sourceRunId}</code>
              </span>
            )}
            {lead.sourceType && <span>来源类型 {lead.sourceType}</span>}
          </div>
        )}
      </section>

      {/* 下一步建议 */}
      <section className="rounded-[var(--kaypal-v3-radius)] border border-[var(--kaypal-v3-accent-border)]/40 bg-[var(--kaypal-v3-accent-soft)] p-5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[var(--kaypal-v3-accent)]" />
          <h2 className="text-sm font-semibold text-[var(--kaypal-v3-ink)]">下一步建议</h2>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-[var(--kaypal-v3-soft-ink)]">
          {lead.status === "converted"
            ? "线索已转 CRM 客户，可从上方进入客户详情，创建商机与跟进任务。"
            : lead.crmCustomerId
              ? "线索已关联客户，建议创建商机并安排一次跟进。"
              : lead.status === "blocked"
                ? "触达已成功但身份未闭环：请先在源平台补录该用户的 ID / 主页链接，再转为 CRM 客户，避免重复触达。"
                : lead.score >= 75
                  ? "高意向线索：建议立即处理（转 CRM 客户或安排跟进），避免错过窗口期。"
                  : "建议先处理来源评论/私信（生成回复草稿确认后发送），或标记资格后转 CRM。"}
        </p>
      </section>

      {/* 跟进操作 */}
      <section className="kaypal-v3-panel p-6">
        <h2 className="mb-4 text-base font-semibold text-[var(--kaypal-v3-ink)]">跟进操作</h2>

        <div className="flex flex-wrap items-center gap-2">
          <V2GhostButton
            loading={acting}
            disabled={Boolean(lead.crmCustomerId)}
            onClick={() => void handleStatus("contacted")}
          >
            标记已触达
          </V2GhostButton>
          <V2GhostButton
            loading={acting}
            disabled={!lead.sourceText}
            onClick={() => void handleReplyDraft()}
          >
            生成回复草稿
          </V2GhostButton>
          <V2GhostButton loading={acting} onClick={() => setNoteOpen((v) => !v)}>
            {noteOpen ? "收起备注" : "加备注"}
          </V2GhostButton>
        </div>

        {noteOpen && (
          <div className="mt-4 rounded-lg border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-4">
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="记录这条线索的补充信息（低风险，仅内部可见）…"
              rows={2}
              className="w-full rounded-lg border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 py-2 text-sm text-[var(--kaypal-v3-ink)] outline-none focus:border-[var(--kaypal-v3-accent)]"
            />
            <div className="mt-2 flex justify-end">
              <V2PrimaryButton
                loading={acting}
                disabled={!noteText.trim()}
                onClick={() => void handleAddNote()}
              >
                保存备注
              </V2PrimaryButton>
            </div>
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-[var(--kaypal-v3-border)] pt-4">
          <V2DangerButton
            loading={acting}
            disabled={!lead.sourceText}
            onClick={() => setBatchConfirmOpen(true)}
          >
            批量触达（需确认）
          </V2DangerButton>
          <span className="text-11 text-[var(--kaypal-v3-muted)]">
            批量私信/群发属高风险，将弹出风险确认后方可执行
          </span>
        </div>

        {batchConfirmOpen && (
          <div className="mt-4 rounded-lg border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--kaypal-v3-danger)]" />
              <div>
                <p className="text-sm font-semibold text-[var(--kaypal-v3-danger)]">
                  高风险操作确认：批量触达该线索（及相似线索）
                </p>
                <p className="mt-1 text-xs leading-relaxed text-[var(--kaypal-v3-soft-ink)]">
                  此操作将向线索来源（评论/私信）发送批量触达消息，可能影响账号权重。
                  请确认已通过预检（账号在线 + 风控正常 + 额度充足）后再执行。
                </p>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <V2DangerButton loading={acting} onClick={() => void handleBatchTouch()}>
                我已确认，执行
              </V2DangerButton>
              <V2GhostButton onClick={() => setBatchConfirmOpen(false)}>取消</V2GhostButton>
            </div>
          </div>
        )}
      </section>

      {/* 跟进记录（含系统留痕） */}
      <section className="kaypal-v3-panel p-6">
        <h2 className="mb-4 text-base font-semibold text-[var(--kaypal-v3-ink)]">跟进记录</h2>
        {notes.length === 0 ? (
          <p className="rounded-lg bg-[var(--kaypal-v3-surface-2)] p-3 text-xs text-[var(--kaypal-v3-muted)]">
            暂无跟进记录。添加备注或执行状态流转后，会在这里留下时间线。
          </p>
        ) : (
          <div className="space-y-3">
            {notes.map((note) => (
              <div key={note.id} className="flex items-start gap-3">
                <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--kaypal-v3-accent)]" />
                <div className="min-w-0">
                  <p className="text-sm leading-relaxed text-[var(--kaypal-v3-soft-ink)]">
                    {note.text}
                  </p>
                  <p className="mt-0.5 text-11 text-[var(--kaypal-v3-muted)]">
                    {note.type === "follow-up"
                      ? "备注"
                      : note.type === "status-change"
                        ? "状态变更"
                        : note.type === "merge"
                          ? "合并"
                          : "系统"}
                    {note.createdBy ? ` · ${note.createdBy}` : ""} · {fmtTime(note.createdAt)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 评分历史 */}
      <section className="kaypal-v3-panel p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-[var(--kaypal-v3-ink)]">评分历史</h2>
          {latestSnapshot && (
            <span className="text-xs text-[var(--kaypal-v3-muted)]">
              规则版本 {latestSnapshot.ruleVersion}
            </span>
          )}
        </div>

        {!scoreHistory?.available || !latestSnapshot ? (
          <p className="rounded-lg bg-[var(--kaypal-v3-surface-2)] p-3 text-xs text-[var(--kaypal-v3-muted)]">
            {scoreHistory?.message || "该线索尚未接入统一评分"}
          </p>
        ) : scoreHistory.snapshots.length === 0 ? (
          <p className="rounded-lg bg-[var(--kaypal-v3-surface-2)] p-3 text-xs text-[var(--kaypal-v3-muted)]">
            暂无评分快照（有信号后会自动评分）
          </p>
        ) : (
          <>
            <div className="mb-4 grid grid-cols-1 gap-3 rounded-lg bg-[var(--kaypal-v3-surface-2)] p-4 sm:grid-cols-2">
              <ScoreBar label="意向 Intent" value={latestSnapshot.intentScore} max={35} color="var(--kaypal-v3-accent)" />
              <ScoreBar label="匹配 Fit" value={latestSnapshot.fitScore} max={25} color="#2f9e8f" />
              <ScoreBar label="身份 Identity" value={latestSnapshot.identityConfidence} max={15} color="var(--kaypal-v3-purple)" />
              <ScoreBar label="风险 Risk（扣分）" value={latestSnapshot.riskScore} max={30} color="#e5484d" />
            </div>
            <div className="space-y-3">
              {scoreHistory.snapshots.map((s) => (
                <div key={s.id} className="rounded-lg border border-[var(--kaypal-v3-border)] p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[var(--kaypal-v3-muted)]">{fmtTime(s.scoredAt)}</span>
                    <span className="text-sm font-bold text-[var(--kaypal-v3-accent)]">{s.totalScore} 分</span>
                  </div>
                  <ul className="mt-2 space-y-1">
                    {s.reasons.map((r, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs text-[var(--kaypal-v3-muted)]">
                        <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-[var(--kaypal-v3-accent)]" />
                        {r}
                      </li>
                    ))}
                  </ul>
                  {s.evidenceIds.length > 0 && (
                    <p className="mt-1.5 text-11 text-[var(--kaypal-v3-muted)]">
                      证据：{s.evidenceIds.join(" / ")} · {s.modelVersion}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* 归因链 */}
      <section className="kaypal-v3-panel p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-[var(--kaypal-v3-ink)]">归因链</h2>
          {attribution && (
            <V2StatusChip
              tone={
                attribution.layer === "confirmed"
                  ? "success"
                  : attribution.layer === "rule_matched"
                    ? "warning"
                    : attribution.layer === "inferred"
                      ? "accent"
                      : "muted"
              }
            >
              {LAYER_LABEL[attribution.layer] ?? attribution.layer}
            </V2StatusChip>
          )}
        </div>

        {!attribution || attribution.hops.length === 0 ? (
          <p className="rounded-lg bg-[var(--kaypal-v3-surface-2)] p-3 text-xs text-[var(--kaypal-v3-muted)]">
            暂无归因链{attribution?.layer === "unknown" ? "（来源缺失，不伪造精确归因）" : ""}
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            {attribution.hops.map((hop, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span className="text-[var(--kaypal-v3-muted)]">→</span>}
                <span
                  className={`rounded-md px-2 py-1 text-xs font-medium ${
                    hop.model === "deterministic"
                      ? "bg-emerald-50 text-emerald-700"
                      : hop.model === "rule_based"
                        ? "bg-amber-50 text-amber-700"
                        : "bg-sky-50 text-sky-700"
                  }`}
                >
                  {HOP_LABEL[hop.fromType] ?? hop.fromType}
                  {hop.label === "qualified_by" ? "·资格" : ""}
                </span>
              </React.Fragment>
            ))}
            {attribution.hops.length > 0 && (
              <span className="text-[var(--kaypal-v3-muted)]">→</span>
            )}
            <span
              className={`rounded-md px-2 py-1 text-xs font-semibold ${
                attribution.layer === "confirmed"
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-[var(--kaypal-v3-paper-soft)] text-[var(--kaypal-v3-soft-ink)]"
              }`}
            >
              线索
            </span>
          </div>
        )}
        {attribution?.lead?.sourceUrl && (
          <p className="mt-2 text-11 text-[var(--kaypal-v3-muted)]">来源 URL：{attribution.lead.sourceUrl}</p>
        )}
      </section>

      {/* 操作反馈 */}
      {msg && (
        <div
          className={`rounded-[var(--kaypal-v3-radius-sm)] border px-4 py-3 text-sm ${
            msgTone === "success"
              ? "border-[var(--kaypal-v3-success)]/40 bg-[var(--kaypal-v3-success-soft)] text-[var(--kaypal-v3-success)]"
              : msgTone === "danger"
                ? "border-[var(--kaypal-v3-danger)]/40 bg-[var(--kaypal-v3-danger-soft)] text-[var(--kaypal-v3-danger)]"
                : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-surface-2)] text-[var(--kaypal-v3-soft-ink)]"
          }`}
        >
          {msg}
        </div>
      )}
    </div>
  );
}
