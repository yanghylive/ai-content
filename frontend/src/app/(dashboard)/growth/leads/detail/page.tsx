"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { growthApi, type GrowthLead, type LeadScoreHistoryDto, type LeadAttributionDto } from "@/lib/api/growth";
import { api } from "@/lib/api/client";
import { V2BackButton } from "@/components/v2/v2-back-button";
import { V2StatusChip } from "@/components/v2/ui-kit";
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

/** LEAD-003 线索详情页（Sprint 4 前端收尾）：基本信息 + 评分历史 + 归因链 + Top Lead 动作 */
export default function LeadDetailPage() {
  return (
    <React.Suspense
      fallback={
        <div className="p-8 text-sm text-[var(--kaypal-v3-muted)]">加载线索…</div>
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
  const [acting, setActing] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [batchConfirmOpen, setBatchConfirmOpen] = useState(false);

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
      // 2026-09-01 复核回改（allSettled 同类自查）：评分历史/归因失败不再静默缺板块
      const rejected = [scoreRes, attrRes].filter(
        (r): r is PromiseRejectedResult => r.status === "rejected",
      );
      if (rejected.length > 0) {
        for (const r of rejected) console.error(r.reason);
        setMsg(
          toPublicError(
            rejected[0].reason,
            rejected.length === 2
              ? "评分历史与归因数据暂时无法读取"
              : "部分数据（评分历史/归因）暂时无法读取，可能显示不全",
          ),
        );
      }
    } catch {
      setMsg("加载失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleConvert = useCallback(async () => {
    if (!lead) return;
    setActing(true);
    try {
      const res = await growthApi.syncLeadToCrm(lead.id);
      if (!res.ok || !res.enabled) {
        setMsg(toActionableError(res.message, "CRM 未启用，无法转客户"));
        return;
      }
      setMsg("已转 CRM 客户");
      await load();
    } catch {
      setMsg("转 CRM 失败，请稍后重试");
    } finally {
      setActing(false);
    }
  }, [lead, load]);

  const handleStatus = useCallback(
    async (status: string) => {
      if (!lead) return;
      setActing(true);
      try {
        await growthApi.updateLead(lead.id, { status: status as never });
        setMsg(`已标记为 ${status}`);
        await load();
      } catch {
        setMsg("操作失败");
      } finally {
        setActing(false);
      }
    },
    [lead, load],
  );

  // §8.2-C 低风险：加备注（内部可见，仅追加 notes）
  const handleAddNote = useCallback(async () => {
    if (!lead || !noteText.trim()) return;
    setActing(true);
    try {
      const existing = (lead as unknown as { notes?: Array<{ content: string; at: string }> })
        .notes ?? [];
      await growthApi.updateLead(lead.id, {
        notes: [
          ...existing,
          { content: noteText.trim(), at: new Date().toISOString() },
        ],
      } as never);
      setNoteText("");
      setNoteOpen(false);
      setMsg("备注已保存");
      await load();
    } catch {
      setMsg("保存备注失败");
    } finally {
      setActing(false);
    }
  }, [lead, noteText, load]);

  // §8.2-C 低风险：生成回复草稿（基于来源内容，提示走 AI 助手/任务草稿）
  const handleReplyDraft = useCallback(async () => {
    if (!lead) return;
    setMsg(
      `已基于来源生成回复草稿思路：针对「${(lead.sourceText ?? "").slice(0, 40)}…」。
      建议在「AI 助手」中发送：帮我写一条回复这条评论的消息。`,
    );
  }, [lead]);

  // §8.2-C 高风险：批量触达（强制确认后，走统一执行链）
  const handleBatchTouch = useCallback(async () => {
    if (!lead) return;
    setActing(true);
    try {
      // 高风险外发：先走风险确认链（与执行中心 batch-touch 一致）
      const confirmation = await api.post<{ confirmationId?: string }>(
        "/growth/risk-confirmations",
        {
          action: "batch-touch",
          riskLevel: "high",
          target: { leadId: lead.id },
        },
      );
      if (!confirmation?.confirmationId) {
        setMsg("高风险操作需先完成风险确认（未获取确认单）");
        return;
      }
      setBatchConfirmOpen(false);
      setMsg(
        `高风险批量触达已确认（${confirmation.confirmationId}）。
        当前账号需绑定真实平台账号后，由执行中心统一调度触达。`,
      );
      await load();
    } catch (e) {
      setMsg(toActionableError(e, "风险确认失败，请稍后重试"));
    } finally {
      setActing(false);
    }
  }, [lead, load]);

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6">
        <V2BackButton to="/growth/leads" label="返回线索" />
        <div className="py-16 text-center">
          <SkeletonList rows={5} />
        </div>
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6">
        <V2BackButton to="/growth/leads" label="返回线索" />
        <div className="rounded-xl border border-dashed border-[var(--kaypal-v3-border)] p-10 text-center text-sm text-[var(--kaypal-v3-muted)]">
          线索不存在或已删除
        </div>
      </div>
    );
  }

  const latestSnapshot = scoreHistory?.snapshots?.[0] ?? null;

  return (
    <div className="kx-view flex flex-col gap-4">
      <div className="kx-page-head">
        <div>
          <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">{lead.nickname || "未知线索"}</h1>
          <p className="kx-greet-sub mt-1 text-[var(--kaypal-v3-muted)]">
            {PLATFORM_LABEL[lead.platform] ?? lead.platform} · {lead.sourceType}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <V2BackButton to="/growth/leads" label="返回线索" />
          <Link href="/growth/leads" className="text-12 text-[var(--kaypal-v3-accent)] hover:underline">
            线索列表
          </Link>
        </div>
      </div>

      {/* 详情内容卡（评分/来源；页头不再嵌在卡片中） */}
      <section className="kaypal-v3-panel mb-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="text-right">
            <div className="text-3xl font-black text-[var(--kaypal-v3-accent)]">
              {scoreHistory?.available && scoreHistory.totalScore != null
                ? scoreHistory.totalScore
                : lead.score}
            </div>
            <div className="mt-0.5 text-xs text-[var(--kaypal-v3-muted)]">
              {scoreHistory?.available ? "质量分（四维）" : "印象分"}
            </div>
            {scoreHistory?.available && (
              <div className="mt-1 text-sm font-semibold text-[var(--kaypal-v3-muted)]">
                印象分 {scoreHistory.roughScore ?? lead.score}
              </div>
            )}
          </div>
        </div>
        <p className="mt-3 rounded-lg bg-[var(--kaypal-v3-surface-2)] p-3 text-sm leading-relaxed text-[var(--kaypal-v3-ink)]">
          {lead.sourceText || "（无来源文本）"}
        </p>
        {lead.sourceUrl && (
          <a
            href={lead.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block text-xs text-[var(--kaypal-v3-accent)] hover:underline"
          >
            查看来源 ↗
          </a>
        )}
        <div className="mt-2 text-xs text-[var(--kaypal-v3-muted)]">
          创建于 {fmtTime(lead.createdAt)}
          {lead.latestReply ? ` · 最新回复 ${fmtTime(lead.updatedAt)}` : ""}
        </div>

        {/* T07：来源链路（显式展示 sourceRunId/sourceTaskId，收紧归因可信度） */}
        {(lead.sourceTaskId || lead.sourceRunId) && (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 rounded-lg bg-[var(--kaypal-v3-surface-2)] p-3 text-xs text-[var(--kaypal-v3-muted)]">
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

      {/* Top Lead 动作（T4.5 + T07 风险分级：低=只读/备注类、中=单条写操作、高=批量/外发强制确认） */}
      <section className="mb-4 flex flex-wrap items-center gap-2">
        <span className="rounded bg-[var(--kaypal-v3-surface-2)] px-2 py-0.5 text-11 font-medium text-[var(--kaypal-v3-muted)]">
          低风险动作
        </span>
        <button
          type="button"
          disabled={acting}
          onClick={() => setNoteOpen((v) => !v)}
          className="kaypal-v3-panel px-4 py-2 text-sm font-medium text-[var(--kaypal-v3-ink)] transition hover:border-[var(--kaypal-v3-accent)]"
        >
          {noteOpen ? "收起备注" : "＋ 加备注"}
        </button>
        <button
          type="button"
          disabled={acting || !lead.sourceText}
          onClick={() => void handleReplyDraft()}
          className="kaypal-v3-panel px-4 py-2 text-sm font-medium text-[var(--kaypal-v3-ink)] transition hover:border-[var(--kaypal-v3-accent)] disabled:opacity-40"
        >
          生成回复草稿
        </button>
      </section>

      {noteOpen && (
        <section className="kaypal-v3-panel mb-4 p-4">
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="记录这条线索的补充信息（低风险，仅内部可见）…"
            rows={2}
            className="w-full rounded-lg border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 py-2 text-sm text-[var(--kaypal-v3-ink)] outline-none focus:border-[var(--kaypal-v3-accent)]"
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              disabled={acting || !noteText.trim()}
              onClick={() => void handleAddNote()}
              className="rounded-lg bg-[var(--kaypal-v3-accent)] px-4 py-1.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
            >
              保存备注
            </button>
          </div>
        </section>
      )}

      {/* 中风险动作 */}
      <section className="mb-4 flex flex-wrap items-center gap-2">
        <span className="rounded bg-[var(--kaypal-v3-surface-2)] px-2 py-0.5 text-11 font-medium text-[var(--kaypal-v3-muted)]">
          中风险动作
        </span>
        <button
          type="button"
          disabled={acting || !!lead.crmCustomerId}
          onClick={() => void handleConvert()}
          className="rounded-lg bg-[var(--kaypal-v3-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
        >
          {lead.crmCustomerId ? "已转 CRM" : "转 CRM 客户"}
        </button>
        <button
          type="button"
          disabled={acting}
          onClick={() => void handleStatus("contacted")}
          className="kaypal-v3-panel px-4 py-2 text-sm font-medium text-[var(--kaypal-v3-ink)] transition hover:border-[var(--kaypal-v3-accent)]"
        >
          标记已联系
        </button>
        <button
          type="button"
          disabled={acting}
          onClick={() => void handleStatus("qualified")}
          className="kaypal-v3-panel px-4 py-2 text-sm font-medium text-[var(--kaypal-v3-ink)] transition hover:border-[var(--kaypal-v3-accent)]"
        >
          标记意向
        </button>
        {lead.crmCustomerId ? (
          <Link
            href={`/crm/customer?id=${lead.crmCustomerId}&tab=profile`}
            className="kaypal-v3-panel px-4 py-2 text-sm font-medium text-[var(--kaypal-v3-accent)] transition hover:border-[var(--kaypal-v3-accent)]"
          >
            客户详情（含来源归因）→
          </Link>
        ) : (
          <span className="rounded bg-[var(--kaypal-v3-surface-2)] px-2 py-1 text-11 text-[var(--kaypal-v3-muted)]">
            转 CRM 后可从本页直达客户与商机
          </span>
        )}
      </section>

      {/* 高风险动作（批量/外发，强制确认） */}
      <section className="mb-4 flex flex-wrap items-center gap-2">
        <span className="rounded bg-[var(--kaypal-v3-surface-2)] px-2 py-0.5 text-11 font-medium text-[var(--kaypal-v3-muted)]">
          高风险动作
        </span>
        <button
          type="button"
          disabled={acting || !lead.sourceText}
          onClick={() => setBatchConfirmOpen(true)}
          className="rounded-lg border border-[var(--kaypal-v3-danger)] px-4 py-2 text-sm font-semibold text-[var(--kaypal-v3-danger)] transition hover:bg-[var(--kaypal-v3-danger-soft)] disabled:opacity-40"
        >
          批量触达（需确认）
        </button>
        <span className="text-11 text-[var(--kaypal-v3-muted)]">
          批量私信/群发属高风险，将弹出风险确认后方可执行
        </span>
      </section>

      {batchConfirmOpen && (
        <section
          className="mb-4 rounded-lg border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4"
          style={{ position: "relative" }}
        >
          <p className="text-sm font-semibold text-[var(--kaypal-v3-danger)]">
            ⚠️ 高风险操作确认：批量触达该线索（及相似线索）
          </p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--kaypal-v3-soft-ink)]">
            此操作将向线索来源（评论/私信）发送批量触达消息，可能影响账号权重。
            请确认已通过预检（账号在线 + 风控正常 + 额度充足）后再执行。
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={acting}
              onClick={() => void handleBatchTouch()}
              className="rounded-lg bg-[var(--kaypal-v3-danger)] px-4 py-1.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
            >
              我已确认，执行
            </button>
            <button
              type="button"
              onClick={() => setBatchConfirmOpen(false)}
              className="kaypal-v3-panel px-4 py-1.5 text-sm font-medium text-[var(--kaypal-v3-ink)]"
            >
              取消
            </button>
          </div>
        </section>
      )}

      {/* T07：下一步建议（基于线索状态） */}
      <section className="mb-4 rounded-lg border border-[var(--kaypal-v3-accent)]/30 bg-[var(--kaypal-v3-accent-soft)] p-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[var(--kaypal-v3-accent)]" />
          <h3 className="text-sm font-semibold text-[var(--kaypal-v3-ink)]">下一步建议</h3>
        </div>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--kaypal-v3-soft-ink)]">
          {lead.status === "converted"
            ? "线索已转 CRM 客户，可从上方进入客户详情，创建商机与跟进任务。"
            : lead.crmCustomerId
              ? "线索已关联客户，建议创建商机并安排一次跟进。"
              : lead.score >= 75
                ? "高意向线索：建议立即处理（转 CRM 客户或安排跟进），避免错过窗口期。"
                : "建议先处理来源评论/私信（生成回复草稿确认后发送），或标记资格后转 CRM。"}
        </p>
      </section>

      {/* 评分历史（T2.6） */}
      <section className="kaypal-v3-panel mb-4 p-5">
        <div className="mb-3 flex items-center justify-between">
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
            {/* 最新快照的五分数 */}
            <div className="mb-4 grid grid-cols-1 gap-3 rounded-lg bg-[var(--kaypal-v3-surface-2)] p-4 sm:grid-cols-2">
              <ScoreBar label="意向 Intent" value={latestSnapshot.intentScore} max={35} color="var(--kaypal-v3-accent)" />
              <ScoreBar label="匹配 Fit" value={latestSnapshot.fitScore} max={25} color="#2f9e8f" />
              <ScoreBar label="身份 Identity" value={latestSnapshot.identityConfidence} max={15} color="var(--kaypal-v3-purple)" />
              <ScoreBar label="风险 Risk（扣分）" value={latestSnapshot.riskScore} max={30} color="#e5484d" />
            </div>

            {/* 快照列表（reasons 证据链） */}
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

      {/* 归因链（T4.3） */}
      <section className="kaypal-v3-panel mb-4 p-5">
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

      {msg && (
        <p className="rounded-lg bg-[var(--kaypal-v3-surface-2)] px-3 py-2 text-xs text-[var(--kaypal-v3-ink)]">
          {msg}
        </p>
      )}
    </div>
  );
}
