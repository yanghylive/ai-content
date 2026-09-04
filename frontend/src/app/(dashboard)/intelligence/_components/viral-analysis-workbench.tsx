"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Database,
  FileText,
  Gauge,
  Search,
  ShieldAlert,
  Sparkles,
  Target,
  type LucideIcon,
} from "@/components/iconpark";
import { redfoxApi, type RedfoxSkill } from "@/lib/api/redfox";
import { FunctionalEmptyState } from "../../components/functional-empty-state";
import { publicIntelligenceText } from "./display-text";
import { IntelligenceToolResultContext } from "./intelligence-tool-result-context";
import { SkeletonList } from "@/components/skeleton";
import { toActionableError } from "@/lib/public-error";

type RiskLevel = "low" | "medium" | "high";
type PlatformFilter = "all" | "douyin" | "xiaohongshu" | "bilibili";
type ViralAngle = "all" | "low_follower" | "comment" | "structure";

type ViralSample = {
  id: string;
  title: string;
  platform: string;
  angle: Exclude<ViralAngle, "all">;
  angleLabel: string;
  sourceSkill: string;
  score: number;
  structureFit: number;
  risk: RiskLevel;
  decision: string;
  titlePattern: string;
  openingPattern: string;
  structurePattern: string;
  commentInsight: string;
  boundary: string;
  evidence: string[];
  actions: Array<{
    actionId: string;
    label: string;
    href: string;
    target: string;
    icon: LucideIcon;
    risk: RiskLevel;
  }>;
};

type QueueItem = {
  id: string;
  title: string;
  label: string;
  target: string;
  href: string;
  risk: RiskLevel;
};

const platformFilters: Array<{ label: string; value: PlatformFilter }> = [
  { label: "全平台", value: "all" },
  { label: "抖音", value: "douyin" },
  { label: "小红书", value: "xiaohongshu" },
  { label: "B站", value: "bilibili" },
];

const angleFilters: Array<{ label: string; value: ViralAngle }> = [
  { label: "全部", value: "all" },
  { label: "低粉爆款", value: "low_follower" },
  { label: "评论驱动", value: "comment" },
  { label: "结构可复用", value: "structure" },
];

