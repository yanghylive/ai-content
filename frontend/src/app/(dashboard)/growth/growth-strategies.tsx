"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ClipboardList,
  Loader2,
  Rocket,
  Sparkles,
  XCircle,
} from "@/components/iconpark";
import {
  V2Section,
  V2Field,
  V2Input,
  V2Select,
  V2StatusChip,
  V2GhostButton,
  V2PrimaryButton,
  V2EmptyState,
} from "@/components/v2/ui-kit";
import { V2BackButton } from "@/components/v2/v2-back-button";
import {
  growthApi,
  type GrowthStrategyTemplate,
  type GrowthPlatform,
  type GrowthAcquisitionMode,
  type KeywordSuggestions,
  type KeywordSuggestion,
} from "@/lib/api/growth";
import { toPublicError } from "@/lib/public-error";
import { SkeletonList } from "@/components/skeleton";
import { toActionableError } from "@/lib/public-error";

const PLATFORM_OPTIONS = [
  { value: "douyin", label: "抖音" },
  { value: "xiaohongshu", label: "小红书" },
  { value: "wechat-channel", label: "视频号" },
  { value: "wechat", label: "微信" },
  { value: "wecom", label: "企业微信" },
  { value: "kuaishou", label: "快手" },
] as const;

const RISK_LABELS: Record<string, string> = {
  "confirm-first": "每条先给我确认（推荐）",
  "draft-only": "只存草稿，我自己发",
  auto: "自动发送（高风险）",
};

const MODE_OPTIONS = [
  { value: "keyword", label: "关键词获客", desc: "搜关键词找客户" },
  { value: "search-account", label: "搜索账号", desc: "盯指定账号的粉丝" },
  { value: "video-link", label: "视频链接", desc: "从指定视频下找客户" },
  { value: "target-account", label: "目标账号", desc: "定向触达账号" },
  { value: "retention", label: "留资获客", desc: "收集留资线索" },
  { value: "manual-import", label: "手动导入", desc: "导入已有名单" },
] as const;

