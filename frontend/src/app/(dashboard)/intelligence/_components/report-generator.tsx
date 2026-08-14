"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  BarChart3,
  Building2,
  FileText,
  Loader2,
  Newspaper,
  Radar,
  TrendingUp,
} from "lucide-react";
import {
  V2Section,
  V2Field,
  V2Input,
  V2PrimaryButton,
  V2GhostButton,
  V2OptionCard,
} from "@/components/v2/ui-kit";
import { intelligenceApi } from "@/lib/api/intelligence";
import { redfoxApi, type HotTopicItem } from "@/lib/api/redfox";
import { toPublicError } from "@/lib/public-error";
import { useIsMobile } from "@/lib/hooks/use-media-query";

const REPORT_KINDS = [
  { value: "daily", label: "日报", desc: "今日热点速览", icon: Newspaper },
  { value: "monitor", label: "舆情日报", desc: "监控项今日发现聚合", icon: Radar },
  { value: "weekly", label: "周报", desc: "本周情报汇总", icon: FileText },
  { value: "industry", label: "行业分析", desc: "行业趋势和竞品动态", icon: TrendingUp },
  { value: "competitor", label: "竞品分析", desc: "盯住对手的打法", icon: BarChart3 },
  { value: "custom", label: "自定义主题", desc: "你关心什么就写什么", icon: Building2 },
] as const;

const RANGE_OPTIONS = [
  { value: "7d", label: "最近 7 天" },
  { value: "14d", label: "最近 14 天" },
  { value: "30d", label: "最近 30 天" },
] as const;

/** 今日热点 → 日报 markdown（不依赖 AI：热点数据实时可拿，快速且可控） */
function buildDailyMarkdown(items: HotTopicItem[]): string {
  const now = new Date();
  const dateLabel = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const byPlatform = new Map<string, HotTopicItem[]>();
  for (const item of items) {
    const key = item.platform || "其他";
    const list = byPlatform.get(key) ?? [];
    list.push(item);
    byPlatform.set(key, list);
  }
  const platformLines = [...byPlatform.entries()]
    .map(
      ([platform, list]) =>
        `### ${platform}（${list.length} 条）\n${list
          .map(
            (item, i) =>
              `${i + 1}. **${item.title}**${item.heat ? `（热度 ${item.heat}）` : ""}${item.url ? ` [原文](${item.url})` : ""}`,
          )
          .join("\n")}`,
    )
    .join("\n\n");
  return [
    `# 今日热点日报（${dateLabel}）`,
    ``,
    `> 数据来源：全网热点聚合（30 分钟缓存）｜生成时间 ${now.toLocaleTimeString("zh-CN")}`,
    ``,
    `## 总览`,
    `- 今日聚合热点 **${items.length} 条**，覆盖 ${byPlatform.size} 个平台`,
    `- 高热度选题建议优先跟进：${items
      .filter((i) => i.heat)
      .slice(0, 3)
      .map((i) => `「${i.title}」`)
      .join("、") || "按平台分布挑选切入"} `,
    ``,
    platformLines,
    ``,
    `---`,
    `*日报由 JIUZHANG AI 自动生成，用于选题灵感参考。*`,
  ].join("\n");
}

