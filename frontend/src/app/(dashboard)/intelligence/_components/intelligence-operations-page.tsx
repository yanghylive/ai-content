"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowRight,
  BellRing,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  FileText,
  GitBranch,
  Inbox,
  MessageSquareText,
  Radio,
  ShieldAlert,
  SlidersHorizontal,
  Target,
  UsersRound,
  type LucideIcon,
} from "@/components/iconpark";

type OperationsKey =
  "inbox" | "reports" | "leads" | "risks" | "rules" | "collaboration";

type RiskLevel = "low" | "medium" | "high";

type WorkAction = {
  label: string;
  target: string;
  href: string;
  risk: RiskLevel;
};

type WorkItem = {
  id: string;
  title: string;
  status: string;
  owner: string;
  due: string;
  source: string;
  score: number;
  risk: RiskLevel;
  decision: string;
  evidence: string[];
  actions: WorkAction[];
};

type OperationsConfig = {
  key: OperationsKey;
  title: string;
  eyebrow: string;
  description: string;
  icon: LucideIcon;
  primaryAction: string;
  primaryHref: string;
  secondaryAction: string;
  secondaryHref: string;
  metrics: Array<{
    label: string;
    value: string;
    detail: string;
    icon: LucideIcon;
  }>;
  items: WorkItem[];
  governanceTitle: string;
  governanceRows: string[][];
  outputTitle: string;
  outputs: Array<{
    title: string;
    detail: string;
    owner: string;
    href: string;
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

const riskMeta: Record<RiskLevel, { label: string; className: string }> = {
  low: {
    label: "低风险",
    className:
      "border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] text-[var(--kaypal-v3-soft-ink)]",
  },
  medium: {
    label: "需复核",
    className:
      "border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)] text-[var(--kaypal-v3-soft-ink)]",
  },
  high: {
    label: "高风险",
    className:
      "border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] text-[var(--kaypal-v3-soft-ink)]",
  },
};

const operationsConfigs: Record<OperationsKey, OperationsConfig> = {
  inbox: {
    key: "inbox",
    title: "待处理发现",
    eyebrow: "统一收件箱",
    description:
      "热点、搜索、账号、评论和行业源先进入同一个待处理发现池，再由负责人判断证据、风险和去向。",
    icon: Inbox,
    primaryAction: "跑平台搜索",
    primaryHref: "/intelligence/search",
    secondaryAction: "查看热点",
    secondaryHref: "/intelligence/trends",
    metrics: [
      {
        label: "待处理情报",
        value: "12",
        detail: "今天必须给出去向",
        icon: Inbox,
      },
      {
        label: "需复核",
        value: "3",
        detail: "不能直接进入业务流程",
        icon: ShieldAlert,
      },
      {
        label: "已派发",
        value: "18",
        detail: "流向素材、选题和监控",
        icon: GitBranch,
      },
    ],
    items: [
      {
        id: "inbox-local-life-comments",
        title: "本地生活评论集中追问价格、到店流程和真实案例",
        status: "待判断",
        owner: "运营负责人",
        due: "今日 18:00",
        source: "小红书评论分析 + 抖音搜索",
        score: 92,
        risk: "medium",
        decision: "转成选题和 FAQ，价格承诺类表达先送风险审核。",
        evidence: [
          "评论里反复出现“多少钱”“怎么到店”“有没有案例”。",
          "同主题在抖音和小红书都有有效样本，说明不是单平台噪音。",
          "适合沉淀回复规则，但不能自动触达用户。",
        ],
        actions: [
          { label: "转选题", target: "选题库", href: "/topics", risk: "low" },
          {
            label: "做线索洞察",
            target: "线索洞察",
            href: "/intelligence/leads",
            risk: "medium",
          },
          {
            label: "送风险审核",
            target: "风险审核",
            href: "/intelligence/risks",
            risk: "high",
          },
        ],
      },
      {
        id: "inbox-founder-account",
        title: "老板 IP 低粉账号连续两周出现高质量评论",
        status: "新发现",
        owner: "增长负责人",
        due: "明日 12:00",
        source: "小红书爆款笔记查询",
        score: 88,
        risk: "low",
        decision: "进入对标账号池，观察栏目和评论问题，不做自动触达。",
        evidence: [
          "账号栏目稳定，持续围绕获客、管理和案例表达。",
          "评论集中在预算、可信度和落地难度。",
          "可作为增长策略，不作为搬运素材。",
        ],
        actions: [
          {
            label: "加入对标",
            target: "对标账号",
            href: "/intelligence/accounts",
            risk: "low",
          },
          {
            label: "加入监控",
            target: "监控",
            href: "/intelligence/monitors",
            risk: "low",
          },
        ],
      },
    ],
    governanceTitle: "发现分流规则",
    governanceRows: [
      ["热点", "看业务相关和时效", "选题 / 报告", "敏感话题先审核"],
      ["评论", "看问题集中度", "线索洞察 / 回复规则", "禁止自动触达"],
      ["账号", "看定位和互动质量", "对标账号 / 监控", "不采集隐私字段"],
    ],
    outputTitle: "今日交付",
    outputs: [
      {
        title: "运营情报日清",
        detail: "待判断、已派发、需复核三类对象",
        owner: "运营负责人",
        href: "/intelligence/reports",
      },
      {
        title: "高风险对象清单",
        detail: "版权、夸大表达、敏感话题和自动触达风险",
        owner: "复核负责人",
        href: "/intelligence/risks",
      },
    ],
  },
  reports: {
    key: "reports",
    title: "报告中心",
    eyebrow: "交付物",
    description:
      "把情报对象沉淀成日报、竞品周报、选题机会和风险摘要，管理层看结论，运营能追证据。",
    icon: FileText,
    primaryAction: "查看待处理发现",
    primaryHref: "/intelligence/inbox",
    secondaryAction: "看用量",
    secondaryHref: "/intelligence/costs",
    metrics: [
      {
        label: "可生成",
        value: "4",
        detail: "可交付报告：日报、周报、机会、风险",
        icon: FileText,
      },
      {
        label: "证据完整",
        value: "21",
        detail: "保留来源、时间和责任人",
        icon: ClipboardCheck,
      },
      {
        label: "需补证",
        value: "2",
        detail: "报告前先回到待处理发现",
        icon: Radio,
      },
    ],
    items: [
      {
        id: "report-daily-brief",
        title: "今日情报简报：本地生活获客机会和风险",
        status: "可生成",
        owner: "运营负责人",
        due: "今日 19:00",
        source: "待处理发现已判断对象",
        score: 90,
        risk: "low",
        decision: "生成管理层摘要，同时保留证据对象和派发去向。",
        evidence: [
          "今日高相关对象集中在本地生活、老板 IP 和评论异议。",
          "已区分可派发样本和需复核对象。",
          "可输出 3 条选题、2 个监控调整和 1 条风险规则。",
        ],
        actions: [
          {
            label: "生成日报",
            target: "报告",
            href: "/intelligence/reports",
            risk: "low",
          },
          {
            label: "补证据",
            target: "待处理发现",
            href: "/intelligence/inbox",
            risk: "medium",
          },
        ],
      },
      {
        id: "report-competitor-weekly",
        title: "竞品账号周报：老板 IP 账号栏目和互动结构",
        status: "审阅中",
        owner: "增长负责人",
        due: "周五 17:00",
        source: "对标账号 + 评论线索",
        score: 84,
        risk: "low",
        decision: "输出账号栏目变化、爆款结构和可借鉴增长动作。",
        evidence: [
          "3 个对标账号都在强化案例型栏目。",
          "评论中预算和可信度问题占比最高。",
          "适合联动增长策略和线索洞察。",
        ],
        actions: [
          {
            label: "进入对标",
            target: "对标账号",
            href: "/intelligence/accounts",
            risk: "low",
          },
          {
            label: "派给增长",
            target: "增长策略",
            href: "/growth/strategies",
            risk: "low",
          },
        ],
      },
    ],
    governanceTitle: "报告生成门槛",
    governanceRows: [
      ["日报", "至少 3 条已判断对象", "管理摘要", "高风险单列"],
      ["竞品周报", "账号池有持续样本", "增长策略", "不复制原文"],
      ["风险摘要", "风险对象有记录", "复核动作", "明确需处理原因"],
    ],
    outputTitle: "报告模板",
    outputs: [
      {
        title: "今日情报简报",
        detail: "机会、风险、派发动作和负责人",
        owner: "运营负责人",
        href: "/intelligence/reports",
      },
      {
        title: "风险摘要",
        detail: "高风险来源、命中原因和处理结论",
        owner: "复核负责人",
        href: "/intelligence/risks",
      },
    ],
  },
  leads: {
    key: "leads",
    title: "线索洞察",
    eyebrow: "评论到需求",
    description:
      "从评论和搜索样本中提炼用户问题、购买异议、意向词和回复规则，只生成洞察，不自动外联。",
    icon: Target,
    primaryAction: "查看评论",
    primaryHref: "/intelligence/leads",
    secondaryAction: "回复规则",
    secondaryHref: "/intelligence/rules",
    metrics: [
      {
        label: "问题簇",
        value: "9",
        detail: "价格、流程、案例、周期",
        icon: MessageSquareText,
      },
      {
        label: "销售线索",
        value: "16",
        detail: "由意向词进入人工线索判断",
        icon: Target,
      },
      {
        label: "自动触达",
        value: "0",
        detail: "默认禁止",
        icon: ShieldAlert,
      },
    ],
    items: [
      {
        id: "lead-private-domain-cost",
        title: "私域获客评论高频异议：预算、见效周期和案例真实性",
        status: "可转 FAQ",
        owner: "内容策划",
        due: "今日 17:30",
        source: "小红书评论分析",
        score: 91,
        risk: "medium",
        decision: "沉淀 FAQ 和回复建议，进入人工确认，不自动私信。",
        evidence: [
          "用户问题集中在预算和效果预期。",
          "异议能反向补充内容选题。",
          "回复建议需要按行业和平台语气复核。",
        ],
        actions: [
          {
            label: "沉淀 FAQ",
            target: "回复规则",
            href: "/intelligence/rules",
            risk: "low",
          },
          {
            label: "转线索池",
            target: "线索池",
            href: "/growth/leads",
            risk: "medium",
          },
        ],
      },
      {
        id: "lead-ai-tool-workflow",
        title: "AI 工具教程评论出现团队协作和数据安全追问",
        status: "可转选题",
        owner: "内容策划",
        due: "明日 10:00",
        source: "B站关键词搜作品",
        score: 82,
        risk: "low",
        decision: "转成团队版工具文章选题，补充安全边界说明。",
        evidence: [
          "评论关注能否多人协作和历史记录安全。",
          "适合内容生产，不适合直接销售触达。",
          "可与知识库和选题库联动。",
        ],
        actions: [
          { label: "生成选题", target: "选题库", href: "/topics", risk: "low" },
          {
            label: "沉淀素材",
            target: "素材库",
            href: "/content",
            risk: "low",
          },
        ],
      },
    ],
    governanceTitle: "线索边界",
    governanceRows: [
      ["评论问题", "提炼为 FAQ", "回复规则", "人工确认"],
      ["意向词", "进入线索判断", "线索池", "不自动外联"],
      ["敏感诉求", "先做风险判断", "风险审核", "不生成承诺"],
    ],
    outputTitle: "可沉淀资产",
    outputs: [
      {
        title: "用户异议库",
        detail: "预算、效果、可信度和流程问题",
        owner: "内容策划",
        href: "/intelligence/rules",
      },
      {
        title: "线索判断依据",
        detail: "只做人工判断输入，不直接触达",
        owner: "增长负责人",
        href: "/growth/leads",
      },
    ],
  },
  risks: {
    key: "risks",
    title: "风险审核",
    eyebrow: "风险守门",
    description:
      "把版权、敏感话题、夸大表达和自动触达风险前置到情报派发阶段，高风险对象不能直接进入生产。",
    icon: ShieldAlert,
    primaryAction: "查看规则",
    primaryHref: "/intelligence/rules",
    secondaryAction: "看用量",
    secondaryHref: "/intelligence/costs",
    metrics: [
      {
        label: "高风险",
        value: "3",
        detail: "暂停业务流程",
        icon: ShieldAlert,
      },
      {
        label: "需复核",
        value: "8",
        detail: "人工确认后派发",
        icon: ClipboardCheck,
      },
      {
        label: "已放行",
        value: "14",
        detail: "保留审核结论",
        icon: CheckCircle2,
      },
    ],
    items: [
      {
        id: "risk-short-drama-title",
        title: "短剧投流样本标题刺激性高，素材版权来源不清",
        status: "需处理",
        owner: "复核负责人",
        due: "今日 16:30",
        source: "抖音实时作品搜索",
        score: 36,
        risk: "high",
        decision: "只保留结构观察价值，不进入创作和发布流程。",
        evidence: [
          "标题表达刺激性强，容易影响品牌安全。",
          "素材来源不能确认，版权信息不完整。",
          "可沉淀为风险规则，提醒后续爆款拆解。",
        ],
        actions: [
          {
            label: "沉淀规则",
            target: "情报规则",
            href: "/intelligence/rules",
            risk: "medium",
          },
          {
            label: "保留证据",
            target: "结果留存",
	            href: "/tasks/evidence",
            risk: "low",
          },
        ],
      },
      {
        id: "risk-price-promise",
        title: "本地生活获客样本涉及价格承诺和效果承诺",
        status: "复核",
        owner: "复核负责人",
        due: "今日 18:00",
        source: "小红书评论分析",
        score: 62,
        risk: "medium",
        decision: "可转 FAQ，但不能生成承诺式回复。",
        evidence: [
          "评论追问价格和见效周期。",
          "内容可解释流程，不能承诺结果。",
          "回复规则需要限定话术边界。",
        ],
        actions: [
          {
            label: "写规则",
            target: "情报规则",
            href: "/intelligence/rules",
            risk: "low",
          },
          {
            label: "转线索洞察",
            target: "线索洞察",
            href: "/intelligence/leads",
            risk: "medium",
          },
        ],
      },
    ],
    governanceTitle: "审核边界",
    governanceRows: [
      ["版权不清", "暂停创作流程", "只保留结构观察", "复核负责人"],
      ["夸大表达", "进入复核", "改成解释型表达", "内容策划"],
      ["自动触达", "默认禁止", "人工确认后处理", "增长负责人"],
    ],
    outputTitle: "审核交付",
    outputs: [
      {
        title: "风险摘要",
        detail: "风险来源、命中原因、处理结论",
        owner: "复核负责人",
        href: "/intelligence/reports",
      },
      {
        title: "拦截规则",
        detail: "进入情报规则和发布前检查",
        owner: "管理员",
        href: "/intelligence/rules",
      },
    ],
  },
  rules: {
    key: "rules",
    title: "情报规则",
    eyebrow: "规则库",
    description:
      "配置关键词、账号、行业源、平台范围、积分扣减和风险边界，让情报生产有稳定规则。",
    icon: SlidersHorizontal,
    primaryAction: "创建监控",
    primaryHref: "/intelligence/monitors",
    secondaryAction: "查看用量",
    secondaryHref: "/intelligence/costs",
    metrics: [
      {
        label: "关键词组",
        value: "18",
        detail: "行业、竞品、品牌和地域",
        icon: SlidersHorizontal,
      },
      {
        label: "积分扣减",
        value: "已启用",
        detail: "真实采集成功后直接扣积分",
        icon: BellRing,
      },
      {
        label: "风险规则",
        value: "12",
        detail: "版权、触达、表达边界和需处理条件",
        icon: ShieldAlert,
      },
    ],
    items: [
      {
        id: "rule-local-life-keywords",
        title: "本地生活关键词组：同城、门店、探店、到店流程",
        status: "运行中",
        owner: "运营负责人",
        due: "每日 09:00",
        source: "一键找线索 + 热点雷达",
        score: 87,
        risk: "low",
        decision: "继续监控，新增价格和案例相关评论标签。",
        evidence: [
          "关键词稳定带来可转选题样本。",
          "评论中的价格和案例追问持续出现。",
          "点数在当前阈值内。",
        ],
        actions: [
          {
            label: "同步监控",
            target: "监控",
            href: "/intelligence/monitors",
            risk: "low",
          },
          {
            label: "看待处理发现",
            target: "待处理发现",
            href: "/intelligence/inbox",
            risk: "low",
          },
        ],
      },
      {
        id: "rule-auto-touch",
        title: "自动触达边界：评论、私信、加微动作必须人工确认",
        status: "强制规则",
        owner: "复核负责人",
        due: "持续生效",
        source: "风险审核",
        score: 100,
        risk: "high",
        decision: "所有情报对象只能生成建议，不自动执行外联动作。",
        evidence: [
          "评论洞察和线索判断不等于触达授权。",
          "高意向词只进入人工线索池。",
          "分发任务必须显示风险和负责人。",
        ],
        actions: [
          {
            label: "查看风险",
            target: "风险审核",
            href: "/intelligence/risks",
            risk: "medium",
          },
          {
            label: "团队确认",
            target: "团队协作",
            href: "/intelligence/collaboration",
            risk: "low",
          },
        ],
      },
    ],
    governanceTitle: "规则类型",
    governanceRows: [
      ["关键词", "平台、频次、积分", "自动监控 / 待处理发现", "运营负责人"],
      ["账号", "观察范围和更新节奏", "对标账号", "增长负责人"],
      ["风险", "需处理和复核条件", "风险审核", "复核负责人"],
    ],
    outputTitle: "规则应用",
    outputs: [
      {
        title: "监控策略",
        detail: "对象、频率、积分记录和停止条件",
        owner: "运营负责人",
        href: "/intelligence/monitors",
      },
      {
        title: "风险边界",
        detail: "自动触达、版权和夸大表达规则",
        owner: "复核负责人",
        href: "/intelligence/risks",
      },
    ],
  },
  collaboration: {
    key: "collaboration",
    title: "团队协作",
    eyebrow: "责任流转",
    description:
      "让每条情报都有负责人、状态、审阅意见、审核结论和交接记录，避免情报只被看见、没有人处理。",
    icon: UsersRound,
    primaryAction: "查看待处理发现",
    primaryHref: "/intelligence/inbox",
    secondaryAction: "查看报告",
    secondaryHref: "/intelligence/reports",
    metrics: [
      {
        label: "待审阅",
        value: "7",
        detail: "需要负责人给结论",
        icon: ClipboardList,
      },
      {
        label: "跨组派发",
        value: "11",
        detail: "运营、内容、增长、风险复核",
        icon: UsersRound,
      },
      {
        label: "逾期",
        value: "1",
        detail: "行业源监控修复",
        icon: BellRing,
      },
    ],
    items: [
      {
        id: "collab-risk-review",
        title: "短剧投流风险对象等待复核负责人确认",
        status: "待审阅",
        owner: "复核负责人",
        due: "今日 16:30",
        source: "风险审核",
        score: 78,
        risk: "high",
        decision: "审阅后决定沉淀规则或删除生产去向。",
        evidence: [
          "对象已从总控台派发到风险审核。",
          "风险原因包含版权来源和刺激性表达。",
          "需要保留最终处理结论。",
        ],
        actions: [
          {
            label: "进入风险",
            target: "风险审核",
            href: "/intelligence/risks",
            risk: "high",
          },
          {
            label: "写报告",
            target: "报告中心",
            href: "/intelligence/reports",
            risk: "low",
          },
        ],
      },
      {
        id: "collab-report-handoff",
        title: "今日情报简报等待运营负责人补充结论",
        status: "待补充",
        owner: "运营负责人",
        due: "今日 19:00",
        source: "报告中心",
        score: 86,
        risk: "low",
        decision: "补充业务判断后交给管理层查看。",
        evidence: [
          "已收集今日待处理发现里的机会和风险对象。",
          "缺少本地生活获客机会的最终优先级。",
          "报告需要保留分发任务和责任人。",
        ],
        actions: [
          {
            label: "补充报告",
            target: "报告中心",
            href: "/intelligence/reports",
            risk: "low",
          },
          {
            label: "回待处理发现",
            target: "待处理发现",
            href: "/intelligence/inbox",
            risk: "low",
          },
        ],
      },
    ],
    governanceTitle: "协作状态",
    governanceRows: [
      ["新发现", "运营初筛", "待判断", "当天处理"],
      ["需复核", "风险复核", "放行 / 需处理", "必须留结论"],
      ["已派发", "目标团队承接", "报告 / 执行", "保留去向"],
    ],
    outputTitle: "交接视图",
    outputs: [
      {
        title: "负责人看板",
        detail: "谁负责、何时处理、当前结论",
        owner: "运营负责人",
        href: "/intelligence/collaboration",
      },
      {
        title: "管理层摘要",
        detail: "已处理、未处理、风险和用量",
        owner: "管理层",
        href: "/intelligence/reports",
      },
    ],
  },
};

function riskClass(risk: RiskLevel) {
  return riskMeta[risk].className;
}

function scoreClass(score: number, risk: RiskLevel) {
  if (risk === "high") return "bg-[var(--kaypal-v3-danger)]";
  if (score >= 85) return "bg-[var(--kaypal-v3-success)]";
  if (score >= 70) return "bg-[var(--kaypal-v3-accent)]";
  return "bg-[var(--kaypal-v3-amber)]";
}

type IntelligenceOperationsPageProps = {
  activeKey: OperationsKey;
};

export function IntelligenceOperationsPage({
  activeKey,
}: IntelligenceOperationsPageProps) {
  const config = operationsConfigs[activeKey];
  const [selectedId, setSelectedId] = useState(config.items[0].id);
  const [queue, setQueue] = useState<QueueItem[]>([]);

  const selectedItem = useMemo(
    () =>
      config.items.find((item) => item.id === selectedId) || config.items[0],
    [config.items, selectedId],
  );

  function addToQueue(action: WorkAction) {
    const id = `${selectedItem.id}:${action.label}:${action.target}`;

    setQueue((current) => {
      if (current.some((item) => item.id === id)) return current;

      return [
        {
          id,
          title: selectedItem.title,
          label: action.label,
          target: action.target,
          href: action.href,
          risk: action.risk,
        },
        ...current,
      ].slice(0, 6);
    });
  }

  function isQueued(action: WorkAction) {
    return queue.some(
      (item) =>
        item.id === `${selectedItem.id}:${action.label}:${action.target}`,
    );
  }

  const PageIcon = config.icon;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section className="kaypal-v3-panel overflow-hidden">
        <div className="border-b border-[var(--kaypal-v3-border)] p-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
            <div className="flex min-w-0 items-start gap-3">
              <span className="kaypal-v3-icon-tile shrink-0">
                <PageIcon
                  aria-hidden="true"
                  className="h-5 w-5"
                  strokeWidth={1.8}
                />
              </span>
              <div className="min-w-0">
                <p className="kaypal-v3-label">{config.eyebrow}</p>
                <h1 className="mt-1 kx-greet text-[var(--kaypal-v3-ink)]">
                  {config.title}
                </h1>
                <p className="mt-1 max-w-4xl text-13 leading-5 text-[var(--kaypal-v3-soft-ink)]">
                  {config.description}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 xl:justify-end">
              <Link
                className="inline-flex h-12 items-center gap-2 whitespace-nowrap rounded-[10px] bg-[image:var(--kaypal-v3-gradient-primary)] px-5 text-[15px] font-semibold text-white transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kaypal-v3-accent)] active:translate-y-0"
                href={config.primaryHref}
              >
                <ArrowRight
                  aria-hidden="true"
                  className="h-4 w-4"
                  strokeWidth={1.8}
                />
                {config.primaryAction}
              </Link>
              <Link
                className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-4 text-13 font-semibold text-[var(--kaypal-v3-soft-ink)] transition-colors hover:border-[var(--kaypal-v3-border-strong)] hover:text-[var(--kaypal-v3-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kaypal-v3-accent)]"
                href={config.secondaryHref}
              >
                {config.secondaryAction}
              </Link>
            </div>
          </div>

          <div className="mt-4 grid gap-2 md:grid-cols-3">
            {config.metrics.map(({ label, value, detail, icon: Icon }) => (
              <div
                className="min-h-[90px] rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3"
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
            ))}
          </div>

        </div>
      </section>

      <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(280px,0.82fr)_minmax(0,1.18fr)_minmax(300px,0.76fr)]">
        <article className="kaypal-v3-panel min-w-0 overflow-hidden">
          <div className="border-b border-[var(--kaypal-v3-border)] p-4">
            <p className="kaypal-v3-label">处理列表</p>
            <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
              当前对象
            </h2>
          </div>
          <div className="divide-y divide-[var(--kaypal-v3-border)]">
            {config.items.map((item) => {
              const isSelected = item.id === selectedItem.id;

              return (
                <button
                  aria-pressed={isSelected}
                  className={[
                    "block w-full p-4 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--kaypal-v3-accent)]",
                    isSelected
                      ? "bg-[var(--kaypal-v3-accent-soft)]"
                      : "bg-[var(--kaypal-v3-paper)] hover:bg-[var(--kaypal-v3-paper-soft)]",
                  ].join(" ")}
                  key={item.id}
                  onClick={() => setSelectedId(item.id)}
                  type="button"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-[6px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] px-2 py-0.5 text-11 font-semibold text-[var(--kaypal-v3-muted)]">
                      {item.status}
                    </span>
                    <span
                      className={[
                        "rounded-[6px] border px-2 py-0.5 text-11 font-semibold",
                        riskClass(item.risk),
                      ].join(" ")}
                    >
                      {riskMeta[item.risk].label}
                    </span>
                  </div>
                  <h3 className="mt-2 text-14 font-bold leading-5 text-[var(--kaypal-v3-ink)]">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                    {item.source}
                  </p>
                  <p className="mt-1 text-12 font-semibold text-[var(--kaypal-v3-soft-ink)]">
                    {item.owner} · {item.due}
                  </p>
                </button>
              );
            })}
          </div>
        </article>

        <article className="kaypal-v3-panel min-w-0 overflow-hidden">
          <div className="border-b border-[var(--kaypal-v3-border)] p-4">
            <p className="kaypal-v3-label">证据和判断</p>
            <h2 className="mt-1 text-lg font-bold leading-6 text-[var(--kaypal-v3-ink)]">
              {selectedItem.title}
            </h2>
            <p className="mt-1 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
              {selectedItem.source} · {selectedItem.owner}
            </p>
          </div>
          <div className="p-4">
            <div className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-12 font-bold text-[var(--kaypal-v3-muted)]">
                  业务评分
                </p>
                <span className="text-base font-bold text-[var(--kaypal-v3-ink)]">
                  {selectedItem.score}
                </span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--kaypal-v3-border)]">
                <div
                  className={[
                    "h-full rounded-full",
                    scoreClass(selectedItem.score, selectedItem.risk),
                  ].join(" ")}
                  style={{ width: `${selectedItem.score}%` }}
                />
              </div>
            </div>

            <div className="mt-4 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-4">
              <p className="kaypal-v3-label">推荐判断</p>
              <p className="mt-2 text-14 font-bold leading-6 text-[var(--kaypal-v3-ink)]">
                {selectedItem.decision}
              </p>
            </div>

            <div className="mt-4 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-4">
              <p className="kaypal-v3-label">证据</p>
              <ol className="mt-3 grid gap-3">
                {selectedItem.evidence.map((evidence, index) => (
                  <li className="flex gap-3" key={evidence}>
                    <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] bg-[var(--kaypal-v3-accent)] text-11 font-bold text-white">
                      {index + 1}
                    </span>
                    <p className="text-12 leading-5 text-[var(--kaypal-v3-soft-ink)]">
                      {evidence}
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
                派发和交接
              </h2>
            </div>
            <div className="grid gap-2 p-4">
              {selectedItem.actions.map((action) => {
                const queued = isQueued(action);

                return (
                  <button
                    className={[
                      "rounded-[8px] border p-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kaypal-v3-accent)] disabled:cursor-not-allowed disabled:opacity-60",
                      queued
                        ? "border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)]"
                        : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] hover:border-[var(--kaypal-v3-border-strong)] hover:bg-[var(--kaypal-v3-paper)]",
                    ].join(" ")}
                    disabled={queued}
                    key={action.label}
                    onClick={() => addToQueue(action)}
                    type="button"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-13 font-bold text-[var(--kaypal-v3-ink)]">
                          {queued ? "已加入队列" : action.label}
                        </p>
                        <p className="mt-1 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                          目标：{action.target}
                        </p>
                      </div>
                      <span
                        className={[
                          "shrink-0 rounded-[6px] border px-2 py-0.5 text-11 font-semibold",
                          riskClass(action.risk),
                        ].join(" ")}
                      >
                        {riskMeta[action.risk].label}
                      </span>
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
                待执行动作
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
                选择上方动作后，会在这里形成可追踪的派发记录。
              </div>
            )}
          </section>
        </aside>
      </section>

      <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <article className="kaypal-v3-panel min-w-0 overflow-hidden">
          <div className="border-b border-[var(--kaypal-v3-border)] p-4">
            <p className="kaypal-v3-label">治理表</p>
            <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
              {config.governanceTitle}
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-13">
              <thead className="bg-[var(--kaypal-v3-table-head)] text-11 font-bold text-[var(--kaypal-v3-muted)]">
                <tr>
                  {["对象", "判断", "去向", "边界"].map((column) => (
                    <th className="px-4 py-3" key={column} scope="col">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--kaypal-v3-border)]">
                {config.governanceRows.map((row) => (
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
        </article>

        <article className="kaypal-v3-panel min-w-0 overflow-hidden">
          <div className="border-b border-[var(--kaypal-v3-border)] p-4">
            <p className="kaypal-v3-label">输出</p>
            <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
              {config.outputTitle}
            </h2>
          </div>
          <div className="divide-y divide-[var(--kaypal-v3-border)]">
            {config.outputs.map((output) => (
              <Link
                className="block p-4 transition-colors hover:bg-[var(--kaypal-v3-paper-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--kaypal-v3-accent)]"
                href={output.href}
                key={output.title}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-13 font-bold text-[var(--kaypal-v3-ink)]">
                      {output.title}
                    </h3>
                    <p className="mt-1 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                      {output.detail}
                    </p>
                    <p className="mt-1 text-12 font-semibold text-[var(--kaypal-v3-soft-ink)]">
                      负责人：{output.owner}
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
        </article>
      </section>
    </div>
  );
}
