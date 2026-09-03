"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  BellRing,
  CheckCircle2,
  Database,
  Flame,
  Gauge,
  ListChecks,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { redfoxApi, type RedfoxSkill } from "@/lib/api/redfox";
import { FunctionalEmptyState } from "../../components/functional-empty-state";
import { publicIntelligenceText } from "./display-text";
import { IntelligenceToolResultContext } from "./intelligence-tool-result-context";
import { toPublicError } from "@/lib/public-error";

type PlatformFilter = "all" | "douyin" | "xiaohongshu" | "bilibili" | "wechat";
type RiskLevel = "low" | "medium" | "high";

type TrendCandidate = {
  id: string;
  title: string;
  platform: string;
  sourceSkill: string;
  freshness: string;
  heat: number;
  fit: number;
  risk: RiskLevel;
  decision: "转选题" | "导入素材" | "加入监控" | "先复核";
  reason: string;
  angle: string;
  titleDraft: string;
  evidence: string[];
  nextActions: Array<{
    label: string;
    href: string;
    icon: LucideIcon;
  }>;
};

const platformOptions: Array<{ label: string; value: PlatformFilter }> = [
  { label: "全网", value: "all" },
  { label: "抖音", value: "douyin" },
  { label: "小红书", value: "xiaohongshu" },
  { label: "B站", value: "bilibili" },
  { label: "公众号", value: "wechat" },
];

const candidates: TrendCandidate[] = [
  {
    id: "ai-tool-workflow",
    title: "AI 工具从测评走向流程模板",
    platform: "全网",
    sourceSkill: "全网热搜查询 + B站关键词搜作品",
    freshness: "近24小时",
    heat: 92,
    fit: 88,
    risk: "low",
    decision: "转选题",
    reason: "能连接产品教程、案例复盘和工具清单，适合内容流程。",
    angle: "不要再做泛泛测评，直接给用户一套可复制的流程。",
    titleDraft: "AI 工具没转化？先把测评改成这 3 个流程模板",
    evidence: ["先抓全网方向", "继续补充样本", "标题和素材能进入选题库"],
    nextActions: [
      { label: "生成选题", href: "/topics", icon: Sparkles },
      { label: "找样本", href: "/intelligence/search", icon: Search },
      { label: "加入监控", href: "/intelligence/monitors", icon: BellRing },
    ],
  },
  {
    id: "summer-local-life",
    title: "暑期文旅和本地生活获客",
    platform: "抖音",
    sourceSkill: "抖音每日热门作品榜",
    freshness: "近24小时",
    heat: 88,
    fit: 91,
    risk: "medium",
    decision: "导入素材",
    reason:
      "能转成本地案例、探店脚本和亲子消费内容，但需要审核价格和宣传表达。",
    angle: "按城市、客群、预算拆成可执行内容，不追纯娱乐热点。",
    titleDraft: "暑期门店没客流？先拆这 4 类本地生活内容",
    evidence: [
      "适合导入素材库做脚本",
      "需要保留来源链接",
      "价格/优惠表述要过风险复核",
    ],
    nextActions: [
      { label: "导入素材", href: "/content", icon: Database },
      { label: "风险复核", href: "/intelligence/risks", icon: ShieldAlert },
      { label: "生成选题", href: "/topics", icon: Sparkles },
    ],
  },
  {
    id: "short-drama-ads",
    title: "短剧投流素材复盘",
    platform: "抖音",
    sourceSkill: "抖音每日点赞飙升榜",
    freshness: "近7天",
    heat: 81,
    fit: 72,
    risk: "high",
    decision: "先复核",
    reason: "素材结构有参考价值，但容易涉及夸张承诺、版权和擦边表达。",
    angle: "只拆结构，不复用原素材；先看钩子、节奏和评论疑问。",
    titleDraft: "短剧素材为什么爆？只拆结构，不碰高风险表达",
    evidence: [
      "适合爆款拆解，不适合直接搬运",
      "版权和夸张承诺风险高",
      "需先进入人工确认",
    ],
    nextActions: [
      { label: "风险检查", href: "/intelligence/risks", icon: ShieldAlert },
      { label: "爆款拆解", href: "/intelligence/viral", icon: ListChecks },
      { label: "沉淀规则", href: "/intelligence/rules", icon: CheckCircle2 },
    ],
  },
  {
    id: "founder-ip",
    title: "老板 IP 轻资产获客",
    platform: "小红书",
    sourceSkill: "小红书热门账号推荐",
    freshness: "近7天",
    heat: 76,
    fit: 90,
    risk: "low",
    decision: "加入监控",
    reason: "适合长期跟踪账号栏目、评论问题和转化话术。",
    angle: "把老板 IP 从人设表达拆成栏目、案例和评论承接。",
    titleDraft: "老板 IP 不是发日常，先搭这 5 个获客栏目",
    evidence: ["更适合作为监控主题", "可进入增长策略", "评论洞察能补转化问题"],
    nextActions: [
      { label: "加入监控", href: "/intelligence/monitors", icon: BellRing },
      { label: "对标账号", href: "/intelligence/accounts", icon: Gauge },
      { label: "增长策略", href: "/growth/strategies", icon: ArrowRight },
    ],
  },
];