const samples: ViralSample[] = [
  {
    id: "xiaohongshu-founder-ip",
    title: "低粉老板 IP 笔记：用真实咨询问题开头",
    platform: "小红书",
    angle: "low_follower",
    angleLabel: "低粉爆款",
    sourceSkill: "小红书爆款笔记查询",
    score: 91,
    structureFit: 88,
    risk: "low",
    decision: "可拆标题、开头和评论问题，进入选题和素材库。",
    titlePattern: "身份 + 真实问题 + 明确结果边界",
    openingPattern: "先抛用户场景，再给一条反常识判断",
    structurePattern: "问题场景 -> 案例拆解 -> 方法清单 -> 评论承接",
    commentInsight: "用户追问预算、落地难度和案例可信度。",
    boundary: "只复用结构和问题，不复用原文、截图、封面和评论原句。",
    evidence: [
      "账号粉丝不高，但评论集中在真实咨询问题。",
      "标题没有夸大承诺，更适合做结构学习。",
      "评论能反向生成 FAQ 和线索洞察。",
    ],
    actions: [
      {
        actionId: "import-material",
        label: "导入素材",
        href: "/content",
        target: "素材库",
        icon: Database,
        risk: "low",
      },
      {
        actionId: "generate-topic",
        label: "生成选题",
        href: "/topics",
        target: "选题库",
        icon: FileText,
        risk: "low",
      },
      {
        actionId: "lead-insight",
        label: "线索洞察",
        href: "/intelligence/leads",
        target: "线索洞察",
        icon: Target,
        risk: "medium",
      },
    ],
  },
  {
    id: "douyin-local-life-hook",
    title: "同城探店短视频：前三秒直接给到店阻碍",
    platform: "抖音",
    angle: "structure",
    angleLabel: "结构可复用",
    sourceSkill: "抖音作品查询",
    score: 84,
    structureFit: 92,
    risk: "medium",
    decision: "可拆节奏和评论问题，涉及价格与优惠表达先复核。",
    titlePattern: "场景痛点 + 到店动作 + 本地关键词",
    openingPattern: "先说用户不来的原因，再展示门店解决动作",
    structurePattern: "痛点钩子 -> 现场证据 -> 服务过程 -> 评论提问",
    commentInsight: "评论集中询问价格、预约方式和是否有团购。",
    boundary: "价格、优惠、效果表达必须走风险审核，不直接生成承诺话术。",
    evidence: [
      "前三秒钩子明确，能学习节奏。",
      "评论问题适合沉淀客服 FAQ。",
      "价格和优惠表达存在中风险。",
    ],
    actions: [
      {
        actionId: "import-material",
        label: "导入素材",
        href: "/content",
        target: "素材库",
        icon: Database,
        risk: "medium",
      },
      {
        actionId: "risk-review",
        label: "风险审核",
        href: "/intelligence/risks",
        target: "风险审核",
        icon: ShieldAlert,
        risk: "high",
      },
      {
        actionId: "intelligence-rules",
        label: "情报规则",
        href: "/intelligence/rules",
        target: "情报规则",
        icon: ClipboardCheck,
        risk: "medium",
      },
    ],
  },
  {
    id: "bilibili-ai-workflow",
    title: "AI 工具长视频教程：章节结构可拆成系列文章",
    platform: "B站",
    angle: "structure",
    angleLabel: "结构可复用",
    sourceSkill: "B站关键词搜作品",
    score: 82,
    structureFit: 86,
    risk: "low",
    decision: "适合拆成工具清单、步骤文章和视频脚本。",
    titlePattern: "工具名 + 任务结果 + 适用人群",
    openingPattern: "先展示完整流程，再拆每一步工具和输入输出",
    structurePattern: "结果预览 -> 工具清单 -> 步骤演示 -> 常见问题",
    commentInsight: "用户关心多人协作、数据安全和是否能复用模板。",
    boundary: "教程结构可学习，不能照搬画面、讲稿和示例数据。",
    evidence: [
      "章节完整，适合转多篇内容。",
      "评论里的安全问题能补充选题角度。",
      "风险较低，但需要标注原始来源。",
    ],
    actions: [
      {
        actionId: "content-optimization",
        label: "内容优化",
        href: "/content/optimization",
        target: "创作优化",
        icon: Sparkles,
        risk: "low",
      },
      {
        actionId: "generate-topic",
        label: "生成选题",
        href: "/topics",
        target: "选题库",
        icon: FileText,
        risk: "low",
      },
    ],
  },
  {
    id: "douyin-short-drama-risk",
    title: "短剧投流素材：高互动但版权和刺激标题风险高",
    platform: "抖音",
    angle: "comment",
    angleLabel: "评论驱动",
    sourceSkill: "抖音实时作品搜索",
    score: 72,
    structureFit: 78,
    risk: "high",
    decision: "只保留反面规则和节奏观察，不进入素材和选题生产。",
    titlePattern: "冲突刺激 + 快速反转 + 情绪词",
    openingPattern: "直接制造强冲突，缺少事实边界",
    structurePattern: "强刺激钩子 -> 快速剪辑 -> 情绪评论承接",
    commentInsight: "评论有争议和版权质疑，不能作为可复用素材。",
    boundary: "禁止复用标题、画面、台词和封面，只能沉淀风险规则。",
    evidence: [
      "标题刺激性高，容易伤害品牌安全。",
      "素材来源不清，版权信息不完整。",
      "评论里有版权和争议提示。",
    ],
    actions: [
      {
        actionId: "risk-review",
        label: "风险审核",
        href: "/intelligence/risks",
        target: "风险审核",
        icon: ShieldAlert,
        risk: "high",
      },
      {
        actionId: "intelligence-rules",
        label: "沉淀规则",
        href: "/intelligence/rules",
        target: "情报规则",
        icon: ClipboardCheck,
        risk: "medium",
      },
    ],
  },
];

const riskMeta: Record<RiskLevel, { label: string; className: string }> = {
  low: {
    label: "可拆解",
    className:
      "border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] text-[var(--kaypal-v3-soft-ink)]",
  },
  medium: {
    label: "需复核",
    className:
      "border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)] text-[var(--kaypal-v3-soft-ink)]",
  },
  high: {
    label: "只做规则",
    className:
      "border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] text-[var(--kaypal-v3-soft-ink)]",
  },
};

function riskClass(risk: RiskLevel) {
  return riskMeta[risk].className;
}

function platformMatches(sample: ViralSample, filter: PlatformFilter) {
  if (filter === "all") return true;
  if (filter === "douyin") return sample.platform === "抖音";
  if (filter === "xiaohongshu") return sample.platform === "小红书";
  if (filter === "bilibili") return sample.platform === "B站";
  return true;
}

