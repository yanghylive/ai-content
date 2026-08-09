"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Divider,
  Input,
  Spinner,
  Textarea,
} from "@heroui/react";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import {
  ArrowRight,
  AlertTriangle,
  BarChart3,
  Blocks,
  CheckCircle2,
  ClipboardList,
  DatabaseZap,
  FileText,
  History,
  ListChecks,
  PlugZap,
  Route,
  Search,
  Settings2,
  ShieldCheck,
  TimerReset,
  UserCheck,
} from "lucide-react";
import toast from "@/lib/toast";
import {
  approveSolutionManualTask,
  confirmSolutionOutputDrafts,
  createSolutionRun,
  dryRunSolutionTaskRedfox,
  executeSolutionResultAction,
  executeSolutionTaskRedfox,
  getSolutionPackages,
  getSolutionRedfoxMappingCoverage,
  getSolutionRun,
  getSolutionRuns,
  type RedfoxSkillDryRunResult,
  type SolutionConfigurationField,
  type SolutionIndustryTemplate,
  type SolutionImplementationState,
  type SolutionPackageDefinition,
  type SolutionRedfoxMappingCoverageItem,
  type SolutionRedfoxMappingCoverageResult,
  type SolutionResultActionKind,
  type SolutionRunPlan,
  type SolutionRunRecord,
  type SolutionRunResultRecord,
  type SolutionRunTaskRecord,
} from "@/lib/api/solutions";
import { localEngineApi } from "@/lib/api/local-engine";
import { commercialDisplayText } from "@/lib/commercial-display-text";
import { toPublicError } from "@/lib/public-error";
import { TaskExperienceFlow } from "../components/task-experience-flow";

type FilterKey = "core" | "redfox_pool";
type SolutionInputValue = string | string[];
type SolutionInputState = Record<string, SolutionInputValue>;

type DisplayOutputRef = {
  label: string;
  status: string;
  targetModule: string;
};

type DisplayAcceptanceCheck = {
  label: string;
  status: string;
};

type CommercialSkillRunPhase =
  | "idle"
  | "checking"
  | "starting"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "blocked";

type CommercialSkillRunEvent = {
  seq: number;
  session_id: string;
  event_type: string;
  status: string;
  created_at: string;
  message?: string | null;
  payload: Record<string, unknown>;
};

type CommercialSkillRunArtifact = {
  artifact_id: string;
  kind: string;
  filename: string;
  path: string;
  created_at: string;
  size_bytes: number;
};

type CommercialSkillRunState = {
  phase: CommercialSkillRunPhase;
  sessionId?: string;
  runId?: string;
  nextSeq?: number;
  events: CommercialSkillRunEvent[];
  artifacts: CommercialSkillRunArtifact[];
  error?: string;
  updatedAt?: string;
};

const primaryActionCards = [
  {
    code: "hot-topic-solution",
    title: "生成热点选题",
    outcome: "把全网热点、平台爆款和历史素材转成可执行选题。",
    persistence: "生成情报条目、素材、选题、内容草稿",
    actionLabel: "生成选题",
    coverage: "热点、素材和选题结果可沉淀",
    outputs: ["情报条目", "素材", "选题", "内容草稿"],
    enabled: true,
    icon: <BarChart3 size={18} />,
  },
  {
    code: "competitor-account-radar",
    title: "查竞品账号",
    outcome: "发现对标账号，跟踪爆款、栏目和涨粉异常。",
    persistence: "生成对标账号、增长线索、账号机会",
    actionLabel: "分析竞品",
    coverage: "账号搜索、相似账号和诊断结果可沉淀",
    outputs: ["对标账号", "增长线索", "账号机会"],
    enabled: true,
    icon: <Search size={18} />,
  },
  {
    code: "comment-lead-solution",
    title: "提取评论线索",
    outcome: "抓评论，识别需求、投诉、购买意图和合作机会。",
    persistence: "生成评论洞察、增长线索、跟进建议",
    actionLabel: "提取线索",
    coverage: "已开放 3 项评论分析动作",
    outputs: ["评论洞察", "增长线索", "跟进建议"],
    enabled: true,
    icon: <UserCheck size={18} />,
  },
  {
    code: "creation-enhancement",
    title: "生成多平台内容",
    outcome: "围绕选题生成标题、正文、封面素材和发布草稿。",
    persistence: "生成内容草稿、素材、发布草稿",
    actionLabel: "生成内容",
    coverage: "标题评分、多平台版本和素材结果可沉淀",
    outputs: ["选题", "内容草稿", "素材", "发布草稿"],
    enabled: true,
    icon: <FileText size={18} />,
  },
  {
    code: "publish-compliance",
    title: "检查发布风险",
    outcome: "发布前检查违禁词、风险表达、人工确认和记录链。",
    persistence: "生成合规记录、风险记录、替代表达",
    actionLabel: "检查风险",
    coverage: "合规结果和风险记录可沉淀",
    outputs: ["合规检查", "风险记录", "发布结果"],
    enabled: true,
    icon: <ShieldCheck size={18} />,
  },
  {
    code: "industry-intel",
    title: "生成行业情报",
    outcome: "按行业和关键词沉淀趋势、机会、风险和报告。",
    persistence: "生成情报条目、行业报告、下步动作",
    actionLabel: "生成情报",
    coverage: "已开放 3 项行业情报动作",
    outputs: ["情报条目", "行业报告", "下步动作"],
    enabled: true,
    icon: <BarChart3 size={18} />,
  },
  {
    code: "global-content-intel",
    title: "发现出海趋势",
    outcome: "采集海外账号和内容趋势，转成本地化选题和脚本建议。",
    persistence: "生成海外账号、趋势情报、本地化选题",
    actionLabel: "生成出海选题",
    coverage: "海外趋势和选题结果可沉淀",
    outputs: ["对标账号", "情报条目", "选题", "素材"],
    enabled: true,
    icon: <Route size={18} />,
  },
  {
    code: "low-follower-viral",
    title: "挖低粉爆款",
    outcome: "发现低粉账号异常爆款，拆出冷启动更容易复制的内容模式。",
    persistence: "生成爆款样本、结构拆解、复刻选题",
    actionLabel: "挖掘爆款",
    coverage: "样本、结构和选题结果可沉淀",
    outputs: ["情报条目", "素材", "选题", "机会项"],
    enabled: true,
    icon: <TimerReset size={18} />,
  },
  {
    code: "kol-screening",
    title: "筛达人/KOL",
    outcome: "按投放目标、人设、内容质量和风险筛出可跟进达人。",
    persistence: "生成候选达人、评分、跟进任务",
    actionLabel: "筛选达人",
    coverage: "达人候选池和跟进任务可沉淀",
    outputs: ["对标账号", "客户线索", "跟进任务"],
    enabled: true,
    icon: <UserCheck size={18} />,
  },
  {
    code: "viral-breakdown",
    title: "拆解爆款内容",
    outcome: "输入链接或关键词，拆结构、评论反馈和复刻建议。",
    persistence: "生成结构拆解、评论洞察、复刻选题",
    actionLabel: "拆解爆款",
    coverage: "拆解结果和复刻建议可沉淀",
    outputs: ["情报条目", "评论洞察", "素材", "选题"],
    enabled: true,
    icon: <ListChecks size={18} />,
  },
  {
    code: "private-asset-extractor",
    title: "提取私域素材",
    outcome: "从文件、链接、短视频和搜索结果中提取素材与知识。",
    persistence: "生成素材、知识条目、证据附件",
    actionLabel: "提取素材",
    coverage: "素材和知识库结果可沉淀",
    outputs: ["素材", "知识条目", "证据附件"],
    enabled: true,
    icon: <ClipboardList size={18} />,
  },
  {
    code: "aigc-asset-factory",
    title: "生成 AIGC 素材",
    outcome: "根据选题、文章和样本生成封面、图片、视频提示词和素材包。",
    persistence: "生成封面、图片、视频提示词、素材包",
    actionLabel: "生成素材",
    coverage: "素材生成结果和成本记录可沉淀",
    outputs: ["素材", "视频素材", "机会项"],
    enabled: true,
    icon: <DatabaseZap size={18} />,
  },
  {
    code: "multi-platform-copy",
    title: "改写多平台文案",
    outcome: "把一份原文改写成小红书、公众号、知乎、抖音口播等版本。",
    persistence: "生成多平台文案、合规检查、发布草稿",
    actionLabel: "改写文案",
    coverage: "多平台改写正在开发中",
    outputs: ["内容草稿", "合规检查", "发布结果"],
    enabled: false,
    icon: <FileText size={18} />,
  },
  {
    code: "account-diagnosis",
    title: "做账号健康诊断",
    outcome: "诊断账号定位、内容节奏、互动质量、风险项和 30 天计划。",
    persistence: "生成健康评分、增长报告、监控任务",
    actionLabel: "开始诊断",
    coverage: "诊断和改进计划可沉淀",
    outputs: ["账号健康", "增长报告", "监控任务"],
    enabled: true,
    icon: <CheckCircle2 size={18} />,
  },
  {
    code: "brand-monitoring",
    title: "监控品牌舆情",
    outcome: "监控品牌词、竞品词、负面舆情、热点关联和回应机会。",
    persistence: "生成监控任务、风险识别、每日情报",
    actionLabel: "开始监控",
    coverage: "监控结果和风险样本可沉淀",
    outputs: ["监控任务", "情报条目", "合规检查"],
    enabled: true,
    icon: <AlertTriangle size={18} />,
  },
];

const scenarioEntryLinks = [
  {
    title: "找热点和竞品",
    href: "/intelligence/trends",
    module: "情报中心",
  },
  {
    title: "写内容和做素材",
    href: "/content/workspace?intent=create",
    module: "内容运营",
  },
  {
    title: "抓评论和提线索",
    href: "/engagement/comment-insights",
    module: "客户互动",
  },
  {
    title: "发布前查风险",
    href: "/distribution?tab=compliance",
    module: "发布中心",
  },
  {
    title: "找达人和看账号健康",
    href: "/growth?view=acquisition",
    module: "增长获客",
  },
];

type BusinessResultCard = {
  label: string;
  targetModule: string;
  description: string;
};

type BusinessVisibleInputField = {
  key: string;
  label: string;
  type?: SolutionConfigurationField["type"];
  required?: boolean;
  placeholder?: string;
  helper?: string;
  options?: string[];
  defaultValue?: string | number | string[];
};

type BusinessResultAction = {
  label: string;
  targetModule: string;
  description: string;
  entryPath?: string;
};

type BusinessActionExperience = {
  formTitle: string;
  formDescription: string;
  inputTips: string[];
  resultTitle: string;
  resultDescription: string;
  resultCards: BusinessResultCard[];
  nextActions: string[];
  visibleInputFields?: BusinessVisibleInputField[];
  resultActions?: BusinessResultAction[];
  fieldHints?: Record<
    string,
    {
      label?: string;
      placeholder?: string;
      helper?: string;
    }
  >;
};

const defaultBusinessActionExperience: BusinessActionExperience = {
  formTitle: "填写业务目标",
  formDescription:
    "补齐目标、范围和交付去向，系统会按当前业务动作生成可保存的结果。",
  inputTips: ["写清楚目标", "限定平台或时间范围", "选择结果保存去向"],
  resultTitle: "看业务结果",
  resultDescription: "完成后在这里看交付物、交付进度和下一步动作。",
  resultCards: [
    {
      label: "业务结果",
      targetModule: "结果中心",
      description: "生成后的结果会按类型进入对应业务库。",
    },
    {
      label: "交付清单",
      targetModule: "待确认",
      description: "需要人工确认的内容会集中出现在这里。",
    },
    {
      label: "下一步动作",
      targetModule: "工作台",
      description: "根据结果继续保存、分发或跟进。",
    },
  ],
  nextActions: ["保存结果", "继续生成", "分发给团队"],
  resultActions: [
    {
      label: "保存结果",
      targetModule: "结果中心",
      description: "生成完成后按业务类型进入对应模块。",
    },
    {
      label: "继续处理",
      targetModule: "工作台",
      description: "基于本次结果继续生成、分发或跟进。",
    },
  ],
};