/** 关键词建议分组（勾选采纳） */
function SuggestionGroup(props: {
  title: string;
  items: KeywordSuggestion[];
  picked: Set<string>;
  onToggle: (word: string) => void;
  tone?: "default" | "danger";
}) {
  const { title, items, picked, onToggle, tone } = props;
  if (items.length === 0) {
    return (
      <div>
        <p className="text-sm font-medium text-[var(--kaypal-v3-ink)]">{title}</p>
        <p className="mt-1 text-xs text-[var(--kaypal-v3-muted)]">暂无建议</p>
      </div>
    );
  }
  const toneClass =
    tone === "danger"
      ? "border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)]"
      : "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)]";
  return (
    <div>
      <p className="text-sm font-medium text-[var(--kaypal-v3-ink)]">{title}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {items.map((s) => {
          const active = picked.has(s.keyword);
          return (
            <button
              key={s.keyword}
              type="button"
              className={`rounded-full border px-3 py-1 text-sm transition ${
                active
                  ? toneClass
                  : "border-[var(--kaypal-v3-border)] text-[var(--kaypal-v3-muted)] hover:border-[var(--kaypal-v3-border-strong)]"
              }`}
              onClick={() => onToggle(s.keyword)}
              title={`命中 ${s.evidenceCount} 条线索`}
            >
              {s.keyword}
              <span className="ml-1 text-xs opacity-70">×{s.evidenceCount}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function GrowthStrategies() {
  const router = useRouter();
  const [strategies, setStrategies] = useState<GrowthStrategyTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 复核弹窗
  const [applyTarget, setApplyTarget] = useState<GrowthStrategyTemplate | null>(null);
  const [applyTaskName, setApplyTaskName] = useState("");
  const [applyPlatform, setApplyPlatform] = useState<GrowthPlatform>("douyin");
  const [applyMode, setApplyMode] = useState<GrowthAcquisitionMode>("keyword");
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [appliedId, setAppliedId] = useState<string | null>(null);

  // AI 生成策略
  const [generateOpen, setGenerateOpen] = useState(false);
  const [genIndustry, setGenIndustry] = useState("");
  const [genScenario, setGenScenario] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  // 关键词建议（C 类 C-a/C-b）
  const [suggestTarget, setSuggestTarget] = useState<GrowthStrategyTemplate | null>(null);
  const [suggestions, setSuggestions] = useState<KeywordSuggestions | null>(null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  // 是否用 AI 语义归纳（C-b），默认规则版（C-a）
  const [suggestUseLLM, setSuggestUseLLM] = useState(false);
  // 勾选采纳的词（按类别存 Set）
  const [pickedSource, setPickedSource] = useState<Set<string>>(new Set());
  const [pickedDemand, setPickedDemand] = useState<Set<string>>(new Set());
  const [pickedExclude, setPickedExclude] = useState<Set<string>>(new Set());
  const [applyingSuggest, setApplyingSuggest] = useState(false);

  const openSuggest = async (strategy: GrowthStrategyTemplate, useLLM?: boolean) => {
    const mode = useLLM ?? suggestUseLLM;
    setSuggestTarget(strategy);
    setSuggestions(null);
    setSuggestError(null);
    setPickedSource(new Set());
    setPickedDemand(new Set());
    setPickedExclude(new Set());
    setSuggestLoading(true);
    try {
      const data = await growthApi.keywordSuggestions({
        industry: strategy.industry || undefined,
        mode: mode ? "llm" : "rule",
      });
      setSuggestions(data);
    } catch (err: unknown) {
      setSuggestError(toPublicError(err, "生成关键词建议失败"));
    } finally {
      setSuggestLoading(false);
    }
  };

  const togglePick = (
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    word: string,
  ) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(word)) next.delete(word);
      else next.add(word);
      return next;
    });
  };

  const handleApplySuggest = async () => {
    if (!suggestTarget) return;
    setApplyingSuggest(true);
    setSuggestError(null);
    try {
      await growthApi.applyKeywordSuggestions(suggestTarget.id, {
        sourceKeywords: Array.from(pickedSource),
        demandKeywords: Array.from(pickedDemand),
        excludeKeywords: Array.from(pickedExclude),
      });
      setSuggestTarget(null);
      await fetchStrategies();
    } catch (err: unknown) {
      setSuggestError(toPublicError(err, "采纳失败，请稍后重试"));
    } finally {
      setApplyingSuggest(false);
    }
  };

  const handleGenerate = async () => {
    if (!genIndustry.trim()) {
      setGenError("先填行业，例如：美业、装修、教育");
      return;
    }
    setGenerating(true);
    setGenError(null);
    try {
      await growthApi.generateStrategy({
        industry: genIndustry.trim(),
        scenario: genScenario.trim() || undefined,
      });
      setGenerateOpen(false);
      setGenIndustry("");
      setGenScenario("");
      await fetchStrategies();
    } catch (err: unknown) {
      const rawMessage = toActionableError(err, "");
      setGenError(rawMessage || toPublicError(err, "生成失败，请稍后重试"));
    } finally {
      setGenerating(false);
    }
  };

  const fetchStrategies = useCallback(async () => {
    try {
      setLoading(true);
      const data = await growthApi.listStrategies();
      setStrategies(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      setError(toPublicError(err, "加载策略失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStrategies();
  }, [fetchStrategies]);

  /* 打开复核弹窗：预填策略默认值 */
  const openApply = (strategy: GrowthStrategyTemplate) => {
    setApplyTarget(strategy);
    setApplyTaskName(`${strategy.name}（获客任务）`);
    setApplyMode("keyword");
    setApplyError(null);
  };

  const handleApply = async () => {
    if (!applyTarget) return;
    setApplying(true);
    setApplyError(null);
    try {
      const result = await growthApi.applyStrategy(applyTarget.id, {
        taskName: applyTaskName.trim() || undefined,
        mode: applyMode,
        platform: applyPlatform,
      });
      setAppliedId(applyTarget.id);
      setApplyTarget(null);
      // 成功后显示创建的任务信息
      console.log("策略已应用，任务：", result);
    } catch (err: unknown) {
      const rawMessage = toActionableError(err, "");
      setApplyError(
        rawMessage || toPublicError(err, "应用失败，请稍后重试"),
      );
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="kx-page-head">
        <div>
          <V2BackButton to="/today" label="返回今日增长" />
          <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">获客策略</h1>
          <p className="kx-greet-sub mt-1 text-[var(--kaypal-v3-muted)]">按行业预置的获客打法，选一个直接用</p>
        </div>
        <V2PrimaryButton icon={Sparkles} onClick={() => setGenerateOpen(true)}>
          AI 生成策略
        </V2PrimaryButton>
      </div>

      {appliedId && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-[var(--kaypal-v3-success)]">
              ✓ 策略已应用，获客任务已创建
            </p>
            <button
              type="button"
              className="text-sm font-medium text-[var(--kaypal-v3-accent-ink)] hover:underline"
              onClick={() => router.push("/growth/acquisition")}
            >
              去查看任务 →
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="kaypal-v3-panel p-12 text-center">
          <SkeletonList rows={5} />
        </div>
      ) : strategies.length === 0 ? (
        <V2Section>
          <V2EmptyState
            icon={ClipboardList}
            title="还没有获客策略"
            description="让 AI 按你的行业生成一套获客打法"
            action={
              <V2PrimaryButton icon={Sparkles} onClick={() => setGenerateOpen(true)}>
                AI 生成策略
              </V2PrimaryButton>
            }
          />
        </V2Section>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {strategies.map((strategy) => (
            <div key={strategy.id} className="kaypal-v3-panel p-5">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="font-semibold text-[var(--kaypal-v3-ink)]">
                    {strategy.name}
                  </h3>
                  <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
                    {strategy.industry} · {strategy.scenario}
                  </p>
                </div>
                {appliedId === strategy.id && (
                  <V2StatusChip tone="success">已应用</V2StatusChip>
                )}
              </div>

              {/* 策略要点 */}
              <div className="mt-3 space-y-1.5 text-sm text-[var(--kaypal-v3-muted)]">
                {strategy.sourceKeywords?.length > 0 && (
                  <p>找客户关键词：{strategy.sourceKeywords.slice(0, 3).join("、")}</p>
                )}
                {strategy.demandKeywords?.length > 0 && (
                  <p>意向关键词：{strategy.demandKeywords.slice(0, 3).join("、")}</p>
                )}
                <p>
                  默认每日上限 {strategy.defaultDailyLimit} 人 ·{" "}
                  {RISK_LABELS[strategy.defaultRiskMode] || strategy.defaultRiskMode}
                </p>
              </div>

              <div className="mt-4 flex justify-end gap-2">
                <V2GhostButton
                  icon={Sparkles}
                  onClick={() => openSuggest(strategy)}
                >
                  关键词建议
                </V2GhostButton>
                <V2PrimaryButton
                  icon={Rocket}
                  disabled={appliedId === strategy.id}
                  onClick={() => openApply(strategy)}
                >
                  {appliedId === strategy.id ? "已应用" : "使用这个策略"}
                </V2PrimaryButton>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* AI 生成策略弹窗 */}
      {generateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-[var(--kaypal-v3-radius)] bg-[var(--kaypal-v3-paper)] p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-[var(--kaypal-v3-ink)]">
                AI 生成获客策略
              </h3>
              <button
                type="button"
                className="rounded-full p-1 text-[var(--kaypal-v3-muted)] hover:bg-[var(--kaypal-v3-paper-soft)]"
                onClick={() => setGenerateOpen(false)}
              >
                <XCircle className="h-5 w-5" />
              </button>
            </div>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              告诉 AI 你的行业，它给你生成一套完整的获客打法（关键词、话术、风控都配好）
            </p>
            <div className="mt-5 space-y-4">
              <V2Field label="你的行业" required hint="例如：美业、装修、教育、餐饮">
                <V2Input
                  placeholder="例如：美业"
                  value={genIndustry}
                  onChange={(e) => setGenIndustry(e.target.value)}
                />
              </V2Field>
              <V2Field label="具体场景" hint="可选：你想获客的具体方向">
                <V2Input
                  placeholder="例如：美甲店新客、二手房装修"
                  value={genScenario}
                  onChange={(e) => setGenScenario(e.target.value)}
                />
              </V2Field>
            </div>
            {genError && (
              <p className="mt-4 text-sm text-[var(--kaypal-v3-danger)]">{genError}</p>
            )}
            <div className="mt-6 flex items-center justify-end gap-3">
              <V2GhostButton onClick={() => setGenerateOpen(false)}>取消</V2GhostButton>
              <V2PrimaryButton
                icon={generating ? Loader2 : Sparkles}
                loading={generating}
                onClick={handleGenerate}
              >
                {generating ? "AI 正在生成..." : "生成策略"}
              </V2PrimaryButton>
            </div>
          </div>
        </div>
      )}

      {/* 复核弹窗（应用前必看） */}
      {applyTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-[var(--kaypal-v3-radius)] bg-[var(--kaypal-v3-paper)] p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-[var(--kaypal-v3-ink)]">
                使用前确认一下
              </h3>
              <button
                type="button"
                className="rounded-full p-1 text-[var(--kaypal-v3-muted)] hover:bg-[var(--kaypal-v3-paper-soft)]"
                onClick={() => setApplyTarget(null)}
              >
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            {/* 策略摘要 */}
            <div className="mt-4 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-paper-soft)] p-4 text-sm">
              <p className="font-medium text-[var(--kaypal-v3-ink)]">{applyTarget.name}</p>
              <p className="mt-1 text-[var(--kaypal-v3-muted)]">
                {applyTarget.industry} · {applyTarget.scenario}
              </p>
              {applyTarget.sourceKeywords?.length > 0 && (
                <p className="mt-2 text-[var(--kaypal-v3-muted)]">
                  关键词：{applyTarget.sourceKeywords.join("、")}
                </p>
              )}
              <p className="mt-1 text-[var(--kaypal-v3-muted)]">
                每日上限 {applyTarget.defaultDailyLimit} 人 ·{" "}
                {RISK_LABELS[applyTarget.defaultRiskMode]}
              </p>
            </div>

            {/* 可改参数 */}
            <div className="mt-5 space-y-4">
              <V2Field label="任务名称" hint="给你自己认的名字">
                <V2Input
                  value={applyTaskName}
                  onChange={(e) => setApplyTaskName(e.target.value)}
                />
              </V2Field>
              <V2Field label="获客方式">
                <div className="grid grid-cols-3 gap-3">
                  {MODE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`rounded-[var(--kaypal-v3-radius-sm)] border p-3 text-left transition ${
                        applyMode === opt.value
                          ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)]"
                          : "border-[var(--kaypal-v3-border)] hover:border-[var(--kaypal-v3-border-strong)]"
                      }`}
                      onClick={() => setApplyMode(opt.value)}
                    >
                      <p className="text-sm font-medium text-[var(--kaypal-v3-ink)]">
                        {opt.label}
                      </p>
                      <p className="mt-0.5 text-xs text-[var(--kaypal-v3-muted)]">
                        {opt.desc}
                      </p>
                    </button>
                  ))}
                </div>
              </V2Field>
              <V2Field label="平台">
                <V2Select
                  value={applyPlatform}
                  onChange={(e) => setApplyPlatform(e.target.value as GrowthPlatform)}
                >
                  {PLATFORM_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </V2Select>
              </V2Field>
            </div>

            {applyError && (
              <p className="mt-4 text-sm text-[var(--kaypal-v3-danger)]">{applyError}</p>
            )}

            <div className="mt-6 flex items-center justify-end gap-3">
              <V2GhostButton onClick={() => setApplyTarget(null)}>取消</V2GhostButton>
              <V2PrimaryButton
                icon={applying ? Loader2 : Rocket}
                loading={applying}
                onClick={handleApply}
              >
                {applying ? "正在创建..." : "确认创建获客任务"}
              </V2PrimaryButton>
            </div>
          </div>
        </div>
      )}

      {/* 关键词建议弹窗（C 类 C-a） */}
      {suggestTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-[var(--kaypal-v3-radius)] bg-[var(--kaypal-v3-paper)] p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-[var(--kaypal-v3-ink)]">
                关键词建议
              </h3>
              <button
                type="button"
                className="rounded-full p-1 text-[var(--kaypal-v3-muted)] hover:bg-[var(--kaypal-v3-paper-soft)]"
                onClick={() => setSuggestTarget(null)}
              >
                <XCircle className="h-5 w-5" />
              </button>
            </div>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              根据「{suggestTarget.name}」的真实线索行为，反推下一轮该搜什么词。勾选采纳后追加进策略。
            </p>

            {/* AI 归纳开关：C-b（LLM 语义归纳造新词）vs C-a（词库命中统计） */}
            <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-[var(--kaypal-v3-ink)]">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--kaypal-v3-primary)]"
                checked={suggestUseLLM}
                disabled={suggestLoading}
                onChange={(e) => {
                  const next = e.target.checked;
                  setSuggestUseLLM(next);
                  if (suggestTarget) void openSuggest(suggestTarget, next);
                }}
              />
              <span>AI 语义归纳（自动发现词库里没有的新词，更智能但更慢）</span>
            </label>

            {suggestLoading ? (
              <div className="mt-6 flex items-center justify-center gap-2 py-8 text-sm text-[var(--kaypal-v3-muted)]">
                <Loader2 className="h-4 w-4 animate-spin" /> 正在分析线索行为...
              </div>
            ) : suggestions ? (
              suggestions.analyzedLeadCount === 0 ? (
                <p className="mt-6 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-paper-soft)] p-4 text-sm text-[var(--kaypal-v3-muted)]">
                  近 30 天没有可分析的线索（样本不足或没有回复互动）。先去跑几轮获客任务，积累真实线索后再来生成建议。
                </p>
              ) : (
                <div className="mt-5 space-y-5">
                  <p className="text-xs text-[var(--kaypal-v3-muted)]">
                    分析 {suggestions.analyzedLeadCount} 条线索 · 真客户 {suggestions.positiveLeadCount} 条 · 负反馈 {suggestions.negativeLeadCount} 条
                  </p>

                  <SuggestionGroup
                    title="找客户关键词（搜账号用）"
                    items={suggestions.sourceKeywords}
                    picked={pickedSource}
                    onToggle={(w) => togglePick(setPickedSource, w)}
                  />
                  <SuggestionGroup
                    title="意向关键词（识别真客户用）"
                    items={suggestions.demandKeywords}
                    picked={pickedDemand}
                    onToggle={(w) => togglePick(setPickedDemand, w)}
                  />
                  <SuggestionGroup
                    title="排除关键词（负反馈高频词）"
                    items={suggestions.excludeKeywords}
                    picked={pickedExclude}
                    onToggle={(w) => togglePick(setPickedExclude, w)}
                    tone="danger"
                  />
                </div>
              )
            ) : null}

            {suggestError && (
              <p className="mt-4 text-sm text-[var(--kaypal-v3-danger)]">{suggestError}</p>
            )}

            <div className="mt-6 flex items-center justify-end gap-3">
              <V2GhostButton onClick={() => setSuggestTarget(null)}>关闭</V2GhostButton>
              <V2PrimaryButton
                icon={applyingSuggest ? Loader2 : Sparkles}
                loading={applyingSuggest}
                disabled={suggestLoading || !suggestions || suggestions.analyzedLeadCount === 0}
                onClick={handleApplySuggest}
              >
                {applyingSuggest ? "正在采纳..." : "采纳勾选的词"}
              </V2PrimaryButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