/** 舆情监控日报：active 监控项 + 今日发现聚合（不走 AI，直连 monitors/items） */
async function buildMonitorDailyMarkdown(): Promise<string> {
  const now = new Date();
  const dateLabel = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const [monitorPage, itemPage] = await Promise.all([
    intelligenceApi.listMonitors({ page: 1, limit: 100, status: "active" }),
    intelligenceApi.listItems({ page: 1, limit: 100, from: `${dateLabel}T00:00:00` }),
  ]);
  const monitors = monitorPage?.items ?? [];
  const items = itemPage?.items ?? [];

  if (monitors.length === 0) {
    throw new Error("还没有监控项——先去「舆情监控」新建监控（品牌词/竞品/关键词）");
  }
  if (items.length === 0) {
    return [
      `# 舆情监控日报（${dateLabel}）`,
      ``,
      `> 监控项 **${monitors.length} 个** ｜今日暂无新增发现`,
      ``,
      `## 监控项清单`,
      ...monitors.map(
        (m, i) =>
          `${i + 1}. **${m.keyword || m.type}**（${m.platform || "全网"}${m.schedule ? ` · ${m.schedule}` : ""}）`,
      ),
      ``,
      `---`,
      `*日报由 JIUZHANG AI 自动生成，用于舆情监控参考。*`,
    ].join("\n");
  }

  // 按平台分组今日发现
  const byPlatform = new Map<string, typeof items>();
  for (const item of items) {
    const key = item.platform || "其他";
    const list = byPlatform.get(key) ?? [];
    list.push(item);
    byPlatform.set(key, list);
  }
  const platformLines = [...byPlatform.entries()]
    .map(
      ([platform, list]) =>
        `### ${platform}（${list.length} 条）\n${list
          .slice(0, 15)
          .map(
            (item, i) =>
              `${i + 1}. **${item.title}**${item.author ? `（@${item.author}）` : ""}${item.publishDate ? ` ${item.publishDate.slice(5, 16)}` : ""}${item.sourceUrl ? ` [原文](${item.sourceUrl})` : ""}`,
          )
          .join("\n")}`,
    )
    .join("\n\n");

  return [
    `# 舆情监控日报（${dateLabel}）`,
    ``,
    `> 监控项 **${monitors.length} 个** ｜今日新增发现 **${items.length} 条**`,
    ``,
    `## 总览`,
    `- 监控范围：${monitors.map((m) => m.keyword || m.type).join("、")}`,
    `- 今日发现 ${items.length} 条，覆盖 ${byPlatform.size} 个平台`,
    `- 建议优先跟进：${items
      .slice(0, 3)
      .map((i) => `「${i.title.slice(0, 24)}${i.title.length > 24 ? "…" : ""}」`)
      .join("、")}`,
    ``,
    platformLines,
    ``,
    `---`,
    `*日报由 JIUZHANG AI 自动生成，用于舆情监控参考。*`,
  ].join("\n");
}

