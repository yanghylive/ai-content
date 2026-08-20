"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { growthApi, type GrowthLead, type LeadScoreHistoryDto, type LeadAttributionDto } from "@/lib/api/growth";
import { V2BackButton } from "@/components/v2/v2-back-button";
import { V2StatusChip } from "@/components/v2/ui-kit";

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
      setMsg(res.customerId ? "已转 CRM 客户" : res.message || "已完成");
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

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6">
        <V2BackButton to="/growth/leads" label="返回线索" />
        <div className="py-16 text-center">
          <div className="mx-auto h-7 w-7 animate-spin rounded-full border-2 border-[var(--kaypal-v3-accent)] border-t-transparent" />
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
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <V2BackButton to="/growth/leads" label="返回线索" />
        <Link
          href="/growth/leads"
          className="text-xs text-[var(--kaypal-v3-accent)] hover:underline"
        >
          线索列表
        </Link>
      </div>

      {/* 头部：名称 + 平台 + 状态 + 总分 */}
      <section className="kaypal-v3-panel mb-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-[var(--kaypal-v3-ink)]">{lead.nickname || "未知线索"}</h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              {PLATFORM_LABEL[lead.platform] ?? lead.platform} · {lead.sourceType}
              
            </p>
          </div>
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
      </section>

      {/* Top Lead 动作（T4.5） */}
      <section className="mb-4 flex flex-wrap gap-2">
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
        {lead.crmCustomerId && (
          <Link
            href={`/crm/customer?id=${lead.crmCustomerId}`}
            className="kaypal-v3-panel px-4 py-2 text-sm font-medium text-[var(--kaypal-v3-accent)] transition hover:border-[var(--kaypal-v3-accent)]"
          >
            客户详情 →
          </Link>
        )}
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
              <ScoreBar label="身份 Identity" value={latestSnapshot.identityConfidence} max={15} color="#8b5cf6" />
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
                    <p className="mt-1.5 text-[10px] text-[var(--kaypal-v3-muted)]">
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
          <p className="mt-2 text-[10px] text-[var(--kaypal-v3-muted)]">来源 URL：{attribution.lead.sourceUrl}</p>
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
