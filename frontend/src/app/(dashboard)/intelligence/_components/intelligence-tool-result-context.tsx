"use client";

import Link from "next/link";
import {
  ArrowRight,
  BellRing,
  CheckCircle2,
  Database,
  FileText,
  Globe2,
  Lightbulb,
  Radar,
  ShieldAlert,
  Sparkles,
  Target,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

type IntelligenceToolView = {
  eyebrow: string;
  title: string;
  summary: string;
  inputLabel: string;
  exampleInput: string;
  outputs: Array<{
    title: string;
    detail: string;
    points: string[];
  }>;
  nextActions: Array<{
    label: string;
    href: string;
    icon: LucideIcon;
  }>;
  guardrails: string[];
};

const intelligenceToolViews: Record<string, IntelligenceToolView> = {
  "hot-topic-solution": {
    eyebrow: "热点选题",
    title: "从热点直接变成可写选题",
    summary:
      "这里不是看热闹榜，而是帮运营判断哪些热点值得写、怎么写、写完进哪个业务库。",
    inputLabel: "你现在可以输入",
    exampleInput: "行业、品牌、目标人群，系统会把热点筛成选题和素材方向。",
    outputs: [
      {
        title: "可推进热点",
        detail: "保留业务相关、风险可控、近期还有效的热点。",
        points: ["热度和匹配度", "适合的平台", "为什么值得写"],
      },
      {
        title: "选题草稿",
        detail: "把热点转成标题、角度和内容结构，不停在一条榜单上。",
        points: ["推荐角度", "标题草稿", "用户痛点"],
      },
      {
        title: "落地方向",
        detail: "明确下一步进选题库、素材库、监控还是风险审核。",
        points: ["保存选题", "导入素材", "加入监控"],
      },
    ],
    nextActions: [
      { label: "生成选题", href: "/topics", icon: Lightbulb },
      { label: "找更多样本", href: "/intelligence/search", icon: Radar },
      { label: "加入监控", href: "/intelligence/monitors", icon: BellRing },
    ],
    guardrails: [
      "高风险热点先走审核，不直接进入创作。",
      "只保留可商用角度，不搬运第三方内容。",
    ],
  },
  "global-content-intel": {
    eyebrow: "出海趋势",
    title: "把海外趋势翻成国内团队能用的内容机会",
    summary:
      "重点看海外平台正在冒出来的话题、表达方式和用户问题，再转成本地化选题。",
    inputLabel: "你现在可以输入",
    exampleInput: "目标国家、行业、人群或产品卖点，用来筛出可本地化的趋势。",
    outputs: [
      {
        title: "海外趋势",
        detail: "识别海外热词、内容形态和用户关注点。",
        points: ["趋势主题", "适配平台", "增长信号"],
      },
      {
        title: "本地化角度",
        detail: "把海外趋势转成国内团队能写、能拍、能测试的表达。",
        points: ["中文标题方向", "本地案例角度", "表达边界"],
      },
      {
        title: "参考素材",
        detail: "留下来源记录和素材方向，方便后续进入素材库。",
        points: ["来源记录", "素材类型", "可复用结构"],
      },
    ],
    nextActions: [
      { label: "沉淀素材", href: "/content?tool=private-asset-extractor", icon: Database },
      { label: "生成内容", href: "/content/articles?tool=creation-enhancement", icon: Sparkles },
      { label: "生成报告", href: "/intelligence/reports", icon: FileText },
    ],
    guardrails: [
      "海外素材只做参考，不直接复制画面、文案和评论。",
      "本地化表达需要保留行业和合规边界。",
    ],
  },
  "industry-intel": {
    eyebrow: "行业情报",
    title: "把行业信号变成选题、素材和监控动作",
    summary:
      "这里按行业聚合机会、风险、样本和平台变化，帮运营判断今天该跟什么、写什么、避开什么。",
    inputLabel: "你现在可以输入",
    exampleInput: "行业名称、关键词、人群或产品线，用来筛出可执行的行业信号。",
    outputs: [
      {
        title: "行业机会",
        detail: "把分散热点、账号、评论和内容样本合并成行业判断。",
        points: ["机会主题", "平台变化", "可执行程度"],
      },
      {
        title: "风险信号",
        detail: "提前识别高风险表达、版权、功效和承诺边界。",
        points: ["风险等级", "来源记录", "处理建议"],
      },
      {
        title: "业务动作",
        detail: "直接转选题、素材、报告或长期监控。",
        points: ["生成选题", "导入素材", "创建监控"],
      },
    ],
    nextActions: [
      { label: "创建监控", href: "/intelligence/monitor-new", icon: BellRing },
      { label: "生成报告", href: "/intelligence/reports", icon: FileText },
      { label: "生成选题", href: "/topics", icon: Lightbulb },
    ],
    guardrails: [
      "行业判断必须保留来源和记录，不能只给主观结论。",
      "高风险行业信号先进入审核，不直接进入发布。",
    ],
  },
  "low-follower-viral": {
    eyebrow: "低粉爆款",
    title: "找到小账号也能爆的可复用打法",
    summary:
      "重点不是粉丝量，而是看标题、开头、结构和评论问题有没有可复制价值。",
    inputLabel: "你现在可以输入",
    exampleInput: "行业、账号阶段或内容方向，用来筛出低粉但高互动的样本。",
    outputs: [
      {
        title: "低粉样本",
        detail: "找出账号体量不大但互动强的样本。",
        points: ["平台来源", "互动表现", "账号阶段"],
      },
      {
        title: "可复用结构",
        detail: "只拆标题、开头、节奏和评论承接。",
        points: ["标题模型", "开头方式", "内容节奏"],
      },
      {
        title: "复刻建议",
        detail: "转成自己的选题和素材任务，不复制原内容。",
        points: ["选题建议", "素材建议", "风险边界"],
      },
    ],
    nextActions: [
      { label: "保存样本", href: "/content?tool=private-asset-extractor", icon: Database },
      { label: "生成选题", href: "/topics", icon: Lightbulb },
      { label: "账号健康", href: "/growth?view=account-health&tool=account-diagnosis", icon: TrendingUp },
    ],
    guardrails: [
      "只学习结构和用户问题，不搬运封面、画面、正文和评论原句。",
      "高风险样本只能进入规则沉淀。",
    ],
  },
  "viral-breakdown": {
    eyebrow: "爆款拆解",
    title: "把爆款拆成可以执行的标题、结构和素材任务",
    summary:
      "页面会把爆款样本拆成可复用部分、不能碰的部分和下一步生产动作。",
    inputLabel: "你现在可以输入",
    exampleInput: "爆款链接、关键词或竞品账号，用来拆标题、开头、结构和评论反馈。",
    outputs: [
      {
        title: "结构拆解",
        detail: "看清楚它为什么有效，而不是复制它。",
        points: ["标题模式", "开头钩子", "结构节奏"],
      },
      {
        title: "评论反馈",
        detail: "把评论里的疑问、异议和需求转成内容方向。",
        points: ["用户问题", "转化异议", "FAQ 方向"],
      },
      {
        title: "复刻任务",
        detail: "生成自己的选题、素材和审核任务。",
        points: ["素材入库", "生成文案", "风险检查"],
      },
    ],
    nextActions: [
      { label: "生成文案", href: "/content/articles?tool=creation-enhancement", icon: Sparkles },
      { label: "风险检查", href: "/compliance", icon: ShieldAlert },
      { label: "生成报告", href: "/intelligence/reports", icon: FileText },
    ],
    guardrails: [
      "爆款拆解只拆方法，不复用第三方原素材。",
      "价格、承诺、版权和医疗金融等敏感表达必须过审核。",
    ],
  },
  "competitor-account-radar": {
    eyebrow: "竞品账号",
    title: "把竞品账号变成长期观察和增长机会",
    summary:
      "这里不是只看账号列表，而是把竞品栏目、爆款、评论问题和动作建议沉淀下来。",
    inputLabel: "你现在可以输入",
    exampleInput: "竞品账号、行业关键词或平台，用来建立对标账号和观察理由。",
    outputs: [
      {
        title: "对标账号",
        detail: "记录账号、平台、来源记录和为什么值得看。",
        points: ["账号信息", "来源记录", "观察理由"],
      },
      {
        title: "增长机会",
        detail: "从栏目、互动和评论里找自己的内容机会。",
        points: ["栏目机会", "评论问题", "差异打法"],
      },
      {
        title: "跟踪动作",
        detail: "把账号加入观察、生成报告或继续拆爆款。",
        points: ["重点观察", "生成报告", "拆爆款样本"],
      },
    ],
    nextActions: [
      { label: "加入监控", href: "/intelligence/monitors", icon: BellRing },
      { label: "拆爆款", href: "/intelligence/viral?tool=viral-breakdown", icon: Target },
      { label: "生成报告", href: "/intelligence/reports", icon: FileText },
    ],
    guardrails: [
      "竞品账号只做观察和复盘，不自动触达对方用户。",
      "报告必须保留来源记录，不能只输出主观判断。",
    ],
  },
  "brand-monitoring": {
    eyebrow: "品牌舆情",
    title: "把品牌词和竞品词变成持续监控",
    summary:
      "这里帮你长期盯品牌词、竞品词、风险词和用户异议，异常先进入处理队列。",
    inputLabel: "你现在可以输入",
    exampleInput: "品牌词、产品词、竞品词或风险词，用来创建长期监控和日报输入。",
    outputs: [
      {
        title: "监控目标",
        detail: "明确要盯的词、平台、频率和负责人。",
        points: ["关键词", "平台范围", "监控频率"],
      },
      {
        title: "风险预警",
        detail: "发现负面、争议、侵权或敏感表达时进入处理队列。",
        points: ["风险等级", "来源记录", "处理边界"],
      },
      {
        title: "复盘报告",
        detail: "把监控结果沉淀成日报、周报和后续选题方向。",
        points: ["趋势变化", "异常记录", "建议动作"],
      },
    ],
    nextActions: [
      { label: "新建监控", href: "/intelligence/monitor-new", icon: BellRing },
      { label: "看待处理", href: "/intelligence/inbox", icon: Target },
      { label: "生成报告", href: "/intelligence/reports", icon: FileText },
    ],
    guardrails: [
      "品牌舆情只做发现、判断和派发，不自动触达用户。",
      "涉及负面和敏感内容时保留记录链，再人工处理。",
    ],
  },
};

export function getIntelligenceToolView(tool: string | null) {
  return tool ? intelligenceToolViews[tool] || null : null;
}

type IntelligenceToolResultContextProps = {
  tool: string | null;
};

export function IntelligenceToolResultContext({
  tool,
}: IntelligenceToolResultContextProps) {
  const view = getIntelligenceToolView(tool);

  if (!view) return null;

  return (
    <section
      className="kaypal-v3-panel overflow-hidden"
      data-testid={`intelligence-tool-result-context-${tool}`}
    >
      <div className="grid gap-0 xl:grid-cols-[minmax(0,1.05fr)_minmax(340px,0.95fr)]">
        <div className="border-b border-[var(--kaypal-v3-border)] p-4 xl:border-b-0 xl:border-r">
          <div className="flex min-w-0 items-start gap-3">
            <span className="kaypal-v3-icon-tile shrink-0">
              <Globe2
                aria-hidden="true"
                className="h-5 w-5"
                strokeWidth={1.8}
              />
            </span>
            <div className="min-w-0">
              <p className="kaypal-v3-label">{view.eyebrow}</p>
              <h2 className="mt-1 text-[20px] font-bold leading-7 text-[var(--kaypal-v3-ink)]">
                {view.title}
              </h2>
              <p className="mt-2 max-w-4xl text-[13px] leading-5 text-[var(--kaypal-v3-soft-ink)]">
                {view.summary}
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3">
            <p className="kaypal-v3-label">{view.inputLabel}</p>
            <p className="mt-1 text-[13px] font-semibold leading-5 text-[var(--kaypal-v3-soft-ink)]">
              {view.exampleInput}
            </p>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {view.nextActions.map(({ label, href, icon: Icon }) => (
              <Link
                className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 text-[12px] font-semibold text-[var(--kaypal-v3-soft-ink)] transition-colors hover:border-[var(--kaypal-v3-border-strong)] hover:text-[var(--kaypal-v3-ink)]"
                href={href}
                key={label}
              >
                <Icon
                  aria-hidden="true"
                  className="h-4 w-4"
                  strokeWidth={1.8}
                />
                {label}
                <ArrowRight
                  aria-hidden="true"
                  className="h-3.5 w-3.5"
                  strokeWidth={1.8}
                />
              </Link>
            ))}
          </div>
        </div>

        <div className="p-4">
          <p className="kaypal-v3-label">结果会直接长这样</p>
          <div className="mt-3 grid gap-3 lg:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
            {view.outputs.map((output) => (
              <article
                className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3"
                key={output.title}
              >
                <h3 className="text-[13px] font-bold text-[var(--kaypal-v3-ink)]">
                  {output.title}
                </h3>
                <p className="mt-1 text-[12px] leading-5 text-[var(--kaypal-v3-muted)]">
                  {output.detail}
                </p>
                <div className="mt-3 grid gap-1.5">
                  {output.points.map((point) => (
                    <div className="flex items-start gap-2" key={point}>
                      <CheckCircle2
                        aria-hidden="true"
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--kaypal-v3-success)]"
                        strokeWidth={1.8}
                      />
                      <span className="text-[12px] leading-4 text-[var(--kaypal-v3-soft-ink)]">
                        {point}
                      </span>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>

          <div className="mt-3 rounded-[8px] border border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)] p-3">
            <p className="kaypal-v3-label">使用边界</p>
            <div className="mt-2 grid gap-1.5">
              {view.guardrails.map((item) => (
                <p
                  className="text-[12px] leading-5 text-[var(--kaypal-v3-soft-ink)]"
                  key={item}
                >
                  {item}
                </p>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