export function ReportGenerator() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneReportId, setDoneReportId] = useState<string | null>(null);

  // 智能默认值：周报 + 最近 7 天
  const [form, setForm] = useState({
    kind: "weekly",
    topic: "",
    rangeKey: "7d",
  });

  const canSubmit = form.kind !== "custom" || form.topic.trim().length > 0;

  const kindLabel =
    REPORT_KINDS.find((k) => k.value === form.kind)?.label || "报告";

  const handleGenerate = async () => {
    if (!canSubmit) return;
    setGenerating(true);
    setError(null);
    setDoneReportId(null);
    try {
      const title =
        form.kind === "custom"
          ? form.topic.trim()
          : form.kind === "daily"
            ? `今日热点日报（${new Date().toLocaleDateString("zh-CN")}）`
            : form.kind === "monitor"
              ? `舆情监控日报（${new Date().toLocaleDateString("zh-CN")}）`
              : `${kindLabel}（${RANGE_OPTIONS.find((r) => r.value === form.rangeKey)?.label}）`;

      // 日报/舆情日报不走 AI：直连热点/监控发现聚合组装，快且内容可控
      let markdown = "";
      if (form.kind === "daily") {
        const hot = await redfoxApi.hotTopics();
        const items = Array.isArray(hot?.items) ? hot.items : [];
        if (items.length === 0) {
          throw new Error("暂时没有聚合到今日热点，稍后再试");
        }
        markdown = buildDailyMarkdown(items);
      }
      if (form.kind === "monitor") {
        markdown = await buildMonitorDailyMarkdown();
      }

      const report = await intelligenceApi.createReport({
        kind: form.kind,
        title,
        rangeKey: form.rangeKey,
        markdown,
      });

      // 后端收到创建请求后会自动开始生成
      if (report?.id) {
        setDoneReportId(report.id);
      }
    } catch (err: unknown) {
      setError(toPublicError(err, "生成报告失败，请稍后重试"));
    } finally {
      setGenerating(false);
    }
  };

  /* 移动端原生视图（mx-* 明德 VP 风格）——intelligence-v2/report-new */
  if (isMobile) {
    /* 完成态 */
    if (doneReportId) {
      return (
        <div className="kx-mobile-ambient">
          <div className="mx-px" style={{ paddingTop: 10, paddingBottom: 28 }}>
            <div className="mx-header">
              <div className="mx-page-title">生成报告</div>
            </div>
            <div className="mx-card" style={{ marginTop: 14, padding: 30, textAlign: "center" }}>
              <FileText width={32} height={32} style={{ color: "#059669", margin: "0 auto" }} />
              <p style={{ fontSize: 14, fontWeight: 700, color: "var(--mx-ink)", marginTop: 11 }}>报告已开始生成</p>
              <p style={{ fontSize: 11.5, color: "var(--mx-muted)", marginTop: 5, lineHeight: 1.55 }}>AI 正在分析数据写报告，稍等片刻就能在报告列表里看到</p>
              <button type="button" className="mx-btn-gold" style={{ marginTop: 16 }} onClick={() => router.push("/intelligence/reports")}>去看报告</button>
              <button type="button" onClick={() => setDoneReportId(null)} style={{ display: "block", margin: "10px auto 0", fontSize: 12, color: "var(--mx-muted)", background: "none", border: "none" }}>
                再生成一份
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="kx-mobile-ambient">
        <div className="mx-px" style={{ paddingTop: 10, paddingBottom: 28 }}>
          <div className="mx-header">
            <div className="mx-header-row" style={{ alignItems: "center" }}>
              <button type="button" onClick={() => router.push("/intelligence/reports")} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--mx-muted)", background: "none", border: "none", padding: 0, flexShrink: 0 }}>
                <ArrowLeft width={14} height={14} /> 返回报告列表
              </button>
              <div style={{ textAlign: "center", flex: 1 }}>
                <div className="mx-page-title" style={{ fontSize: 18 }}>生成报告</div>
                <div className="mx-page-sub" style={{ marginTop: 1 }}>选个类型点一下，AI 自动帮你写好</div>
              </div>
              <span style={{ flexShrink: 0, width: 44 }} />
            </div>
          </div>

          {error && (
            <div className="mx-card" style={{ marginTop: 10, padding: 11, borderColor: "rgba(220,80,80,.4)" }}>
              <p style={{ fontSize: 12.5, color: "#dc2626" }}>{error}</p>
            </div>
          )}

          {/* 报告类型 */}
          <div className="mx-section-head" style={{ marginTop: 14 }}>报告类型</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {REPORT_KINDS.map(({ value, label, desc, icon: KindIcon }) => {
              const selected = form.kind === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, kind: value }))}
                  className="mx-card"
                  style={{ padding: 12, display: "flex", alignItems: "center", gap: 11, textAlign: "left", borderColor: selected ? "rgba(222,150,57,.6)" : undefined, background: selected ? "rgba(246,196,120,.1)" : undefined }}
                >
                  <span style={{ width: 34, height: 34, borderRadius: 9, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "rgba(246,196,120,.14)", color: "#d98a2d", flexShrink: 0 }}>
                    <KindIcon width={16} height={16} />
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: "var(--mx-ink)" }}>{label}</span>
                    <span style={{ display: "block", fontSize: 11, color: "var(--mx-muted)", marginTop: 1 }}>{desc}</span>
                  </span>
                  {selected && <span style={{ color: "#d98a2d", fontSize: 14, flexShrink: 0 }}>✓</span>}
                </button>
              );
            })}
          </div>

          {/* 自定义主题 */}
          {form.kind === "custom" && (
            <>
              <div className="mx-section-head" style={{ marginTop: 16 }}>分析主题</div>
              <input
                placeholder="例如：最近空气炸锅品类的内容趋势"
                value={form.topic}
                onChange={(e) => setForm((p) => ({ ...p, topic: e.target.value }))}
                style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(142,165,190,.3)", background: "rgba(255,255,255,.06)", color: "var(--mx-ink)", fontSize: 13 }}
              />
            </>
          )}

          {/* 时间范围 */}
          {form.kind !== "daily" && (
            <>
              <div className="mx-section-head" style={{ marginTop: 16 }}>时间范围</div>
              <div style={{ display: "flex", gap: 7 }}>
                {RANGE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setForm((p) => ({ ...p, rangeKey: opt.value }))}
                    style={{ flex: 1, padding: "8px 0", borderRadius: 9, fontSize: 12, fontWeight: 600, background: form.rangeKey === opt.value ? "rgba(246,196,120,.18)" : "rgba(120,148,179,.12)", color: form.rangeKey === opt.value ? "#d98a2d" : "var(--mx-ink)", border: "1px solid " + (form.rangeKey === opt.value ? "rgba(222,150,57,.5)" : "rgba(142,165,190,.3)") }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* 操作 */}
          <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
            <button type="button" onClick={() => router.push("/intelligence/reports")} style={{ flex: "0 0 auto", padding: "10px 16px", borderRadius: 10, background: "rgba(120,148,179,.12)", color: "var(--mx-ink)", border: "1px solid rgba(142,165,190,.3)", fontSize: 12.5, fontWeight: 600 }}>
              返回
            </button>
            <button
              type="button"
              className="mx-btn-gold"
              style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
              disabled={!canSubmit || generating}
              onClick={() => void handleGenerate()}
            >
              {generating ? <Loader2 width={15} height={15} className="animate-spin" /> : <FileText width={15} height={15} />}
              {generating ? "正在生成…" : `生成${kindLabel}`}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)] hover:text-[var(--kaypal-v3-ink)]"
            onClick={() => router.push("/intelligence/reports")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">
              生成报告
            </h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              选个类型点一下，AI 自动帮你写好
            </p>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      {doneReportId ? (
        <V2Section>
          <div className="py-8 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[var(--kaypal-v3-success-soft)]">
              <FileText className="h-8 w-8 text-[var(--kaypal-v3-success)]" />
            </div>
            <h3 className="mt-4 text-lg font-semibold text-[var(--kaypal-v3-ink)]">
              报告已开始生成
            </h3>
            <p className="mt-2 text-sm text-[var(--kaypal-v3-muted)]">
              AI 正在分析数据写报告，稍等片刻就能在报告列表里看到
            </p>
            <div className="mt-6 flex items-center justify-center gap-3">
              <V2PrimaryButton
                onClick={() => router.push("/intelligence/reports")}
              >
                去看报告
              </V2PrimaryButton>
              <V2GhostButton onClick={() => setDoneReportId(null)}>
                再生成一份
              </V2GhostButton>
            </div>
          </div>
        </V2Section>
      ) : (
        <>
          {/* 类型选择 */}
          <V2Section title="报告类型">
            <div className="grid gap-3 sm:grid-cols-2">
              {REPORT_KINDS.map(({ value, label, desc, icon }) => (
                <V2OptionCard
                  key={value}
                  icon={icon}
                  title={label}
                  description={desc}
                  selected={form.kind === value}
                  onClick={() => setForm((p) => ({ ...p, kind: value }))}
                />
              ))}
            </div>
          </V2Section>

          {/* 自定义主题 */}
          {form.kind === "custom" && (
            <V2Section title="分析主题">
              <V2Field label="想分析什么" required hint="例如：最近空气炸锅品类的内容趋势">
                <V2Input
                  placeholder="例如：最近空气炸锅品类的内容趋势"
                  value={form.topic}
                  onChange={(e) => setForm((p) => ({ ...p, topic: e.target.value }))}
                />
              </V2Field>
            </V2Section>
          )}

          {/* 时间范围（日报固定今日，不展示） */}
          {form.kind !== "daily" && (
            <V2Section title="时间范围">
              <div className="grid grid-cols-3 gap-3">
                {RANGE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`rounded-[var(--kaypal-v3-radius-sm)] border px-3 py-2.5 text-sm font-medium transition ${
                      form.rangeKey === opt.value
                        ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]"
                        : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] text-[var(--kaypal-v3-soft-ink)] hover:border-[var(--kaypal-v3-border-strong)]"
                    }`}
                    onClick={() => setForm((p) => ({ ...p, rangeKey: opt.value }))}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </V2Section>
          )}

          <section className="flex items-center justify-between">
            <V2GhostButton icon={ArrowLeft} onClick={() => router.push("/intelligence/reports")}>
              返回
            </V2GhostButton>
            <V2PrimaryButton
              icon={generating ? Loader2 : FileText}
              loading={generating}
              disabled={!canSubmit}
              onClick={handleGenerate}
            >
              {generating ? "正在生成..." : `生成${kindLabel}`}
            </V2PrimaryButton>
          </section>
        </>
      )}
    </div>
  );
}
