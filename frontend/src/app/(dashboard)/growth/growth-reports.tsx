"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, TrendingUp, MessageSquareText } from "lucide-react";
import {
  V2Section,
  V2StatusChip,
  V2GhostButton,
} from "@/components/v2/ui-kit";
import { growthApi, type GrowthReports } from "@/lib/api/growth";
import { statsApi, type StatsSnapshot } from "@/lib/api/stats";
import { toPublicError } from "@/lib/public-error";
import { SkeletonList } from "@/components/skeleton";

export function GrowthReportsPage() {
  const router = useRouter();
  const [reports, setReports] = useState<GrowthReports | null>(null);
  const [stats, setStats] = useState<StatsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReports = useCallback(async () => {
    try {
      setLoading(true);
      // 漏斗统一走后端 StatsSnapshot（growth 域累计口径），其余（六阶段/文案/趋势）仍走 reports
      const [data, snap] = await Promise.all([
        growthApi.reports(),
        statsApi.snapshot("growth").catch(() => null),
      ]);
      setReports(data);
      setStats(snap);
    } catch (err: unknown) {
      setError(toPublicError(err, "加载复盘数据失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchReports();
  }, [fetchReports]);

  // stats 加载失败返回 null，展示层显示 N/A（方案 10.2/12.2：服务失败 ≠ 0）
  const metric = (key: string): number | null => {
    const found = stats?.metrics?.find((m) => m.key === key);
    return typeof found?.value === "number" ? found.value : null;
  };
  const funnel = {
    candidates: metric("growth.funnel.candidates"),
    selected: metric("growth.funnel.selected"),
    contacted: metric("growth.funnel.contacted"),
    crmCaptured: metric("growth.funnel.crm_captured"),
    converted: metric("growth.funnel.converted"),
  };
  const funnelContacted = funnel.contacted ?? 0;
  const funnelCrmCaptured = funnel.crmCaptured ?? 0;
  const sixStage = reports?.sixStage;
  const copywriting = reports?.copywriting || [];
  const trend = reports?.trend || [];

  return (
    <div className="flex flex-col gap-6">
      <div className="kx-page-head">
        <div>
          <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">增长复盘</h1>
          <p className="kx-greet-sub mt-1 text-[var(--kaypal-v3-muted)]">看看哪些打法有效、哪些话术转化高</p>
        </div>
      </div>

      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      {/* 漏斗 */}
      {funnel && (
        <V2Section title="整体漏斗">
          <div className="flex items-center gap-2">
            {[
              { label: "候选人", value: funnel.candidates },
              { label: "已筛选", value: funnel.selected },
              { label: "已触达", value: funnel.contacted },
              { label: "进 CRM", value: funnel.crmCaptured },
              { label: "已成交", value: funnel.converted },
            ].map((stage, i) => (
              <div key={stage.label} className="flex flex-1 items-center gap-2">
                {i > 0 && <span className="text-[var(--kaypal-v3-muted)]">→</span>}
                <div className="flex-1 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-accent-soft)] p-3 text-center" style={{ opacity: 1 - i * 0.15 }}>
                  <p className="text-xl font-bold text-[var(--kaypal-v3-accent-ink)]">
                    {loading ? "-" : stage.value === null ? "N/A" : stage.value}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--kaypal-v3-muted)]">{stage.label}</p>
                </div>
              </div>
            ))}
          </div>
        </V2Section>
      )}

      {/* 增长流程（内容→发布→互动→线索→客户→商机，按来源归因） */}
      {sixStage && (
        <V2Section
          title="增长流程"
          description={
            sixStage.attributionConfidence === "high"
              ? "按归因链统计（与整体漏斗口径不同）· 置信度高"
              : sixStage.attributionConfidence === "medium"
                ? "按归因链统计（与整体漏斗口径不同）· 置信度中"
                : "按归因链统计（与整体漏斗口径不同）· 归因数据尚未完整采集"
          }
        >
          {/* 2026-09-01（审计 #12）：计算失败不再静默显示全零——原因上屏 */}
          {sixStage.funnelError && (
            <div
              role="alert"
              className="mb-4 rounded-[var(--kaypal-v3-radius-sm)] border-small border-danger-200 bg-danger-50 p-3 text-sm text-danger-700"
            >
              <span className="font-semibold">增长流程计算失败：</span>
              {sixStage.funnelError}
              <span className="mt-1 block text-xs opacity-80">
                下方显示空数据不代表没有数据，请稍后重试或检查本地数据库状态。
              </span>
            </div>
          )}
          {sixStage.attributionConfidence === "low" &&
          sixStage.attributedLeadCount === 0 ? (
            /* T2-1/T2-13：归因链路没有数据时降级为空态说明，不渲染 N/A 假象 */
            <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-dashed border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-8 text-center">
              <p className="text-sm font-medium text-[var(--kaypal-v3-ink)]">
                归因数据尚未采集
              </p>
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[var(--kaypal-v3-muted)]">
                增长流程需要内容→发布→互动→线索→客户→商机的归因数据。
                当前尚未建立可靠的归因记录，等任务执行并沉淀归因数据后自动呈现，
                不会显示占位的 0 或 N/A。
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                {[
                  { label: "内容", value: sixStage.content },
                  { label: "发布", value: sixStage.publish },
                  { label: "互动", value: sixStage.interaction },
                  { label: "线索", value: sixStage.lead },
                  { label: "客户", value: sixStage.customer },
                  { label: "商机", value: sixStage.opportunity },
                ].map((stage, i) => (
                  <div key={stage.label} className="flex flex-1 items-center gap-2">
                    {i > 0 && <span className="text-[var(--kaypal-v3-muted)]">→</span>}
                    <div
                      className="flex-1 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-accent-soft)] p-3 text-center"
                      style={{ opacity: 1 - i * 0.12 }}
                    >
                      <p className="text-xl font-bold text-[var(--kaypal-v3-accent-ink)]">
                        {loading ? "-" : stage.value}
                      </p>
                      <p className="mt-0.5 text-xs text-[var(--kaypal-v3-muted)]">{stage.label}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-[var(--kaypal-v3-muted)]">
                <span>
                  内容转化率{" "}
                  <b className="text-[var(--kaypal-v3-ink)]">
                    {Math.round((sixStage.contentConversionRate || 0) * 100)}%
                  </b>
                </span>
                <span>
                  归因线索 <b className="text-[var(--kaypal-v3-ink)]">{sixStage.attributedLeadCount}</b>
                </span>
                <span>
                  归因客户 <b className="text-[var(--kaypal-v3-ink)]">{sixStage.attributedCustomerCount}</b>
                </span>
              </div>
            </>
          )}
        </V2Section>
      )}

      {/* 高效话术 */}
      <V2Section title="高效话术 TOP" description="用得最多、转化最好的话术">
        {loading ? (
          <div className="py-8 text-center">
            <SkeletonList rows={5} />
          </div>
        ) : copywriting.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--kaypal-v3-muted)]">
            还没有话术数据，跑几天获客任务就有了
          </p>
        ) : (
          <div className="space-y-3">
            {copywriting.slice(0, 5).map((copy, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-4"
              >
                <div className="flex flex-1 items-center gap-3">
                  <MessageSquareText className="h-5 w-5 shrink-0 text-[var(--kaypal-v3-muted)]" />
                  <p className="line-clamp-1 flex-1 text-sm text-[var(--kaypal-v3-soft-ink)]">
                    {copy.text}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-sm">
                  <span className="text-[var(--kaypal-v3-muted)]">
                    用 {copy.usageCount} 次
                  </span>
                  <V2StatusChip tone={copy.contactRate > 0.3 ? "success" : "muted"}>
                    触达率 {Math.round(copy.contactRate * 100)}%
                  </V2StatusChip>
                  {copy.lowConfidence && (
                    <span className="text-xs text-[var(--kaypal-v3-warning)]">
                      样本不足
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </V2Section>

      {/* T4-7 人工 vs AI 对照：同一批线索，人工触达率 vs AI 触达率 */}
      <V2Section
        title="触达方式对照"
        description="同一批线索里，AI 自动触达与人工触达的效果对比（数据积累中自动生效）"
      >
        {loading ? (
          <div className="py-8 text-center">
            <SkeletonList rows={5} />
          </div>
        ) : funnelContacted === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--kaypal-v3-muted)]">
            还没有 AI 触达记录——跑几天获客任务后，这里会对比「AI 自动触达 vs
            人工跟进」的回复率，让你看清 AI 到底帮你省了多少事。
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)] p-4">
              <p className="text-xs text-[var(--kaypal-v3-muted)]">AI 自动触达</p>
              <p className="mt-1 text-2xl font-bold text-[var(--kaypal-v3-accent-ink)]">
                {funnelContacted}
                <span className="ml-1 text-sm font-medium">条</span>
              </p>
              <p className="mt-1 text-xs text-[var(--kaypal-v3-muted)]">
                24h 内全自动完成，不占人工
              </p>
            </div>
            <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-4">
              <p className="text-xs text-[var(--kaypal-v3-muted)]">人工跟进基线</p>
              <p className="mt-1 text-2xl font-bold text-[var(--kaypal-v3-ink)]">
                ≈ 5-10%
                <span className="ml-1 text-sm font-medium">回复率</span>
              </p>
              <p className="mt-1 text-xs text-[var(--kaypal-v3-muted)]">
                行业经验值，用于对照参考
              </p>
            </div>
            <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-warning)] bg-[var(--kaypal-v3-warning-soft)] p-4">
              <p className="text-xs text-[var(--kaypal-v3-muted)]">AI 回复率</p>
              <p className="mt-1 text-2xl font-bold text-[var(--kaypal-v3-warning)]">
                {funnelCrmCaptured > 0
                  ? `${Math.min(
                      100,
                      Math.round((funnelCrmCaptured / Math.max(funnelContacted, 1)) * 100),
                    )}%`
                  : "积累中"}
              </p>
              <p className="mt-1 text-xs text-[var(--kaypal-v3-muted)]">
                有回复并沉淀进 CRM 的比例
              </p>
            </div>
          </div>
        )}
      </V2Section>

      {/* 趋势 */}
      {trend.length > 0 && (
        <V2Section title="近期趋势">
          <div className="flex items-end gap-1">
            {trend.slice(-14).map((day, i) => {
              const item = day as { date?: string; leadCount?: number; count?: number };
              const value = item.leadCount ?? item.count ?? 0;
              const max = Math.max(...trend.map((d) => ((d as { leadCount?: number; count?: number }).leadCount ?? (d as { count?: number }).count ?? 0)), 1);
              const height = Math.max((value / max) * 100, 4);
              return (
                <div key={i} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-xs text-[var(--kaypal-v3-muted)]">{value}</span>
                  <div
                    className="w-full rounded-t bg-[var(--kaypal-v3-accent)]"
                    style={{ height: `${height}px`, minHeight: "4px" }}
                  />
                  <span className="text-11 text-[var(--kaypal-v3-muted)]">
                    {item.date ? new Date(item.date).getDate() + "日" : ""}
                  </span>
                </div>
              );
            })}
          </div>
        </V2Section>
      )}

      {/* P2 T06：成交复盘四维（平台/策略/内容/话术） */}
      {reports?.attribution && (
        <AttributionReportSection attribution={reports.attribution} />
      )}

      <section className="flex items-center justify-between">
        <V2GhostButton icon={ArrowLeft} className="kx-back-to-parent" onClick={() => router.push("/today")}>
          返回今日增长
        </V2GhostButton>
        <V2GhostButton icon={TrendingUp} onClick={() => void fetchReports()}>
          刷新
        </V2GhostButton>
      </section>
    </div>
  );
}

/** P2 T06：归因报告四维（null→N/A，低样本→样本不足，不显示 0 兜底） */
function AttributionReportSection({
  attribution,
}: {
  attribution: NonNullable<GrowthReports["attribution"]>;
}) {
  const [tab, setTab] = useState<"platform" | "strategy" | "content" | "script">(
    "platform",
  );
  const fmtMoney = (cents: number) =>
    `¥${(cents / 100).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
  const rate = (v: number | null) =>
    v === null ? "N/A" : `${(v * 100).toFixed(1)}%`;

  const TABS: Array<{ key: typeof tab; label: string }> = [
    { key: "platform", label: "按平台" },
    { key: "strategy", label: "按策略" },
    { key: "content", label: "按内容" },
    { key: "script", label: "按话术" },
  ];

  return (
    <V2Section
      title="成交复盘"
      description="按平台 / 策略 / 内容 / 话术归因成交，数据来自 CRM 商机 + 来源归因链"
    >
      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              tab === t.key
                ? "bg-[var(--kaypal-v3-accent)] text-white"
                : "bg-[var(--kaypal-v3-paper-soft)] text-[var(--kaypal-v3-muted)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "platform" && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="border-b border-[var(--kaypal-v3-border)] text-left text-xs text-[var(--kaypal-v3-muted)]">
                <th className="py-2 pr-4">平台</th>
                <th className="py-2 pr-4">线索</th>
                <th className="py-2 pr-4">客户</th>
                <th className="py-2 pr-4">商机</th>
                <th className="py-2 pr-4">成交</th>
                <th className="py-2 pr-4">成交金额</th>
                <th className="py-2">转化率</th>
              </tr>
            </thead>
            <tbody>
              {attribution.byPlatform.map((row) => (
                <tr key={row.platform} className="border-b border-[var(--kaypal-v3-border)]/50">
                  <td className="py-2 pr-4 font-medium text-[var(--kaypal-v3-ink)]">{row.platform}</td>
                  <td className="py-2 pr-4 text-[var(--kaypal-v3-soft-ink)]">{row.leads}</td>
                  <td className="py-2 pr-4 text-[var(--kaypal-v3-soft-ink)]">{row.customers}</td>
                  <td className="py-2 pr-4 text-[var(--kaypal-v3-soft-ink)]">{row.opportunities}</td>
                  <td className="py-2 pr-4 text-[var(--kaypal-v3-accent-ink)]">{row.won}</td>
                  <td className="py-2 pr-4 text-[var(--kaypal-v3-soft-ink)]">{fmtMoney(row.wonAmountCents)}</td>
                  <td className="py-2 text-[var(--kaypal-v3-soft-ink)]">{rate(row.conversionRate)}</td>
                </tr>
              ))}
              {attribution.byPlatform.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-xs text-[var(--kaypal-v3-muted)]">
                    暂无归因成交数据
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "strategy" && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="border-b border-[var(--kaypal-v3-border)] text-left text-xs text-[var(--kaypal-v3-muted)]">
                <th className="py-2 pr-4">获客策略</th>
                <th className="py-2 pr-4">平台</th>
                <th className="py-2 pr-4">线索</th>
                <th className="py-2 pr-4">成交</th>
                <th className="py-2 pr-4">成交金额</th>
                <th className="py-2">转化率</th>
              </tr>
            </thead>
            <tbody>
              {attribution.byStrategy.map((row) => (
                <tr key={row.strategyId} className="border-b border-[var(--kaypal-v3-border)]/50">
                  <td className="py-2 pr-4 font-medium text-[var(--kaypal-v3-ink)]">{row.strategyName}</td>
                  <td className="py-2 pr-4 text-[var(--kaypal-v3-soft-ink)]">{row.platform}</td>
                  <td className="py-2 pr-4 text-[var(--kaypal-v3-soft-ink)]">{row.leads}</td>
                  <td className="py-2 pr-4 text-[var(--kaypal-v3-accent-ink)]">{row.won}</td>
                  <td className="py-2 pr-4 text-[var(--kaypal-v3-soft-ink)]">{fmtMoney(row.wonAmountCents)}</td>
                  <td className="py-2 text-[var(--kaypal-v3-soft-ink)]">{rate(row.conversionRate)}</td>
                </tr>
              ))}
              {attribution.byStrategy.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-xs text-[var(--kaypal-v3-muted)]">
                    暂无策略归因成交数据
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "content" && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="border-b border-[var(--kaypal-v3-border)] text-left text-xs text-[var(--kaypal-v3-muted)]">
                <th className="py-2 pr-4">内容</th>
                <th className="py-2 pr-4">线索</th>
                <th className="py-2 pr-4">客户</th>
                <th className="py-2 pr-4">成交</th>
                <th className="py-2">成交金额</th>
              </tr>
            </thead>
            <tbody>
              {attribution.byContent.map((row) => (
                <tr key={row.articleId} className="border-b border-[var(--kaypal-v3-border)]/50">
                  <td className="max-w-[260px] truncate py-2 pr-4 font-medium text-[var(--kaypal-v3-ink)]">{row.title}</td>
                  <td className="py-2 pr-4 text-[var(--kaypal-v3-soft-ink)]">{row.leads}</td>
                  <td className="py-2 pr-4 text-[var(--kaypal-v3-soft-ink)]">{row.customers}</td>
                  <td className="py-2 pr-4 text-[var(--kaypal-v3-accent-ink)]">{row.won}</td>
                  <td className="py-2 text-[var(--kaypal-v3-soft-ink)]">{fmtMoney(row.wonAmountCents)}</td>
                </tr>
              ))}
              {attribution.byContent.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-xs text-[var(--kaypal-v3-muted)]">
                    暂无内容归因成交数据
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "script" && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="border-b border-[var(--kaypal-v3-border)] text-left text-xs text-[var(--kaypal-v3-muted)]">
                <th className="py-2 pr-4">话术</th>
                <th className="py-2 pr-4">使用次数</th>
                <th className="py-2 pr-4">线索</th>
                <th className="py-2 pr-4">成交</th>
                <th className="py-2">成交金额</th>
              </tr>
            </thead>
            <tbody>
              {attribution.byScript.map((row) => (
                <tr key={row.text} className="border-b border-[var(--kaypal-v3-border)]/50">
                  <td className="max-w-[260px] truncate py-2 pr-4 font-medium text-[var(--kaypal-v3-ink)]">
                    {row.text}
                    {row.lowConfidence && (
                      <span className="ml-2 rounded bg-[var(--kaypal-v3-warning-soft)] px-1.5 py-0.5 text-11 text-[var(--kaypal-v3-warning-ink)]">
                        样本不足
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-[var(--kaypal-v3-soft-ink)]">{row.usageCount}</td>
                  <td className="py-2 pr-4 text-[var(--kaypal-v3-soft-ink)]">{row.leads}</td>
                  <td className="py-2 pr-4 text-[var(--kaypal-v3-accent-ink)]">{row.won}</td>
                  <td className="py-2 text-[var(--kaypal-v3-soft-ink)]">{fmtMoney(row.wonAmountCents)}</td>
                </tr>
              ))}
              {attribution.byScript.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-xs text-[var(--kaypal-v3-muted)]">
                    暂无话术归因成交数据
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </V2Section>
  );
}
