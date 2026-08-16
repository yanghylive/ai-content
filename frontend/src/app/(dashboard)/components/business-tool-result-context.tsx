"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Database,
  FileText,
  HeartPulse,
  MessageCircle,
  PenLine,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  Upload,
  UsersRound,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";

type BusinessToolView = {
  eyebrow: string;
  title: string;
  summary: string;
  inputHint: string;
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

const businessToolViews: Record<string, BusinessToolView> = {
  "private-asset-extractor": {
    eyebrow: "素材提取",
    title: "把外部内容沉淀成自己的素材资产",
    summary:
      "这里用来采集、筛选和整理可用素材，后续直接进入选题、创作优化和发布准备。",
    inputHint: "输入关键词、来源链接、平台或素材主题，先把素材收进素材库。",
    outputs: [
      {
        title: "可用素材",
        detail: "留下标题、摘要、平台、作者和正文。",
        points: ["来源信息", "素材摘要", "平台标签"],
      },
      {
        title: "来源记录",
        detail: "保留原始链接和采集时间，方便后续复核。",
        points: ["原始链接", "采集记录", "风险提示"],
      },
      {
        title: "下一步任务",
        detail: "素材可以继续转选题、改文案或进发布检查。",
        points: ["生成选题", "创作优化", "发布检查"],
      },
    ],
    nextActions: [
      { label: "生成选题", href: "/topics", icon: PenLine },
      {
        label: "创作优化",
        href: "/content/optimization?tool=multi-platform-copy",
        icon: WandSparkles,
      },
      {
        label: "发布检查",
        href: "/compliance",
        icon: ShieldCheck,
      },
    ],
    guardrails: [
      "素材入库只保留来源和可学习结构，不自动搬运原文。",
      "涉及版权、功效、价格和隐私的信息先进入复核。",
    ],
  },
  "creation-enhancement": {
    eyebrow: "内容生成",
    title: "把选题和素材变成可编辑内容草稿",
    summary:
      "这里承接选题、素材和业务目标，生成文章、脚本、标题和可继续优化的内容版本。",
    inputHint: "输入选题、素材摘要、目标平台和表达风格，直接生成内容草稿。",
    outputs: [
      {
        title: "内容草稿",
        detail: "生成可继续编辑的正文、标题和结构。",
        points: ["标题", "正文", "内容结构"],
      },
      {
        title: "平台版本",
        detail: "根据不同平台转成不同表达方式。",
        points: ["小红书", "公众号", "短视频脚本"],
      },
      {
        title: "发布准备",
        detail: "草稿完成后进入优化和合规检查。",
        points: ["保存版本", "优化文案", "发布检查"],
      },
    ],
    nextActions: [
      {
        label: "优化文案",
        href: "/content/optimization?tool=multi-platform-copy",
        icon: WandSparkles,
      },
      {
        label: "发布检查",
        href: "/compliance",
        icon: ShieldCheck,
      },
      { label: "打开素材库", href: "/content?tool=private-asset-extractor", icon: Database },
    ],
    guardrails: [
      "生成内容先保存为草稿，不直接发布。",
      "涉及承诺、价格、医疗健康等表达必须走发布检查。",
    ],
  },
  "aigc-asset-factory": {
    eyebrow: "视频工坊",
    title: "把素材和脚本做成可发布的视频资产",
    summary:
      "这里承接素材、模板、画幅和脚本，生成可复用的视频任务和成片记录。",
    inputHint: "选择素材、模板、时长、画幅和风格，生成短视频任务。",
    outputs: [
      {
        title: "视频脚本",
        detail: "把素材转成镜头、口播和节奏安排。",
        points: ["镜头顺序", "口播脚本", "字幕要点"],
      },
      {
        title: "成片任务",
        detail: "生成可追踪的视频任务和输出文件。",
        points: ["任务进度", "输出文件", "生成记录"],
      },
      {
        title: "发布衔接",
        detail: "成片后继续进入发布准备和风险检查。",
        points: ["发布中心", "风险检查", "复盘记录"],
      },
    ],
    nextActions: [
      { label: "打开素材库", href: "/content?tool=private-asset-extractor", icon: Database },
      { label: "发布衔接", href: "/distribution/publish-video", icon: Upload },
      {
        label: "风险检查",
        href: "/compliance",
        icon: ShieldCheck,
      },
    ],
    guardrails: [
      "生成视频前要确认素材来源和版权边界。",
      "发布前仍需检查标题、口播、字幕和封面表达。",
    ],
  },
  "multi-platform-copy": {
    eyebrow: "多平台文案",
    title: "把一份内容改成不同平台能用的版本",
    summary:
      "这里做标题评分、文案改写、小红书优化和多平台适配，输出可保存的内容版本。",
    inputHint: "粘贴原文或选择文章/素材，再选择目标平台和账号语气。",
    outputs: [
      {
        title: "标题评分",
        detail: "判断吸引力、关键词、可信度和风险。",
        points: ["总分", "命中项", "修改建议"],
      },
      {
        title: "平台改写",
        detail: "按平台语气生成不同版本。",
        points: ["小红书笔记", "公众号文章", "短视频脚本"],
      },
      {
        title: "正式版本",
        detail: "保存后进入发布检查和协作复核。",
        points: ["保存版本", "设为正式", "发布检查"],
      },
    ],
    nextActions: [
      {
        label: "发布检查",
        href: "/compliance",
        icon: ShieldCheck,
      },
      { label: "打开文章库", href: "/content/articles?tool=creation-enhancement", icon: FileText },
      { label: "打开素材库", href: "/content?tool=private-asset-extractor", icon: Database },
    ],
    guardrails: [
      "多平台改写不等于自动发布，发布前要检查风险。",
      "保留每次保存的版本，方便回滚和复盘。",
    ],
  },
  "publish-compliance": {
    eyebrow: "发布风险检查",
    title: "发布前先把敏感词、承诺和平台风险查清楚",
    summary:
      "这里检查标题、正文、脚本、评论回复和素材表达，给出是否可发、怎么改和是否需要人工复核。",
    inputHint: "粘贴待发布内容，或从内容优化版本带入后直接检查。",
    outputs: [
      {
        title: "风险命中",
        detail: "列出敏感词、绝对化承诺、隐私和价格风险。",
        points: ["命中文本", "风险原因", "风险等级"],
      },
      {
        title: "修改建议",
        detail: "给出可替换表达和处理动作。",
        points: ["替换建议", "人工复核", "正式版本"],
      },
      {
        title: "发布判断",
        detail: "明确能不能进入发布准备。",
        points: ["允许发布", "需要复核", "禁止直接发布"],
      },
    ],
    nextActions: [
      {
        label: "继续优化",
        href: "/content/optimization?tool=multi-platform-copy",
        icon: WandSparkles,
      },
      { label: "发布中心", href: "/distribution", icon: Upload },
	      { label: "结果留存", href: "/tasks/evidence", icon: ClipboardCheck },
    ],
    guardrails: [
      "检查通过才进入发布准备，高风险内容不能直接发布。",
      "人工复核记录要保留，方便追溯责任和修改过程。",
    ],
  },
  "kol-screening": {
    eyebrow: "达人筛选",
    title: "从账号和内容样本里找值得合作的达人",
    summary:
      "这里按行业、平台、人群和互动质量筛选达人，输出候选名单、匹配理由和跟进动作。",
    inputHint: "输入行业、人群、平台、预算或对标账号，筛出可跟进的达人候选。",
    outputs: [
      {
        title: "达人候选",
        detail: "整理账号、平台、内容方向和互动表现。",
        points: ["账号信息", "平台来源", "内容定位"],
      },
      {
        title: "匹配理由",
        detail: "判断和品牌、人群、内容目标是否匹配。",
        points: ["人群匹配", "内容匹配", "风险提示"],
      },
      {
        title: "跟进动作",
        detail: "进入获客任务、线索池或增长复盘。",
        points: ["创建任务", "沉淀线索", "复盘效果"],
      },
    ],
    nextActions: [
      { label: "创建获客任务", href: "/growth?view=acquisition&tool=kol-screening", icon: Target },
      { label: "查看线索池", href: "/growth?view=leads", icon: UsersRound },
	      { label: "账号健康", href: "/growth?view=account-health&tool=account-diagnosis", icon: HeartPulse },
    ],
    guardrails: [
      "达人筛选只给候选和理由，不自动私信、不自动外联。",
      "高风险账号先做账号健康诊断，再进入合作跟进。",
    ],
  },
  "account-diagnosis": {
    eyebrow: "账号健康",
    title: "先看账号健康，再决定要不要跑获客任务",
    summary:
      "这里看账号登录、失败率、冷却状态和平台风险，避免任务还没开始就被风控拖死。",
    inputHint: "选择账号或输入账号关键词，查看健康状态和处理建议。",
    outputs: [
      {
        title: "账号状态",
        detail: "展示账号是否可用、是否冷却、近期是否异常。",
        points: ["登录状态", "失败率", "冷却时间"],
      },
      {
        title: "风险原因",
        detail: "说明任务失败、触发风控或需要暂停的原因。",
        points: ["异常记录", "风险模式", "处理边界"],
      },
      {
        title: "处理建议",
        detail: "给出恢复、暂停、换号或降低频率建议。",
        points: ["恢复账号", "暂停任务", "调整频率"],
      },
    ],
    nextActions: [
      { label: "自动获客", href: "/growth?view=acquisition&tool=kol-screening", icon: Search },
	      { label: "增长复盘", href: "/growth?view=reports", icon: FileText },
	      { label: "增长工作流", href: "/growth?view=workflows", icon: Target },
    ],
    guardrails: [
      "账号异常时不建议继续跑高频任务。",
      "冷却、恢复和释放都要留下结果记录。",
    ],
  },
  "comment-lead-solution": {
    eyebrow: "评论线索",
    title: "把评论里的问题变成可跟进的需求线索",
    summary:
      "这里分析评论里的痛点、需求、异议和意向词，生成回复建议和线索草稿。",
    inputHint: "选择作品评论、导入评论样本，或输入关键词评论进行分析。",
    outputs: [
      {
        title: "需求洞察",
        detail: "把评论聚类成痛点、疑问、预算和购买阻碍。",
        points: ["痛点", "需求", "异议"],
      },
      {
        title: "回复建议",
        detail: "生成待确认回复和规则建议。",
        points: ["回复草稿", "回复规则", "人工确认"],
      },
      {
        title: "线索草稿",
        detail: "把高意向评论沉淀为可审核线索。",
        points: ["意向词", "来源记录", "跟进建议"],
      },
    ],
    nextActions: [
      { label: "查看回复规则", href: "/engagement/rules", icon: MessageCircle },
      { label: "查看线索池", href: "/growth?view=leads", icon: UsersRound },
      { label: "客户沉淀", href: "/engagement/customers", icon: Database },
    ],
    guardrails: [
      "评论洞察不自动评论、不自动私信、不自动加微。",
      "线索入池前需要人工确认来源、意向和合规边界。",
    ],
  },
};

type BusinessToolResultContextProps = {
  allowedTools: string[];
};

export function BusinessToolResultContext({
  allowedTools,
}: BusinessToolResultContextProps) {
  const searchParams = useSearchParams();
  const tool = searchParams.get("tool") || "";
  const isAllowed = allowedTools.includes(tool);
  const view = isAllowed ? businessToolViews[tool] : null;

  if (!view) return null;

  return (
    <section
      className="kaypal-v3-panel overflow-hidden"
      data-testid={`business-tool-result-context-${tool}`}
    >
      <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.92fr)]">
        <div className="border-b border-[var(--kaypal-v3-border)] p-4 xl:border-b-0 xl:border-r">
          <div className="flex min-w-0 items-start gap-3">
            <span className="kaypal-v3-icon-tile shrink-0">
              <Sparkles
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
            <p className="kaypal-v3-label">直接这样用</p>
            <p className="mt-1 text-[13px] font-semibold leading-5 text-[var(--kaypal-v3-soft-ink)]">
              {view.inputHint}
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
          <p className="kaypal-v3-label">你会拿到这些结果</p>
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