const businessActionExperiences: Record<string, BusinessActionExperience> = {
  "hot-topic-solution": {
    formTitle: "填写选题目标",
    formDescription:
      "输入行业、关键词和平台范围，系统会把热点和爆款信号转成可写、可排期的选题。",
    inputTips: [
      "行业越具体越好",
      "关键词可填产品词或人群词",
      "选择要沉淀到选题库",
    ],
    resultTitle: "看热点选题结果",
    resultDescription:
      "生成后直接看到热点来源、选题方向、素材证据和可继续写作的草稿入口。",
    visibleInputFields: [
      {
        key: "businessObjective",
        label: "今天想找什么选题",
        type: "textarea",
        required: true,
        placeholder: "例如：给新中式茶饮账号找 10 个小红书选题",
        helper: "写成一个运营目标，不要只写一个词。",
      },
      {
        key: "keywords",
        label: "关键词",
        type: "tags",
        required: true,
        placeholder: "例如：新中式茶饮、低糖奶茶、下午茶",
        helper: "多个词用逗号分开，系统会按词组扩展热点。",
      },
      {
        key: "platforms",
        label: "关注平台",
        type: "tags",
        required: true,
        placeholder: "例如：抖音、小红书、公众号",
        helper: "选择实际要观察或发布的平台。",
      },
    ],
    resultCards: [
      {
        label: "热点情报",
        targetModule: "情报库",
        description: "沉淀热词、平台、热度和来源记录。",
      },
      {
        label: "可执行选题",
        targetModule: "选题库",
        description: "输出标题方向、内容角度和优先级。",
      },
      {
        label: "素材线索",
        targetModule: "素材库",
        description: "保留可复用案例、链接和截图证据。",
      },
    ],
    nextActions: ["保存到选题库", "生成内容草稿", "加入今日排期"],
    resultActions: [
      {
        label: "保存到选题库",
        targetModule: "选题库",
        description: "把可执行选题沉淀，后续可直接进入创作。",
      },
      {
        label: "保存素材证据",
        targetModule: "素材库",
        description: "保留热点来源、链接和可复用案例。",
      },
      {
        label: "生成内容草稿",
        targetModule: "内容库",
        description: "基于选题继续生成标题、正文或口播稿。",
      },
    ],
    fieldHints: {
      businessObjective: {
        label: "今天想找什么选题",
        placeholder: "例如：给新中式茶饮账号找 10 个小红书选题",
        helper: "写成一个运营目标，不要只写一个词。",
      },
      keyword: {
        label: "核心关键词",
        placeholder: "例如：新中式茶饮、低糖奶茶、下午茶",
        helper: "可以输入品牌词、品类词、人群词或场景词。",
      },
      keywords: {
        label: "扩展关键词",
        placeholder: "例如：办公室下午茶，低卡饮品，夏季新品",
        helper: "多个词用逗号分开，系统会按词组扩展热点。",
      },
      platforms: {
        label: "关注平台",
        helper: "选择实际要发布或观察的平台。",
      },
      deliveryTarget: {
        label: "结果保存到",
        helper: "建议保存到选题库，方便后续生成内容。",
      },
    },
  },
  "competitor-account-radar": {
    formTitle: "填写竞品观察范围",
    formDescription:
      "输入对标账号、行业或关键词，系统会整理账号表现、爆款栏目和增长机会。",
    inputTips: [
      "至少给一个竞品账号或关键词",
      "补充你想对标的品类",
      "关注最近 7 到 30 天变化",
    ],
    resultTitle: "看竞品分析结果",
    resultDescription:
      "生成后直接看到对标账号、爆款内容、增长异常和可复制动作。",
    visibleInputFields: [
      {
        key: "benchmarkAccounts",
        label: "竞品账号或主页链接",
        type: "tags",
        required: false,
        placeholder: "例如：账号昵称、主页链接或主页 ID",
        helper: "能给账号链接最好；没有链接就填账号名和平台。",
      },
      {
        key: "keywords",
        label: "行业或品类关键词",
        type: "tags",
        required: true,
        placeholder: "例如：本地生活探店、母婴护理、茶饮加盟",
        helper: "用于补充发现相似账号和爆款内容。",
      },
      {
        key: "platforms",
        label: "观察平台",
        type: "tags",
        required: true,
        placeholder: "例如：抖音、小红书、B 站",
        helper: "选择竞品主要经营的平台。",
      },
    ],
    resultCards: [
      {
        label: "对标账号",
        targetModule: "账号库",
        description: "保存账号画像、平台、粉丝和内容定位。",
      },
      {
        label: "增长机会",
        targetModule: "增长看板",
        description: "标记值得跟进的栏目、频率和内容模式。",
      },
      {
        label: "竞品报告",
        targetModule: "报告中心",
        description: "输出账号对比、风险和行动建议。",
      },
    ],
    nextActions: ["加入竞品监控", "生成对标报告", "拆解爆款内容"],
    resultActions: [
      {
        label: "加入竞品监控",
        targetModule: "账号库",
        description: "把对标账号保存起来，后续持续跟踪变化。",
      },
      {
        label: "生成对标报告",
        targetModule: "报告中心",
        description: "输出账号差异、栏目打法和增长机会。",
      },
      {
        label: "拆解爆款内容",
        targetModule: "素材库",
        description: "把高表现内容转成可复用结构和选题。",
      },
    ],
    fieldHints: {
      competitors: {
        label: "竞品账号",
        placeholder: "例如：账号昵称、主页链接或主页 ID",
        helper: "能给账号链接最好；没有链接就填账号名和平台。",
      },
      competitorAccounts: {
        label: "竞品账号",
        placeholder: "例如：账号昵称、主页链接或主页 ID",
        helper: "多个账号用逗号分开。",
      },
      keyword: {
        label: "行业或品类",
        placeholder: "例如：本地生活探店、母婴护理、茶饮加盟",
        helper: "用于补充发现相似账号。",
      },
      businessObjective: {
        label: "分析目标",
        placeholder: "例如：找出低粉高互动账号的栏目打法",
        helper: "说明你要看增长、选题、投放还是内容节奏。",
      },
    },
  },
  "comment-lead-solution": {
    formTitle: "填写评论来源",
    formDescription:
      "输入作品链接、账号或关键词，系统会从评论里识别需求、投诉、购买意图和跟进线索。",
    inputTips: [
      "优先填作品链接",
      "说明要找购买意图还是投诉风险",
      "选择线索保存去向",
    ],
    resultTitle: "看评论线索结果",
    resultDescription:
      "生成后直接看到评论分类、重点用户、跟进建议和可创建的 CRM 线索。",
    visibleInputFields: [
      {
        key: "query",
        label: "作品链接或评论来源",
        type: "textarea",
        required: true,
        placeholder: "粘贴短视频/笔记链接，或输入账号名 + 平台",
        helper: "链接越明确，评论线索越容易定位。",
      },
      {
        key: "keywords",
        label: "筛选关键词",
        type: "tags",
        required: false,
        placeholder: "例如：多少钱、怎么买、加盟、售后、避雷",
        helper: "用于优先识别高价值评论。",
      },
      {
        key: "businessObjective",
        label: "线索目标",
        type: "textarea",
        required: true,
        placeholder: "例如：找 20 条想咨询价格的潜在客户",
        helper: "说明你要找成交、投诉、合作还是内容反馈。",
      },
    ],
    resultCards: [
      {
        label: "评论洞察",
        targetModule: "评论洞察库",
        description: "聚合需求、痛点、异议、投诉和高频问题。",
      },
      {
        label: "客户线索",
        targetModule: "CRM",
        description: "把高意向评论转成可跟进线索。",
      },
      {
        label: "跟进任务",
        targetModule: "待办",
        description: "给客服或销售生成跟进建议。",
      },
    ],
    nextActions: ["创建 CRM 线索", "生成私信话术", "导出评论报告"],
    resultActions: [
      {
        label: "创建 CRM 线索",
        targetModule: "CRM",
        description: "把高意向评论转成交给客服或销售的线索。",
      },
      {
        label: "生成私信话术",
        targetModule: "工作台",
        description: "根据评论意图生成可人工确认的跟进话术。",
      },
      {
        label: "导出评论报告",
        targetModule: "报告中心",
        description: "汇总需求、投诉和内容反馈给团队复盘。",
      },
    ],
    fieldHints: {
      query: {
        label: "作品链接或评论来源",
        placeholder: "粘贴短视频/笔记链接，或输入账号名 + 平台",
        helper: "链接越明确，评论线索越容易定位。",
      },
      keyword: {
        label: "筛选关键词",
        placeholder: "例如：多少钱、怎么买、加盟、售后、避雷",
        helper: "用于优先识别高价值评论。",
      },
      businessObjective: {
        label: "线索目标",
        placeholder: "例如：找 20 条想咨询价格的潜在客户",
        helper: "说明你要找成交、投诉、合作还是内容反馈。",
      },
    },
  },
  "creation-enhancement": {
    formTitle: "填写内容生成要求",
    formDescription:
      "输入选题、素材或原文，系统会生成标题、正文、多平台版本和发布草稿。",
    inputTips: ["先写清楚目标用户", "给出平台和语气", "可粘贴已有素材或草稿"],
    resultTitle: "看内容生成结果",
    resultDescription:
      "生成后直接看到标题、正文、平台版本、素材建议和可继续发布的草稿。",
    visibleInputFields: [
      {
        key: "businessObjective",
        label: "内容目标",
        type: "textarea",
        required: true,
        placeholder: "例如：把选题写成小红书种草笔记和抖音口播稿",
        helper: "说明要种草、成交、引流、科普还是公告。",
      },
      {
        key: "query",
        label: "选题、原文或素材",
        type: "textarea",
        required: true,
        placeholder: "粘贴选题、原文、素材链接或参考案例",
        helper: "有参考内容时，结果会更贴近你想要的风格。",
      },
      {
        key: "platforms",
        label: "生成平台",
        type: "tags",
        required: true,
        placeholder: "例如：小红书、抖音、公众号",
        helper: "可多选，系统会生成不同平台版本。",
      },
    ],
    resultCards: [
      {
        label: "内容草稿",
        targetModule: "内容库",
        description: "保存标题、正文、结构和口播稿。",
      },
      {
        label: "封面素材",
        targetModule: "素材库",
        description: "输出封面方向、配图建议和素材提示词。",
      },
      {
        label: "发布草稿",
        targetModule: "发布中心",
        description: "按平台沉淀待发布版本。",
      },
    ],
    nextActions: ["保存内容草稿", "检查发布风险", "加入发布排期"],
    resultActions: [
      {
        label: "保存内容草稿",
        targetModule: "内容库",
        description: "把生成的标题、正文和口播稿保存为可编辑草稿。",
      },
      {
        label: "检查发布风险",
        targetModule: "合规中心",
        description: "发布前继续检查敏感表达和风险词。",
      },
      {
        label: "加入发布排期",
        targetModule: "发布中心",
        description: "把通过检查的版本加入待发布列表。",
      },
    ],
    fieldHints: {
      businessObjective: {
        label: "内容目标",
        placeholder: "例如：把选题写成小红书种草笔记和抖音口播稿",
        helper: "说明要种草、成交、引流、科普还是公告。",
      },
      keyword: {
        label: "选题或主题",
        placeholder: "例如：夏季低糖饮品推荐",
        helper: "一句话写清楚内容主题。",
      },
      query: {
        label: "原文或素材链接",
        placeholder: "粘贴原文、选题、素材链接或参考案例",
        helper: "有参考内容时，结果会更贴近你想要的风格。",
      },
      platform: {
        label: "生成平台",
        helper: "不同平台会使用不同结构和语气。",
      },
      platforms: {
        label: "生成平台",
        helper: "可多选，系统会生成不同版本。",
      },
    },
  },
  "publish-compliance": {
    formTitle: "填写待发布内容",
    formDescription:
      "粘贴标题、正文、口播稿或素材说明，系统会检查违禁词、风险表达和替代写法。",
    inputTips: ["粘贴完整文案", "选择实际发布平台", "说明是否需要保守口径"],
    resultTitle: "看风险检查结果",
    resultDescription:
      "生成后直接看到风险点、命中原因、替代表达和可留存的合规证据。",
    visibleInputFields: [
      {
        key: "query",
        label: "待检查文案",
        type: "textarea",
        required: true,
        placeholder: "粘贴标题、正文、口播稿或素材说明",
        helper: "建议粘贴完整版本，避免只检查片段。",
      },
      {
        key: "platforms",
        label: "发布平台",
        type: "tags",
        required: true,
        placeholder: "例如：抖音、小红书、公众号",
        helper: "不同平台风险词和表达边界不同。",
      },
      {
        key: "businessObjective",
        label: "发布目标",
        type: "textarea",
        required: false,
        placeholder: "例如：检查直播预热视频是否有夸大宣传风险",
        helper: "说明内容用途，系统会按场景判断风险。",
      },
    ],
    resultCards: [
      {
        label: "合规检查",
        targetModule: "合规中心",
        description: "保存风险等级、问题位置和处理状态。",
      },
      {
        label: "替代表达",
        targetModule: "内容库",
        description: "输出可替换的标题、正文或口播句子。",
      },
      {
        label: "风险记录",
        targetModule: "记录链",
        description: "记录检查时间、平台、规则和确认人。",
      },
    ],
    nextActions: ["替换风险表达", "确认合规记录", "继续发布"],
    resultActions: [
      {
        label: "替换风险表达",
        targetModule: "内容库",
        description: "把命中的风险句改成更稳的可发布表达。",
      },
      {
        label: "确认合规记录",
        targetModule: "合规中心",
        description: "把检查结果和处理动作留痕。",
      },
      {
        label: "继续发布",
        targetModule: "发布中心",
        description: "通过检查后再进入发布排期。",
      },
    ],
    fieldHints: {
      query: {
        label: "待检查文案",
        placeholder: "粘贴标题、正文、口播稿或素材说明",
        helper: "建议粘贴完整版本，避免只检查片段。",
      },
      businessObjective: {
        label: "发布目标",
        placeholder: "例如：检查直播预热视频是否有夸大宣传风险",
        helper: "说明内容用途，系统会按场景判断风险。",
      },
      platform: {
        label: "发布平台",
        helper: "不同平台风险词和表达边界不同。",
      },
      platforms: {
        label: "发布平台",
        helper: "需要多平台发布时可以多选。",
      },
    },
  },
  "industry-intel": {
    formTitle: "填写行业情报范围",
    formDescription:
      "输入行业、地区、关键词和观察周期，系统会生成趋势、机会、风险和行动建议。",
    inputTips: ["行业不要太宽", "补充区域或客群", "说明要日报、周报还是专题"],
    resultTitle: "看行业情报结果",
    resultDescription:
      "生成后直接看到趋势摘要、机会点、风险点和可分发的情报报告。",
    visibleInputFields: [
      {
        key: "industry",
        label: "行业",
        type: "text",
        required: true,
        placeholder: "例如：本地生活、跨境美妆、母婴护理",
        helper: "行业不要太宽，越具体越容易形成判断。",
      },
      {
        key: "keywords",
        label: "观察关键词",
        type: "tags",
        required: true,
        placeholder: "例如：加盟、价格战、新品、监管、达人投放",
        helper: "多个词用逗号分开。",
      },
      {
        key: "businessObjective",
        label: "情报目标",
        type: "textarea",
        required: true,
        placeholder: "例如：给老板生成一份本周茶饮行业机会摘要",
        helper: "说明报告给谁看、要支持什么决策。",
      },
    ],
    resultCards: [
      {
        label: "趋势情报",
        targetModule: "情报库",
        description: "沉淀行业热词、事件和变化信号。",
      },
      {
        label: "行业报告",
        targetModule: "报告中心",
        description: "形成可发给团队的摘要和判断。",
      },
      {
        label: "行动建议",
        targetModule: "工作台",
        description: "转成选题、监控或销售跟进动作。",
      },
    ],
    nextActions: ["生成行业报告", "创建监控任务", "转成选题"],
    resultActions: [
      {
        label: "生成行业报告",
        targetModule: "报告中心",
        description: "把趋势、机会和风险整理成团队可读报告。",
      },
      {
        label: "创建监控任务",
        targetModule: "监控中心",
        description: "把关键行业词加入持续观察。",
      },
      {
        label: "转成选题",
        targetModule: "选题库",
        description: "把机会点转成可执行内容方向。",
      },
    ],
    fieldHints: {
      industry: {
        label: "行业",
        placeholder: "例如：本地生活、跨境美妆、母婴护理",
        helper: "行业越明确，情报越可用。",
      },
      keyword: {
        label: "观察关键词",
        placeholder: "例如：加盟、价格战、新品、监管、达人投放",
        helper: "多个词用逗号分开。",
      },
      businessObjective: {
        label: "情报目标",
        placeholder: "例如：给老板生成一份本周茶饮行业机会摘要",
        helper: "说明报告给谁看、要支持什么决策。",
      },
    },
  },
  "global-content-intel": {
    formTitle: "填写出海观察目标",
    formDescription:
      "输入目标市场、品类和平台，系统会发现海外趋势并转成本地化选题。",
    inputTips: [
      "写清楚目标国家或地区",
      "补充海外平台",
      "说明要选题还是脚本方向",
    ],
    resultTitle: "看出海趋势结果",
    resultDescription:
      "生成后直接看到海外账号、爆款主题、本地化角度和可复制素材。",
    visibleInputFields: [
      {
        key: "businessObjective",
        label: "出海目标",
        type: "textarea",
        required: true,
        placeholder: "例如：找欧美 TikTok 上适合复制到小红书的护肤选题",
        helper: "说明目标市场、品类和要落地的平台。",
      },
      {
        key: "keywords",
        label: "品类或关键词",
        type: "tags",
        required: true,
        placeholder: "例如：skincare routine、home workout、pet food",
        helper: "可输入英文或中文关键词。",
      },
      {
        key: "platforms",
        label: "海外平台",
        type: "tags",
        required: true,
        placeholder: "例如：TikTok、YouTube、Instagram",
        helper: "选择实际要观察的海外平台。",
      },
    ],
    resultCards: [
      {
        label: "海外趋势",
        targetModule: "情报库",
        description: "记录市场、平台、热词和内容样本。",
      },
      {
        label: "本地化选题",
        targetModule: "选题库",
        description: "把海外趋势转成中文团队可执行选题。",
      },
      {
        label: "参考素材",
        targetModule: "素材库",
        description: "保存链接、画面、脚本结构和证据。",
      },
    ],
    nextActions: ["保存本地化选题", "生成双语脚本", "加入出海监控"],
    resultActions: [
      {
        label: "保存本地化选题",
        targetModule: "选题库",
        description: "把海外趋势转成中文团队可执行方向。",
      },
      {
        label: "生成双语脚本",
        targetModule: "内容库",
        description: "把趋势样本改成可发布的脚本草稿。",
      },
      {
        label: "加入出海监控",
        targetModule: "监控中心",
        description: "持续观察目标市场和平台变化。",
      },
    ],
    fieldHints: {
      businessObjective: {
        label: "出海目标",
        placeholder: "例如：找欧美 TikTok 上适合复制到小红书的护肤选题",
        helper: "说明目标市场、品类和要落地的平台。",
      },
      keyword: {
        label: "品类或关键词",
        placeholder: "例如：skincare routine、home workout、pet food",
        helper: "可输入英文或中文关键词。",
      },
      platforms: {
        label: "海外平台",
        helper: "选择 TikTok、YouTube、Instagram 等观察范围。",
      },
    },
  },
  "low-follower-viral": {
    formTitle: "填写低粉爆款条件",
    formDescription:
      "输入品类、平台和粉丝范围，系统会找低粉账号里的异常爆款并拆出机会。",
    inputTips: ["限定账号粉丝区间", "补充内容品类", "关注近期异常数据"],
    resultTitle: "看低粉爆款结果",
    resultDescription:
      "生成后直接看到爆款样本、账号画像、可复制结构和冷启动选题。",
    visibleInputFields: [
      {
        key: "businessObjective",
        label: "挖掘目标",
        type: "textarea",
        required: true,
        placeholder: "例如：找 1 万粉以内账号的高互动家居爆款",
        helper: "说明粉丝范围、平台和品类。",
      },
      {
        key: "keywords",
        label: "内容品类",
        type: "tags",
        required: true,
        placeholder: "例如：收纳、宠物、茶饮、母婴、探店",
        helper: "用于筛选低粉爆款样本。",
      },
      {
        key: "platforms",
        label: "观察平台",
        type: "tags",
        required: true,
        placeholder: "例如：抖音、小红书、B 站",
        helper: "建议先选择一个主平台，结果更聚焦。",
      },
    ],
    resultCards: [
      {
        label: "爆款样本",
        targetModule: "素材库",
        description: "保存低粉高互动作品和数据证据。",
      },
      {
        label: "复刻选题",
        targetModule: "选题库",
        description: "把异常爆款转成自己的选题方向。",
      },
      {
        label: "机会判断",
        targetModule: "增长看板",
        description: "判断内容模式是否适合冷启动复制。",
      },
    ],
    nextActions: ["保存爆款样本", "生成复刻选题", "分析账号打法"],
    resultActions: [
      {
        label: "保存爆款样本",
        targetModule: "素材库",
        description: "保留可复盘的低粉高互动内容样本。",
      },
      {
        label: "生成复刻选题",
        targetModule: "选题库",
        description: "把异常爆款转成自己的冷启动选题。",
      },
      {
        label: "分析账号打法",
        targetModule: "增长看板",
        description: "沉淀账号定位、栏目和增长机会。",
      },
    ],
    fieldHints: {
      businessObjective: {
        label: "挖掘目标",
        placeholder: "例如：找 1 万粉以内账号的高互动家居爆款",
        helper: "说明粉丝范围、平台和品类。",
      },
      keyword: {
        label: "内容品类",
        placeholder: "例如：收纳、宠物、茶饮、母婴、探店",
        helper: "用于筛选低粉爆款样本。",
      },
      platforms: {
        label: "观察平台",
        helper: "建议先选择一个主平台，结果更聚焦。",
      },
    },
  },
  "kol-screening": {
    formTitle: "填写达人筛选条件",
    formDescription:
      "输入投放目标、品类、人设和预算范围，系统会筛出可跟进达人和风险点。",
    inputTips: ["写清楚投放目的", "补充预算和合作形式", "说明不能接受的风险"],
    resultTitle: "看达人筛选结果",
    resultDescription:
      "生成后直接看到候选达人、匹配理由、内容质量、风险提示和跟进任务。",
    visibleInputFields: [
      {
        key: "businessObjective",
        label: "投放目标",
        type: "textarea",
        required: true,
        placeholder: "例如：为新品上市筛 30 个母婴垂类小红书达人",
        helper: "说明曝光、成交、种草还是线索收集。",
      },
      {
        key: "keywords",
        label: "达人方向",
        type: "tags",
        required: true,
        placeholder: "例如：母婴、护肤、健身、探店、跨境美妆",
        helper: "用于限定达人内容方向。",
      },
      {
        key: "platforms",
        label: "投放平台",
        type: "tags",
        required: true,
        placeholder: "例如：小红书、抖音、B 站",
        helper: "选择实际要合作的平台。",
      },
    ],
    resultCards: [
      {
        label: "候选达人",
        targetModule: "达人库",
        description: "保存达人画像、平台、内容方向和联系方式状态。",
      },
      {
        label: "匹配评分",
        targetModule: "投放看板",
        description: "按目标、内容、互动和风险给出评分。",
      },
      {
        label: "跟进任务",
        targetModule: "CRM",
        description: "为商务或运营生成下一步联系动作。",
      },
    ],
    nextActions: ["加入达人池", "创建跟进任务", "生成邀约话术"],
    resultActions: [
      {
        label: "加入达人池",
        targetModule: "达人库",
        description: "保存候选达人和匹配理由。",
      },
      {
        label: "创建跟进任务",
        targetModule: "CRM",
        description: "把可联系达人转成商务跟进任务。",
      },
      {
        label: "生成邀约话术",
        targetModule: "工作台",
        description: "按达人方向生成合作邀约草稿。",
      },
    ],
    fieldHints: {
      businessObjective: {
        label: "投放目标",
        placeholder: "例如：为新品上市筛 30 个母婴垂类小红书达人",
        helper: "说明曝光、成交、种草还是线索收集。",
      },
      keyword: {
        label: "达人方向",
        placeholder: "例如：母婴、护肤、健身、探店、跨境美妆",
        helper: "用于限定达人内容方向。",
      },
      platforms: {
        label: "投放平台",
        helper: "选择实际要合作的平台。",
      },
    },
  },
  "viral-breakdown": {
    formTitle: "填写爆款样本",
    formDescription:
      "粘贴作品链接或输入关键词，系统会拆解结构、评论反馈和复刻建议。",
    inputTips: [
      "优先粘贴作品链接",
      "说明要学结构还是话术",
      "补充自己的行业背景",
    ],
    resultTitle: "看爆款拆解结果",
    resultDescription: "生成后直接看到开头、结构、卖点、评论反馈和可复制选题。",
    visibleInputFields: [
      {
        key: "query",
        label: "爆款链接或样本",
        type: "textarea",
        required: true,
        placeholder: "粘贴笔记/短视频链接，或输入爆款标题",
        helper: "链接越明确，拆解越具体。",
      },
      {
        key: "businessObjective",
        label: "拆解目标",
        type: "textarea",
        required: true,
        placeholder: "例如：拆出这条视频的开头钩子和评论转化点",
        helper: "说明你想复刻结构、标题、卖点还是评论打法。",
      },
      {
        key: "platforms",
        label: "样本平台",
        type: "tags",
        required: false,
        placeholder: "例如：抖音、小红书、B 站",
        helper: "不知道平台时可以留空。",
      },
    ],
    resultCards: [
      {
        label: "结构拆解",
        targetModule: "素材库",
        description: "保存内容结构、钩子和表达方式。",
      },
      {
        label: "评论反馈",
        targetModule: "评论洞察库",
        description: "提炼用户关心点、异议和需求。",
      },
      {
        label: "复刻建议",
        targetModule: "选题库",
        description: "生成适合自己账号的改写方向。",
      },
    ],
    nextActions: ["保存拆解结果", "生成复刻文案", "检查发布风险"],
    resultActions: [
      {
        label: "保存拆解结果",
        targetModule: "素材库",
        description: "沉淀结构、钩子、卖点和评论反馈。",
      },
      {
        label: "生成复刻文案",
        targetModule: "内容库",
        description: "把拆解结论转成自己的内容草稿。",
      },
      {
        label: "检查发布风险",
        targetModule: "合规中心",
        description: "复刻文案发布前继续做风险检查。",
      },
    ],
    fieldHints: {
      query: {
        label: "爆款链接或样本",
        placeholder: "粘贴笔记/短视频链接，或输入爆款标题",
        helper: "链接越明确，拆解越具体。",
      },
      businessObjective: {
        label: "拆解目标",
        placeholder: "例如：拆出这条视频的开头钩子和评论转化点",
        helper: "说明你想复刻结构、标题、卖点还是评论打法。",
      },
    },
  },
  "private-asset-extractor": {
    formTitle: "填写素材来源",
    formDescription:
      "上传或粘贴文件、链接、短视频和私域内容，系统会提取素材、知识点和证据附件。",
    inputTips: [
      "给出素材链接或文件说明",
      "说明要提取话术、案例还是知识",
      "选择素材保存位置",
    ],
    resultTitle: "看素材提取结果",
    resultDescription:
      "生成后直接看到可复用素材、知识条目、证据附件和后续内容建议。",
    visibleInputFields: [
      {
        key: "query",
        label: "素材来源",
        type: "textarea",
        required: true,
        placeholder: "粘贴网页、文档、短视频链接，或描述要提取的素材",
        helper: "可以一次输入多个来源，用换行分开。",
      },
      {
        key: "businessObjective",
        label: "提取目标",
        type: "textarea",
        required: true,
        placeholder: "例如：从客户案例里提取 20 条可复用成交话术",
        helper: "说明要素材、知识、话术还是证据。",
      },
      {
        key: "keywords",
        label: "重点关注",
        type: "tags",
        required: false,
        placeholder: "例如：成交话术、客户案例、产品卖点",
        helper: "用于优先提取你最关心的内容。",
      },
    ],
    resultCards: [
      {
        label: "可复用素材",
        targetModule: "素材库",
        description: "沉淀图片、文案、案例、视频片段或引用。",
      },
      {
        label: "知识条目",
        targetModule: "知识库",
        description: "提炼产品卖点、FAQ、服务说明和案例摘要。",
      },
      {
        label: "记录附件",
        targetModule: "记录链",
        description: "保存来源、时间和可追溯附件。",
      },
    ],
    nextActions: ["保存到素材库", "转成内容草稿", "加入知识库"],
    resultActions: [
      {
        label: "保存到素材库",
        targetModule: "素材库",
        description: "沉淀可复用图片、文案、案例和引用。",
      },
      {
        label: "转成内容草稿",
        targetModule: "内容库",
        description: "把素材继续加工成文章、笔记或脚本。",
      },
      {
        label: "加入知识库",
        targetModule: "知识库",
        description: "把产品卖点、FAQ 和案例摘要沉淀给团队。",
      },
    ],
    fieldHints: {
      query: {
        label: "素材来源",
        placeholder: "粘贴网页、文档、短视频链接，或描述要提取的素材",
        helper: "可以一次输入多个来源，用换行分开。",
      },
      businessObjective: {
        label: "提取目标",
        placeholder: "例如：从客户案例里提取 20 条可复用成交话术",
        helper: "说明要素材、知识、话术还是证据。",
      },
    },
  },
  "aigc-asset-factory": {
    formTitle: "填写素材生成目标",
    formDescription:
      "输入选题、产品和风格要求，系统会生成图片、封面、视频提示词和素材包。",
    inputTips: ["说明使用场景", "写清楚画面风格", "补充尺寸或平台"],
    resultTitle: "看 AIGC 素材结果",
    resultDescription:
      "生成后直接看到封面方向、图片提示词、视频脚本提示和素材包。",
    visibleInputFields: [
      {
        key: "businessObjective",
        label: "素材目标",
        type: "textarea",
        required: true,
        placeholder: "例如：为新品小红书笔记生成 6 张封面图方向",
        helper: "说明平台、用途和期望风格。",
      },
      {
        key: "keywords",
        label: "产品或主题",
        type: "tags",
        required: true,
        placeholder: "例如：低糖气泡茶、夏日通勤防晒、宠物烘干箱",
        helper: "用于生成素材主题。",
      },
      {
        key: "platforms",
        label: "使用平台",
        type: "tags",
        required: true,
        placeholder: "例如：小红书、抖音、视频号",
        helper: "平台会影响尺寸、构图和文案密度。",
      },
    ],
    resultCards: [
      {
        label: "图片素材",
        targetModule: "素材库",
        description: "保存封面、配图和生成提示词。",
      },
      {
        label: "视频提示词",
        targetModule: "视频素材库",
        description: "输出镜头、动作、风格和时长建议。",
      },
      {
        label: "素材包",
        targetModule: "内容库",
        description: "按选题打包可继续编辑的素材。",
      },
    ],
    nextActions: ["保存素材包", "生成内容草稿", "加入发布排期"],
    resultActions: [
      {
        label: "保存素材包",
        targetModule: "素材库",
        description: "保存封面方向、图片提示词和视频提示词。",
      },
      {
        label: "生成内容草稿",
        targetModule: "内容库",
        description: "把素材继续组合成可编辑内容。",
      },
      {
        label: "加入发布排期",
        targetModule: "发布中心",
        description: "把已确认素材加入待发布准备。",
      },
    ],
    fieldHints: {
      businessObjective: {
        label: "素材目标",
        placeholder: "例如：为新品小红书笔记生成 6 张封面图方向",
        helper: "说明平台、用途和期望风格。",
      },
      keyword: {
        label: "产品或主题",
        placeholder: "例如：低糖气泡茶、夏日通勤防晒、宠物烘干箱",
        helper: "用于生成素材主题。",
      },
      platform: {
        label: "使用平台",
        helper: "平台会影响尺寸、构图和文案密度。",
      },
    },
  },
  "multi-platform-copy": {
    formTitle: "填写改写原文",
    formDescription:
      "粘贴一份原文，系统会改写成不同平台可发布的标题、正文和口播版本。",
    inputTips: ["粘贴完整原文", "选择要适配的平台", "说明语气和禁用表达"],
    resultTitle: "看多平台文案结果",
    resultDescription:
      "生成后会看到小红书、公众号、知乎、抖音等平台版本和风险提示。",
    visibleInputFields: [
      {
        key: "query",
        label: "原文",
        type: "textarea",
        required: true,
        placeholder: "粘贴要改写的原文、产品介绍或直播脚本",
        helper: "原文越完整，多平台改写越稳定。",
      },
      {
        key: "platforms",
        label: "改写平台",
        type: "tags",
        required: true,
        placeholder: "例如：小红书、公众号、知乎、抖音",
        helper: "选择要生成的目标平台版本。",
      },
      {
        key: "businessObjective",
        label: "改写目标",
        type: "textarea",
        required: false,
        placeholder: "例如：把产品介绍改成更适合种草和转化的版本",
        helper: "说明希望偏种草、成交、科普还是品牌表达。",
      },
    ],
    resultCards: [
      {
        label: "平台文案",
        targetModule: "内容库",
        description: "按平台保存标题、正文、口播或长文版本。",
      },
      {
        label: "合规提示",
        targetModule: "合规中心",
        description: "提示敏感表达和替换建议。",
      },
      {
        label: "发布草稿",
        targetModule: "发布中心",
        description: "沉淀待发布版本和排期建议。",
      },
    ],
    nextActions: ["保存平台版本", "检查发布风险", "加入发布排期"],
    resultActions: [
      {
        label: "保存平台版本",
        targetModule: "内容库",
        description: "按平台保存标题、正文、口播或长文版本。",
      },
      {
        label: "检查发布风险",
        targetModule: "合规中心",
        description: "对改写结果继续做敏感表达检查。",
      },
      {
        label: "加入发布排期",
        targetModule: "发布中心",
        description: "把确认后的平台版本加入待发布列表。",
      },
    ],
    fieldHints: {
      query: {
        label: "原文",
        placeholder: "粘贴要改写的原文、产品介绍或直播脚本",
        helper: "原文越完整，多平台改写越稳定。",
      },
      platforms: {
        label: "改写平台",
        helper: "选择要生成的目标平台版本。",
      },
    },
  },
  "account-diagnosis": {
    formTitle: "填写账号信息",
    formDescription:
      "输入账号链接、平台和诊断目标，系统会分析定位、内容节奏、互动质量和 30 天计划。",
    inputTips: ["优先填主页链接", "说明账号当前问题", "选择需要诊断的平台"],
    resultTitle: "看账号健康结果",
    resultDescription:
      "生成后直接看到健康评分、问题清单、增长机会和 30 天改进计划。",
    visibleInputFields: [
      {
        key: "query",
        label: "账号链接或账号名",
        type: "textarea",
        required: true,
        placeholder: "粘贴主页链接，或输入账号名 + 平台",
        helper: "主页链接最准确。",
      },
      {
        key: "businessObjective",
        label: "诊断目标",
        type: "textarea",
        required: true,
        placeholder: "例如：找出账号近 30 天播放下滑的原因",
        helper: "说明你最关心定位、选题、互动还是转化。",
      },
      {
        key: "platforms",
        label: "账号平台",
        type: "tags",
        required: true,
        placeholder: "例如：抖音、小红书、B 站",
        helper: "选择账号所在平台。",
      },
    ],
    resultCards: [
      {
        label: "健康评分",
        targetModule: "账号健康",
        description: "沉淀定位、内容、互动和风险评分。",
      },
      {
        label: "增长报告",
        targetModule: "报告中心",
        description: "输出问题、原因和优先改进项。",
      },
      {
        label: "监控任务",
        targetModule: "监控中心",
        description: "持续跟踪账号变化和执行效果。",
      },
    ],
    nextActions: ["生成 30 天计划", "加入账号监控", "拆解竞品账号"],
    resultActions: [
      {
        label: "生成 30 天计划",
        targetModule: "增长报告",
        description: "把健康诊断结论转成可执行改进计划。",
      },
      {
        label: "加入账号监控",
        targetModule: "监控中心",
        description: "持续跟踪账号变化和执行效果。",
      },
      {
        label: "拆解竞品账号",
        targetModule: "账号库",
        description: "继续分析同类账号的增长打法。",
      },
    ],
    fieldHints: {
      query: {
        label: "账号链接或账号名",
        placeholder: "粘贴主页链接，或输入账号名 + 平台",
        helper: "主页链接最准确。",
      },
      businessObjective: {
        label: "诊断目标",
        placeholder: "例如：找出账号近 30 天播放下滑的原因",
        helper: "说明你最关心定位、选题、互动还是转化。",
      },
      platform: {
        label: "账号平台",
        helper: "选择账号所在平台。",
      },
    },
  },
  "brand-monitoring": {
    formTitle: "填写品牌监控词",
    formDescription:
      "输入品牌词、竞品词、风险词和平台范围，系统会监控舆情、负面风险和回应机会。",
    inputTips: ["品牌词和别名都要填", "补充竞品词或风险词", "选择监控频率"],
    resultTitle: "看品牌舆情结果",
    resultDescription:
      "生成后直接看到品牌提及、负面风险、热点关联和可跟进回应建议。",
    visibleInputFields: [
      {
        key: "keywords",
        label: "监控词",
        type: "tags",
        required: true,
        placeholder: "例如：品牌名、竞品名、差评、投诉、退款",
        helper: "把品牌词、竞品词和风险词分开写更好。",
      },
      {
        key: "businessObjective",
        label: "监控目标",
        type: "textarea",
        required: true,
        placeholder: "例如：每天监控品牌负面舆情并生成处理建议",
        helper: "说明要看负面、竞品、热点关联还是合作机会。",
      },
      {
        key: "platforms",
        label: "监控平台",
        type: "tags",
        required: true,
        placeholder: "例如：抖音、小红书、微博、公众号",
        helper: "选择品牌最可能被讨论的平台。",
      },
    ],
    resultCards: [
      {
        label: "监控任务",
        targetModule: "监控中心",
        description: "保存品牌词、平台、频率和负责人。",
      },
      {
        label: "风险识别",
        targetModule: "合规中心",
        description: "记录负面样本、风险等级和处理状态。",
      },
      {
        label: "每日情报",
        targetModule: "情报库",
        description: "沉淀品牌提及、竞品动态和回应机会。",
      },
    ],
    nextActions: ["创建监控任务", "生成舆情日报", "分派处理人"],
    resultActions: [
      {
        label: "创建监控任务",
        targetModule: "监控中心",
        description: "把品牌词、竞品词和风险词加入持续观察。",
      },
      {
        label: "生成舆情日报",
        targetModule: "报告中心",
        description: "把提及、风险和回应机会汇总成日报。",
      },
      {
        label: "分派处理人",
        targetModule: "待办",
        description: "把高风险样本转成可跟进处理任务。",
      },
    ],
    fieldHints: {
      keyword: {
        label: "品牌词",
        placeholder: "例如：品牌名、产品名、创始人名、常见简称",
        helper: "多个词用逗号分开。",
      },
      keywords: {
        label: "监控词",
        placeholder: "例如：品牌名、竞品名、差评、投诉、退款",
        helper: "把品牌词、竞品词和风险词分开写更好。",
      },
      businessObjective: {
        label: "监控目标",
        placeholder: "例如：每天监控品牌负面舆情并生成处理建议",
        helper: "说明要看负面、竞品、热点关联还是合作机会。",
      },
      frequency: {
        label: "监控频率",
        helper: "品牌舆情建议至少每日更新。",
      },
    },
  },
};