function angleMatches(sample: ViralSample, filter: ViralAngle) {
  return filter === "all" || sample.angle === filter;
}

function scoreClass(score: number, risk: RiskLevel) {
  if (risk === "high") return "bg-[var(--kaypal-v3-danger)]";
  if (score >= 88) return "bg-[var(--kaypal-v3-success)]";
  if (score >= 78) return "bg-[var(--kaypal-v3-accent)]";
  return "bg-[var(--kaypal-v3-amber)]";
}

function initialAngleForTool(tool: string | null): ViralAngle {
  if (tool === "low-follower-viral") return "low_follower";
  if (tool === "viral-breakdown") return "structure";
  return "all";
}

function SkillStrip() {
  const [skillState, setSkillState] = useState<{
    items: RedfoxSkill[];
    error: string;
    loaded: boolean;
  }>({
    items: [],
    error: "",
    loaded: false,
  });

  useEffect(() => {
    let active = true;

    redfoxApi
      .listSkills({ page: 1, limit: 4, keyword: "爆款" })
      .then((result) => {
        if (!active) return;
        setSkillState({ items: result.items, error: "", loaded: true });
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setSkillState({
          items: [],
          error: publicIntelligenceText(
            toActionableError(reason, "功能读取失败"),
          ),
          loaded: true,
        });
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="kaypal-v3-panel overflow-hidden">
      <div className="border-b border-[var(--kaypal-v3-border)] p-4">
        <p className="kaypal-v3-label">相关能力</p>
        <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
          系统可继续找爆款样本
        </h2>
      </div>
      {!skillState.loaded ? (
        <div className="flex items-center gap-2 p-4 text-12 font-semibold text-[var(--kaypal-v3-muted)]">
          <SkeletonList rows={3} />
        </div>
      ) : skillState.error ? (
        <div className="p-4 text-12 font-semibold text-[var(--kaypal-v3-soft-ink)]">
          {skillState.error}
        </div>
      ) : skillState.items.length > 0 ? (
        <div className="divide-y divide-[var(--kaypal-v3-border)]">
          {skillState.items.map((skill) => (
            <div className="p-4" key={skill.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-13 font-bold leading-5 text-[var(--kaypal-v3-ink)]">
                    {publicIntelligenceText(skill.name, "系统功能")}
                  </h3>
                  <p className="mt-1 line-clamp-2 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                    {publicIntelligenceText(
                      skill.summary,
                      "可用于继续查找爆款样本和结构参考。",
                    )}
                  </p>
                </div>
                <span className="shrink-0 rounded-[6px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] px-2 py-1 text-11 font-semibold text-[var(--kaypal-v3-muted)]">
                  {publicIntelligenceText(skill.platform, "平台")}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-4">
          <FunctionalEmptyState
            actions={[
              { href: "/intelligence/skills", label: "功能模板" },
              { href: "/intelligence/monitors", label: "绑定监控" },
            ]}
            description="当前没有匹配到爆款功能。可以到功能模板页刷新能力，或绑定爆款/评论/结构分析场景。"
            examples={["爆款样本", "结构拆解", "评论洞察", "低粉高赞"]}
            icon={FileText}
            surface="plain"
            title="当前没有爆款功能"
          />
        </div>
      )}
    </section>
  );
}

export function ViralAnalysisWorkbench() {
  const searchParams = useSearchParams();
  const activeTool = searchParams.get("tool");
  const [platform, setPlatform] = useState<PlatformFilter>("all");
  const [angle, setAngle] = useState<ViralAngle>(() =>
    initialAngleForTool(activeTool),
  );
  const [selectedId, setSelectedId] = useState(samples[0].id);
  const [queue, setQueue] = useState<QueueItem[]>([]);

  const filteredSamples = useMemo(
    () =>
      samples.filter(
        (sample) =>
          platformMatches(sample, platform) && angleMatches(sample, angle),
      ),
    [angle, platform],
  );

  const selectedSample = useMemo(
    () =>
      filteredSamples.find((sample) => sample.id === selectedId) ||
      filteredSamples[0] ||
      samples[0],
    [filteredSamples, selectedId],
  );

  function addToQueue(action: ViralSample["actions"][number]) {
    const id = `${selectedSample.id}:${action.actionId}:${action.target}`;

    setQueue((current) => {
      if (current.some((item) => item.id === id)) return current;

      return [
        {
          id,
          title: selectedSample.title,
          label: action.label,
          target: action.target,
          href: action.href,
          risk: action.risk,
        },
        ...current,
      ].slice(0, 6);
    });
  }

  function isQueued(action: ViralSample["actions"][number]) {
    return queue.some(
      (item) =>
        item.id === `${selectedSample.id}:${action.actionId}:${action.target}`,
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section className="kaypal-v3-panel overflow-hidden">
        <div className="border-b border-[var(--kaypal-v3-border)] p-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
            <div className="min-w-0">
              <p className="kaypal-v3-label">爆款拆解</p>
              <h1 className="mt-1 kx-greet text-[var(--kaypal-v3-ink)]">
                爆款样本工作台
              </h1>
              <p className="mt-1 max-w-4xl text-13 leading-5 text-[var(--kaypal-v3-soft-ink)]">
                只拆可复用结构、用户问题和内容节奏；不复制原文、封面、画面、评论原句，也不让高风险样本进入业务流程。
              </p>
            </div>
            <div className="flex flex-wrap gap-2 xl:justify-end">
              <Link
                className="inline-flex h-12 items-center gap-2 whitespace-nowrap rounded-[10px] bg-[image:var(--kaypal-v3-gradient-primary)] px-5 text-[15px] font-semibold text-white transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kaypal-v3-accent)] active:translate-y-0"
                href="/intelligence/search"
              >
                <Search
                  aria-hidden="true"
                  className="h-4 w-4"
                  strokeWidth={1.8}
                />
                找样本
              </Link>
              <Link
                className="inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-[10px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-5 text-sm font-semibold text-[var(--kaypal-v3-soft-ink)] transition-colors hover:border-[var(--kaypal-v3-border-strong)] hover:text-[var(--kaypal-v3-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kaypal-v3-accent)]"
                href="/intelligence/risks"
              >
                风险审核
              </Link>
            </div>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {[
              {
                label: "样本池",
                value: String(samples.length),
                detail: "低粉、评论、结构三类样本",
                icon: Gauge,
              },
              {
                label: "可入库",
                value: String(
                  samples.filter((sample) => sample.risk === "low").length,
                ),
                detail: "可转素材或选题",
                icon: CheckCircle2,
              },
              {
                label: "需复核",
                value: String(
                  samples.filter((sample) => sample.risk === "medium").length,
                ),
                detail: "价格、优惠和承诺边界",
                icon: ShieldAlert,
              },
              {
                label: "只做规则",
                value: String(
                  samples.filter((sample) => sample.risk === "high").length,
                ),
                detail: "不进入业务流程",
                icon: ClipboardCheck,
              },
            ].map(({ label, value, detail, icon: Icon }) => {
              return (
                <div
                  className="min-h-[88px] rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3"
                  key={label}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="kaypal-v3-label">{label}</p>
                    <Icon
                      aria-hidden="true"
                      className="h-4 w-4 text-[var(--kaypal-v3-muted)]"
                      strokeWidth={1.8}
                    />
                  </div>
                  <p className="mt-1 text-xl font-bold leading-7 text-[var(--kaypal-v3-ink)]">
                    {value}
                  </p>
                  <p className="mt-1 text-11 leading-4 text-[var(--kaypal-v3-muted)]">
                    {detail}
                  </p>
                </div>
              );
            })}
          </div>

        </div>
      </section>

      <IntelligenceToolResultContext tool={activeTool} />

      <section className="kaypal-v3-panel p-3">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <p className="text-12 font-bold text-[var(--kaypal-v3-soft-ink)]">
              平台
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {platformFilters.map((item) => (
                <button
                  className={[
                    "h-8 rounded-[8px] border px-3 text-12 font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kaypal-v3-accent)]",
                    platform === item.value
                      ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]"
                      : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] text-[var(--kaypal-v3-muted)] hover:text-[var(--kaypal-v3-soft-ink)]",
                  ].join(" ")}
                  data-testid={`viral-platform-${item.value}`}
                  key={item.value}
                  onClick={() => setPlatform(item.value)}
                  type="button"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-12 font-bold text-[var(--kaypal-v3-soft-ink)]">
              拆解角度
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {angleFilters.map((item) => (
                <button
                  className={[
                    "h-8 rounded-[8px] border px-3 text-12 font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kaypal-v3-accent)]",
                    angle === item.value
                      ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]"
                      : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] text-[var(--kaypal-v3-muted)] hover:text-[var(--kaypal-v3-soft-ink)]",
                  ].join(" ")}
                  data-testid={`viral-angle-${item.value}`}
                  key={item.value}
                  onClick={() => setAngle(item.value)}
                  type="button"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(280px,0.76fr)_minmax(0,1.24fr)_minmax(300px,0.78fr)]">
        <article className="kaypal-v3-panel min-w-0 overflow-hidden">
          <div className="border-b border-[var(--kaypal-v3-border)] p-4">
            <p className="kaypal-v3-label">样本池</p>
            <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
              可拆解对象
            </h2>
          </div>
          <div className="divide-y divide-[var(--kaypal-v3-border)]">
            {filteredSamples.map((sample) => {
              const isSelected = sample.id === selectedSample.id;

              return (
                <button
                  aria-pressed={isSelected}
                  className={[
                    "block w-full p-4 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--kaypal-v3-accent)]",
                    isSelected
                      ? "bg-[var(--kaypal-v3-accent-soft)]"
                      : "bg-[var(--kaypal-v3-paper)] hover:bg-[var(--kaypal-v3-paper-soft)]",
                  ].join(" ")}
                  data-testid={`viral-sample-${sample.id}`}
                  key={sample.id}
                  onClick={() => setSelectedId(sample.id)}
                  type="button"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-[6px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] px-2 py-0.5 text-11 font-semibold text-[var(--kaypal-v3-muted)]">
                      {sample.platform}
                    </span>
                    <span className="rounded-[6px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] px-2 py-0.5 text-11 font-semibold text-[var(--kaypal-v3-muted)]">
                      {sample.angleLabel}
                    </span>
                    <span
                      className={[
                        "rounded-[6px] border px-2 py-0.5 text-11 font-semibold",
                        riskClass(sample.risk),
                      ].join(" ")}
                    >
                      {riskMeta[sample.risk].label}
                    </span>
                  </div>
                  <h3 className="mt-2 text-14 font-bold leading-5 text-[var(--kaypal-v3-ink)]">
                    {sample.title}
                  </h3>
                  <p className="mt-2 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                    系统从{sample.platform}样本里发现
                  </p>
                </button>
              );
            })}
          </div>
        </article>

        <article className="kaypal-v3-panel min-w-0 overflow-hidden">
          <div className="border-b border-[var(--kaypal-v3-border)] p-4">
            <p className="kaypal-v3-label">拆解台</p>
            <h2 className="mt-1 text-lg font-bold leading-6 text-[var(--kaypal-v3-ink)]">
              {selectedSample.title}
            </h2>
            <p className="mt-1 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
              {selectedSample.platform} · 爆款样本
            </p>
          </div>
          <div className="p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                ["爆款评分", selectedSample.score],
                ["结构可复用", selectedSample.structureFit],
              ].map(([label, value]) => (
                <div
                  className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3"
                  key={String(label)}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-11 font-bold text-[var(--kaypal-v3-muted)]">
                      {label}
                    </p>
                    <span className="text-13 font-bold text-[var(--kaypal-v3-ink)]">
                      {value}
                    </span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--kaypal-v3-border)]">
                    <div
                      className={[
                        "h-full rounded-full",
                        scoreClass(Number(value), selectedSample.risk),
                      ].join(" ")}
                      style={{ width: `${value}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {[
                ["标题套路", selectedSample.titlePattern],
                ["开头套路", selectedSample.openingPattern],
                ["结构路径", selectedSample.structurePattern],
                ["评论洞察", selectedSample.commentInsight],
              ].map(([label, value]) => (
                <div
                  className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-4"
                  key={label}
                >
                  <p className="kaypal-v3-label">{label}</p>
                  <p className="mt-2 text-13 font-semibold leading-6 text-[var(--kaypal-v3-soft-ink)]">
                    {value}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-[8px] border border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)] p-4">
              <p className="kaypal-v3-label">推荐判断</p>
              <p className="mt-2 text-14 font-bold leading-6 text-[var(--kaypal-v3-ink)]">
                {selectedSample.decision}
              </p>
              <p className="mt-2 text-12 leading-5 text-[var(--kaypal-v3-soft-ink)]">
                {selectedSample.boundary}
              </p>
            </div>

            <div className="mt-4 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-4">
              <p className="kaypal-v3-label">证据</p>
              <ol className="mt-3 grid gap-3">
                {selectedSample.evidence.map((item, index) => (
                  <li className="flex gap-3" key={item}>
                    <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] bg-[var(--kaypal-v3-accent)] text-11 font-bold text-white">
                      {index + 1}
                    </span>
                    <p className="text-12 leading-5 text-[var(--kaypal-v3-soft-ink)]">
                      {item}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </article>

        <aside className="grid min-w-0 gap-4">
          <section className="kaypal-v3-panel overflow-hidden">
            <div className="border-b border-[var(--kaypal-v3-border)] p-4">
              <p className="kaypal-v3-label">下一步动作</p>
              <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
                派发规则
              </h2>
            </div>
            <div className="grid gap-2 p-4">
              {selectedSample.actions.map((action) => {
                const Icon = action.icon;
                const queued = isQueued(action);

                return (
                  <button
                    className={[
                      "rounded-[8px] border p-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kaypal-v3-accent)] disabled:cursor-not-allowed disabled:opacity-60",
                      queued
                        ? "border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)]"
                        : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] hover:border-[var(--kaypal-v3-border-strong)] hover:bg-[var(--kaypal-v3-paper)]",
                    ].join(" ")}
                    data-testid={`viral-action-${action.actionId}`}
                    disabled={queued}
                    key={action.label}
                    onClick={() => addToQueue(action)}
                    type="button"
                  >
                    <div className="flex items-start gap-3">
                      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)]">
                        <Icon
                          aria-hidden="true"
                          className="h-4 w-4 text-[var(--kaypal-v3-accent)]"
                          strokeWidth={1.8}
                        />
                      </span>
                      <div className="min-w-0">
                        <p className="text-13 font-bold text-[var(--kaypal-v3-ink)]">
                          {queued ? "已加入队列" : action.label}
                        </p>
                        <p className="mt-1 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                          {action.target} · {riskMeta[action.risk].label}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="kaypal-v3-panel overflow-hidden">
            <div className="border-b border-[var(--kaypal-v3-border)] p-4">
              <p className="kaypal-v3-label">分发任务</p>
              <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
                待执行拆解动作
              </h2>
            </div>
            {queue.length > 0 ? (
              <div className="divide-y divide-[var(--kaypal-v3-border)]">
                {queue.map((item) => (
                  <Link
                    className="block p-4 transition-colors hover:bg-[var(--kaypal-v3-paper-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--kaypal-v3-accent)]"
                    href={item.href}
                    key={item.id}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-13 font-bold text-[var(--kaypal-v3-ink)]">
                          {item.label} · {item.target}
                        </p>
                        <p className="mt-1 line-clamp-2 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                          {item.title}
                        </p>
                      </div>
                      <ArrowRight
                        aria-hidden="true"
                        className="h-4 w-4 shrink-0 text-[var(--kaypal-v3-muted)]"
                        strokeWidth={1.8}
                      />
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="p-4 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                选择拆解动作后，会在这里形成可追踪队列。
              </div>
            )}
          </section>
          <SkillStrip />
        </aside>
      </section>

      <section className="kaypal-v3-panel overflow-hidden">
        <div className="border-b border-[var(--kaypal-v3-border)] p-4">
          <p className="kaypal-v3-label">治理边界</p>
          <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
            拆解能做什么，不能做什么
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-13">
            <thead className="bg-[var(--kaypal-v3-table-head)] text-11 font-bold text-[var(--kaypal-v3-muted)]">
              <tr>
                {["对象", "可做", "禁止", "去向"].map((column) => (
                  <th className="px-4 py-3" key={column} scope="col">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--kaypal-v3-border)]">
              {[
                ["标题", "拆结构和关键词", "复制标题", "选题 / 创作优化"],
                ["开头", "拆钩子顺序", "复用原句", "素材库"],
                ["评论", "提炼问题和异议", "搬运评论原文", "线索洞察"],
                [
                  "高风险样本",
                  "沉淀规则和反面案例",
                  "进入业务流程",
                  "风险审核",
                ],
              ].map((row) => (
                <tr key={row.join("-")}>
                  {row.map((cell, index) => (
                    <td
                      className={[
                        "px-4 py-3 align-top leading-5 text-[var(--kaypal-v3-soft-ink)]",
                        index === 0
                          ? "font-bold text-[var(--kaypal-v3-ink)]"
                          : "",
                      ].join(" ")}
                      key={`${row.join("-")}-${cell}`}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