function riskLabel(risk: RiskLevel) {
  if (risk === "high") return "高风险";
  if (risk === "medium") return "需复核";
  return "可推进";
}

function riskClass(risk: RiskLevel) {
  if (risk === "high") {
    return "border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] text-[var(--kaypal-v3-soft-ink)]";
  }

  if (risk === "medium") {
    return "border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)] text-[var(--kaypal-v3-soft-ink)]";
  }

  return "border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] text-[var(--kaypal-v3-soft-ink)]";
}

function platformMatches(candidate: TrendCandidate, platform: PlatformFilter) {
  if (platform === "all") return true;
  if (platform === "douyin") return candidate.platform === "抖音";
  if (platform === "xiaohongshu") return candidate.platform === "小红书";
  if (platform === "bilibili") return candidate.sourceSkill.includes("B站");
  if (platform === "wechat") return candidate.sourceSkill.includes("公众号");
  return true;
}

function skillPlatformLabel(value?: string | null) {
  const labels: Record<string, string> = {
    bilibili: "B站",
    douyin: "抖音",
    unknown: "未分类",
    wechat: "公众号",
    xiaohongshu: "小红书",
  };
  return labels[value || ""] || value || "未分类";
}

export function TrendsRadarWorkbench() {
  const searchParams = useSearchParams();
  const activeTool = searchParams.get("tool");
  const [platform, setPlatform] = useState<PlatformFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(candidates[0].id);
  const [skills, setSkills] = useState<RedfoxSkill[]>([]);
  const [message, setMessage] = useState("");
  const [loadingSkills, setLoadingSkills] = useState(false);

  const filteredCandidates = useMemo(() => {
    const trimmed = query.trim();
    return candidates.filter((candidate) => {
      const matchesPlatform = platformMatches(candidate, platform);
      const matchesQuery =
        !trimmed ||
        [
          candidate.title,
          candidate.reason,
          candidate.angle,
          candidate.sourceSkill,
        ]
          .join(" ")
          .includes(trimmed);
      return matchesPlatform && matchesQuery;
    });
  }, [platform, query]);

  const selected =
    filteredCandidates.find((candidate) => candidate.id === selectedId) ||
    filteredCandidates[0] ||
    candidates[0];

  useEffect(() => {
    if (!filteredCandidates.some((candidate) => candidate.id === selectedId)) {
      setSelectedId(filteredCandidates[0]?.id || candidates[0].id);
    }
  }, [filteredCandidates, selectedId]);

  async function loadHotSkills() {
    setLoadingSkills(true);
    setMessage("");
    try {
      const result = await redfoxApi.listSkills({
        keyword: "热",
        page: 1,
        limit: 12,
      });
      setSkills(result.items);
      if (!result.items.length) {
        setMessage("没有读到热点能力，请先刷新能力。");
      }
    } catch (error) {
      setMessage(toPublicError(error, "热点功能暂时无法读取，请重新加载。"));
    } finally {
      setLoadingSkills(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadHotSkills();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const decisionStats = [
    {
      label: "可执行热点",
      value: String(candidates.filter((item) => item.risk !== "high").length),
      detail: "可直接转选题、素材或监控",
    },
    {
      label: "高风险需处理",
      value: String(candidates.filter((item) => item.risk === "high").length),
      detail: "先走风险复核，不进入自动生产",
    },
    {
      label: "热点能力",
      value: loadingSkills ? "读取中" : String(skills.length || 0),
      detail: "系统可用能力",
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <section className="kaypal-v3-panel overflow-hidden">
        <div className="grid gap-0 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)]">
          <header className="border-b border-[var(--kaypal-v3-border)] p-4 xl:border-b-0 xl:border-r">
            <div className="flex min-w-0 items-start gap-3">
              <span className="kaypal-v3-icon-tile shrink-0">
                <Flame
                  aria-hidden="true"
                  className="h-5 w-5"
                  strokeWidth={1.8}
                />
              </span>
              <div className="min-w-0">
                <p className="kaypal-v3-label">趋势发现</p>
                <h1 className="mt-1 kx-greet text-[var(--kaypal-v3-ink)]">
                  热点雷达
                </h1>
                <p className="mt-1 max-w-4xl text-13 leading-5 text-[var(--kaypal-v3-soft-ink)]">
                  按热度、业务匹配度和风险筛选热点，并给出内容建议。
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <label className="block">
                <span className="text-12 font-semibold text-[var(--kaypal-v3-soft-ink)]">
                  行业或主题
                </span>
                <input
                  className="mt-1 h-10 w-full rounded-[8px] border border-[var(--kaypal-v3-field-border)] bg-[var(--kaypal-v3-field-bg)] px-3 text-13 text-[var(--kaypal-v3-ink)] outline-none transition focus:border-[var(--kaypal-v3-accent)] focus:shadow-[var(--kaypal-v3-field-shadow-focus)]"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="输入行业、主题或业务词，例如：本地生活、AI 工具、老板 IP"
                  value={query}
                />
              </label>
              <div className="flex flex-wrap gap-2 lg:justify-end">
                <button
                  className="inline-flex h-10 items-center gap-2 rounded-[8px] bg-[var(--kaypal-v3-accent)] px-4 text-13 font-semibold text-white disabled:opacity-60"
                  disabled={loadingSkills}
                  onClick={() => void loadHotSkills()}
                  type="button"
                >
                  <RefreshCw
                    aria-hidden="true"
                    className={[
                      "h-4 w-4",
                      loadingSkills ? "animate-spin" : "",
                    ].join(" ")}
                    strokeWidth={1.8}
                  />
                  刷新热点能力
                </button>
                <Link
                  className="inline-flex h-10 items-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-4 text-13 font-semibold text-[var(--kaypal-v3-soft-ink)]"
                  href="/topics"
                >
                  打开选题库
                  <ArrowRight
                    aria-hidden="true"
                    className="h-4 w-4"
                    strokeWidth={1.8}
                  />
                </Link>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {platformOptions.map((item) => (
                <button
                  className={[
                    "h-8 rounded-[8px] border px-3 text-12 font-semibold transition",
                    platform === item.value
                      ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]"
                      : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] text-[var(--kaypal-v3-muted)] hover:border-[var(--kaypal-v3-border-strong)]",
                  ].join(" ")}
                  key={item.value}
                  onClick={() => setPlatform(item.value)}
                  type="button"
                >
                  {item.label}
                </button>
              ))}
            </div>

          </header>

          <aside className="p-4">
            <p className="kaypal-v3-label">本轮决策</p>
            <h2 className="mt-1 text-14 font-bold text-[var(--kaypal-v3-ink)]">
              热点进入生产前必须回答三件事
            </h2>
            <div className="mt-4 grid gap-2">
              {decisionStats.map((item) => (
                <div
                  className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3"
                  key={item.label}
                >
                  <p className="kaypal-v3-label">{item.label}</p>
                  <p className="mt-1 text-2xl font-bold leading-7 text-[var(--kaypal-v3-ink)]">
                    {item.value}
                  </p>
                  <p className="mt-1 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                    {item.detail}
                  </p>
                </div>
              ))}
            </div>
            <div className="mt-3 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-3">
              <div className="flex items-start gap-2">
                <ShieldAlert
                  aria-hidden="true"
                  className="mt-0.5 h-4 w-4 shrink-0 text-[var(--kaypal-v3-amber)]"
                  strokeWidth={1.8}
                />
                <p className="text-12 leading-5 text-[var(--kaypal-v3-soft-ink)]">
                  高风险热点只能进入风险复核和人工确认，不直接推送到创作或发布流程。
                </p>
              </div>
            </div>
          </aside>
        </div>
      </section>

      <IntelligenceToolResultContext tool={activeTool} />

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(380px,0.9fr)]">
        <article className="kaypal-v3-panel overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-[var(--kaypal-v3-border)] p-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="kaypal-v3-label">热点池</p>
              <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
                先筛掉不能商用的热闹
              </h2>
            </div>
            <span className="inline-flex h-8 items-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] px-3 text-12 font-semibold text-[var(--kaypal-v3-muted)]">
              <Gauge aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />
              热度 / 匹配 / 风险
            </span>
          </div>
          <div className="divide-y divide-[var(--kaypal-v3-border)]">
            {filteredCandidates.map((candidate) => (
              <button
                className={[
                  "grid w-full gap-3 p-4 text-left transition lg:grid-cols-[minmax(0,1fr)_220px]",
                  selected.id === candidate.id
                    ? "bg-[var(--kaypal-v3-accent-soft)]"
                    : "hover:bg-[var(--kaypal-v3-paper-soft)]",
                ].join(" ")}
                key={candidate.id}
                onClick={() => setSelectedId(candidate.id)}
                type="button"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-14 font-bold leading-5 text-[var(--kaypal-v3-ink)]">
                      {candidate.title}
                    </h3>
                    <span
                      className={[
                        "rounded-[6px] border px-2 py-0.5 text-11 font-semibold",
                        riskClass(candidate.risk),
                      ].join(" ")}
                    >
                      {riskLabel(candidate.risk)}
                    </span>
                    <span className="rounded-[6px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-2 py-0.5 text-11 font-semibold text-[var(--kaypal-v3-muted)]">
                      {candidate.platform}
                    </span>
                  </div>
                  <p className="mt-1 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                    {candidate.reason}
                  </p>
                  <p className="mt-2 text-12 font-semibold text-[var(--kaypal-v3-soft-ink)]">
                    系统从{candidate.platform}热点里发现 · {candidate.freshness}
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    ["热度", candidate.heat],
                    ["匹配", candidate.fit],
                    [
                      "风险",
                      candidate.risk === "high"
                        ? 84
                        : candidate.risk === "medium"
                          ? 52
                          : 18,
                    ],
                  ].map(([label, value]) => (
                    <div
                      className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-2"
                      key={`${candidate.id}-${label}`}
                    >
                      <p className="text-11 font-bold text-[var(--kaypal-v3-muted)]">
                        {label}
                      </p>
                      <p className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
                        {value}
                      </p>
                    </div>
                  ))}
                </div>
              </button>
            ))}
          </div>
        </article>

        <aside className="kaypal-v3-panel overflow-hidden">
          <div className="border-b border-[var(--kaypal-v3-border)] p-4">
            <p className="kaypal-v3-label">决策台</p>
            <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
              {selected.decision}：{selected.title}
            </h2>
          </div>
          <div className="p-4">
            <p className="text-12 font-bold text-[var(--kaypal-v3-muted)]">
              推荐角度
            </p>
            <p className="mt-1 text-14 font-semibold leading-6 text-[var(--kaypal-v3-ink)]">
              {selected.angle}
            </p>
            <div className="mt-4 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3">
              <p className="text-12 font-bold text-[var(--kaypal-v3-muted)]">
                选题草稿
              </p>
              <p className="mt-1 text-13 font-semibold leading-5 text-[var(--kaypal-v3-soft-ink)]">
                {selected.titleDraft}
              </p>
            </div>
            <div className="mt-4 grid gap-2">
              {selected.evidence.map((item) => (
                <div className="flex items-start gap-2" key={item}>
                  <CheckCircle2
                    aria-hidden="true"
                    className="mt-0.5 h-4 w-4 shrink-0 text-[var(--kaypal-v3-success)]"
                    strokeWidth={1.8}
                  />
                  <span className="text-12 leading-5 text-[var(--kaypal-v3-soft-ink)]">
                    {item}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
              {selected.nextActions.map(({ label, href, icon: Icon }) => (
                <Link
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 text-12 font-semibold text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)]"
                  href={href}
                  key={label}
                >
                  <Icon
                    aria-hidden="true"
                    className="h-4 w-4"
                    strokeWidth={1.8}
                  />
                  {label}
                </Link>
              ))}
            </div>
          </div>
        </aside>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(420px,1.1fr)]">
        <article className="kaypal-v3-panel overflow-hidden">
          <div className="border-b border-[var(--kaypal-v3-border)] p-4">
            <p className="kaypal-v3-label">相关能力</p>
            <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
              系统可继续查热点和样本
            </h2>
          </div>
          <div className="divide-y divide-[var(--kaypal-v3-border)]">
            {(skills.length ? skills.slice(0, 6) : []).map((skill) => (
              <div
                className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_auto]"
                key={skill.id}
              >
                <div className="min-w-0">
                  <p className="text-13 font-bold text-[var(--kaypal-v3-ink)]">
                    {publicIntelligenceText(skill.name, "系统功能")}
                  </p>
                  <p className="mt-1 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                    {publicIntelligenceText(
                      skill.summary,
                      "可用于继续查找热点、样本和相关账号。",
                    )}
                  </p>
                </div>
                <span className="inline-flex h-7 items-center rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] px-2.5 text-11 font-semibold text-[var(--kaypal-v3-muted)]">
                  {skillPlatformLabel(skill.platform)}
                </span>
              </div>
            ))}
            {!skills.length ? (
              <div className="p-4">
                <FunctionalEmptyState
                  actions={[
                    { label: "刷新能力", onPress: () => void loadHotSkills() },
                    { href: "/intelligence/skills", label: "功能模板" },
                  ]}
                  description={publicIntelligenceText(
                    message || "正在读取可用功能。",
                  )}
                  examples={["热点能力", "样本查找", "相关账号", "加入监控"]}
                  icon={Flame}
                  surface="plain"
                  title="当前没有热点能力"
                />
              </div>
            ) : null}
          </div>
        </article>

        <article className="kaypal-v3-panel overflow-hidden">
          <div className="border-b border-[var(--kaypal-v3-border)] p-4">
            <p className="kaypal-v3-label">落地规则</p>
            <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
              热点不是内容，过筛后才进入生产
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-13">
              <thead className="bg-[var(--kaypal-v3-table-head)] text-11 font-bold text-[var(--kaypal-v3-muted)]">
                <tr>
                  <th className="px-4 py-3" scope="col">
                    判断
                  </th>
                  <th className="px-4 py-3" scope="col">
                    通过
                  </th>
                  <th className="px-4 py-3" scope="col">
                    不通过
                  </th>
                  <th className="px-4 py-3" scope="col">
                    去向
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--kaypal-v3-border)]">
                {[
                  [
                    "业务相关",
                    "能连接产品、案例或观点",
                    "纯娱乐无转化价值",
                    "选题库",
                  ],
                  [
                    "表达空间",
                    "能写出新角度和样本拆解",
                    "只有标题党价值",
                    "素材库",
                  ],
                  [
                    "平台适配",
                    "符合账号人设和平台语境",
                    "跨平台硬搬",
                    "平台搜索",
                  ],
                  [
                    "发布风险",
                    "无明显争议、侵权和夸张承诺",
                    "敏感或侵权",
                    "风险复核",
                  ],
                ].map((row) => (
                  <tr key={row[0]}>
                    {row.map((cell, index) => (
                      <td
                        className={[
                          "px-4 py-3 align-top leading-5 text-[var(--kaypal-v3-soft-ink)]",
                          index === 0
                            ? "font-bold text-[var(--kaypal-v3-ink)]"
                            : "",
                        ].join(" ")}
                        key={`${row[0]}-${cell}`}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    </div>
  );
}