function getBusinessActionExperience(
  item: SolutionPackageDefinition | null | undefined,
) {
  return getBusinessActionExperienceByCode(item?.code);
}

function getBusinessActionExperienceByCode(code: string | null | undefined) {
  if (!code) return defaultBusinessActionExperience;
  return businessActionExperiences[code] || defaultBusinessActionExperience;
}

function getPrimaryActionMeta(code: string | null | undefined) {
  if (!code) return null;
  return primaryActionCards.find((action) => action.code === code) || null;
}

const showAdminDiagnostics = false;

const resultModuleEntryPaths: Record<string, string> = {
  CRM: "/crm",
  内容库: "/content/articles",
  发布中心: "/distribution",
  合规中心: "/distribution?tab=compliance",
  增长报告: "/growth?view=reports",
  增长看板: "/growth",
  工作台: "/engagement",
  待办: "/tasks",
  待确认: "/tasks/confirmations",
  情报库: "/intelligence/inbox",
  报告中心: "/intelligence/reports",
  材料库: "/content",
  素材库: "/content",
  监控中心: "/intelligence/monitors",
  知识库: "/content/knowledge",
  结果中心: "/tasks/runs",
  评论洞察库: "/engagement/comment-insights",
  账号健康: "/growth?view=account-health",
  账号库: "/intelligence/accounts",
  结果留存: "/tasks/evidence",
  选题库: "/content/topics",
  达人库: "/growth?view=acquisition",
  视频素材库: "/content/video",
  投放看板: "/growth?view=acquisition",
};

const stateMeta: Record<
  SolutionImplementationState,
  {
    label: string;
    color: "default" | "primary" | "success" | "warning" | "danger";
  }
> = {
  connected: { label: "可用", color: "success" },
  partial: { label: "逐步开放", color: "warning" },
  planned: { label: "建设中", color: "default" },
};

const OUTPUT_DRAFT_CONFIRMATION_TOKEN = "PERSIST_REDFOX_OUTPUT_DRAFTS";
const confirmableOutputObjects = new Set(["Material", "Topic", "Article"]);
const redfoxDryRunnableStatuses = new Set(["queued", "planned", "failed"]);
const manualApprovableStatuses = new Set([
  "approval_required",
  "planned",
  "queued",
  "failed",
]);

const runStatusMeta: Record<
  string,
  {
    label: string;
    color:
      "default" | "primary" | "secondary" | "success" | "warning" | "danger";
  }
> = {
  queued: { label: "准备生成", color: "primary" },
  running: { label: "生成中", color: "secondary" },
  dry_run_ready: { label: "可生成", color: "success" },
  approval_required: { label: "待确认", color: "warning" },
  succeeded: { label: "已完成", color: "success" },
  failed: { label: "失败", color: "danger" },
  cancelled: { label: "已取消", color: "default" },
  planned: { label: "待生成", color: "default" },
};

const taskStatusMeta: Record<
  string,
  {
    label: string;
    color:
      "default" | "primary" | "secondary" | "success" | "warning" | "danger";
  }
> = {
  queued: { label: "准备中", color: "primary" },
  running: { label: "生成中", color: "secondary" },
  dry_run_ready: { label: "可生成", color: "success" },
  approval_required: { label: "待确认", color: "warning" },
  succeeded: { label: "已完成", color: "success" },
  failed: { label: "失败", color: "danger" },
  cancelled: { label: "已取消", color: "default" },
  planned: { label: "待生成", color: "default" },
};

function runStatus(status: string) {
  return runStatusMeta[status] || { label: status, color: "default" as const };
}

function taskStatus(status: string) {
  return taskStatusMeta[status] || { label: status, color: "default" as const };
}

function canDryRunSolutionTask(task: SolutionRunTaskRecord) {
  return (
    task.executorKind === "redfox" && redfoxDryRunnableStatuses.has(task.status)
  );
}

function canApproveSolutionManualTask(task: SolutionRunTaskRecord) {
  return (
    task.executorKind === "manual" && manualApprovableStatuses.has(task.status)
  );
}

