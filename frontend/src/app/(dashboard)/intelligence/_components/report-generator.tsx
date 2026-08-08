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

const REPORT_KINDS = [
  { value: "daily", label: "日报", desc: "今日热点速览", icon: Newspaper },
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
    `> 数据来源：RedFox 全网热点聚合（30 分钟缓存）｜生成时间 ${now.toLocaleTimeString("zh-CN")}`,
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

export function ReportGenerator() {
  const router = useRouter();
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
            : `${kindLabel}（${RANGE_OPTIONS.find((r) => r.value === form.rangeKey)?.label}）`;

      // 日报不走 AI：直连热点聚合（30 分钟缓存）组装，快且内容可控
      let markdown = "";
      if (form.kind === "daily") {
        const hot = await redfoxApi.hotTopics();
        const items = Array.isArray(hot?.items) ? hot.items : [];
        if (items.length === 0) {
          throw new Error("暂时没有聚合到今日热点，稍后再试");
        }
        markdown = buildDailyMarkdown(items);
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