function canCloseSolutionPreviewRun(run: SolutionRunRecord | null) {
  return Boolean(
    run?.tasks.some(
      (task) =>
        canDryRunSolutionTask(task) || canApproveSolutionManualTask(task),
    ),
  );
}

const businessObjectLabels: Record<string, string> = {
  AgentConfirmation: "人工确认",
  Article: "内容草稿",
  BenchmarkAccount: "对标账号",
  CommentInsight: "评论洞察",
  ComplianceCheck: "合规检查",
  CrmCustomer: "客户线索",
  CrmTask: "跟进任务",
  EvidenceAttachment: "证据附件",
  GrowthAccountHealth: "账号健康",
  GrowthLead: "增长线索",
  GrowthReport: "增长报告",
  IntelligenceItem: "情报条目",
  IntelligenceMonitor: "监控任务",
  IntelligenceReport: "情报报告",
  KnowledgeItem: "知识条目",
  Material: "素材",
  PublishRecord: "发布结果",
  RedfoxCallLog: "接入记录",
  RiskEvidence: "风险证据",
  RuntimeExecution: "任务历史",
  Seedance: "视频素材",
  SolutionRun: "任务记录",
  SolutionRunItem: "机会条目",
  Topic: "选题",
};

const hiddenObjectNames = new Set([
  "SolutionRun",
  "RedfoxCallLog",
  "RuntimeExecution",
]);

const configurationKeyLabels: Record<string, string> = {
  businessObjective: "业务目标",
  objective: "业务目标",
  keyword: "关键词",
  keywords: "关键词",
  query: "查询词",
  q: "查询词",
  platforms: "平台范围",
  platform: "平台",
  competitors: "对标账号",
  competitorAccounts: "对标账号",
  benchmarkAccounts: "对标账号",
  frequency: "运行频率",
  cadence: "运行频率",
  deliveryTarget: "交付去向",
  outputTarget: "交付去向",
  outputChannel: "交付去向",
  approver: "审批人",
  approvalOwner: "审批人",
  industry: "行业",
  scenario: "场景",
};

const hiddenUserConfigurationKeys = new Set([
  "approval",
  "approvalOwner",
  "approver",
  "cadence",
  "deliveryTarget",
  "frequency",
  "outputChannel",
  "outputTarget",
  "runMode",
  "sendMode",
]);

const primaryInputKeyPriority = [
  "businessObjective",
  "query",
  "keywords",
  "keyword",
  "sourceText",
  "content",
  "benchmarkAccounts",
  "brandKeywords",
  "accountUrl",
  "topic",
  "productName",
  "industry",
];

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function formatBusinessObject(value: string | null | undefined) {
  if (!value) return "结果待生成";
  return businessObjectLabels[value] || value;
}

function formatConfigurationKey(value: string) {
  return configurationKeyLabels[value] || value;
}

function resolveVisibleConfigurationField(
  item: SolutionPackageDefinition,
  visibleField: BusinessVisibleInputField,
): SolutionConfigurationField {
  const sourceField = item.productization?.configurationFields.find(
    (field) => field.key === visibleField.key,
  );

  return {
    key: visibleField.key,
    label:
      visibleField.label ||
      sourceField?.label ||
      formatConfigurationKey(visibleField.key),
    type: visibleField.type || sourceField?.type || "text",
    required: visibleField.required ?? sourceField?.required ?? false,
    placeholder: visibleField.placeholder || sourceField?.placeholder || "",
    helper: visibleField.helper || sourceField?.helper || "",
    options: visibleField.options || sourceField?.options,
    defaultValue: visibleField.defaultValue ?? sourceField?.defaultValue,
  };
}

function getVisibleConfigurationFields(item: SolutionPackageDefinition) {
  const profileFields = item.productization?.configurationFields || [];
  const experience = getBusinessActionExperience(item);

  if (experience.visibleInputFields?.length) {
    return experience.visibleInputFields.map((field) =>
      resolveVisibleConfigurationField(item, field),
    );
  }

  return profileFields.filter(
    (field) => !hiddenUserConfigurationKeys.has(field.key),
  );
}

function getPrimaryConfigurationField(fields: SolutionConfigurationField[]) {
  return (
    [...fields].sort((left, right) => {
      const leftPriority = primaryInputKeyPriority.includes(left.key)
        ? primaryInputKeyPriority.indexOf(left.key)
        : primaryInputKeyPriority.length;
      const rightPriority = primaryInputKeyPriority.includes(right.key)
        ? primaryInputKeyPriority.indexOf(right.key)
        : primaryInputKeyPriority.length;
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      if (left.required !== right.required) return left.required ? -1 : 1;
      if (left.type === "textarea" && right.type !== "textarea") return -1;
      if (right.type === "textarea" && left.type !== "textarea") return 1;
      return 0;
    })[0] || null
  );
}

function summarizeFieldValue(
  field: SolutionConfigurationField,
  value: SolutionInputValue | undefined,
) {
  const values = listInputValues(value);
  if (values.length) return values.slice(0, 3).join("、");
  if (field.type === "tags" && field.options?.length) {
    return field.options.slice(0, 3).join("、");
  }
  if (Array.isArray(field.defaultValue) && field.defaultValue.length) {
    return field.defaultValue.slice(0, 3).join("、");
  }
  if (typeof field.defaultValue === "string" && field.defaultValue.trim()) {
    return field.defaultValue;
  }
  return "系统自动判断";
}

function getVisibleConfiguredInputEntries(
  item: SolutionPackageDefinition | null,
  configuredInput: Record<string, unknown> | null,
) {
  if (!configuredInput) return [];
  const visibleKeys = item
    ? new Set(getVisibleConfigurationFields(item).map((field) => field.key))
    : null;

  return Object.entries(configuredInput).filter(([key, value]) => {
    if (hiddenUserConfigurationKeys.has(key)) return false;
    if (visibleKeys && !visibleKeys.has(key)) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "string") return value.trim().length > 0;
    return value !== null && value !== undefined;
  });
}

function summarizeBusinessObjects(values: string[]) {
  const visibleObjects = uniqueValues(
    values
      .filter((value) => !hiddenObjectNames.has(value))
      .map(formatBusinessObject),
  );
  const fallbackObjects = uniqueValues(values.map(formatBusinessObject));
  const labels = visibleObjects.length ? visibleObjects : fallbackObjects;
  return {
    value: labels.slice(0, 2).join("、") || "业务结果",
    hint:
      labels.length > 2
        ? `另有 ${labels.length - 2} 类交付物`
        : "沉淀到对应业务模块",
  };
}

function displayPlanWarning(value: string) {
  if (value.includes("不会直接调用 RedFox")) {
    return "当前只是处理计划，不会消耗额度或写入业务结果。";
  }
  if (value.includes("任务编排、成本限额")) {
    return "正式上线前需要补齐自动任务、用量限制、人工确认和结果沉淀。";
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringFromUnknown(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function inputToText(value: SolutionInputValue | undefined) {
  return Array.isArray(value) ? value.join("，") : (value ?? "");
}

function parseTags(value: string) {
  return value
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function fieldDefaultValue(field: SolutionConfigurationField) {
  if (Array.isArray(field.defaultValue)) return field.defaultValue;
  if (typeof field.defaultValue === "number") return String(field.defaultValue);
  if (typeof field.defaultValue === "string") return field.defaultValue;
  return field.type === "tags" ? [] : "";
}

function createDefaultSolutionInput(item: SolutionPackageDefinition | null) {
  const fields = item?.productization?.configurationFields || [];
  return fields.reduce<SolutionInputState>((current, field) => {
    current[field.key] = fieldDefaultValue(field);
    return current;
  }, {});
}

function normalizeTemplateInput(input: Record<string, unknown>) {
  return Object.entries(input).reduce<SolutionInputState>(
    (current, [key, value]) => {
      if (Array.isArray(value)) {
        current[key] = value.map((item) => String(item).trim()).filter(Boolean);
      } else if (typeof value === "string" || typeof value === "number") {
        current[key] = String(value);
      }
      return current;
    },
    {},
  );
}

function readOutputRefs(value: unknown): DisplayOutputRef[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({
    label: stringFromUnknown(item.label, "业务交付物"),
    status: stringFromUnknown(item.status, "planned"),
    targetModule: stringFromUnknown(item.targetModule, "结果中心"),
  }));
}

function readAcceptanceChecks(value: unknown): DisplayAcceptanceCheck[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({
    label: stringFromUnknown(item.label, "交付项"),
    status: stringFromUnknown(item.status, "pending"),
  }));
}

function readRunConfiguredInput(run: SolutionRunRecord | null) {
  if (!run || !isRecord(run.summary)) return null;
  const configuredInput = run.summary.configuredInput;
  return isRecord(configuredInput) ? configuredInput : null;
}

type BusinessObjectRef = {
  objectType: string;
  status: string;
  refId: string | null;
  dedupeKey?: string;
  persistence?: string;
};

function readBusinessObjectRefs(value: unknown): BusinessObjectRef[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({
    objectType: stringFromUnknown(item.objectType, ""),
    status: stringFromUnknown(item.status, "planned"),
    refId: typeof item.refId === "string" ? item.refId : null,
    dedupeKey: typeof item.dedupeKey === "string" ? item.dedupeKey : undefined,
    persistence:
      typeof item.persistence === "string" ? item.persistence : undefined,
  }));
}

function pendingOutputDraftRefs(result: SolutionRunResultRecord) {
  if (result.kind !== "redfox_output_normalization") return [];
  return readBusinessObjectRefs(result.businessObjectRefs).filter(
    (ref) =>
      confirmableOutputObjects.has(ref.objectType) &&
      ref.status === "ready_for_persistence" &&
      !ref.refId,
  );
}

function pendingOutputDraftResults(run: SolutionRunRecord) {
  return (run.results || [])
    .map((result) => ({
      result,
      refs: pendingOutputDraftRefs(result),
    }))
    .filter((item) => item.refs.length > 0);
}

function statusTone(status: string) {
  if (["succeeded", "success", "ready", "dry_run_ready"].includes(status)) {
    return "success" as const;
  }
  if (["failed", "blocked"].includes(status)) return "danger" as const;
  if (["approval_required", "pending", "planned"].includes(status)) {
    return "warning" as const;
  }
  return "primary" as const;
}

const skillRunMeta: Record<
  CommercialSkillRunPhase,
  {
    label: string;
    color:
      "default" | "primary" | "secondary" | "success" | "warning" | "danger";
  }
> = {
  idle: { label: "可运行", color: "primary" },
  checking: { label: "检查中", color: "secondary" },
  starting: { label: "启动中", color: "secondary" },
  running: { label: "生成中", color: "secondary" },
  waiting: { label: "待确认", color: "warning" },
  completed: { label: "已完成", color: "success" },
  failed: { label: "未完成", color: "danger" },
  blocked: { label: "需处理", color: "warning" },
};

function skillRunKey(
  item: SolutionPackageDefinition,
  row: SolutionRedfoxMappingCoverageItem,
) {
  return `${item.code}:${row.skillCode || row.skillName}`;
}

function normalizeCommercialMessage(value: string | null | undefined) {
  if (!value) return "等待本机服务返回进度。";
  return commercialDisplayText(value)
    .replace(
      /缺少平台参数\s*platform[。.]?/g,
      "运行平台没有配置完整，请重新运行，系统会使用默认全平台范围。",
    )
    .replace(
      /missing required field:?\s*platform/gi,
      "运行平台没有配置完整，请重新运行，系统会使用默认全平台范围。",
    )
    .replace(/Agent-S/g, "本机服务")
    .replace(/SkillHub/g, "能力服务");
}

function listInputValues(value: SolutionInputValue | undefined) {
  if (Array.isArray(value))
    return value.map((item) => item.trim()).filter(Boolean);
  return (value || "")
    .split(/[,，、\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function firstInputValue(value: SolutionInputValue | undefined) {
  return listInputValues(value)[0] || inputToText(value).trim();
}

function normalizeCommercialPlatform(value: string | null | undefined) {
  const normalized = (value || "").trim().toLowerCase();
  if (!normalized) return "";
  const map: Record<string, string> = {
    all: "all",
    web: "all",
    全网: "all",
    多平台: "all",
    multi_platform: "all",
    douyin: "douyin",
    抖音: "douyin",
    xiaohongshu: "xiaohongshu",
    xhs: "xiaohongshu",
    小红书: "xiaohongshu",
    gzh: "gzh",
    wechat: "gzh",
    公众号: "gzh",
    bilibili: "bilibili",
    b站: "bilibili",
    "b 站": "bilibili",
    tiktok: "tiktok",
  };
  return map[normalized] || "";
}

function buildCommercialSkillRunInput({
  item,
  row,
  ref,
  solutionInput,
}: {
  item: SolutionPackageDefinition;
  row: SolutionRedfoxMappingCoverageItem;
  ref: NonNullable<ReturnType<typeof firstSkillHubRef>>;
  solutionInput: SolutionInputState;
}) {
  const configuredPlatforms = listInputValues(solutionInput.platforms);
  const configuredPlatform =
    configuredPlatforms.map(normalizeCommercialPlatform).find(Boolean) || "";
  const rowPlatform = normalizeCommercialPlatform(row.platform);
  const platform = rowPlatform || configuredPlatform || "all";
  const keywords = listInputValues(solutionInput.keywords);
  const primaryKeyword =
    firstInputValue(solutionInput.keyword) ||
    firstInputValue(solutionInput.query) ||
    keywords[0] ||
    item.name;
  const businessObjective =
    firstInputValue(solutionInput.businessObjective) || item.customerValue;

  return {
    ...solutionInput,
    platform,
    platforms: configuredPlatforms.length ? configuredPlatforms : [platform],
    keyword: primaryKeyword,
    query: primaryKeyword,
    q: primaryKeyword,
    limit: 10,
    timeRange: "last_7_days",
    time_range: "last_7_days",
    packageCode: item.code,
    packageName: item.name,
    capabilityName: row.skillName,
    skillCode: ref.skillCode,
    skillName: ref.skillName,
    businessObjective,
    deliverable: outputSummary(row),
    scenario: row.scenario || "commercial_solution_trial",
    source: "solutions-page",
  };
}

function latestSkillRunMessage(state?: CommercialSkillRunState) {
  if (!state) return "配置好输入后，可以直接生成结果。";
  const latestEvent = [...state.events]
    .reverse()
    .find((event) => event.message);
  if (state.error) return normalizeCommercialMessage(state.error);
  return normalizeCommercialMessage(latestEvent?.message);
}

function mapAgentEventPhase(
  event?: CommercialSkillRunEvent,
): CommercialSkillRunPhase {
  if (!event) return "running";
  if (event.status === "completed" || event.event_type === "task_completed") {
    return "completed";
  }
  if (event.status === "waiting_approval") return "waiting";
  if (event.status === "blocked") return "blocked";
  if (
    event.status === "failed" ||
    event.status === "cancelled" ||
    event.event_type === "task_failed" ||
    event.event_type === "task_cancelled"
  ) {
    return "failed";
  }
  return "running";
}

function isTerminalSkillRunPhase(phase: CommercialSkillRunPhase) {
  return (
    phase === "completed" ||
    phase === "failed" ||
    phase === "blocked" ||
    phase === "waiting"
  );
}

function outputSummary(row: SolutionRedfoxMappingCoverageItem) {
  const summary = summarizeBusinessObjects(row.outputObjects);
  return summary.value || "业务结果";
}

function commercialCapabilitySummary(
  rows: SolutionRedfoxMappingCoverageItem[],
) {
  const usable = rows.filter((row) => row.integrationReady).length;
  const apiReady = rows.filter(
    (row) => row.executionStatus === "verified_api_path",
  ).length;
  const localReady = rows.filter(
    (row) => row.executionStatus === "verified_skillhub",
  ).length;
  const pending = Math.max(0, rows.length - usable);
  return { usable, apiReady, localReady, pending };
}

function firstSkillHubRef(row: SolutionRedfoxMappingCoverageItem) {
  return row.skillHubRefs[0] || null;
}

function mergeSkillRunEvents(
  current: CommercialSkillRunEvent[],
  incoming: CommercialSkillRunEvent[],
) {
  const bySeq = new Map<number, CommercialSkillRunEvent>();
  [...current, ...incoming].forEach((event) => bySeq.set(event.seq, event));
  return Array.from(bySeq.values()).sort((a, b) => a.seq - b.seq);
}

function getSessionId(value: unknown) {
  if (!isRecord(value)) return "";
  const sessionId = value.session_id || value.id;
  return typeof sessionId === "string" ? sessionId : "";
}

function SummaryMetric({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  hint: string;
}) {
  return (
    <div className="rounded-[8px] border border-default-200 bg-default-50 p-3">
      <div className="flex items-center gap-3">
        <span className="kaypal-v3-icon-tile h-8 w-8 flex-shrink-0">
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-xs text-default-500">{label}</p>
          <p className="mt-0.5 line-clamp-2 text-sm font-semibold leading-5 text-[var(--kaypal-v3-ink)]">
            {commercialDisplayText(value)}
          </p>
        </div>
      </div>
      <p className="mt-2 text-xs leading-5 text-default-500">
        {commercialDisplayText(hint)}
      </p>
    </div>
  );
}

function SkillActionWorkbench({
  items,
  selectableItems,
  selectedItem,
  loading,
  scenarioScope,
  onSelect,
  onScenarioScopeChange,
  onFocusConfiguration,
}: {
  items: SolutionPackageDefinition[];
  selectableItems: SolutionPackageDefinition[];
  selectedItem: SolutionPackageDefinition | null;
  loading: boolean;
  scenarioScope: FilterKey;
  onSelect: (code: string) => void;
  onScenarioScopeChange: (scope: FilterKey) => void;
  onFocusConfiguration: () => void;
}) {
  const selectableCodes = new Set(selectableItems.map((item) => item.code));
  const actionItems = primaryActionCards
    .filter((action) => selectableCodes.has(action.code) && action.enabled)
    .map((action) => ({
      action,
      item: items.find((item) => item.code === action.code) || null,
    }));
  const selectedAction =
    actionItems.find(({ item }) => item?.code === selectedItem?.code) || null;
  const selectedActionItem = selectedAction?.item || selectedItem || null;
  const selectedActionMeta = selectedAction?.action;
  const selectedActionReady = Boolean(
    selectedActionItem &&
    (selectedActionMeta?.enabled ?? true) &&
    selectedActionItem.implementationState !== "planned",
  );
  return (
    <section className="rounded-[8px] border border-default-200 bg-content1 shadow-sm">
      <div className="flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-primary">
              组合方案
            </p>
            <h2 className="mt-1 text-2xl font-bold text-[var(--kaypal-v3-ink)]">
              选择一条业务链
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-default-500">
              单点功能已经拆到左侧业务模块。这里只处理需要跨模块串起来的结果。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              color={scenarioScope === "core" ? "primary" : "default"}
              variant={scenarioScope === "core" ? "solid" : "flat"}
              className="rounded-[8px] font-semibold"
              onPress={() => onScenarioScopeChange("core")}
            >
              核心组合
            </Button>
            <Button
              size="sm"
              color={scenarioScope === "redfox_pool" ? "primary" : "default"}
              variant={scenarioScope === "redfox_pool" ? "solid" : "flat"}
              className="rounded-[8px] font-semibold"
              onPress={() => onScenarioScopeChange("redfox_pool")}
            >
              方案池
            </Button>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {actionItems.map(({ action, item }) => {
            const active = selectedItem?.code === action.code;
            const ready = Boolean(
              item && action.enabled && item.implementationState !== "planned",
            );
            return (
              <Button
                key={action.code}
                color={active ? "primary" : "default"}
                variant={active ? "solid" : "flat"}
                className="h-auto min-h-11 justify-start whitespace-normal rounded-[8px] px-3 py-2 text-left font-semibold leading-5"
                isDisabled={!ready || loading}
                startContent={action.icon}
                onPress={() => {
                  if (item) onSelect(item.code);
                }}
              >
                {commercialDisplayText(item?.name) || action.title}
              </Button>
            );
          })}
        </div>

        <div className="grid gap-4 rounded-[8px] border border-primary/20 bg-primary/5 p-4 lg:grid-cols-[minmax(0,1fr)_180px] lg:items-center">
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-[var(--kaypal-v3-ink)]">
              {commercialDisplayText(selectedActionItem?.name) ||
                selectedActionMeta?.title ||
                "选择一个方案"}
            </h3>
            <p className="mt-2 text-sm leading-6 text-default-600">
              {commercialDisplayText(selectedActionItem?.customerValue) ||
                selectedActionMeta?.outcome ||
                "选择方案后，系统会按业务链生成对应结果。"}
            </p>
            <div className="mt-3 grid gap-2 text-xs text-default-600 sm:grid-cols-3">
              <span className="rounded-[8px] bg-content1 px-3 py-2 font-semibold">
                1. 选方案
              </span>
              <span className="rounded-[8px] bg-content1 px-3 py-2 font-semibold">
                2. 写一句目标
              </span>
              <span className="rounded-[8px] bg-content1 px-3 py-2 font-semibold">
                3. 收业务结果
              </span>
            </div>
          </div>
          <Button
            color="primary"
            className="h-12 rounded-[8px] font-semibold"
            isDisabled={!selectedActionReady || loading}
            startContent={<Settings2 size={16} />}
            onPress={() => {
              if (selectedActionReady) {
                onFocusConfiguration();
              }
            }}
          >
            {selectedActionReady ? "填写目标" : "建设中"}
          </Button>
        </div>
      </div>
    </section>
  );
}

function PackageCard({
  item,
  solutionInput,
  loadingRunCode,
  onCreateRun,
}: {
  item: SolutionPackageDefinition;
  solutionInput: SolutionInputState;
  loadingRunCode: string | null;
  onCreateRun: (code: string, input: SolutionInputState) => void;
}) {
  const state = stateMeta[item.implementationState];
  const canGenerateResult = item.implementationState !== "planned";
  const liveEntryPath =
    item.connectedEntryPath ??
    (!item.entryPath.startsWith("/solutions/") ? item.entryPath : null);
  const primaryOutcome = item.acceptance[0] || "完成方案交付并沉淀结果";
  const businessObjects = summarizeBusinessObjects(item.dataObjects);
  const experience = getBusinessActionExperience(item);
  const actionMeta = getPrimaryActionMeta(item.code);

  return (
    <Card className="border border-default-200 bg-content1 shadow-sm">
      <CardBody className="gap-5 p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Chip color={state.color} size="sm" variant="flat">
                {state.label}
              </Chip>
              <Chip size="sm" variant="flat">
                {businessObjects.value}
              </Chip>
              {liveEntryPath ? (
                <Chip color="success" size="sm" variant="flat">
                  结果库可打开
                </Chip>
              ) : (
                <Chip color="warning" size="sm" variant="flat">
                  结果入口待补
                </Chip>
              )}
            </div>
            <h2 className="text-xl font-bold text-[var(--kaypal-v3-ink)]">
              {commercialDisplayText(item.name)}
            </h2>
            <p className="mt-2 text-sm leading-6 text-default-500">
              {commercialDisplayText(item.summary)}
            </p>
          </div>
          <span className="kaypal-v3-icon-tile hidden h-11 w-11 flex-shrink-0 md:flex">
            <Blocks size={20} />
          </span>
        </div>

        <div className="rounded-[8px] border border-primary/20 bg-primary/5 p-4">
          <p className="text-xs font-semibold text-primary">这个组合会产出</p>
          <p className="mt-1 text-base font-semibold leading-6 text-[var(--kaypal-v3-ink)]">
            {experience.resultTitle}
          </p>
          <p className="mt-2 text-sm leading-6 text-default-600">
            {experience.resultDescription}
          </p>
          <p className="mt-2 text-sm leading-6 text-default-600">
            交付重点：{commercialDisplayText(primaryOutcome)}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {experience.resultCards.slice(0, 3).map((result) => (
            <SummaryMetric
              key={result.label}
              icon={<DatabaseZap size={15} />}
              label={result.targetModule}
              value={result.label}
              hint={result.description}
            />
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            color="primary"
            className="rounded-[8px] font-semibold"
            isDisabled={!canGenerateResult}
            isLoading={loadingRunCode === item.code}
            startContent={
              loadingRunCode === item.code ? null : <DatabaseZap size={16} />
            }
            onPress={() => onCreateRun(item.code, solutionInput)}
          >
            {canGenerateResult
              ? actionMeta?.actionLabel || "生成结果"
              : "建设中"}
          </Button>
          {liveEntryPath ? (
            <Button
              as={Link}
              href={liveEntryPath}
              color="primary"
              variant="bordered"
              className="rounded-[8px] font-semibold"
              endContent={<ArrowRight size={16} />}
            >
              查看结果
            </Button>
          ) : null}
        </div>

        <Divider />

        <div className="grid gap-5 lg:grid-cols-[1fr_0.9fr]">
          <InfoBlock
            icon={<ListChecks size={16} />}
            title="下一步动作"
            values={experience.nextActions}
          />
          <InfoBlock
            icon={<DatabaseZap size={16} />}
            title="生成结果"
            values={uniqueValues(
              item.dataObjects
                .filter((value) => !hiddenObjectNames.has(value))
                .map(formatBusinessObject),
            )}
          />
        </div>
      </CardBody>
    </Card>
  );
}

function InfoBlock({
  icon,
  title,
  values,
}: {
  icon: React.ReactNode;
  title: string;
  values: string[];
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--kaypal-v3-ink)]">
        <span className="kaypal-v3-icon-tile h-7 w-7">{icon}</span>
        {title}
      </div>
      <div className="flex flex-wrap gap-2">
        {values.map((value) => (
          <Chip key={value} size="sm" variant="flat">
            {commercialDisplayText(value)}
          </Chip>
        ))}
      </div>
    </div>
  );
}

function getResultActionEntryPath(action: BusinessResultAction) {
  return (
    action.entryPath || resultModuleEntryPaths[action.targetModule] || null
  );
}

function buildResultActionHref(
  action: BusinessResultAction,
  run: SolutionRunRecord | null,
) {
  const entryPath = getResultActionEntryPath(action);
  if (!entryPath || !run) return null;
  const separator = entryPath.includes("?") ? "&" : "?";
  return `${entryPath}${separator}source=solutions&runId=${encodeURIComponent(
    run.id,
  )}&packageCode=${encodeURIComponent(run.packageCode)}`;
}

type ResultActionWriteState = {
  phase: "idle" | "running" | "created" | "failed";
  message?: string;
  href?: string;
};

function getResultActionWriteKind(
  action: BusinessResultAction,
): SolutionResultActionKind | null {
  const label = action.label;
  const targetModule = action.targetModule;
  if (
    targetModule === "监控中心" ||
    label.includes("监控") ||
    label.includes("加入账号监控") ||
    label.includes("加入竞品监控")
  ) {
    return "monitor";
  }
  if (
    label.includes("创建跟进任务") ||
    label.includes("分派处理人") ||
    (targetModule === "待办" && label.includes("处理"))
  ) {
    return "crm_task";
  }
  if (
    label.includes("创建 CRM 线索") ||
    label.includes("创建线索") ||
    label.includes("保存线索") ||
    targetModule === "CRM" ||
    targetModule.includes("线索")
  ) {
    return "crm_lead";
  }
  if (
    label.includes("生成报告") ||
    label.includes("导出") ||
    label.includes("日报") ||
    targetModule.includes("报告")
  ) {
    return "intelligence_report";
  }
  if (
    label.includes("加入发布排期") ||
    label.includes("继续发布") ||
    targetModule.includes("发布")
  ) {
    return "publish_preparation";
  }
  return null;
}

function ResultActionBlock({
  actions,
  run,
  configuredInput,
}: {
  actions: BusinessResultAction[];
  run: SolutionRunRecord | null;
  configuredInput: Record<string, unknown> | null;
}) {
  const [writeStates, setWriteStates] = useState<
    Record<string, ResultActionWriteState>
  >({});

  const updateWriteState = (key: string, nextState: ResultActionWriteState) => {
    setWriteStates((current) => ({ ...current, [key]: nextState }));
  };

  const handleWriteAction = async (action: BusinessResultAction) => {
    if (!run) return;
    const kind = getResultActionWriteKind(action);
    if (!kind) return;
    const key = `${run.id}:${action.label}:${action.targetModule}`;
    updateWriteState(key, { phase: "running" });

    try {
      const result = await executeSolutionResultAction(run.id, {
        kind,
        label: action.label,
        targetModule: action.targetModule,
        description: action.description,
        entryPath: getResultActionEntryPath(action) || undefined,
        configuredInput: configuredInput || undefined,
      });
      updateWriteState(key, {
        phase: "created",
        message: result.message,
        href: result.href || buildResultActionHref(action, run) || undefined,
      });
      toast.success(result.message);
    } catch (error) {
      const message = toPublicError(error, "结果操作未完成，请重试。");
      updateWriteState(key, { phase: "failed", message });
      toast.error(message);
    }
  };

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--kaypal-v3-ink)]">
        <span className="kaypal-v3-icon-tile h-7 w-7">
          <ArrowRight size={16} />
        </span>
        结果下一步
      </div>
      <div className="grid gap-2">
        {actions.map((action) => {
          const href = buildResultActionHref(action, run);
          const entryPath = getResultActionEntryPath(action);
          const writeKind = getResultActionWriteKind(action);
          const writeState = run
            ? writeStates[`${run.id}:${action.label}:${action.targetModule}`]
            : undefined;
          const isWritable = Boolean(run && writeKind);
          const isReady = Boolean(run && (href || writeKind));
          const createdHref = writeState?.href || href;
          return (
            <div
              key={`${action.label}-${action.targetModule}`}
              className="rounded-[8px] border border-default-200 bg-default-50 p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--kaypal-v3-ink)]">
                    {commercialDisplayText(action.label)}
                  </p>
                  <p className="mt-1 text-xs text-default-500">
                    去向：{commercialDisplayText(action.targetModule)}
                  </p>
                </div>
                <Chip
                  size="sm"
                  color={isReady ? "success" : "default"}
                  variant="flat"
                >
                  {isReady ? "可打开" : entryPath ? "生成后可打开" : "入口待补"}
                </Chip>
              </div>
              <p className="mt-2 text-xs leading-5 text-default-600">
                {commercialDisplayText(action.description)}
              </p>
              {writeState?.message ? (
                <p
                  className={`mt-2 text-xs leading-5 ${
                    writeState.phase === "failed"
                      ? "text-danger"
                      : "text-success"
                  }`}
                >
                  {commercialDisplayText(writeState.message)}
                </p>
              ) : null}
              <div className="mt-3">
                {createdHref && writeState?.phase === "created" ? (
                  <Button
                    as={Link}
                    href={createdHref}
                    size="sm"
                    color="primary"
                    variant="flat"
                    className="rounded-[8px] font-semibold"
                    endContent={<ArrowRight size={14} />}
                  >
                    查看{commercialDisplayText(action.targetModule)}
                  </Button>
                ) : isWritable ? (
                  <Button
                    size="sm"
                    color="primary"
                    variant="flat"
                    className="rounded-[8px] font-semibold"
                    isLoading={writeState?.phase === "running"}
                    isDisabled={writeState?.phase === "running"}
                    onPress={() => void handleWriteAction(action)}
                  >
                    {writeKind === "monitor"
                      ? "创建监控任务"
                      : writeKind === "crm_task"
                        ? "创建跟进任务"
                        : writeKind === "crm_lead"
                          ? "创建 CRM 线索"
                          : writeKind === "intelligence_report"
                            ? "生成报告"
                            : "创建发布准备"}
                  </Button>
                ) : href ? (
                  <Button
                    as={Link}
                    href={href}
                    size="sm"
                    color="primary"
                    variant="flat"
                    className="rounded-[8px] font-semibold"
                    endContent={<ArrowRight size={14} />}
                  >
                    查看{commercialDisplayText(action.targetModule)}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="flat"
                    className="rounded-[8px] font-semibold"
                    isDisabled
                  >
                    {entryPath ? "生成后打开" : "等待接入"}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SolutionConfigurationPanel({
  item,
  input,
  loadingRunCode,
  onChange,
  onApplyTemplate,
  onGenerate,
}: {
  item: SolutionPackageDefinition;
  input: SolutionInputState;
  loadingRunCode: string | null;
  onChange: (key: string, value: SolutionInputValue) => void;
  onApplyTemplate: (template: SolutionIndustryTemplate) => void;
  onGenerate: (code: string, input: SolutionInputState) => void;
}) {
  const profile = item.productization;
  if (!profile) return null;
  const experience = getBusinessActionExperience(item);
  const actionMeta = getPrimaryActionMeta(item.code);
  const canGenerateResult = item.implementationState !== "planned";
  const visibleFields = getVisibleConfigurationFields(item);
  const usesCustomVisibleFields = Boolean(
    experience.visibleInputFields?.length,
  );
  const primaryField = getPrimaryConfigurationField(visibleFields);
  const defaultedFields = visibleFields
    .filter((field) => field.key !== primaryField?.key)
    .slice(0, 4);

  return (
    <Card className="border border-default-200 bg-content1 shadow-sm">
      <CardHeader className="flex flex-col items-start gap-2 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="kaypal-v3-icon-tile h-8 w-8">
              <Settings2 size={16} />
            </span>
            <h2 className="text-lg font-bold text-[var(--kaypal-v3-ink)]">
              写一句话
            </h2>
          </div>
          <p className="text-sm leading-6 text-default-500">
            不用配复杂参数。把你想要的结果说清楚，系统会自动补默认平台、范围和保存去向。
          </p>
        </div>
        <Chip color="primary" variant="flat">
          一个按钮生成
        </Chip>
      </CardHeader>
      <Divider />
      <CardBody className="gap-5 p-5">
        <div className="rounded-[8px] border border-primary/20 bg-primary/5 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Chip size="sm" color="primary" variant="solid">
              第二步
            </Chip>
            <p className="text-sm font-semibold text-[var(--kaypal-v3-ink)]">
              只填这个
            </p>
          </div>
          {primaryField ? (
            (() => {
              const field = primaryField;
              const value = input[field.key];
              const fieldHint = experience.fieldHints?.[field.key] || {};
              const label = usesCustomVisibleFields
                ? field.label
                : fieldHint.label || field.label;
              const placeholder = usesCustomVisibleFields
                ? field.placeholder
                : fieldHint.placeholder || field.placeholder;
              const helper = usesCustomVisibleFields
                ? field.helper
                : fieldHint.helper || field.helper;

              if (field.type === "textarea") {
                return (
                  <Textarea
                    label={commercialDisplayText(label)}
                    value={inputToText(value)}
                    placeholder={commercialDisplayText(placeholder)}
                    description={commercialDisplayText(helper)}
                    minRows={3}
                    variant="bordered"
                    isRequired={field.required}
                    onValueChange={(nextValue) =>
                      onChange(field.key, nextValue)
                    }
                    classNames={{
                      inputWrapper: "rounded-[8px] bg-content1",
                    }}
                  />
                );
              }

              if (field.type === "select") {
                return (
                  <label className="flex flex-col gap-1">
                    <span className="text-sm font-semibold text-[var(--kaypal-v3-ink)]">
                      {commercialDisplayText(label)}
                      {field.required ? " *" : ""}
                    </span>
                    <select
                      value={inputToText(value)}
                      onChange={(event) =>
                        onChange(field.key, event.currentTarget.value)
                      }
                      className="h-12 rounded-[8px] border border-default-200 bg-content1 px-3 text-sm text-[var(--kaypal-v3-ink)] outline-none transition focus:border-primary"
                    >
                      {(field.options || []).map((option) => (
                        <option key={option} value={option}>
                          {commercialDisplayText(option)}
                        </option>
                      ))}
                    </select>
                    <span className="text-xs leading-5 text-default-500">
                      {commercialDisplayText(helper)}
                    </span>
                  </label>
                );
              }

              return (
                <Input
                  label={commercialDisplayText(label)}
                  value={inputToText(value)}
                  placeholder={commercialDisplayText(placeholder)}
                  description={commercialDisplayText(helper)}
                  variant="bordered"
                  isRequired={field.required}
                  onValueChange={(nextValue) =>
                    onChange(
                      field.key,
                      field.type === "tags" ? parseTags(nextValue) : nextValue,
                    )
                  }
                  classNames={{
                    inputWrapper: "h-12 rounded-[8px] bg-content1",
                  }}
                />
              );
            })()
          ) : (
            <p className="text-sm leading-6 text-default-500">
              当前任务不需要额外填写，直接生成即可。
            </p>
          )}
        </div>

        {defaultedFields.length ? (
          <div className="rounded-[8px] border border-default-200 bg-default-50 p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="kaypal-v3-icon-tile h-7 w-7">
                <ListChecks size={15} />
              </span>
              <p className="text-sm font-semibold text-[var(--kaypal-v3-ink)]">
                系统已默认
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {defaultedFields.map((field) => (
                <Chip key={field.key} size="sm" color="default" variant="flat">
                  {commercialDisplayText(field.label)}：
                  {commercialDisplayText(
                    summarizeFieldValue(field, input[field.key]),
                  )}
                </Chip>
              ))}
            </div>
          </div>
        ) : null}

        {showAdminDiagnostics ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {visibleFields.map((field) => {
              const value = input[field.key];
              const fieldHint = experience.fieldHints?.[field.key] || {};
              const label = usesCustomVisibleFields
                ? field.label
                : fieldHint.label || field.label;
              const placeholder = usesCustomVisibleFields
                ? field.placeholder
                : fieldHint.placeholder || field.placeholder;
              const helper = usesCustomVisibleFields
                ? field.helper
                : fieldHint.helper || field.helper;
              if (field.type === "textarea") {
                return (
                  <Textarea
                    key={field.key}
                    label={commercialDisplayText(label)}
                    value={inputToText(value)}
                    placeholder={commercialDisplayText(placeholder)}
                    description={commercialDisplayText(helper)}
                    minRows={2}
                    variant="bordered"
                    isRequired={field.required}
                    onValueChange={(nextValue) =>
                      onChange(field.key, nextValue)
                    }
                    classNames={{ inputWrapper: "rounded-[8px]" }}
                  />
                );
              }

              if (field.type === "select") {
                return (
                  <label key={field.key} className="flex flex-col gap-1">
                    <span className="text-sm font-semibold text-[var(--kaypal-v3-ink)]">
                      {commercialDisplayText(label)}
                      {field.required ? " *" : ""}
                    </span>
                    <select
                      value={inputToText(value)}
                      onChange={(event) =>
                        onChange(field.key, event.currentTarget.value)
                      }
                      className="h-11 rounded-[8px] border border-default-200 bg-content1 px-3 text-sm text-[var(--kaypal-v3-ink)] outline-none transition focus:border-primary"
                    >
                      {(field.options || []).map((option) => (
                        <option key={option} value={option}>
                          {commercialDisplayText(option)}
                        </option>
                      ))}
                    </select>
                    <span className="text-xs leading-5 text-default-500">
                      {commercialDisplayText(helper)}
                    </span>
                  </label>
                );
              }

              return (
                <Input
                  key={field.key}
                  label={commercialDisplayText(label)}
                  value={inputToText(value)}
                  placeholder={commercialDisplayText(placeholder)}
                  description={commercialDisplayText(helper)}
                  variant="bordered"
                  isRequired={field.required}
                  onValueChange={(nextValue) =>
                    onChange(
                      field.key,
                      field.type === "tags" ? parseTags(nextValue) : nextValue,
                    )
                  }
                  classNames={{ inputWrapper: "rounded-[8px]" }}
                />
              );
            })}
          </div>
        ) : null}

        <div className="flex flex-col gap-3 rounded-[8px] border border-primary/20 bg-primary/5 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2">
              <Chip size="sm" color="primary" variant="solid">
                第三步
              </Chip>
              <p className="text-sm font-semibold text-[var(--kaypal-v3-ink)]">
                点一下，等结果
              </p>
            </div>
            <p className="mt-1 text-xs leading-5 text-default-600">
              {experience.resultDescription}
            </p>
          </div>
          <Button
            color="primary"
            className="h-11 rounded-[8px] font-semibold"
            isDisabled={!canGenerateResult}
            isLoading={loadingRunCode === item.code}
            startContent={
              loadingRunCode === item.code ? null : <DatabaseZap size={16} />
            }
            onPress={() => onGenerate(item.code, input)}
          >
            {canGenerateResult
              ? actionMeta?.actionLabel || "生成结果"
              : "建设中"}
          </Button>
        </div>

        {showAdminDiagnostics ? (
          <div className="rounded-[8px] border border-default-200 bg-default-50 p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="kaypal-v3-icon-tile h-7 w-7">
                <ClipboardList size={15} />
              </span>
              <p className="text-sm font-semibold text-[var(--kaypal-v3-ink)]">
                快速模板
              </p>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {profile.templates.map((template) => (
                <button
                  key={template.code}
                  type="button"
                  className="rounded-[8px] border border-default-200 bg-content1 p-3 text-left transition hover:border-primary/50 hover:bg-primary/5"
                  onClick={() => onApplyTemplate(template)}
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Chip size="sm" color="primary" variant="flat">
                      {commercialDisplayText(template.industry)}
                    </Chip>
                    <Chip size="sm" variant="flat">
                      {template.rolloutDays} 天上线
                    </Chip>
                  </div>
                  <p className="text-sm font-semibold text-[var(--kaypal-v3-ink)]">
                    {commercialDisplayText(template.name)}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-default-500">
                    {commercialDisplayText(template.scenario)}
                  </p>
                  <p className="mt-2 text-xs leading-5 text-default-600">
                    {commercialDisplayText(template.expectedOutcome)}
                  </p>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function MappingCoveragePanel({
  item,
  coverage,
  runStates,
  activeRunKey,
  onStartSkillRun,
}: {
  item: SolutionPackageDefinition;
  coverage: SolutionRedfoxMappingCoverageResult | null;
  runStates: Record<string, CommercialSkillRunState>;
  activeRunKey: string | null;
  onStartSkillRun: (row: SolutionRedfoxMappingCoverageItem) => void;
}) {
  const rows = useMemo(() => {
    return (
      coverage?.items.filter(
        (coverageItem) => coverageItem.packageCode === item.code,
      ) || []
    );
  }, [coverage, item.code]);
  const summary = commercialCapabilitySummary(rows);
  const apiReadyRows = rows.filter(
    (row) => row.executionStatus === "verified_api_path",
  );
  const skillHubVerified = rows.filter(
    (row) => row.executionStatus === "verified_skillhub",
  );
  const total = rows.length || item.redfoxSkills.length;
  const percent = total ? Math.round((summary.usable / total) * 100) : 0;
  const pending = rows.filter((row) => !row.integrationReady);
  const statusColor = summary.pending > 0 ? "warning" : "success";

  return (
    <Card className="border border-default-200 bg-content1 shadow-sm">
      <CardHeader className="flex items-center justify-between gap-3 p-5">
        <div className="flex items-center gap-2">
          <span className="kaypal-v3-icon-tile h-8 w-8">
            <PlugZap size={16} />
          </span>
          <div>
            <h2 className="text-lg font-bold text-[var(--kaypal-v3-ink)]">
              交付准备度
            </h2>
            <p className="text-xs text-default-500">
              展示当前方案能直接生成什么、还缺什么。
            </p>
          </div>
        </div>
        <Chip color={statusColor} variant="flat">
          可启用 {summary.usable}/{total}
        </Chip>
      </CardHeader>
      <Divider />
      <CardBody className="gap-4 p-5">
        <div className="h-2 overflow-hidden rounded-full bg-default-100">
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${percent}%` }}
          />
        </div>
        <div className="grid gap-3">
          <SummaryMetric
            icon={<CheckCircle2 size={15} />}
            label="可直接用"
            value={`${summary.apiReady} 个`}
            hint="已经接好的数据来源"
          />
          <SummaryMetric
            icon={<DatabaseZap size={15} />}
            label="可生成处理"
            value={`${summary.localReady} 个`}
            hint="可以生成内容或分析结果"
          />
          <SummaryMetric
            icon={<ShieldCheck size={15} />}
            label="待处理"
            value={`${summary.pending} 个`}
            hint="暂时不会展示成可用方案"
          />
        </div>

        {apiReadyRows.length ? (
          <div className="rounded-[8px] border border-default-200 bg-default-50 p-3">
            <p className="mb-2 text-sm font-semibold text-[var(--kaypal-v3-ink)]">
              已接入来源
            </p>
            <div className="flex flex-wrap gap-2">
              {apiReadyRows.slice(0, 8).map((row) => (
                <Chip
                  key={`${row.packageCode}-${row.skillName}`}
                  size="sm"
                  color="success"
                  variant="flat"
                >
                  {commercialDisplayText(row.skillName)}
                </Chip>
              ))}
            </div>
          </div>
        ) : null}

        {skillHubVerified.length ? (
          <div className="rounded-[8px] border border-success/30 bg-success/10 p-3">
            <p className="mb-2 text-sm font-semibold text-[var(--kaypal-v3-ink)]">
              可生成结果的处理项
            </p>
            <div className="grid gap-2">
              {skillHubVerified.slice(0, 6).map((row) => {
                const key = skillRunKey(item, row);
                const state = runStates[key];
                const phase = state?.phase || "idle";
                const meta = skillRunMeta[phase];
                const isLoading =
                  activeRunKey === key &&
                  ["checking", "starting", "running"].includes(phase);
                const ref = firstSkillHubRef(row);

                return (
                  <div
                    key={key}
                    className="rounded-[8px] border border-success/20 bg-content1 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-[var(--kaypal-v3-ink)]">
                            {commercialDisplayText(row.skillName)}
                          </p>
                          <Chip size="sm" color={meta.color} variant="flat">
                            {meta.label}
                          </Chip>
                        </div>
                        <p className="mt-1 text-xs leading-5 text-default-500">
                          交付：{outputSummary(row)}
                          {ref?.requiresApiKey ? " · 需要完成授权" : ""}
                        </p>
                      </div>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-default-600">
                      {latestSkillRunMessage(state)}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        color="success"
                        variant={phase === "completed" ? "bordered" : "flat"}
                        className="rounded-[8px] font-semibold"
                        isLoading={isLoading}
                        isDisabled={isLoading}
                        startContent={isLoading ? null : <PlugZap size={14} />}
                        onPress={() => onStartSkillRun(row)}
                      >
                        {phase === "completed" ? "重新生成" : "生成结果"}
                      </Button>
                      {state?.artifacts.length ? (
                        <Chip size="sm" color="success" variant="flat">
                          {state.artifacts.length} 个交付文件
                        </Chip>
                      ) : null}
                      {state?.events.length ? (
                        <Chip size="sm" variant="flat">
                          {state.events.length} 条进度
                        </Chip>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
        {pending.length ? (
          <div className="rounded-[8px] border border-warning/30 bg-warning/10 p-3">
            <p className="mb-2 text-sm font-semibold text-[var(--kaypal-v3-ink)]">
              暂未开放
            </p>
            <div className="flex flex-wrap gap-2">
              {pending.slice(0, 8).map((row) => (
                <Chip
                  key={`${row.packageCode}-${row.skillName}`}
                  size="sm"
                  color="warning"
                  variant="flat"
                >
                  {commercialDisplayText(row.skillName)}
                </Chip>
              ))}
            </div>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function ProductizationPanel({ item }: { item: SolutionPackageDefinition }) {
  const profile = item.productization;
  if (!profile) return null;
  const caseStudy = profile.caseStudies[0];

  return (
    <Card className="border border-default-200 bg-content1 shadow-sm">
      <CardHeader className="flex items-center gap-2 p-5">
        <span className="kaypal-v3-icon-tile h-8 w-8">
          <BarChart3 size={16} />
        </span>
        <div>
          <h2 className="text-lg font-bold text-[var(--kaypal-v3-ink)]">
            模板、案例和 ROI
          </h2>
          <p className="text-xs text-default-500">
            这部分决定方案是不是能被销售、交付和客户复用。
          </p>
        </div>
      </CardHeader>
      <Divider />
      <CardBody className="gap-5 p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          {profile.roiMetrics.map((metric) => (
            <SummaryMetric
              key={metric.key}
              icon={<BarChart3 size={15} />}
              label={metric.label}
              value={`${metric.baseline} → ${metric.target}${metric.unit}`}
              hint={metric.description}
            />
          ))}
        </div>
        {caseStudy ? (
          <div className="rounded-[8px] border border-default-200 bg-default-50 p-4">
            <p className="text-sm font-semibold text-[var(--kaypal-v3-ink)]">
              {commercialDisplayText(caseStudy.title)}
            </p>
            <p className="mt-2 text-sm leading-6 text-default-600">
              {commercialDisplayText(caseStudy.before)} →{" "}
              {commercialDisplayText(caseStudy.after)}
            </p>
            <p className="mt-2 text-sm font-semibold text-primary">
              {commercialDisplayText(caseStudy.result)}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {caseStudy.evidence.map((item) => (
                <Chip key={item} size="sm" variant="flat">
                  {commercialDisplayText(item)}
                </Chip>
              ))}
            </div>
          </div>
        ) : null}
        <div className="grid gap-4 lg:grid-cols-2">
          <InfoBlock
            icon={<TimerReset size={16} />}
            title="运营节奏"
            values={profile.operatingCadence}
          />
          <InfoBlock
            icon={<UserCheck size={16} />}
            title="权限与审计"
            values={[
              `可操作：${profile.permissionPolicy.requiredRoles.join("、")}`,
              `审批：${profile.permissionPolicy.approvalRoles.join("、")}`,
              profile.permissionPolicy.externalExecutionPolicy,
            ]}
          />
        </div>
      </CardBody>
    </Card>
  );
}

function BusinessResultCenter({
  run,
  item,
  loadingResultId,
  closingPreviewRun,
  onFocusConfiguration,
  onClosePreviewRun,
  onConfirmOutputDrafts,
}: {
  run: SolutionRunRecord | null;
  item: SolutionPackageDefinition | null;
  loadingResultId: string | null;
  closingPreviewRun: boolean;
  onFocusConfiguration: () => void;
  onClosePreviewRun: () => void;
  onConfirmOutputDrafts: (resultId: string) => void;
}) {
  const outputRefs = readOutputRefs(run?.outputRefs);
  const acceptanceChecks = readAcceptanceChecks(run?.acceptanceChecks);
  const configuredInput = readRunConfiguredInput(run);
  const outputDraftResults = run ? pendingOutputDraftResults(run) : [];
  const experience = getBusinessActionExperience(item);
  const configuredInputEntries = getVisibleConfiguredInputEntries(
    item,
    configuredInput,
  );
  const configuredInputLabels = new Map(
    item
      ? getVisibleConfigurationFields(item).map((field) => [
          field.key,
          field.label,
        ])
      : [],
  );
  const resultActions =
    experience.resultActions ||
    experience.nextActions.map((action) => ({
      label: action,
      targetModule: "工作台",
      description: "生成结果后继续处理。",
    }));
  const deliverables =
    outputRefs.length > 0
      ? outputRefs.map((outputRef) => ({
          ...outputRef,
          description: "已经生成的结果会继续按业务类型保存或确认。",
        }))
      : experience.resultCards.map((card) => ({
          label: card.label,
          status: "planned",
          targetModule: card.targetModule,
          description: card.description,
        }));

  return (
    <Card className="border border-default-200 bg-content1 shadow-sm">
      <CardHeader className="flex items-center justify-between gap-3 p-5">
        <div className="flex items-center gap-2">
          <span className="kaypal-v3-icon-tile h-8 w-8">
            <DatabaseZap size={16} />
          </span>
          <div>
            <h2 className="text-lg font-bold text-[var(--kaypal-v3-ink)]">
              结果在这里
            </h2>
            <p className="text-xs text-default-500">
              生成完成后，能保存、跟进或继续处理的内容都会出现在这里。
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {canCloseSolutionPreviewRun(run) ? (
            <Button
              color="primary"
              className="rounded-[8px] font-semibold"
              isLoading={closingPreviewRun}
              startContent={
                closingPreviewRun ? null : <DatabaseZap size={14} />
              }
              onPress={onClosePreviewRun}
            >
              继续生成结果
            </Button>
          ) : null}
          <Chip
            color={run ? runStatus(run.status).color : "default"}
            variant="flat"
          >
            {run ? runStatus(run.status).label : "待生成"}
          </Chip>
        </div>
      </CardHeader>
      <Divider />
      <CardBody className="gap-5 p-5">
        {run ? (
          <div className="rounded-[8px] border border-default-200 bg-default-50 p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-[var(--kaypal-v3-ink)]">
                本次生成
              </span>
              <span className="text-sm font-semibold text-primary">
                {run.progress}%
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-default-100">
              <div
                className="h-full rounded-full bg-success"
                style={{
                  width: `${Math.max(0, Math.min(run.progress, 100))}%`,
                }}
              />
            </div>
          </div>
        ) : null}

        {!run ? (
          <div className="flex flex-col gap-3 rounded-[8px] border border-primary/20 bg-primary/5 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--kaypal-v3-ink)]">
                还没有生成本次结果
              </p>
              <p className="mt-1 text-xs leading-5 text-default-600">
                先在上方写一句目标，点击生成后，这里会显示结果和下一步按钮。
              </p>
            </div>
            <Button
              color="primary"
              variant="flat"
              className="rounded-[8px] font-semibold"
              startContent={<Settings2 size={14} />}
              onPress={onFocusConfiguration}
            >
              去填写目标
            </Button>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-3">
          {deliverables.slice(0, 3).map((deliverable) => (
            <div
              key={`${deliverable.label}-${deliverable.targetModule}`}
              className="rounded-[8px] border border-default-200 bg-default-50 p-3"
            >
              <Chip
                size="sm"
                color={statusTone(deliverable.status)}
                variant="flat"
              >
                {deliverable.status === "planned"
                  ? "待生成"
                  : commercialDisplayText(deliverable.status)}
              </Chip>
              <p className="mt-2 text-sm font-semibold text-[var(--kaypal-v3-ink)]">
                {commercialDisplayText(deliverable.label)}
              </p>
              <p className="mt-1 text-xs text-default-500">
                去向：{commercialDisplayText(deliverable.targetModule)}
              </p>
              <p className="mt-2 text-xs leading-5 text-default-600">
                {commercialDisplayText(deliverable.description)}
              </p>
            </div>
          ))}
        </div>

        {outputDraftResults.length ? (
          <div className="rounded-[8px] border border-primary/20 bg-primary/5 p-4">
            <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm font-semibold text-[var(--kaypal-v3-ink)]">
                  待入库交付物
                </p>
                <p className="text-xs leading-5 text-default-500">
                  这些结果已经生成草稿，确认后会进入素材、选题或内容草稿库。
                </p>
              </div>
              <Chip color="primary" variant="flat">
                {outputDraftResults.reduce(
                  (sum, item) => sum + item.refs.length,
                  0,
                )}{" "}
                个待确认
              </Chip>
            </div>
            <div className="grid gap-2 lg:grid-cols-2">
              {outputDraftResults.map(({ result, refs }) => (
                <div
                  key={result.id}
                  className="flex flex-col gap-3 rounded-[8px] border border-default-200 bg-content1 p-3 lg:flex-row lg:items-center lg:justify-between"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--kaypal-v3-ink)]">
                      {uniqueValues(
                        refs.map((ref) => formatBusinessObject(ref.objectType)),
                      ).join("、")}
                    </p>
                    <p className="mt-1 text-xs text-default-500">
                      {result.nextAction || "确认后写入对应业务库"}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    color="primary"
                    className="rounded-[8px] font-semibold"
                    isLoading={loadingResultId === result.id}
                    startContent={
                      loadingResultId === result.id ? null : (
                        <CheckCircle2 size={14} />
                      )
                    }
                    onPress={() => onConfirmOutputDrafts(result.id)}
                  >
                    确认入库
                  </Button>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {configuredInputEntries.length ? (
          <div className="rounded-[8px] border border-default-200 bg-default-50 p-4">
            <p className="mb-2 text-sm font-semibold text-[var(--kaypal-v3-ink)]">
              本次配置
            </p>
            <div className="flex flex-wrap gap-2">
              {configuredInputEntries.slice(0, 8).map(([key, value]) => (
                <Chip key={key} size="sm" variant="flat">
                  {commercialDisplayText(
                    configuredInputLabels.get(key) ||
                      formatConfigurationKey(key),
                  )}
                  ：
                  {commercialDisplayText(
                    Array.isArray(value) ? value.join("、") : String(value),
                  )}
                </Chip>
              ))}
            </div>
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          <InfoBlock
            icon={<CheckCircle2 size={16} />}
            title="交付状态"
            values={
              acceptanceChecks.length
                ? acceptanceChecks.map(
                    (check) =>
                      `${commercialDisplayText(check.label)}：${check.status === "pending" ? "待验证" : commercialDisplayText(check.status)}`,
                  )
                : item?.acceptance || ["等待生成后展示交付项"]
            }
          />
          <ResultActionBlock
            actions={resultActions}
            run={run}
            configuredInput={configuredInput}
          />
        </div>
      </CardBody>
    </Card>
  );
}

function RunPlanPanel({ plan }: { plan: SolutionRunPlan | null }) {
  if (!plan) {
    return null;
  }

  return (
    <Card className="border border-primary/20 bg-primary/5 shadow-sm">
      <CardHeader className="flex flex-col items-start gap-2 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Chip
              color="primary"
              variant="flat"
              startContent={<Route size={14} />}
            >
              交付步骤
            </Chip>
            <Chip variant="flat">
              {new Date(plan.generatedAt).toLocaleString()}
            </Chip>
          </div>
          <h2 className="text-lg font-bold text-[var(--kaypal-v3-ink)]">
            {commercialDisplayText(plan.packageName)}
          </h2>
          <p className="mt-1 text-sm text-default-500">
            这里展示系统会怎样拆解任务、检查结果和沉淀交付物。
          </p>
        </div>
      </CardHeader>
      <Divider />
      <CardBody className="gap-5 p-5">
        <div className="grid gap-3 lg:grid-cols-2">
          {plan.steps.map((step) => (
            <div
              key={`${plan.packageCode}-${step.order}`}
              className="rounded-[8px] border border-default-200 bg-content1 p-4"
            >
              <div className="flex items-start gap-3">
                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[8px] bg-primary/10 text-sm font-bold text-primary">
                  {step.order}
                </span>
                <div className="min-w-0">
                  <p className="font-semibold text-[var(--kaypal-v3-ink)]">
                    {commercialDisplayText(step.name)}
                  </p>
                  <p className="mt-1 text-xs text-default-500">
                    {step.redfoxSkills.length ? "需要能力服务" : "系统内处理"} ·
                    输出到 {summarizeBusinessObjects(step.outputs).value}
                  </p>
                  <p className="mt-2 text-xs leading-5 text-default-600">
                    检查点：{commercialDisplayText(step.businessCheckpoint)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Chip
                      size="sm"
                      color={step.requiresApproval ? "warning" : "success"}
                      variant="flat"
                    >
                      {step.requiresApproval ? "需要确认" : "自动推进"}
                    </Chip>
                    <Chip size="sm" variant="flat">
                      约 {step.estimatedMinutes} 分钟
                    </Chip>
                    {step.deliverables.slice(0, 2).map((deliverable) => (
                      <Chip key={deliverable} size="sm" variant="flat">
                        {commercialDisplayText(deliverable)}
                      </Chip>
                    ))}
                  </div>
                  {step.redfoxSkills.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {step.redfoxSkills.map((skill) => (
                        <Chip
                          key={skill}
                          color="secondary"
                          size="sm"
                          variant="flat"
                        >
                          {commercialDisplayText(skill)}
                        </Chip>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <InfoBlock
            icon={<CheckCircle2 size={16} />}
            title="交付标准"
            values={plan.acceptance}
          />
          <InfoBlock
            icon={<ShieldCheck size={16} />}
            title="执行警示"
            values={plan.warnings.map(displayPlanWarning)}
          />
        </div>
      </CardBody>
    </Card>
  );
}

function LatestRunPanel({
  run,
  loadingTaskId,
  loadingResultId,
  closingPreviewRun,
  onDryRunTask,
  onApproveManualTask,
  onClosePreviewRun,
  onConfirmOutputDrafts,
}: {
  run: SolutionRunRecord | null;
  loadingTaskId: string | null;
  loadingResultId: string | null;
  closingPreviewRun: boolean;
  onDryRunTask: (taskId: string) => void;
  onApproveManualTask: (taskId: string) => void;
  onClosePreviewRun: () => void;
  onConfirmOutputDrafts: (resultId: string) => void;
}) {
  if (!run) {
    return null;
  }
  const outputDraftResults = pendingOutputDraftResults(run);

  return (
    <Card className="border border-success/20 bg-success/5 shadow-sm">
      <CardHeader className="flex flex-col items-start gap-2 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Chip
              color="success"
              variant="flat"
              startContent={<DatabaseZap size={14} />}
            >
              本次结果
            </Chip>
            <Chip variant="flat">{run.tasks.length} 个处理项</Chip>
          </div>
          <h2 className="text-lg font-bold text-[var(--kaypal-v3-ink)]">
            {commercialDisplayText(run.packageName)}
          </h2>
          <p className="mt-1 text-sm text-default-500">
            结果编号：{run.id.slice(0, 8)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canCloseSolutionPreviewRun(run) ? (
            <Button
              color="primary"
              variant="solid"
              className="rounded-[8px] font-semibold"
              isLoading={closingPreviewRun}
              startContent={
                closingPreviewRun ? null : <CheckCircle2 size={14} />
              }
              onPress={onClosePreviewRun}
            >
              继续生成结果
            </Button>
          ) : null}
          <Chip color={runStatus(run.status).color} variant="flat">
            {runStatus(run.status).label}
          </Chip>
          <Chip variant="flat">结果可追溯</Chip>
        </div>
      </CardHeader>
      <Divider />
      <CardBody className="gap-4 p-5">
        <div className="rounded-[8px] border border-default-200 bg-default-50 p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-[var(--kaypal-v3-ink)]">
              生成进度
            </span>
            <span className="text-sm font-semibold text-primary">
              {run.progress}%
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-default-100">
            <div
              className="h-full rounded-full bg-success"
              style={{ width: `${Math.max(0, Math.min(run.progress, 100))}%` }}
            />
          </div>
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          {run.tasks.map((task) => (
            <div
              key={task.id}
              className="rounded-[8px] border border-default-200 bg-content1 p-4"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-[var(--kaypal-v3-ink)]">
                  {task.order}. {commercialDisplayText(task.name)}
                </span>
                <Chip
                  size="sm"
                  color={taskStatus(task.status).color}
                  variant="flat"
                >
                  {taskStatus(task.status).label}
                </Chip>
              </div>
              <p className="text-xs text-default-500">
                交付：{formatBusinessObject(task.targetObject)}
              </p>
              {task.errorMessage ? (
                <p className="mt-2 rounded-[8px] bg-danger/10 p-2 text-xs leading-5 text-danger">
                  {commercialDisplayText(task.errorMessage)}
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {task.executorKind === "redfox" ? (
                  <Button
                    size="sm"
                    color="secondary"
                    variant="flat"
                    className="rounded-[8px] font-semibold"
                    isLoading={loadingTaskId === task.id}
                    startContent={
                      loadingTaskId === task.id ? null : <PlugZap size={14} />
                    }
                    onPress={() => onDryRunTask(task.id)}
                  >
                    重新生成
                  </Button>
                ) : null}
                {canApproveSolutionManualTask(task) ? (
                  <Button
                    size="sm"
                    color="primary"
                    variant="flat"
                    className="rounded-[8px] font-semibold"
                    isLoading={loadingTaskId === task.id}
                    startContent={
                      loadingTaskId === task.id ? null : (
                        <CheckCircle2 size={14} />
                      )
                    }
                    onPress={() => onApproveManualTask(task.id)}
                  >
                    确认业务检查
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
        {outputDraftResults.length ? (
          <div className="rounded-[8px] border border-primary/20 bg-primary/5 p-4">
            <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm font-semibold text-[var(--kaypal-v3-ink)]">
                  待入库交付物
                </p>
                <p className="text-xs leading-5 text-default-500">
                  这些结果已经生成草稿，确认后会进入素材、选题或内容草稿库。
                </p>
              </div>
              <Chip color="primary" variant="flat">
                {outputDraftResults.reduce(
                  (sum, item) => sum + item.refs.length,
                  0,
                )}{" "}
                个待确认
              </Chip>
            </div>
            <div className="grid gap-2 lg:grid-cols-2">
              {outputDraftResults.map(({ result, refs }) => (
                <div
                  key={result.id}
                  className="flex flex-col gap-3 rounded-[8px] border border-default-200 bg-content1 p-3 lg:flex-row lg:items-center lg:justify-between"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--kaypal-v3-ink)]">
                      {uniqueValues(
                        refs.map((ref) => formatBusinessObject(ref.objectType)),
                      ).join("、")}
                    </p>
                    <p className="mt-1 text-xs text-default-500">
                      {result.nextAction || "确认后写入对应业务库"}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    color="primary"
                    className="rounded-[8px] font-semibold"
                    isLoading={loadingResultId === result.id}
                    startContent={
                      loadingResultId === result.id ? null : (
                        <CheckCircle2 size={14} />
                      )
                    }
                    onPress={() => onConfirmOutputDrafts(result.id)}
                  >
                    确认入库
                  </Button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function LatestRedfoxDryRunPanel({
  result,
}: {
  result: RedfoxSkillDryRunResult | null;
}) {
  if (!result) {
    return null;
  }

  return (
    <Card className="border border-secondary/20 bg-secondary/5 shadow-sm">
      <CardHeader className="flex flex-col items-start gap-2 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Chip
              color="secondary"
              variant="flat"
              startContent={<PlugZap size={14} />}
            >
              能力生成检查
            </Chip>
            <Chip color={runStatus(result.status).color} variant="flat">
              {runStatus(result.status).label}
            </Chip>
            <Chip variant="flat">用量预估 {result.estimatedCostPoints}</Chip>
          </div>
          <h2 className="text-lg font-bold text-[var(--kaypal-v3-ink)]">
            {commercialDisplayText(result.skill.name)}
          </h2>
          <p className="mt-1 text-sm text-default-500">
            已生成检查结果，正式启用前仍需要确认。
          </p>
        </div>
        <Chip
          color={result.skill.resolved ? "success" : "warning"}
          variant="flat"
        >
          {result.skill.resolved ? "交付流程已匹配" : "交付流程待同步"}
        </Chip>
      </CardHeader>
      <Divider />
      <CardBody className="gap-3 p-5">
        <InfoBlock
          icon={<ShieldCheck size={16} />}
          title="启用提示"
          values={result.warnings}
        />
      </CardBody>
    </Card>
  );
}

function RecentRunsPanel({
  runs,
  onSelect,
}: {
  runs: SolutionRunRecord[];
  onSelect: (run: SolutionRunRecord) => void;
}) {
  if (!runs.length) {
    return null;
  }

  return (
    <Card className="border border-default-200 bg-content1 shadow-sm">
      <CardHeader className="flex items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-2">
          <span className="kaypal-v3-icon-tile h-8 w-8">
            <History size={16} />
          </span>
          <div>
            <h2 className="text-base font-bold text-[var(--kaypal-v3-ink)]">
              最近生成结果
            </h2>
            <p className="text-xs text-default-500">点一条查看当时的交付结果</p>
          </div>
        </div>
      </CardHeader>
      <Divider />
      <CardBody className="gap-2 p-3">
        {runs.slice(0, 5).map((run) => {
          const actionMeta = getPrimaryActionMeta(run.packageCode);
          const experience = getBusinessActionExperienceByCode(run.packageCode);
          const resultTargets = experience.resultCards
            .slice(0, 2)
            .map((card) => card.targetModule)
            .join("、");

          return (
            <button
              key={run.id}
              type="button"
              className="rounded-[8px] border border-default-200 bg-default-50 p-3 text-left transition hover:border-primary/40 hover:bg-primary/5"
              onClick={() => onSelect(run)}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold text-[var(--kaypal-v3-ink)]">
                  {actionMeta?.title || commercialDisplayText(run.packageName)}
                </span>
                <Chip
                  size="sm"
                  color={runStatus(run.status).color}
                  variant="flat"
                >
                  {runStatus(run.status).label}
                </Chip>
              </div>
              <p className="line-clamp-2 text-xs leading-5 text-default-500">
                {experience.resultTitle} · 去向：{resultTargets || "业务库"}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Chip size="sm" color="primary" variant="flat">
                  {run.progress}% 完成
                </Chip>
                <span className="truncate text-xs text-default-400">
                  {new Date(run.createdAt).toLocaleString()}
                </span>
              </div>
            </button>
          );
        })}
      </CardBody>
    </Card>
  );
}

function EmptyState({ loading }: { loading: boolean }) {
  return (
    <Card className="border border-default-200 bg-content1 shadow-sm">
      <CardBody className="items-center justify-center gap-3 py-12 text-center">
        {loading ? (
          <Spinner color="primary" />
        ) : (
          <FileText className="h-8 w-8 text-default-400" />
        )}
        <p className="text-sm text-default-500">
          {loading ? "正在读取组合方案" : "暂无可用组合方案"}
        </p>
      </CardBody>
    </Card>
  );
}

export default function SolutionsPage() {
  const [filter, setFilter] = useState<FilterKey>("core");
  const [items, setItems] = useState<SolutionPackageDefinition[]>([]);
  const [mappingCoverage, setMappingCoverage] =
    useState<SolutionRedfoxMappingCoverageResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingRunCode, setLoadingRunCode] = useState<string | null>(null);
  const [loadingTaskId, setLoadingTaskId] = useState<string | null>(null);
  const [loadingResultId, setLoadingResultId] = useState<string | null>(null);
  const [closingPreviewRun, setClosingPreviewRun] = useState(false);
  const [runPlan] = useState<SolutionRunPlan | null>(null);
  const [latestRun, setLatestRun] = useState<SolutionRunRecord | null>(null);
  const [recentRuns, setRecentRuns] = useState<SolutionRunRecord[]>([]);
  const [latestRedfoxRun, setLatestRedfoxRun] =
    useState<RedfoxSkillDryRunResult | null>(null);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [solutionInput, setSolutionInput] = useState<SolutionInputState>({});
  const [skillRunStates, setSkillRunStates] = useState<
    Record<string, CommercialSkillRunState>
  >({});
  const [activeSkillRunKey, setActiveSkillRunKey] = useState<string | null>(
    null,
  );
  const skillRunTimersRef = useRef<
    Record<string, ReturnType<typeof setTimeout>>
  >({});
  const configurationSectionRef = useRef<HTMLDivElement | null>(null);
  const resultSectionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return () => {
      Object.values(skillRunTimersRef.current).forEach((timer) =>
        clearTimeout(timer),
      );
      skillRunTimersRef.current = {};
    };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getSolutionPackages()
      .then((result) => {
        if (!active) return;
        setItems(result.items);
      })
      .catch((error) => {
        if (!active) return;
        toast.error(toPublicError(error, "组合方案暂时无法读取，请重新加载。"));
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    getSolutionRuns()
      .then((result) => {
        if (!active) return;
        setRecentRuns(result.items.slice(0, 5));
      })
      .catch(() => {
        if (!active) return;
        setRecentRuns([]);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!showAdminDiagnostics) {
      setMappingCoverage(null);
      return;
    }
    let active = true;
    getSolutionRedfoxMappingCoverage()
      .then((result) => {
        if (!active) return;
        setMappingCoverage(result);
      })
      .catch(() => {
        if (!active) return;
        setMappingCoverage(null);
      });

    return () => {
      active = false;
    };
  }, []);

  const groupedItems = useMemo(() => {
    return {
      core: items.filter((item) => item.category === "core"),
      redfoxPool: items.filter((item) => item.category === "redfox_pool"),
    };
  }, [items]);
  const selectableItems = useMemo(() => {
    return filter === "core" ? groupedItems.core : groupedItems.redfoxPool;
  }, [filter, groupedItems.core, groupedItems.redfoxPool]);
  const selectedItem = useMemo(() => {
    const preferredItem =
      primaryActionCards
        .map((action) => items.find((item) => item.code === action.code))
        .find((item): item is SolutionPackageDefinition => Boolean(item)) ||
      null;

    return (
      items.find((item) => item.code === selectedCode) ||
      preferredItem ||
      groupedItems.core[0] ||
      groupedItems.redfoxPool[0] ||
      null
    );
  }, [groupedItems.core, groupedItems.redfoxPool, items, selectedCode]);
  const currentActionRun = useMemo(() => {
    if (!latestRun || !selectedItem) return null;
    return latestRun.packageCode === selectedItem.code ? latestRun : null;
  }, [latestRun, selectedItem]);

  const scrollToConfiguration = () => {
    window.requestAnimationFrame(() => {
      configurationSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  };

  const scrollToResult = () => {
    window.requestAnimationFrame(() => {
      resultSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  };

  const handleSelectSolutionCode = (code: string) => {
    setSelectedCode(code);
    setLatestRedfoxRun(null);
    scrollToConfiguration();
  };

  useEffect(() => {
    if (!items.length) {
      setSelectedCode(null);
      return;
    }
    if (!selectedCode || !items.some((item) => item.code === selectedCode)) {
      const preferredItem =
        primaryActionCards
          .map((action) => items.find((item) => item.code === action.code))
          .find((item): item is SolutionPackageDefinition => Boolean(item)) ||
        items[0];
      setSelectedCode(preferredItem.code);
    }
  }, [items, selectedCode]);

  useEffect(() => {
    setSolutionInput(createDefaultSolutionInput(selectedItem));
  }, [selectedItem]);

  const updateSkillRunState = (
    key: string,
    updater: (
      current: CommercialSkillRunState | undefined,
    ) => CommercialSkillRunState,
  ) => {
    setSkillRunStates((current) => ({
      ...current,
      [key]: updater(current[key]),
    }));
  };

  const pollSkillRunEvents = async (
    key: string,
    sessionId: string,
    afterSeq = 0,
    attempt = 0,
  ) => {
    try {
      const page = await localEngineApi.agentSGetEvents(sessionId, afterSeq);
      const events = page.events as CommercialSkillRunEvent[];
      const latestEvent = [...events]
        .reverse()
        .find((event) => isTerminalSkillRunPhase(mapAgentEventPhase(event)));
      const phase = latestEvent
        ? mapAgentEventPhase(latestEvent)
        : events.length
          ? "running"
          : "running";

      updateSkillRunState(key, (current) => ({
        ...(current || { phase: "running", events: [], artifacts: [] }),
        phase,
        sessionId,
        nextSeq: page.next_seq,
        events: mergeSkillRunEvents(current?.events || [], events),
        updatedAt: new Date().toISOString(),
      }));

      if (isTerminalSkillRunPhase(phase)) {
        try {
          const artifactPage =
            await localEngineApi.agentSGetArtifacts(sessionId);
          updateSkillRunState(key, (current) => ({
            ...(current || { phase, events: [], artifacts: [] }),
            phase,
            sessionId,
            artifacts: artifactPage.artifacts,
            updatedAt: new Date().toISOString(),
          }));
        } catch {
          updateSkillRunState(key, (current) => ({
            ...(current || { phase, events: [], artifacts: [] }),
            phase,
            sessionId,
            updatedAt: new Date().toISOString(),
          }));
        }
        setActiveSkillRunKey((current) => (current === key ? null : current));
        return;
      }

      if (attempt >= 30) {
        updateSkillRunState(key, (current) => ({
          ...(current || { phase: "blocked", events: [], artifacts: [] }),
          phase: "blocked",
          sessionId,
          error: "本机运行超过等待时间，先查看本机服务状态。",
          updatedAt: new Date().toISOString(),
        }));
        setActiveSkillRunKey((current) => (current === key ? null : current));
        return;
      }

      skillRunTimersRef.current[key] = setTimeout(() => {
        void pollSkillRunEvents(key, sessionId, page.next_seq, attempt + 1);
      }, 1200);
    } catch (error) {
      updateSkillRunState(key, (current) => ({
        ...(current || { phase: "failed", events: [], artifacts: [] }),
        phase: "failed",
        sessionId,
        error: toPublicError(error, "任务进度暂时无法读取，请重新加载。"),
        updatedAt: new Date().toISOString(),
      }));
      setActiveSkillRunKey((current) => (current === key ? null : current));
    }
  };

  const handleStartSkillHubRun = async (
    row: SolutionRedfoxMappingCoverageItem,
  ) => {
    if (!selectedItem) return;
    const key = skillRunKey(selectedItem, row);
    const ref = firstSkillHubRef(row);
    if (!ref) {
      toast.error("该能力还没有可直接运行的官方入口");
      return;
    }
    const runInput = buildCommercialSkillRunInput({
      item: selectedItem,
      row,
      ref,
      solutionInput,
    });

    if (skillRunTimersRef.current[key]) {
      clearTimeout(skillRunTimersRef.current[key]);
      delete skillRunTimersRef.current[key];
    }

    try {
      setActiveSkillRunKey(key);
      updateSkillRunState(key, () => ({
        phase: "checking",
        events: [],
        artifacts: [],
        updatedAt: new Date().toISOString(),
      }));

      const status = await localEngineApi.agentSEnsureRunning();
      if (!status.connected && status.phase !== "ready") {
        updateSkillRunState(key, (current) => ({
          ...(current || { events: [], artifacts: [] }),
          phase: "blocked",
          error: "本机服务未就绪，请先在本机能力页完成检查。",
          updatedAt: new Date().toISOString(),
        }));
        setActiveSkillRunKey(null);
        return;
      }

      updateSkillRunState(key, (current) => ({
        ...(current || { events: [], artifacts: [] }),
        phase: "starting",
        updatedAt: new Date().toISOString(),
      }));

      const created = await localEngineApi.agentSCreateSession({
        session_name: `${selectedItem.name} · ${row.skillName}`,
        task_type: "redfox.skillhub.run",
        metadata: {
          provider: "redfox-skillhub",
          packageCode: selectedItem.code,
          packageName: selectedItem.name,
          skillNo: ref.skillNo,
          skillCode: ref.skillCode,
          skillName: ref.skillName,
          repoUrl: ref.repoUrl,
          requiresApiKey: ref.requiresApiKey,
          input: runInput,
          outputObjects: row.outputObjects,
        },
        labels: ["redfox", "commercial-solution", "local-capability"],
      });
      const sessionId = getSessionId(created.session);
      if (!sessionId) {
        throw new Error("本机服务没有返回有效任务");
      }

      const run = await localEngineApi.agentSRunTask(sessionId, {
        instruction: [
          `运行方案能力：${row.skillName}`,
          `方案：${selectedItem.name}`,
          `交付目标：${outputSummary(row)}`,
        ].join("\n"),
        task_type: "redfox.skillhub.run",
        metadata: {
          provider: "redfox-skillhub",
          packageCode: selectedItem.code,
          packageName: selectedItem.name,
          skillNo: ref.skillNo,
          skillCode: ref.skillCode,
          skillName: ref.skillName,
          repoUrl: ref.repoUrl,
          requiresApiKey: ref.requiresApiKey,
          input: runInput,
          outputObjects: row.outputObjects,
        },
        risk_level: ref.requiresApiKey ? "medium" : "low",
        requires_approval: false,
      });

      updateSkillRunState(key, (current) => ({
        ...(current || { events: [], artifacts: [] }),
        phase: "running",
        sessionId,
        runId: run.run_id,
        updatedAt: new Date().toISOString(),
      }));
      toast.success("本机运行已启动");
      void pollSkillRunEvents(key, sessionId);
    } catch (error) {
      updateSkillRunState(key, (current) => ({
        ...(current || { events: [], artifacts: [] }),
        phase: "failed",
        error: toPublicError(error, "任务未启动，请重试。"),
        updatedAt: new Date().toISOString(),
      }));
      setActiveSkillRunKey(null);
      toast.error(toPublicError(error, "任务未启动，请重试。"));
    }
  };

  const handleInputChange = (key: string, value: SolutionInputValue) => {
    setSolutionInput((current) => ({ ...current, [key]: value }));
  };

  const handleApplyTemplate = (template: SolutionIndustryTemplate) => {
    setSolutionInput((current) => ({
      ...current,
      ...normalizeTemplateInput(template.defaultInput),
    }));
    toast.success(`${template.name} 已套用`);
  };

  const handleScenarioScopeChange = (scope: FilterKey) => {
    setFilter(scope);
    const nextItem =
      (scope === "core" ? groupedItems.core : groupedItems.redfoxPool)[0] ||
      null;
    if (nextItem) {
      setSelectedCode(nextItem.code);
      setLatestRedfoxRun(null);
      scrollToConfiguration();
    }
  };

  const rememberRun = (run: SolutionRunRecord) => {
    setLatestRun(run);
    setRecentRuns((current) => [
      run,
      ...current.filter((item) => item.id !== run.id),
    ]);
  };

  const handleCreateRun = async (code: string, input: SolutionInputState) => {
    setSelectedCode(code);
    setSolutionInput(input);
    try {
      setLoadingRunCode(code);
      setLatestRedfoxRun(null);
      const run = await createSolutionRun(code, {
        trigger: "manual",
        source: "solutions-combo-workflow",
        input,
        dryRun: false,
      });
      rememberRun(run);

      let currentRun = run;
      let latestSkillResult: RedfoxSkillDryRunResult | null = null;

      for (const originalTask of run.tasks) {
        const task =
          currentRun.tasks.find((item) => item.id === originalTask.id) ||
          originalTask;

        if (task.executorKind === "redfox") {
          setLoadingTaskId(task.id);
          const executed = await executeSolutionTaskRedfox(
            currentRun.id,
            task.id,
            {
              input: input as Record<string, unknown>,
              estimatedCostPoints: 1,
              approvalNote: "用户在方案中心直接生成业务结果。",
            },
          );
          currentRun = executed.run;
          latestSkillResult = executed.redfoxRun;
          rememberRun(currentRun);
          continue;
        }

        if (canApproveSolutionManualTask(task)) {
          setLoadingTaskId(task.id);
          const result = await approveSolutionManualTask(
            currentRun.id,
            task.id,
            {
              approvalNote: "用户在方案中心直接生成业务结果时确认检查点。",
            },
          );
          currentRun = result.run;
          rememberRun(currentRun);
        }
      }

      if (latestSkillResult) {
        setLatestRedfoxRun(latestSkillResult);
      }
      toast.success("业务结果已生成");
      scrollToResult();
    } catch (error) {
      toast.error(toPublicError(error, "业务结果未生成，请调整输入后重试。"));
    } finally {
      setLoadingRunCode(null);
      setLoadingTaskId(null);
    }
  };

  const handleDryRunTask = async (taskId: string) => {
    if (!latestRun) return;
    try {
      setLoadingTaskId(taskId);
      const preview = await dryRunSolutionTaskRedfox(latestRun.id, taskId, {
        estimatedCostPoints: 1,
      });
      let currentRun = preview.run;
      let latestSkillResult = preview.redfoxRun;
      const updatedTask =
        currentRun.tasks.find((item) => item.id === taskId) || null;
      if (
        updatedTask &&
        ["dry_run_ready", "approval_required", "failed"].includes(
          updatedTask.status,
        )
      ) {
        const executed = await executeSolutionTaskRedfox(
          currentRun.id,
          taskId,
          {
            estimatedCostPoints: preview.redfoxRun.estimatedCostPoints || 1,
            approvalNote: "用户在方案中心重新生成该步骤。",
          },
        );
        currentRun = executed.run;
        latestSkillResult = executed.redfoxRun;
      }
      setLatestRun(currentRun);
      setRecentRuns((current) => [
        currentRun,
        ...current.filter((item) => item.id !== currentRun.id),
      ]);
      setLatestRedfoxRun(latestSkillResult);
      toast.success("该步骤已生成");
    } catch (error) {
      toast.error(toPublicError(error, "当前步骤未生成，请重试。"));
    } finally {
      setLoadingTaskId(null);
    }
  };

  const handleApproveManualTask = async (taskId: string) => {
    if (!latestRun) return;
    try {
      setLoadingTaskId(taskId);
      const result = await approveSolutionManualTask(latestRun.id, taskId, {
        approvalNote: "页面确认该人工检查点已完成，继续生成结果。",
      });
      setLatestRun(result.run);
      setRecentRuns((current) => [
        result.run,
        ...current.filter((item) => item.id !== result.run.id),
      ]);
      toast.success("人工检查点已确认");
    } catch (error) {
      toast.error(toPublicError(error, "检查点未确认，请重试。"));
    } finally {
      setLoadingTaskId(null);
    }
  };

  const handleClosePreviewRun = async () => {
    if (!latestRun) return;
    if (!canCloseSolutionPreviewRun(latestRun)) {
      toast.success("当前结果已经生成完毕");
      return;
    }

    setClosingPreviewRun(true);
    let currentRun = latestRun;
    let latestDryRun: RedfoxSkillDryRunResult | null = null;

    try {
      for (const originalTask of latestRun.tasks) {
        const task =
          currentRun.tasks.find((item) => item.id === originalTask.id) ||
          originalTask;
        if (canDryRunSolutionTask(task)) {
          setLoadingTaskId(task.id);
          const preview = await dryRunSolutionTaskRedfox(
            currentRun.id,
            task.id,
            {
              estimatedCostPoints: 1,
            },
          );
          currentRun = preview.run;
          latestDryRun = preview.redfoxRun;
          const updatedTask =
            currentRun.tasks.find((item) => item.id === task.id) || task;
          if (
            ["dry_run_ready", "approval_required", "failed"].includes(
              updatedTask.status,
            )
          ) {
            const executed = await executeSolutionTaskRedfox(
              currentRun.id,
              task.id,
              {
                estimatedCostPoints: preview.redfoxRun.estimatedCostPoints || 1,
                approvalNote: "用户在方案中心继续生成剩余业务结果。",
              },
            );
            currentRun = executed.run;
            latestDryRun = executed.redfoxRun;
          }
          const updatedRun = currentRun;
          setLatestRun(updatedRun);
          setRecentRuns((runs) => [
            updatedRun,
            ...runs.filter((item) => item.id !== updatedRun.id),
          ]);
          continue;
        }
        if (canApproveSolutionManualTask(task)) {
          setLoadingTaskId(task.id);
          const result = await approveSolutionManualTask(
            currentRun.id,
            task.id,
            {
              approvalNote: "继续生成结果时确认该人工检查点。",
            },
          );
          currentRun = result.run;
          const updatedRun = result.run;
          setLatestRun(updatedRun);
          setRecentRuns((runs) => [
            updatedRun,
            ...runs.filter((item) => item.id !== updatedRun.id),
          ]);
        }
      }
      if (latestDryRun) {
        setLatestRedfoxRun(latestDryRun);
      }
      toast.success("剩余结果已生成");
    } catch (error) {
      toast.error(toPublicError(error, "剩余结果未生成，请重试。"));
    } finally {
      setLoadingTaskId(null);
      setClosingPreviewRun(false);
    }
  };

  const handleConfirmOutputDrafts = async (resultId: string) => {
    if (!latestRun) return;
    try {
      setLoadingResultId(resultId);
      const result = await confirmSolutionOutputDrafts(latestRun.id, resultId, {
        confirmPersistence: OUTPUT_DRAFT_CONFIRMATION_TOKEN,
        objectTypes: ["Material", "Topic", "Article"],
      });
      const refreshedRun = await getSolutionRun(latestRun.id);
      setLatestRun(refreshedRun);
      setRecentRuns((current) => [
        refreshedRun,
        ...current.filter((item) => item.id !== refreshedRun.id),
      ]);
      toast.success(`已入库 ${result.createdRefs.length} 个交付物`);
    } catch (error) {
      toast.error(toPublicError(error, "交付物未保存，请重试。"));
    } finally {
      setLoadingResultId(null);
    }
  };

  return (
    <Layout height="fill">
      <LayoutContent padding={6}>
          <VStack gap={3}>
            <VStack gap={2}>
              <HStack gap={2} vAlign="center">
                <Text color="secondary" type="supporting">
                  商业增长 · 组合方案
                </Text>
              </HStack>
              <Heading level={1}>组合方案</Heading>
              <Text color="secondary">
                日常功能已经拆到左侧业务模块。这里专门处理跨模块的组合结果：情报、内容、线索、合规和增长动作一次串起来。
              </Text>
              <div className="flex flex-wrap gap-2">
                {scenarioEntryLinks.map((entry) => (
                  <Button
                    key={entry.href}
                    as={Link}
                    href={entry.href}
                    size="sm"
                    variant="flat"
                    className="rounded-[8px] font-semibold"
                    endContent={<ArrowRight size={14} />}
                  >
                    {entry.title}
                    <span className="text-default-500"> · {entry.module}</span>
                  </Button>
                ))}
              </div>
            </VStack>
          </VStack>
        </LayoutContent>
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-5 pb-10">

      <TaskExperienceFlow
        title="从目标到交付的任务流程"
        description="先选择业务目标，再让 AI 辅助生成候选结果；执行前检查数据、账号和风险，确认后进入任务记录，失败有处理动作，完成后沉淀到对应业务页。"
        primaryHref="#solution-workbench"
        primaryLabel="选择方案"
      />

      <div id="solution-workbench">
        <SkillActionWorkbench
          items={items}
          selectableItems={selectableItems}
          selectedItem={selectedItem}
          loading={loading}
          scenarioScope={filter}
          onSelect={handleSelectSolutionCode}
          onScenarioScopeChange={handleScenarioScopeChange}
          onFocusConfiguration={scrollToConfiguration}
        />
      </div>

      <div
        className={
          showAdminDiagnostics
            ? "grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]"
            : "flex flex-col gap-5"
        }
      >
        <main className="flex min-w-0 flex-col gap-5">
          {selectedItem ? (
            <div ref={configurationSectionRef}>
              <SolutionConfigurationPanel
                item={selectedItem}
                input={solutionInput}
                loadingRunCode={loadingRunCode}
                onChange={handleInputChange}
                onApplyTemplate={handleApplyTemplate}
                onGenerate={handleCreateRun}
              />
            </div>
          ) : (
            <EmptyState loading={loading} />
          )}
          {showAdminDiagnostics && selectedItem ? (
            <PackageCard
              item={selectedItem}
              solutionInput={solutionInput}
              loadingRunCode={loadingRunCode}
              onCreateRun={handleCreateRun}
            />
          ) : null}
          {showAdminDiagnostics ? <RunPlanPanel plan={runPlan} /> : null}
          {showAdminDiagnostics ? (
            <LatestRunPanel
              run={latestRun}
              loadingTaskId={loadingTaskId}
              loadingResultId={loadingResultId}
              closingPreviewRun={closingPreviewRun}
              onDryRunTask={handleDryRunTask}
              onApproveManualTask={handleApproveManualTask}
              onClosePreviewRun={handleClosePreviewRun}
              onConfirmOutputDrafts={handleConfirmOutputDrafts}
            />
          ) : null}
          <div ref={resultSectionRef}>
            <BusinessResultCenter
              run={currentActionRun}
              item={selectedItem}
              loadingResultId={loadingResultId}
              closingPreviewRun={closingPreviewRun}
              onFocusConfiguration={scrollToConfiguration}
              onClosePreviewRun={handleClosePreviewRun}
              onConfirmOutputDrafts={handleConfirmOutputDrafts}
            />
          </div>
          {showAdminDiagnostics ? (
            <LatestRedfoxDryRunPanel result={latestRedfoxRun} />
          ) : null}
          {showAdminDiagnostics && selectedItem ? (
            <ProductizationPanel item={selectedItem} />
          ) : null}
        </main>

        {showAdminDiagnostics ? (
          <aside className="flex flex-col gap-4">
            {showAdminDiagnostics && selectedItem ? (
              <MappingCoveragePanel
                item={selectedItem}
                coverage={mappingCoverage}
                runStates={skillRunStates}
                activeRunKey={activeSkillRunKey}
                onStartSkillRun={handleStartSkillHubRun}
              />
            ) : null}
            <RecentRunsPanel
              runs={recentRuns}
              onSelect={(run) => {
                setSelectedCode(run.packageCode);
                setLatestRun(run);
                setLatestRedfoxRun(null);
                scrollToResult();
              }}
            />
          </aside>
        ) : null}
      </div>
    </div>
    </Layout>
  );
}
