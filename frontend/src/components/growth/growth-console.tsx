"use client";

import React from "react";
import Link from "next/link";
import {
  Button,
  Card,
  CardBody,
  Checkbox,
  Chip,
  Divider,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Progress,
  Select,
  SelectItem,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
  Textarea,
} from "@heroui/react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  ClipboardList,
  Copy,
  Download,
  Edit3,
  ExternalLink,
  Eye,
  FileText,
  Filter,
  HeartPulse,
  Network,
  PauseCircle,
  Play,
  Plus,
  RefreshCw,
  Route,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  Unlock,
  UsersRound,
  XCircle,
} from "lucide-react";
import toast from "@/lib/toast";
import { buildRiskConfirmation } from "@/lib/api/auto-upload";
import {
  growthApi,
  type GrowthAccountHealth,
  type GrowthAcquisitionConfig,
  type GrowthAcquisitionMode,
  type GrowthAcquisitionPreflight,
  type GrowthAcquisitionRun,
  type GrowthLead,
  type GrowthLeadDedupeMatch,
  type GrowthLeadStatus,
  type GrowthOverview,
  type GrowthPlatform,
  type GrowthReportQuery,
  type GrowthReports,
  type GrowthRiskMode,
  type GrowthSchedulePlan,
  type GrowthStrategyTemplate,
  type GrowthWorkflow,
} from "@/lib/api/growth";
import {
  aiEmployeeApi,
  type AiEmployeeCapability,
  type AiEmployeeCoreTaskType,
  type AiEmployeeCapabilitiesSnapshot,
} from "@/lib/api/ai-employee";
import { AgentStatusDrawer } from "@/components/agent-status-drawer";
import type { AgentSession } from "@/lib/api/local-engine";
import { toPublicError } from "@/lib/public-error";
import {
  OpsDenseTable,
  OpsMetric,
  OpsPanel,
  OpsStatusPill,
  OpsToolbar,
} from "@/app/(dashboard)/components/desktop-ops-ui";

type GrowthView =
  | "overview"
  | "acquisition"
  | "strategies"
  | "leads"
  | "account-health"
  | "reports"
  | "workflows";
type WorkflowAction = Parameters<typeof growthApi.workflowAction>[1];
type WorkflowStepDraft = {
  stepId: string;
  stepName: string;
  stepDescription: string;
  stepOutputSummary: string;
  saveBeforeAction: boolean;
};
type WorkflowConfirmState = {
  workflow: GrowthWorkflow;
  action?: WorkflowAction;
  outputSummary?: string;
  actionDraft?: WorkflowStepDraft;
  delete?: boolean;
  title: string;
  message: string;
  danger?: boolean;
};

type BulkLeadConfirmState = {
  status: GrowthLeadStatus;
  leads: GrowthLead[];
  filteredCount: number;
  visibleSelectedCount: number;
};

type ExposurePreviewType = Extract<
  AiEmployeeCoreTaskType,
  | "exposure.auto"
  | "exposure.targeted"
  | "exposure.link"
  | "exposure.search_account"
  | "exposure.retention"
>;

type CapabilityLoadState = "loading" | "ready" | "error";

function displayText(value?: string) {
  return (value || "")
    .replace(/GROWTH_EXECUTION_ENABLED(?:=true)?/gi, "外部动作开关")
    .replace(/GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED(?:=true)?/gi, "自动执行设置")
    .replace(/真实执行器|执行器/gi, "外部动作服务")
    .replace(/能力清单/gi, "功能状态")
    .replace(/后端/gi, "系统")
    .replace(/回读/gi, "结果确认")
    .replace(/阻断项?|门禁/gi, "待处理问题")
    .replace(/预演/gi, "预览")
    .replace(/本地引擎|本机/gi, "当前环境")
    .replace(/连接器/gi, "平台连接")
    .replace(/闭环/gi, "完整流程")
    .replace(/链路/gi, "流程")
    .replace(/dry-run/gi, "预览")
    .trim();
}

const exposureCapabilityKeys: Record<ExposurePreviewType, string> = {
  "exposure.auto": "douyin-hot-video-exposure",
  "exposure.targeted": "douyin-targeted-exposure",
  "exposure.link": "douyin-link-exposure",
  "exposure.search_account": "douyin-search-account-exposure",
  "exposure.retention": "douyin-retention-exposure",
};

function exposureExecutionBoundary(
  capability: AiEmployeeCapability | undefined,
  loadState: CapabilityLoadState,
): {
  canExecute: boolean;
  label: string;
  detail: string;
  color: "default" | "primary" | "success" | "warning" | "danger";
  tone: "default" | "brand" | "success" | "warning" | "danger";
} {
  if (loadState === "loading") {
    return {
      canExecute: false,
      label: "能力检查中",
      detail:
        "正在检查当前玩法能否执行外部动作。检查完成前只允许创建预览任务，不会执行外部采集、评论或私信。",
      color: "default",
      tone: "default",
    };
  }
  if (!capability) {
    if (loadState === "error") {
      return {
        canExecute: false,
        label: "能力检查失败",
        detail:
          "未能读取当前玩法的外部动作状态。为避免误发，当前只允许创建预览任务；请重新检查。",
        color: "danger",
        tone: "danger",
      };
    }
    if (loadState === "ready") {
      return {
        canExecute: false,
        label: "能力未登记",
        detail:
          "当前玩法尚未完成运行配置，外部动作已暂停；请到 AI 员工能力中心查看处理方式。",
        color: "warning",
        tone: "warning",
      };
    }
    return {
      canExecute: false,
      label: "能力未知",
      detail:
        "当前没有可验证的外部动作状态。为避免误发，当前只允许创建预览任务。",
      color: "warning",
      tone: "warning",
    };
  }

  const reason = Array.from(
    new Set(
      [
        displayText(capability.nextAction),
        displayText(capability.message),
        ...(capability.blockers || []).map(displayText),
      ].filter(Boolean),
    ),
  )
    .slice(0, 3)
    .join("；");
  if (capability.status === "real") {
    return {
      canExecute: true,
      label: "外部动作可用",
      detail:
        displayText(capability.message) ||
        "外部动作服务已就绪；执行前仍会检查账号、额度、风控和结果记录。",
      color: "success",
      tone: "success",
    };
  }
  if (capability.status === "simulated") {
    return {
      canExecute: false,
      label: "仅生成预览",
      detail: `${reason || "当前只支持生成安全预览任务。"}；预览任务不会计入真实触达统计。`,
      color: "primary",
      tone: "brand",
    };
  }
  if (capability.status === "needs_config") {
    return {
      canExecute: false,
      label: "外部动作待配置",
      detail: reason || "当前玩法还需要补充账号或运行配置，完成后才能执行外部动作。",
      color: "warning",
      tone: "warning",
    };
  }
  return {
    canExecute: false,
    label: "外部动作不可用",
    detail: reason || "当前玩法暂时不能执行外部动作，请先按提示处理问题。",
    color: "danger",
    tone: "danger",
  };
}

const tablePageSize = 10;

const viewMeta: Record<
  GrowthView,
  {
    title: string;
    desc: string;
    icon: React.ElementType;
  }
> = {
  overview: {
    title: "增长获客总览",
    desc: "统一查看线索、触达、账号风险和近期获客任务。",
    icon: Target,
  },
  acquisition: {
    title: "自动获客矩阵",
    desc: "创建获客任务，完成安全检查和到期检查后，再查看任务与结果。",
    icon: Search,
  },
  strategies: {
    title: "获客策略中心",
    desc: "行业模板、关键词、排除词和话术池统一管理。",
    icon: ClipboardList,
  },
  leads: {
    title: "线索池",
    desc: "自动获客、评论、私信沉淀的增长漏斗资产。",
    icon: UsersRound,
  },
  "account-health": {
    title: "账号健康中心",
    desc: "账号登录、失败率、风控状态和冷却建议。",
    icon: HeartPulse,
  },
  reports: {
    title: "增长复盘",
    desc: "漏斗、话术表现、账号表现和任务表现。",
    icon: BarChart3,
  },
  workflows: {
    title: "增长工作流",
    desc: "把策略、内容、发布、获客、跟进、复盘串成 SOP。",
    icon: Route,
  },
};

const modes: Array<{
  key: GrowthAcquisitionMode;
  label: string;
}> = [
  {
    key: "keyword",
    label: "关键词获客",
  },
  {
    key: "search-account",
    label: "搜索账号获客",
  },
  {
    key: "video-link",
    label: "视频链接获客",
  },
  {
    key: "target-account",
    label: "目标账号获客",
  },
  {
    key: "retention",
    label: "留资线索获客",
  },
  {
    key: "manual-import",
    label: "手动导入获客",
  },
];

const modeGuidance: Record<
  GrowthAcquisitionMode,
  {
    sourceLabel: string;
    sourcePlaceholder: string;
    sourceHelp: string;
    intentHelp: string;
    riskHelp: string;
  }
> = {
  keyword: {
    sourceLabel: "来源关键词",
    sourcePlaceholder: "每行一个关键词，例如：装修\n旧房翻新\n全屋定制",
    sourceHelp: "适合持续发现评论区、搜索页或内容池里的潜在线索。",
    intentHelp: "建议填写需求词、价格词、地域词，用来筛掉泛流量。",
    riskHelp: "关键词任务容易扩大候选面，建议先用人工确认后触达。",
  },
  "search-account": {
    sourceLabel: "搜索关键词",
    sourcePlaceholder: "每行一个账号搜索词，例如：装修设计师\n同城家装",
    sourceHelp:
      "适合从真实搜索页读取账号候选，结果会单独留存，不会自动当成客户私信。",
    intentHelp: "可填写昵称或行业筛选词，并用黑名单排除同行和无关账号。",
    riskHelp: "账号搜索会消耗当日额度；只有取得匹配结果和记录才记为完成。",
  },
  "video-link": {
    sourceLabel: "视频链接",
    sourcePlaceholder: "每行一个视频链接，优先放近期有互动的视频。",
    sourceHelp: "适合围绕指定内容的评论、互动证据做线索筛选。",
    intentHelp: "建议填写评论里的咨询、预算、购买意向词。",
    riskHelp: "链接任务依赖平台可访问性，检查会先确认账号和额度。",
  },
  "target-account": {
    sourceLabel: "目标账号",
    sourcePlaceholder: "每行一个主页链接、账号 ID 或昵称。",
    sourceHelp: "适合跟踪竞品、达人、同城账号下的公开互动线索。",
    intentHelp: "建议用需求词配合黑名单，避免误采同行和招商号。",
    riskHelp: "目标账号任务更容易触发频控，单目标上限建议保持为 1。",
  },
  retention: {
    sourceLabel: "互动或客户主页链接",
    sourcePlaceholder: "每行一个明确的抖音视频互动链接或客户主页链接。",
    sourceHelp: "只有能确认评论作者或客户主页的明确来源才会形成跟进对象。",
    intentHelp: "建议填写活动名、来源渠道、预约意向等分层词。",
    riskHelp:
      "普通搜索词、手机号或表单备注不会直接映射为抖音客户，触达前仍需人工确认。",
  },
  "manual-import": {
    sourceLabel: "手动候选",
    sourcePlaceholder: "每行一个候选线索、来源备注或人工筛选记录。",
    sourceHelp: "适合把人工整理的候选线索纳入同一套检查、去重和复盘。",
    intentHelp: "建议填写来源批次、需求标签和跟进优先级。",
    riskHelp: "手动导入任务默认不触发外部采集，需人工确认后再处理。",
  },
};

const exposurePreviewDefinitions: Array<{
  type: ExposurePreviewType;
  title: string;
  mode: GrowthAcquisitionMode;
  sourceLabel: string;
  sourcePlaceholder: string;
  sourceExample: string;
  goal: string;
  riskLabel: string;
  riskMode: GrowthRiskMode;
  dailyLimit: string;
}> = [
  {
    type: "exposure.auto",
    title: "自动曝光",
    mode: "keyword",
    sourceLabel: "来源关键词",
    sourcePlaceholder: "每行一个关键词，例如：装修、全屋定制、同城服务",
    sourceExample: "装修\n旧房翻新\n全屋定制",
    goal: "按关键词发现公开互动线索，先做候选筛选和结果留存。",
    riskLabel: "中风险",
    riskMode: "confirm-first",
    dailyLimit: "20",
  },
  {
    type: "exposure.targeted",
    title: "定向曝光",
    mode: "target-account",
    sourceLabel: "目标账号",
    sourcePlaceholder: "每行一个账号主页、昵称或账号编号",
    sourceExample: "同城装修设计\n家装案例账号\n本地生活达人",
    goal: "围绕指定账号下的公开互动做线索筛选，避免泛流量误触。",
    riskLabel: "中风险",
    riskMode: "confirm-first",
    dailyLimit: "15",
  },
  {
    type: "exposure.link",
    title: "链接曝光",
    mode: "video-link",
    sourceLabel: "视频或内容链接",
    sourcePlaceholder: "每行一个公开视频链接",
    sourceExample: "https://example.com/video-01\nhttps://example.com/video-02",
    goal: "围绕指定链接读取互动线索，先校验链接、账号和浏览器可用性。",
    riskLabel: "中风险",
    riskMode: "confirm-first",
    dailyLimit: "10",
  },
  {
    type: "exposure.search_account",
    title: "搜索账号曝光",
    mode: "search-account",
    sourceLabel: "搜索关键词",
    sourcePlaceholder: "每行一个搜索词或账号筛选条件",
    sourceExample: "装修设计师\n同城家装\n软装顾问",
    goal: "通过搜索结果筛选目标账号，生成候选结果后再决定是否跟进。",
    riskLabel: "中风险",
    riskMode: "confirm-first",
    dailyLimit: "15",
  },
  {
    type: "exposure.retention",
    title: "留痕曝光",
    mode: "retention",
    sourceLabel: "明确互动或客户主页",
    sourcePlaceholder: "每行一个抖音视频互动链接或已确认客户主页链接",
    sourceExample:
      "https://www.douyin.com/video/7390000000000000011\nhttps://www.douyin.com/user/MS4wLjABAAAAexample001",
    goal: "只对有明确互动或客户主页证据的对象做低频跟进，高影响动作必须确认。",
    riskLabel: "高风险",
    riskMode: "confirm-first",
    dailyLimit: "8",
  },
];

type ExposurePreviewDefinition = (typeof exposurePreviewDefinitions)[number];

function getModeLabel(mode: GrowthAcquisitionMode | string) {
  return modes.find((item) => item.key === mode)?.label || mode;
}

function getExposureDefinitionFromTaskName(taskName?: string) {
  const normalized = taskName || "";
  return exposurePreviewDefinitions.find((definition) =>
    normalized.includes(definition.title),
  );
}

function getTaskExposureLabel(
  taskName: string | undefined,
  mode: GrowthAcquisitionMode | string,
) {
  return (
    getExposureDefinitionFromTaskName(taskName)?.title || getModeLabel(mode)
  );
}

function getConfigExposureDefinition(config: GrowthAcquisitionConfig) {
  return getExposureDefinitionFromTaskName(config.taskName);
}

function getConfigExposureLabel(config: GrowthAcquisitionConfig) {
  return getTaskExposureLabel(config.taskName, config.mode);
}

function isConfigForExposureDefinition(
  config: GrowthAcquisitionConfig,
  definition: ExposurePreviewDefinition,
) {
  return getConfigExposureDefinition(config)?.type === definition.type;
}

function isRunForExposureDefinition(
  run: GrowthAcquisitionRun,
  configs: GrowthAcquisitionConfig[],
  definition: ExposurePreviewDefinition,
) {
  const config = configs.find((item) => item.id === run.configId);
  if (config) return isConfigForExposureDefinition(config, definition);
  const sameModeDefinitions = exposurePreviewDefinitions.filter(
    (item) => item.mode === definition.mode,
  );
  return sameModeDefinitions.length === 1 && run.mode === definition.mode;
}

function getRunExposureLabel(
  run: GrowthAcquisitionRun,
  configs: GrowthAcquisitionConfig[],
) {
  const config = configs.find((item) => item.id === run.configId);
  return config ? getConfigExposureLabel(config) : getModeLabel(run.mode);
}

const platformLabels: Record<string, string> = {
  douyin: "抖音",
  "wechat-channel": "视频号",
  wechat: "微信",
  wecom: "企微",
  xiaohongshu: "小红书",
  kuaishou: "快手",
};

const statusLabels: Record<string, string> = {
  enabled: "启用",
  disabled: "停用",
  running: "执行中",
  queued: "已排队",
  success: "全部成功",
  partial: "部分成功",
  failed: "执行失败",
  skipped: "未执行",
};

function runStatusTone(
  status: GrowthAcquisitionRun["status"],
): "default" | "brand" | "success" | "warning" | "danger" {
  if (status === "success") return "success";
  if (status === "queued") return "brand";
  if (status === "running" || status === "partial") return "warning";
  if (status === "failed" || status === "skipped") return "danger";
  return "default";
}

function runStatusChipColor(
  status: GrowthAcquisitionRun["status"],
): "default" | "primary" | "success" | "warning" | "danger" {
  if (status === "success") return "success";
  if (status === "queued") return "primary";
  if (status === "running" || status === "partial") return "warning";
  if (status === "failed" || status === "skipped") return "danger";
  return "default";
}

function runExecutionBoundaryLabel(run: GrowthAcquisitionRun) {
  if (run.status === "queued") return "等待外部动作";
  if (run.status === "running") return "外部动作进行中";
  if (run.contactedCount > 0) return "真实触达";
  if (
    run.status === "skipped" ||
    /安全演练|未触发|只生成草稿|阻止.*执行|需要.*确认|达到上限/.test(
      `${run.message || ""} ${run.failureReason || ""}`,
    )
  ) {
    return "未执行外部动作";
  }
  if (
    run.mode === "search-account" &&
    (run.status === "success" || run.status === "partial")
  ) {
    return "真实采集，未触达";
  }
  if (run.status === "success" || run.status === "partial") {
    return "外部动作结果";
  }
  return "执行失败，查看证据";
}

function runOutcomeDetail(run: GrowthAcquisitionRun) {
  if (run.status === "queued") {
    return "任务已进入执行队列，尚未产生外部动作或最终结果。";
  }
  if (run.status === "running") {
    return "任务正在处理，成功、失败和真实触达数量仍在更新。";
  }
  if (run.status === "success") {
    if (run.contactedCount > 0) {
      return `全部成功：已真实触达 ${run.contactedCount}/${Math.max(run.selectedCount, run.contactedCount)} 个目标。`;
    }
    if (run.mode === "search-account") {
      return `采集完成：已留存 ${run.selectedCount} 条账号候选，本玩法没有执行客户评论或私信。`;
    }
    return "执行已完成，本次没有产生客户触达；请结合处理说明和证据确认结果。";
  }
  if (run.status === "partial") {
    return `部分成功：已真实触达 ${run.contactedCount}/${Math.max(run.selectedCount, run.contactedCount)} 个目标；未成功目标不计入触达，请查看失败说明。`;
  }
  if (run.status === "skipped") {
    return `未执行：${displayText(run.message) || run.failureReason || "执行条件未满足"}；本次不计入真实触达。`;
  }
  return run.contactedCount > 0
    ? `执行失败：已有 ${run.contactedCount} 个目标确认触达，其余目标失败；请查看失败原因和证据。`
    : `执行失败：未确认成功触达。${displayText(run.message) || run.failureReason || "请查看任务记录。"}`;
}

function notifyRunResult(run: GrowthAcquisitionRun) {
  const message = `${statusLabels[run.status] || run.status}：${displayText(run.message) || runOutcomeDetail(run)}`;
  if (run.status === "success") {
    toast.success(message);
    return;
  }
  if (run.status === "failed") {
    toast.error(message);
    return;
  }
  toast(message);
}

const riskModeLabels: Record<string, string> = {
  "confirm-first": "人工确认后触达",
  "draft-only": "只生成线索草稿",
  auto: "自动触达",
};

const loginStatusLabels: Record<string, string> = {
  online: "在线",
  expired: "已过期",
  "verification-required": "需验证",
  unknown: "未知",
};

const riskStatusLabels: Record<string, string> = {
  normal: "正常",
  cooldown: "冷却中",
  paused: "已暂停",
  "needs-human": "需人工处理",
};

const cooldownOptions = [
  {
    key: "30",
    label: "30 分钟",
  },
  {
    key: "60",
    label: "1 小时",
  },
  {
    key: "180",
    label: "3 小时",
  },
  {
    key: "360",
    label: "6 小时",
  },
  {
    key: "1440",
    label: "24 小时",
  },
];

const leadStatusLabels: Record<GrowthLeadStatus, string> = {
  new: "新线索",
  contacted: "已触达",
  replied: "已回复",
  qualified: "已合格",
  converted: "已转化",
  ignored: "已忽略",
  blocked: "已拉黑",
};

const leadSourceLabels: Record<string, string> = {
  "auto-acquisition": "自动获客",
  comment: "评论",
  "direct-message": "私信",
  "wechat-group": "微信群",
  "wechat-moments": "朋友圈",
  "manual-import": "手动导入",
};

const leadStatusFlow: GrowthLeadStatus[] = [
  "contacted",
  "qualified",
  "converted",
  "ignored",
  "blocked",
];

const workflowStatusLabels: Record<GrowthWorkflow["status"], string> = {
  draft: "草稿",
  enabled: "已启用",
  running: "运行中",
  paused: "已暂停",
  completed: "已完成",
  failed: "异常",
};

const workflowStepStatusLabels: Record<
  GrowthWorkflow["steps"][number]["status"],
  string
> = {
  pending: "待处理",
  running: "进行中",
  completed: "已完成",
  failed: "异常",
  "waiting-confirmation": "等待确认",
};

const workflowStepTypeLabels: Record<string, string> = {
  strategy: "策略",
  content: "内容",
  publish: "发布",
  acquisition: "获客",
  "follow-up": "跟进",
  report: "复盘",
};

const workflowTemplates = [
  {
    key: "content-to-growth",
    label: "内容到获客流程",
    desc: "从内容准备、发布确认、获客检查、线索跟进到增长复盘。",
  },
  {
    key: "keyword-lead-nurture",
    label: "关键词线索培育 SOP",
    desc: "围绕关键词池、线索检查、人工筛选和跟进备注做稳态获客。",
  },
  {
    key: "campaign-review",
    label: "活动获客复盘流程",
    desc: "覆盖活动目标、素材检查、获客确认、线索分层和复盘沉淀。",
  },
];

const workflowTemplateLabels = Object.fromEntries(
  workflowTemplates.map((item) => [item.key, item.label]),
);

const scheduleStatusLabels: Record<
  GrowthSchedulePlan["items"][number]["status"],
  string
> = {
  ready: "自动可执行",
  "waiting-confirmation": "待人工确认",
  "waiting-time": "等待时间",
  blocked: "需处理",
  exhausted: "达上限",
  disabled: "已停用",
};

const leadStatusOptions = [
  {
    key: "all",
    label: "全部状态",
  },
  ...Object.entries(leadStatusLabels).map(([key, label]) => ({
    key,
    label,
  })),
];

const platformOptions = [
  {
    key: "all",
    label: "全部平台",
  },
  ...Object.entries(platformLabels).map(([key, label]) => ({
    key,
    label,
  })),
];

const leadSourceOptions = [
  {
    key: "all",
    label: "全部来源",
  },
  ...Object.entries(leadSourceLabels).map(([key, label]) => ({
    key,
    label,
  })),
];

const leadIntentOptions = [
  {
    key: "all",
    label: "全部意向",
  },
  {
    key: "high",
    label: "高意向",
  },
  {
    key: "follow-up",
    label: "待跟进",
  },
  {
    key: "overdue",
    label: "已逾期",
  },
];

const reportRangeOptions = [
  {
    key: "7d",
    label: "近 7 天",
  },
  {
    key: "30d",
    label: "近 30 天",
  },
  {
    key: "today",
    label: "今天",
  },
  {
    key: "custom",
    label: "自定义",
  },
];

const growthTableClassNames = {
  wrapper: "growth-table-scroll",
  table: "growth-table",
  th: "growth-table-th",
  td: "growth-table-td",
  emptyWrapper: "growth-table-empty",
};

type ReportRangePreset = "today" | "7d" | "30d" | "custom";
type ReportDrilldownKey =
  | "leads"
  | "contacted"
  | "intent"
  | "risk"
  | "candidates"
  | "selected"
  | "crmCaptured"
  | "converted";

const reportDrilldownLabels: Record<ReportDrilldownKey, string> = {
  leads: "新增线索",
  contacted: "已触达",
  intent: "高意向线索",
  risk: "风险账号",
  candidates: "候选线索",
  selected: "筛选线索",
  crmCaptured: "线索沉淀",
  converted: "已转化",
};
function usePagedItems<T>(items: T[], pageSize = tablePageSize) {
  const [page, setPage] = React.useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  React.useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    page: safePage,
    setPage,
    totalPages,
    pageItems: items.slice(start, start + pageSize),
    start,
    end: Math.min(start + pageSize, items.length),
  };
}
function TablePager({
  page,
  totalPages,
  total,
  start,
  end,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  start: number;
  end: number;
  onPageChange: (page: number) => void;
}) {
  if (total <= tablePageSize) return null;
  return (
    <div className="flex flex-col gap-2 border-t border-default-100 pt-3 text-sm text-default-500 sm:flex-row sm:items-center sm:justify-between">
      <span>
        显示
        {start + 1}-{end}/{total}
      </span>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="flat"
          isDisabled={page <= 1}
          onPress={() => onPageChange(page - 1)}
        >
          上一页
        </Button>
        <span>
          {page}/{totalPages}
        </span>
        <Button
          size="sm"
          variant="flat"
          isDisabled={page >= totalPages}
          onPress={() => onPageChange(page + 1)}
        >
          下一页
        </Button>
      </div>
    </div>
  );
}

type AcquisitionTaskForm = {
  taskName: string;
  mode: GrowthAcquisitionMode;
  sourceInputs: string;
  includeKeywords: string;
  excludeKeywords: string;
  blacklistNicknames: string;
  commentTemplates: string;
  privateMessageTemplates: string;
  dailyLimit: string;
  perTargetLimit: string;
  riskMode: "confirm-first" | "draft-only" | "auto";
  accountKey: string;
  scheduleEnabled: string;
  beginTime: string;
  deduplicate: string;
};

type AcquisitionFormErrors = Partial<Record<keyof AcquisitionTaskForm, string>>;

type StrategyFormState = {
  name: string;
  industry: string;
  scenario: string;
  sourceKeywords: string;
  demandKeywords: string;
  excludeKeywords: string;
  blacklistNicknames: string;
  commentTemplates: string;
  privateMessageTemplates: string;
  defaultDailyLimit: string;
  defaultRiskMode: GrowthRiskMode;
};

type StrategyFormErrors = Partial<Record<keyof StrategyFormState, string>>;

type StrategyReview =
  | {
      kind: "generate";
    }
  | {
      kind: "copy";
      source: GrowthStrategyTemplate;
    }
  | {
      kind: "apply";
      source: GrowthStrategyTemplate;
    };

type LeadEditForm = {
  nickname: string;
  profileUrl: string;
  sourceText: string;
  sourceUrl: string;
  matchedKeywords: string;
  score: string;
  latestReply: string;
  nextFollowUpAt: string;
  followUpNote: string;
};

const defaultAcquisitionForm: AcquisitionTaskForm = {
  taskName: "装修客户关键词获客",
  mode: "keyword",
  sourceInputs: "装修\n旧房翻新\n全屋定制",
  includeKeywords: "想,需要,多少钱,本地",
  excludeKeywords: "招聘,教程,同行,招商",
  blacklistNicknames: "广告号,招商加盟",
  commentTemplates:
    "我这边刚好整理过这类问题，可以给你一个参考。\n这个要看你的具体情况，方便的话我可以帮你拆一下。",
  privateMessageTemplates:
    "我可以先发你一份避坑清单，你看完再决定是否继续沟通。",
  dailyLimit: "20",
  perTargetLimit: "1",
  riskMode: "confirm-first",
  accountKey: "",
  scheduleEnabled: "false",
  beginTime: "09:30",
  deduplicate: "true",
};

function exposureDefinitionToForm(
  definition: (typeof exposurePreviewDefinitions)[number],
  current: AcquisitionTaskForm,
): AcquisitionTaskForm {
  return {
    ...current,
    taskName: `${definition.title}任务`,
    mode: definition.mode,
    sourceInputs: definition.sourceExample,
    dailyLimit: definition.dailyLimit,
    riskMode: definition.riskMode,
    scheduleEnabled: "false",
    deduplicate: "true",
  };
}

const defaultStrategyFormState: StrategyFormState = {
  name: "",
  industry: "装修",
  scenario: "评论获客",
  sourceKeywords: "装修\n旧房翻新\n全屋定制",
  demandKeywords: "想,需要,多少钱,本地",
  excludeKeywords: "招聘,教程,同行,招商",
  blacklistNicknames: "广告号,招商加盟",
  commentTemplates:
    "我这边刚好整理过这类问题，可以给你一个参考。\n这个要看你的具体情况，方便的话我可以帮你拆一下。",
  privateMessageTemplates:
    "我可以先发你一份避坑清单，你看完再决定是否继续沟通。",
  defaultDailyLimit: "20",
  defaultRiskMode: "confirm-first",
};

function leadToEditForm(lead: GrowthLead): LeadEditForm {
  return {
    nickname: lead.nickname,
    profileUrl: lead.profileUrl || "",
    sourceText: lead.sourceText,
    sourceUrl: lead.sourceUrl || "",
    matchedKeywords: lead.matchedKeywords.join(","),
    score: String(lead.score),
    latestReply: lead.latestReply || "",
    nextFollowUpAt: lead.nextFollowUpAt
      ? toLocalDateTimeInputValue(lead.nextFollowUpAt)
      : "",
    followUpNote: "",
  };
}

function formatDate(value?: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toLocalDateTimeInputValue(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function fromLocalDateTimeInputValue(value: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function getReportRange(preset: ReportRangePreset) {
  const end = new Date();
  const start = new Date();
  if (preset === "today") {
    return {
      startDate: toDateInputValue(start),
      endDate: toDateInputValue(end),
    };
  }
  start.setDate(end.getDate() - (preset === "30d" ? 29 : 6));
  return {
    startDate: toDateInputValue(start),
    endDate: toDateInputValue(end),
  };
}

function csvEscape(value: unknown) {
  const text = value === undefined || value === null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(filename: string, rows: Array<Record<string, unknown>>) {
  if (!rows.length) {
    toast.error("当前筛选条件下暂无可导出的数据");
    return;
  }
  const headers = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row).forEach((key) => set.add(key));
      return set;
    }, new Set<string>()),
  );
  const csv = [
    headers.map(csvEscape).join(","),
    ...rows.map((row) =>
      headers.map((header) => csvEscape(row[header])).join(","),
    ),
  ].join("\n");
  const blob = new Blob([`\uFEFF${csv}`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function splitLines(value: string) {
  return value
    .split(/[,\n，、]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function validateAcquisitionForm(form: AcquisitionTaskForm) {
  const errors: AcquisitionFormErrors = {};
  const sourceInputs = splitLines(form.sourceInputs);
  const includeKeywords = splitLines(form.includeKeywords);
  const commentTemplates = splitLines(form.commentTemplates);
  const privateMessageTemplates = splitLines(form.privateMessageTemplates);
  const dailyLimit = Number(form.dailyLimit);
  const perTargetLimit = Number(form.perTargetLimit);

  if (!form.taskName.trim()) errors.taskName = "请输入任务名称";
  if (form.taskName.trim().length > 60)
    errors.taskName = "任务名称最多 60 个字";
  if (!sourceInputs.length)
    errors.sourceInputs = "至少填写 1 条关键词、链接、账号或候选来源";
  if (sourceInputs.length > 80)
    errors.sourceInputs = "来源最多 80 条，建议拆分成多个任务";
  if (
    form.mode === "retention" &&
    sourceInputs.some(
      (item) =>
        !/^https?:\/\/(?:www\.)?douyin\.com\/(?:video|user|share\/user)\//i.test(
          item,
        ),
    )
  ) {
    errors.sourceInputs = "留资曝光只接受明确的抖音视频互动链接或客户主页链接";
  }
  if (!includeKeywords.length)
    errors.includeKeywords = "至少填写 1 个意向关键词";
  if (!commentTemplates.length && !privateMessageTemplates.length) {
    errors.commentTemplates = "评论话术或私信话术至少填写一类";
    errors.privateMessageTemplates = "评论话术或私信话术至少填写一类";
  }
  if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 200) {
    errors.dailyLimit = "每日上限需为 1-200 的整数";
  }
  if (
    !Number.isInteger(perTargetLimit) ||
    perTargetLimit < 1 ||
    perTargetLimit > 10
  ) {
    errors.perTargetLimit = "单目标上限需为 1-10 的整数";
  }
  if (!/^\d{2}:\d{2}$/.test(form.beginTime)) {
    errors.beginTime = "时间格式需为 HH:mm";
  } else {
    const [hour, minute] = form.beginTime.split(":").map(Number);
    if (hour > 23 || minute > 59) errors.beginTime = "请输入有效时间";
  }
  if (form.riskMode === "auto" && dailyLimit > 50) {
    errors.riskMode = "自动触达模式下每日上限不能超过 50";
  }
  return errors;
}

function hasFormErrors(errors: AcquisitionFormErrors) {
  return Object.keys(errors).length > 0;
}

function configToForm(config: GrowthAcquisitionConfig): AcquisitionTaskForm {
  return {
    taskName: config.taskName,
    mode: config.mode,
    sourceInputs: config.sourceInputs.join("\n"),
    includeKeywords: config.includeKeywords.join(","),
    excludeKeywords: config.excludeKeywords.join(","),
    blacklistNicknames: config.blacklistNicknames.join(","),
    commentTemplates: config.commentTemplates.join("\n"),
    privateMessageTemplates: config.privateMessageTemplates.join("\n"),
    dailyLimit: String(config.dailyLimit),
    perTargetLimit: String(config.perTargetLimit),
    riskMode: config.riskMode,
    accountKey: `${config.platform}:${config.accountId}`,
    scheduleEnabled: String(config.scheduleEnabled),
    beginTime: config.beginTime,
    deduplicate: String(config.deduplicate),
  };
}

function strategyToForm(strategy: GrowthStrategyTemplate): StrategyFormState {
  return {
    name: strategy.name,
    industry: strategy.industry,
    scenario: strategy.scenario,
    sourceKeywords: strategy.sourceKeywords.join("\n"),
    demandKeywords: strategy.demandKeywords.join(","),
    excludeKeywords: strategy.excludeKeywords.join(","),
    blacklistNicknames: strategy.blacklistNicknames.join(","),
    commentTemplates: strategy.commentTemplates.join("\n"),
    privateMessageTemplates: strategy.privateMessageTemplates.join("\n"),
    defaultDailyLimit: String(strategy.defaultDailyLimit),
    defaultRiskMode: strategy.defaultRiskMode,
  };
}

function validateStrategyForm(form: StrategyFormState) {
  const errors: StrategyFormErrors = {};
  const dailyLimit = Number(form.defaultDailyLimit);
  if (!form.name.trim()) errors.name = "请输入策略名称";
  if (!form.industry.trim()) errors.industry = "请输入行业";
  if (!form.scenario.trim()) errors.scenario = "请输入场景";
  if (!splitLines(form.sourceKeywords).length)
    errors.sourceKeywords = "至少填写 1 个来源词";
  if (!splitLines(form.demandKeywords).length)
    errors.demandKeywords = "至少填写 1 个需求词";
  if (
    !splitLines(form.commentTemplates).length &&
    !splitLines(form.privateMessageTemplates).length
  ) {
    errors.commentTemplates = "评论话术或私信话术至少填写一类";
    errors.privateMessageTemplates = "评论话术或私信话术至少填写一类";
  }
  if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 200) {
    errors.defaultDailyLimit = "每日上限需为 1-200 的整数";
  }
  if (form.defaultRiskMode === "auto" && dailyLimit > 50) {
    errors.defaultRiskMode = "自动触达模式下每日上限不能超过 50";
  }
  return errors;
}

function buildStrategyPayload(form: StrategyFormState) {
  return {
    name: form.name.trim(),
    industry: form.industry.trim(),
    scenario: form.scenario.trim(),
    sourceKeywords: splitLines(form.sourceKeywords),
    demandKeywords: splitLines(form.demandKeywords),
    excludeKeywords: splitLines(form.excludeKeywords),
    blacklistNicknames: splitLines(form.blacklistNicknames),
    commentTemplates: splitLines(form.commentTemplates),
    privateMessageTemplates: splitLines(form.privateMessageTemplates),
    defaultDailyLimit: Number(form.defaultDailyLimit),
    defaultRiskMode: form.defaultRiskMode,
  };
}

function formatStrategyVersion(strategy: GrowthStrategyTemplate) {
  const value = strategy.updatedAt || strategy.createdAt;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "v1";
  const year = String(date.getFullYear()).slice(2);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `v${year}${month}${day}.${hour}${minute}`;
}

function strategyReviewLabel(strategy: GrowthStrategyTemplate) {
  if (!strategy.diagnostics) return "未复核";
  const label: Record<string, string> = {
    excellent: "优秀",
    healthy: "健康",
    "needs-work": "待优化",
    risky: "高风险",
  };
  return `${strategy.diagnostics.score} 分 · ${label[strategy.diagnostics.level]}`;
}

function strategyRiskSummary(strategy: GrowthStrategyTemplate) {
  const issues = strategy.diagnostics?.issues || [];
  if (issues.length) return issues.slice(0, 2);
  if (strategy.defaultRiskMode === "auto") {
    return ["默认自动触达，套用前需确认账号健康和每日上限。"];
  }
  return ["套用后只生成获客任务，不会立即执行外部触达。"];
}

function isStepDraftDirty(
  step: GrowthWorkflow["steps"][number] | undefined,
  description: string,
  outputSummary: string,
) {
  if (!step) return false;
  return (
    description.trim() !== (step.description || "").trim() ||
    outputSummary.trim() !== (step.outputSummary || "").trim()
  );
}

function accountKey(account: GrowthAccountHealth) {
  return `${account.platform}:${account.accountId}`;
}

function isAccountReady(account: GrowthAccountHealth) {
  return account.loginStatus === "online" && account.riskStatus === "normal";
}

function findAccountByKey(
  accounts: GrowthAccountHealth[],
  selectedKey: string,
) {
  return (
    accounts.find((item) => accountKey(item) === selectedKey) ||
    getDefaultAccount(accounts) ||
    null
  );
}

function getExecutionModeState(
  riskMode: AcquisitionTaskForm["riskMode"],
  account?: GrowthAccountHealth | null,
): {
  label: string;
  color: "default" | "primary" | "success" | "warning" | "danger";
  detail: string;
} {
  if (riskMode === "draft-only") {
    return {
      label: "仅草稿",
      color: "default",
      detail: "只生成候选线索和话术草稿，不会进入真实触达。",
    };
  }
  if (!account) {
    return {
      label: "待配置",
      color: "warning",
      detail: "还没有可用执行账号，任务会先停下提示。",
    };
  }
  if (!isAccountReady(account)) {
    return {
      label: "待处理",
      color: "warning",
      detail: "账号未处于在线正常状态，检查会给出需处理原因和处理入口。",
    };
  }
  if (riskMode === "auto") {
    return {
      label: "计划自动执行",
      color: "success",
      detail:
        "账号条件已满足；是否会真实触达仍以页面实时执行能力和执行前检查为准。",
    };
  }
  return {
    label: "确认后执行",
    color: "primary",
    detail:
      "需要先通过执行前确认；外部动作仍以页面运行状态和最终确认结果为准。",
  };
}

function accountHealthColor(
  account: GrowthAccountHealth,
): "success" | "warning" | "danger" {
  if (isAccountReady(account)) return "success";
  if (account.riskStatus === "cooldown") return "warning";
  return "danger";
}

function accountSeverityScore(account: GrowthAccountHealth) {
  if (account.loginStatus === "verification-required") return 60;
  if (account.loginStatus === "expired") return 55;
  if (account.riskStatus === "needs-human") return 50;
  if (account.riskStatus === "paused") return 45;
  if (account.riskStatus === "cooldown") return 35;
  if (account.failureRate >= 0.25) return 30;
  if (account.failureRate >= 0.1) return 20;
  if (account.todayActionCount >= 80) return 10;
  return 0;
}

function accountSeverityLabel(account: GrowthAccountHealth) {
  if (isAccountReady(account)) return "可执行";
  if (account.loginStatus === "verification-required") return "需验证";
  if (account.loginStatus === "expired") return "登录过期";
  if (account.riskStatus === "cooldown") return "冷却中";
  if (account.riskStatus === "paused") return "已暂停";
  if (account.riskStatus === "needs-human") return "需人工";
  if (account.failureRate >= 0.25) return "失败率高";
  return "需复核";
}

function accountSeverityColor(
  account: GrowthAccountHealth,
): "success" | "warning" | "danger" | "default" {
  const score = accountSeverityScore(account);
  if (!score) return "success";
  if (score >= 45) return "danger";
  if (score >= 20) return "warning";
  return "default";
}

function accountNextAction(account: GrowthAccountHealth) {
  if (account.loginStatus === "unknown")
    return "先完成平台账号真实检测；检测为在线正常后才能承接自动获客任务。";
  if (account.loginStatus === "verification-required")
    return "先完成平台验证码或二次确认，再重新检测账号。";
  if (account.loginStatus === "expired")
    return "先到发布中心-平台账号重新登录，再恢复获客任务。";
  if (account.riskStatus === "cooldown")
    return "等待冷却结束或人工确认安全后解除冷却。";
  if (account.riskStatus === "paused" || account.riskStatus === "needs-human")
    return "人工确认近期失败证据，必要时降低任务频率。";
  if (account.failureRate >= 0.25)
    return "暂停高频任务，先检查失败原因和平台页面变化。";
  if (account.failureRate >= 0.1)
    return "继续观察，优先使用人工确认后触达模式。";
  return "可承接获客任务，继续按当前频率执行。";
}

function sortAccountsByRisk(accounts: GrowthAccountHealth[]) {
  return [...accounts].sort((left, right) => {
    const severity = accountSeverityScore(right) - accountSeverityScore(left);
    if (severity) return severity;
    const failureRate = right.failureRate - left.failureRate;
    if (failureRate) return failureRate;
    return right.todayActionCount - left.todayActionCount;
  });
}

function formatCooldownRemaining(value?: string) {
  if (!value) return "人工解除";
  const minutes = Math.ceil(
    Math.max(0, new Date(value).getTime() - Date.now()) / 60_000,
  );
  if (minutes <= 0) return "现在可解除";
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
}

function platformCapability(platform: GrowthAccountHealth["platform"]) {
  const map: Record<
    GrowthAccountHealth["platform"],
    {
      status: string;
      detail: string;
      modes: string[];
    }
  > = {
    douyin: {
      status: "账号检测 + 安全检查",
      detail:
        "支持账号登录状态、冷却、额度和执行确认单；具体采集、评论或私信能力以实时能力状态为准。",
      modes: ["关键词", "视频链接", "目标账号", "留资来源"],
    },
    "wechat-channel": {
      status: "候选导入 + 安全检查",
      detail:
        "支持账号健康纳管和链接、目标账号、手动候选检查；自动采集能力以实时能力状态为准。",
      modes: ["视频链接", "目标账号", "手动候选"],
    },
    wechat: {
      status: "账号纳管",
      detail:
        "微信执行需要明确会话目标；增长模块会展示账号状态、冷却、风险提示和实时能力状态。",
      modes: ["手动候选", "人工确认"],
    },
    wecom: {
      status: "账号纳管",
      detail:
        "企微侧承接人工跟进和会话确认；具体触达范围以实时能力状态和账号权限为准。",
      modes: ["手动候选", "人工确认"],
    },
    xiaohongshu: {
      status: "等待配置",
      detail:
        "当前仅支持账号纳管和平台可用范围；真实自动触达能力未接通时会阻止执行，并显示处理原因。",
      modes: ["账号检测"],
    },
    kuaishou: {
      status: "等待配置",
      detail:
        "当前仅支持账号纳管和平台可用范围；真实自动触达能力未接通时会阻止执行，并显示处理原因。",
      modes: ["账号检测"],
    },
  };
  return map[platform];
}

function resolvedPlatformCapability(
  platform: GrowthAccountHealth["platform"],
  snapshot?: AiEmployeeCapabilitiesSnapshot | null,
) {
  const fallback = platformCapability(platform);
  const domains =
    platform === "douyin"
      ? ["douyin-acquisition"]
      : platform === "wechat"
        ? ["wechat-service", "wechat-broadcast", "wechat-moments"]
        : [];
  const capabilities =
    snapshot?.capabilities.filter(
      (item) => item.platform === platform && domains.includes(item.domain),
    ) || [];
  if (!capabilities.length) return fallback;
  const executable = capabilities.filter(
    (item) => item.executionMode === "real",
  ).length;
  const previewable = capabilities.filter(
    (item) => item.executionMode === "simulated",
  ).length;
  const blocked = capabilities.filter(
    (item) => item.executionMode === "blocked",
  ).length;
  const status = executable
    ? `${executable} 项可执行`
    : previewable
      ? `${previewable} 项可生成预览`
      : blocked
        ? `${blocked} 项暂不可用`
        : "待配置";
  const detail = Array.from(
    new Set(
      capabilities
        .map((item) => displayText(item.message || item.nextAction))
        .filter(Boolean),
    ),
  )
    .slice(0, 2)
    .join("；");
  return {
    ...fallback,
    status,
    detail: detail || fallback.detail,
  };
}

function getDefaultAccount(accounts: GrowthAccountHealth[]) {
  const douyinAccounts = accounts.filter(
    (account) => account.platform === "douyin",
  );
  return (
    douyinAccounts.find(
      (account) =>
        account.loginStatus === "online" && account.riskStatus === "normal",
    ) ||
    douyinAccounts.find((account) => account.loginStatus === "online") ||
    douyinAccounts[0] ||
    accounts.find(
      (account) =>
        account.loginStatus === "online" && account.riskStatus === "normal",
    ) ||
    accounts[0]
  );
}

export function GrowthConsole({ view }: { view: GrowthView }) {
  const meta = viewMeta[view];
  const [loading, setLoading] = React.useState(true);
  const [overview, setOverview] = React.useState<GrowthOverview | null>(null);
  const [reports, setReports] = React.useState<GrowthReports | null>(null);
  const [configs, setConfigs] = React.useState<GrowthAcquisitionConfig[]>([]);
  const [runs, setRuns] = React.useState<GrowthAcquisitionRun[]>([]);
  const [strategies, setStrategies] = React.useState<GrowthStrategyTemplate[]>(
    [],
  );
  const [leads, setLeads] = React.useState<GrowthLead[]>([]);
  const [accounts, setAccounts] = React.useState<GrowthAccountHealth[]>([]);
  const [schedulePlan, setSchedulePlan] =
    React.useState<GrowthSchedulePlan | null>(null);
  const [workflows, setWorkflows] = React.useState<GrowthWorkflow[]>([]);
  const [q, setQ] = React.useState("");
  const [leadStatusFilter, setLeadStatusFilter] = React.useState("all");
  const [leadPlatformFilter, setLeadPlatformFilter] = React.useState("all");
  const [leadSourceFilter, setLeadSourceFilter] = React.useState("all");
  const [leadIntentFilter, setLeadIntentFilter] = React.useState("all");
  const [form, setForm] = React.useState<AcquisitionTaskForm>(
    defaultAcquisitionForm,
  );
  const [formErrors, setFormErrors] = React.useState<AcquisitionFormErrors>({});
  const [editingConfig, setEditingConfig] =
    React.useState<GrowthAcquisitionConfig | null>(null);
  const [editForm, setEditForm] = React.useState<AcquisitionTaskForm>(
    defaultAcquisitionForm,
  );
  const [editFormErrors, setEditFormErrors] =
    React.useState<AcquisitionFormErrors>({});
  const [detailConfig, setDetailConfig] =
    React.useState<GrowthAcquisitionConfig | null>(null);
  const [deleteConfigTarget, setDeleteConfigTarget] =
    React.useState<GrowthAcquisitionConfig | null>(null);
  const [preflight, setPreflight] =
    React.useState<GrowthAcquisitionPreflight | null>(null);
  const [preflightLoading, setPreflightLoading] = React.useState(false);
  const [preflightExecuting, setPreflightExecuting] = React.useState(false);
  const [exposurePreviewBusy, setExposurePreviewBusy] = React.useState<
    ExposurePreviewType | ""
  >("");
  const [exposureSaveBusy, setExposureSaveBusy] = React.useState<
    ExposurePreviewType | ""
  >("");
  const [statusSession, setStatusSession] = React.useState<AgentSession | null>(
    null,
  );
  const [capabilitySnapshot, setCapabilitySnapshot] =
    React.useState<AiEmployeeCapabilitiesSnapshot | null>(null);
  const [capabilityLoadState, setCapabilityLoadState] =
    React.useState<CapabilityLoadState>("loading");
  const defaultReportRange = React.useMemo(() => getReportRange("7d"), []);
  const [reportPreset, setReportPreset] =
    React.useState<ReportRangePreset>("7d");
  const [reportFilters, setReportFilters] = React.useState<GrowthReportQuery>({
    startDate: defaultReportRange.startDate,
    endDate: defaultReportRange.endDate,
    platform: "all",
    configId: "all",
  });
  const [drilldown, setDrilldown] = React.useState<ReportDrilldownKey | null>(
    null,
  );
  const [selectedRunId, setSelectedRunId] = React.useState<string | null>(null);
  const [leadForm, setLeadForm] = React.useState({
    nickname: "本地装修咨询客户",
    platform: "douyin" as GrowthLead["platform"],
    sourceText: "想了解旧房翻新多少钱，近期准备对比装修公司。",
    matchedKeywords: "装修,多少钱,旧房翻新",
    latestReply: "",
  });
  const [selectedLead, setSelectedLead] = React.useState<GrowthLead | null>(
    null,
  );
  const [leadEditForm, setLeadEditForm] = React.useState<LeadEditForm | null>(
    null,
  );
  const [leadDeleteTarget, setLeadDeleteTarget] =
    React.useState<GrowthLead | null>(null);
  const [leadDedupeMatches, setLeadDedupeMatches] = React.useState<
    GrowthLeadDedupeMatch[]
  >([]);
  const [dedupeLoading, setDedupeLoading] = React.useState(false);
  const [selectedLeadIds, setSelectedLeadIds] = React.useState<Set<string>>(
    new Set(),
  );
  const [manualLeadPanelOpen, setManualLeadPanelOpen] = React.useState(false);
  const [bulkLeadConfirm, setBulkLeadConfirm] =
    React.useState<BulkLeadConfirmState | null>(null);
  const [strategyForm, setStrategyForm] = React.useState({
    industry: "装修",
    scenario: "评论获客",
  });
  const [strategyQuery, setStrategyQuery] = React.useState("");
  const [strategyHealthFilter, setStrategyHealthFilter] = React.useState("all");
  const [detailStrategy, setDetailStrategy] =
    React.useState<GrowthStrategyTemplate | null>(null);
  const [editingStrategy, setEditingStrategy] =
    React.useState<GrowthStrategyTemplate | null>(null);
  const [strategyEditForm, setStrategyEditForm] =
    React.useState<StrategyFormState>(defaultStrategyFormState);
  const [strategyEditErrors, setStrategyEditErrors] =
    React.useState<StrategyFormErrors>({});
  const [deleteStrategyTarget, setDeleteStrategyTarget] =
    React.useState<GrowthStrategyTemplate | null>(null);
  const [strategyReview, setStrategyReview] =
    React.useState<StrategyReview | null>(null);
  const [strategyReviewForm, setStrategyReviewForm] =
    React.useState<StrategyFormState>(defaultStrategyFormState);
  const [strategyReviewErrors, setStrategyReviewErrors] =
    React.useState<StrategyFormErrors>({});
  const [strategyApplyForm, setStrategyApplyForm] = React.useState<{
    mode: GrowthAcquisitionMode;
    platform: GrowthPlatform;
    taskName: string;
  }>({
    mode: "keyword",
    platform: "douyin",
    taskName: "",
  });
  const [strategyActionLoading, setStrategyActionLoading] =
    React.useState(false);
  const [workflowForm, setWorkflowForm] = React.useState({
    name: "内容到获客流程",
    template: "content-to-growth",
  });
  const [workflowConfirm, setWorkflowConfirm] =
    React.useState<WorkflowConfirmState | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const needsOverview = view === "overview" || view === "reports";
      const needsRuns =
        view === "overview" || view === "acquisition" || view === "reports";
      const needsStrategies = view === "strategies";
      const needsLeads =
        view === "overview" || view === "leads" || view === "reports";
      const needsAccounts = true;
      const needsReports = view === "overview" || view === "reports";
      const needsWorkflows = view === "workflows";
      const needsSchedule = view === "overview" || view === "reports";
      const [
        nextOverview,
        nextConfigs,
        nextRuns,
        nextStrategies,
        nextLeads,
        nextAccounts,
        nextReports,
        nextWorkflows,
        nextSchedulePlan,
      ] = await Promise.all([
        needsOverview ? growthApi.overview() : Promise.resolve(null),
        growthApi.listConfigs(),
        needsRuns ? growthApi.listRuns() : Promise.resolve([]),
        needsStrategies ? growthApi.listStrategies() : Promise.resolve([]),
        needsLeads ? growthApi.listLeads() : Promise.resolve([]),
        needsAccounts ? growthApi.listAccountHealth() : Promise.resolve([]),
        needsReports ? growthApi.reports(reportFilters) : Promise.resolve(null),
        needsWorkflows ? growthApi.listWorkflows() : Promise.resolve([]),
        needsSchedule ? growthApi.schedulePlan() : Promise.resolve(null),
      ]);
      setOverview(nextOverview);
      setConfigs(nextConfigs);
      setRuns(nextRuns);
      setStrategies(nextStrategies);
      setLeads(nextLeads);
      if (nextReports?.accounts?.length) setAccounts(nextReports.accounts);
      else if (needsAccounts) setAccounts(nextAccounts);
      setReports(nextReports);
      setWorkflows(nextWorkflows);
      setSchedulePlan(nextSchedulePlan);
    } catch (error) {
      toast.error(
        toPublicError(error, "增长获客数据暂时无法读取，请稍后重试。"),
      );
    } finally {
      setLoading(false);
    }
  }, [reportFilters, view]);

  React.useEffect(() => {
    load();
  }, [load]);

  const loadCapabilities = React.useCallback(async () => {
    setCapabilityLoadState("loading");
    try {
      const snapshot = await aiEmployeeApi.capabilities();
      setCapabilitySnapshot(snapshot);
      setCapabilityLoadState("ready");
    } catch {
      setCapabilitySnapshot(null);
      setCapabilityLoadState("error");
    }
  }, []);

  React.useEffect(() => {
    void loadCapabilities();
  }, [loadCapabilities]);

  React.useEffect(() => {
    if (!selectedLead) return;
    const latest = leads.find((lead) => lead.id === selectedLead.id);
    if (latest && latest !== selectedLead) {
      setSelectedLead(latest);
      if (!leadEditForm) return;
      setLeadEditForm((current) =>
        current
          ? {
              ...leadToEditForm(latest),
              followUpNote: current.followUpNote,
            }
          : current,
      );
    }
  }, [leadEditForm, leads, selectedLead]);

  React.useEffect(() => {
    setSelectedLeadIds(new Set());
  }, [
    leadIntentFilter,
    leadPlatformFilter,
    leadSourceFilter,
    leadStatusFilter,
    q,
  ]);

  const buildConfigPayload = (
    taskForm: AcquisitionTaskForm,
    existing?: GrowthAcquisitionConfig,
  ) => {
    const selectedAccount = accounts.find(
      (account) => accountKey(account) === taskForm.accountKey,
    );
    const [platform, accountId] = taskForm.accountKey.split(":");
    const nextPlatform = (selectedAccount?.platform ||
      existing?.platform ||
      platform ||
      "douyin") as GrowthPlatform;
    const payload = {
      taskName: taskForm.taskName.trim(),
      mode: taskForm.mode,
      platform: nextPlatform,
      accountId:
        selectedAccount?.accountId ||
        existing?.accountId ||
        accountId ||
        "default",
      accountName: selectedAccount?.accountName || existing?.accountName,
      sourceInputs: splitLines(taskForm.sourceInputs),
      includeKeywords: splitLines(taskForm.includeKeywords),
      excludeKeywords: splitLines(taskForm.excludeKeywords),
      blacklistNicknames: splitLines(taskForm.blacklistNicknames),
      commentTemplates: splitLines(taskForm.commentTemplates),
      privateMessageTemplates: splitLines(taskForm.privateMessageTemplates),
      dailyLimit: Number(taskForm.dailyLimit),
      perTargetLimit: Number(taskForm.perTargetLimit),
      deduplicate: taskForm.deduplicate === "true",
      riskMode: taskForm.riskMode,
      scheduleEnabled: taskForm.scheduleEnabled === "true",
      beginTime: taskForm.beginTime,
    };
    if (payload.scheduleEnabled && payload.riskMode === "auto") {
      return {
        ...payload,
        riskConfirmation: buildRiskConfirmation("schedule-enable"),
      };
    }
    return payload;
  };

  const applyExposurePreviewDefinition = (
    definition: ExposurePreviewDefinition,
  ) => {
    setForm((current) => exposureDefinitionToForm(definition, current));
    setFormErrors({});
    toast.success(`${definition.title}已套用到创建表单`);
  };

  const saveExposureConfig = async (definition: ExposurePreviewDefinition) => {
    if (exposureSaveBusy) return;
    const defaultAccount = getDefaultAccount(accounts);
    const defaultForm = exposureDefinitionToForm(definition, form);
    const formLooksMatched =
      form.taskName.includes(definition.title) || form.mode === definition.mode;
    const nextForm = formLooksMatched
      ? {
          ...form,
          taskName: form.taskName || defaultForm.taskName,
          mode: definition.mode,
          sourceInputs: form.sourceInputs || defaultForm.sourceInputs,
          dailyLimit: form.dailyLimit || defaultForm.dailyLimit,
          riskMode: form.riskMode || defaultForm.riskMode,
          scheduleEnabled: form.scheduleEnabled || defaultForm.scheduleEnabled,
          deduplicate: form.deduplicate || defaultForm.deduplicate,
        }
      : defaultForm;
    const mergedForm = {
      ...nextForm,
      accountKey:
        form.accountKey ||
        nextForm.accountKey ||
        (defaultAccount ? accountKey(defaultAccount) : ""),
    };
    const errors = validateAcquisitionForm(mergedForm);
    setFormErrors(errors);
    if (hasFormErrors(errors)) {
      toast.error("请先完善方案字段");
      return;
    }
    setExposureSaveBusy(definition.type);
    try {
      await growthApi.createConfig(buildConfigPayload(mergedForm));
      setForm(mergedForm);
      toast.success(`${definition.title}方案已保存`);
      await load();
    } catch (error) {
      toast.error(toPublicError(error, "曝光方案未保存，请稍后重试。"));
    } finally {
      setExposureSaveBusy("");
    }
  };

  const createExposurePreviewTask = async (
    definition: ExposurePreviewDefinition,
  ) => {
    const nextForm = exposureDefinitionToForm(definition, form);
    const mergedForm = {
      ...nextForm,
      accountKey: form.accountKey || nextForm.accountKey,
      includeKeywords: form.includeKeywords || nextForm.includeKeywords,
      excludeKeywords: form.excludeKeywords || nextForm.excludeKeywords,
      blacklistNicknames:
        form.blacklistNicknames || nextForm.blacklistNicknames,
      commentTemplates: form.commentTemplates || nextForm.commentTemplates,
      privateMessageTemplates:
        form.privateMessageTemplates || nextForm.privateMessageTemplates,
      beginTime: form.beginTime || nextForm.beginTime,
    };
    const defaultAccount = getDefaultAccount(accounts);
    const selectedAccount =
      findAccountByKey(accounts, mergedForm.accountKey) || defaultAccount;
    const accountLabel = selectedAccount
      ? `${platformLabels[selectedAccount.platform] || selectedAccount.platform} · ${selectedAccount.accountName}`
      : "演示账号";
    const sourceInputs = splitLines(
      mergedForm.sourceInputs || definition.sourceExample,
    );
    const includeKeywords = splitLines(mergedForm.includeKeywords);
    const commentTemplates = splitLines(mergedForm.commentTemplates);
    const privateMessageTemplates = splitLines(
      mergedForm.privateMessageTemplates,
    );
    if (exposurePreviewBusy) return;
    setExposurePreviewBusy(definition.type);
    try {
      const result = await aiEmployeeApi.createDryRunTask({
        type: definition.type,
        title: `${definition.title}预览任务`,
        accountId: selectedAccount?.accountId || "demo-growth-account",
        instruction: [
          `创建${definition.title}预览任务。`,
          `账号：${accountLabel}`,
          `来源：${sourceInputs.join("、")}`,
          `意向关键词：${includeKeywords.join("、") || "按任务设置筛选"}`,
          `话术：评论 ${commentTemplates.length} 条，私信 ${privateMessageTemplates.length} 条。`,
          `频率：每日 ${mergedForm.dailyLimit} 次，开始时间 ${mergedForm.beginTime}。`,
          "执行边界：只生成任务事件、待确认和结果留存，不执行真实采集、评论、私信或批量触达。",
        ].join("\n"),
        payload: {
          source: "growth-exposure-preview",
          exposure: {
            type: definition.type,
            title: definition.title,
            mode: definition.mode,
            platform: selectedAccount?.platform || "douyin",
            account: selectedAccount?.accountName || "演示账号",
            sourceLabel: definition.sourceLabel,
            sourceInputs,
            includeKeywords,
            excludeKeywords: splitLines(mergedForm.excludeKeywords),
            blacklistNicknames: splitLines(mergedForm.blacklistNicknames),
            commentTemplates,
            privateMessageTemplates,
            dailyLimit:
              Number(mergedForm.dailyLimit) || Number(definition.dailyLimit),
            perTargetLimit: Number(mergedForm.perTargetLimit) || 1,
            beginTime: mergedForm.beginTime,
            riskLabel: definition.riskLabel,
            riskMode: definition.riskMode,
            goal: definition.goal,
          },
        },
      });
      toast.success(
        `${definition.title}预览任务已创建；不会计入曝光记录或真实触达统计`,
      );
      setStatusSession(result.session);
    } catch (error) {
      toast.error(toPublicError(error, "曝光预览未生成，请稍后重试。"));
    } finally {
      setExposurePreviewBusy("");
    }
  };

  const saveEditingConfig = async () => {
    if (!editingConfig) return;
    const errors = validateAcquisitionForm(editForm);
    setEditFormErrors(errors);
    if (hasFormErrors(errors)) {
      toast.error("请先修正任务字段");
      return;
    }
    try {
      const updated = await growthApi.updateConfig(
        editingConfig.id,
        buildConfigPayload(editForm, editingConfig),
      );
      toast.success("获客任务已更新");
      setEditingConfig(null);
      setDetailConfig(updated);
      await load();
    } catch (error) {
      toast.error(toPublicError(error, "获客任务未保存，请稍后重试。"));
    }
  };

  const openEditConfig = (config: GrowthAcquisitionConfig) => {
    setEditingConfig(config);
    setEditForm(configToForm(config));
    setEditFormErrors({});
  };

  const openPreflight = async (config: GrowthAcquisitionConfig) => {
    setPreflightLoading(true);
    setPreflight(null);
    try {
      const result = await growthApi.preflightConfig(config.id);
      setPreflight(result);
    } catch (error) {
      toast.error(toPublicError(error, "执行确认单未生成，请稍后重试。"));
    } finally {
      setPreflightLoading(false);
    }
  };

  const executeConfig = async (config: GrowthAcquisitionConfig) => {
    await openPreflight(config);
  };

  const confirmPreflightExecution = async () => {
    if (!preflight || preflightExecuting) return;
    if (!preflight.allowed || preflight.blockers.length > 0) {
      toast.error(
        displayText(
          preflight.blockers[0] || "执行前检查未通过，请先处理需处理项。",
        ),
      );
      return;
    }
    setPreflightExecuting(true);
    try {
      const result = await growthApi.executeConfig(
        preflight.config.id,
        buildRiskConfirmation("batch-touch"),
      );
      notifyRunResult(result.run);
      setSelectedRunId(result.run.id);
      setPreflight(null);
      await load();
    } catch (error) {
      toast.error(toPublicError(error, "任务未能开始执行，请稍后重试。"));
    } finally {
      setPreflightExecuting(false);
    }
  };

  const confirmDeleteConfig = async () => {
    if (!deleteConfigTarget) return;
    try {
      await growthApi.deleteConfig(deleteConfigTarget.id);
      toast.success("获客任务已删除");
      setDeleteConfigTarget(null);
      if (detailConfig?.id === deleteConfigTarget.id) setDetailConfig(null);
      await load();
    } catch (error) {
      toast.error(toPublicError(error, "任务未删除，请稍后重试。"));
    }
  };

  const deleteConfig = (config: GrowthAcquisitionConfig) => {
    setDeleteConfigTarget(config);
  };

  const toggleConfig = async (config: GrowthAcquisitionConfig) => {
    try {
      const nextEnabled = config.status !== "enabled";
      const riskConfirmation =
        nextEnabled && config.scheduleEnabled && config.riskMode === "auto"
          ? buildRiskConfirmation("schedule-enable")
          : undefined;
      await growthApi.setConfigStatus(config.id, nextEnabled, riskConfirmation);
      toast.success(
        config.status === "enabled" ? "获客任务已停用" : "获客任务已启用",
      );
      await load();
    } catch (error) {
      toast.error(toPublicError(error, "任务状态未更新，请稍后重试。"));
    }
  };

  const checkAccount = async (account: GrowthAccountHealth) => {
    try {
      await growthApi.checkAccountHealth(account.platform, account.accountId);
      toast.success("账号状态已刷新");
      await load();
    } catch (error) {
      toast.error(toPublicError(error, "账号状态未完成检查，请稍后重试。"));
    }
  };

  const cooldownAccount = async (
    account: GrowthAccountHealth,
    minutes = 60,
  ) => {
    try {
      await growthApi.cooldownAccount(
        account.platform,
        account.accountId,
        minutes,
      );
      toast.success(
        `账号已冷却 ${cooldownOptions.find((option) => option.key === String(minutes))?.label || `${minutes} 分钟`}`,
      );
      await load();
    } catch (error) {
      toast.error(toPublicError(error, "账号暂时无法进入冷却，请稍后重试。"));
    }
  };

  const releaseAccountCooldown = async (account: GrowthAccountHealth) => {
    try {
      await growthApi.releaseAccountCooldown(
        account.platform,
        account.accountId,
      );
      toast.success("账号冷却已解除");
      await load();
    } catch (error) {
      toast.error(toPublicError(error, "账号冷却暂时无法解除，请稍后重试。"));
    }
  };

  const createLead = async () => {
    try {
      await growthApi.createLead({
        nickname: leadForm.nickname,
        platform: leadForm.platform,
        sourceText: leadForm.sourceText,
        matchedKeywords: splitLines(leadForm.matchedKeywords),
        latestReply: leadForm.latestReply,
      });
      toast.success("线索已入池");
      await load();
    } catch (error) {
      toast.error(toPublicError(error, "线索未创建，请稍后重试。"));
    }
  };

  const updateLeadStatus = async (
    lead: GrowthLead,
    status: GrowthLeadStatus,
  ) => {
    try {
      await growthApi.updateLead(lead.id, {
        status,
        followUpNote:
          status === "ignored" ? "已人工确认忽略该线索。" : undefined,
      } as Partial<GrowthLead> & {
        followUpNote?: string;
      });
      toast.success(`线索已更新为${leadStatusLabels[status]}`);
      await load();
    } catch (error) {
      toast.error(toPublicError(error, "线索状态未更新，请稍后重试。"));
    }
  };

  const bulkUpdateLeads = async (
    status: GrowthLeadStatus,
    ids = Array.from(selectedLeadIds),
  ) => {
    if (!ids.length) {
      toast("请先选择线索");
      return;
    }
    try {
      await Promise.all(
        ids.map((id) =>
          growthApi.updateLead(id, {
            status,
            followUpNote: `线索池批量操作：更新为「${leadStatusLabels[status]}」。`,
          } as Partial<GrowthLead> & {
            followUpNote?: string;
          }),
        ),
      );
      toast.success(`已批量更新 ${ids.length} 条线索`);
      setSelectedLeadIds(new Set());
      await load();
    } catch (error) {
      toast.error(toPublicError(error, "所选线索未批量更新，请稍后重试。"));
    }
  };

  const openLeadDetail = async (lead: GrowthLead) => {
    setSelectedLead(lead);
    setLeadEditForm(leadToEditForm(lead));
    setLeadDedupeMatches([]);
  };

  const saveLead = async () => {
    if (!selectedLead || !leadEditForm) return;
    const score = Number(leadEditForm.score);
    if (!leadEditForm.nickname.trim() || !leadEditForm.sourceText.trim()) {
      toast.error("线索昵称和原文不能为空");
      return;
    }
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      toast.error("线索评分需为 0-100");
      return;
    }
    try {
      await growthApi.updateLead(selectedLead.id, {
        nickname: leadEditForm.nickname,
        profileUrl: leadEditForm.profileUrl,
        sourceText: leadEditForm.sourceText,
        sourceUrl: leadEditForm.sourceUrl,
        matchedKeywords: splitLines(leadEditForm.matchedKeywords),
        score,
        latestReply: leadEditForm.latestReply,
        nextFollowUpAt: fromLocalDateTimeInputValue(
          leadEditForm.nextFollowUpAt,
        ),
        followUpNote: leadEditForm.followUpNote,
      } as Partial<GrowthLead> & {
        followUpNote?: string;
      });
      toast.success("线索详情已保存");
      setLeadEditForm({
        ...leadEditForm,
        followUpNote: "",
      });
      await load();
    } catch (error) {
      toast.error(toPublicError(error, "线索内容未保存，请稍后重试。"));
    }
  };

  const confirmDeleteLead = async () => {
    if (!leadDeleteTarget) return;
    try {
      await growthApi.deleteLead(leadDeleteTarget.id);
      toast.success("线索已删除");
      if (selectedLead?.id === leadDeleteTarget.id) {
        setSelectedLead(null);
        setLeadEditForm(null);
      }
      setLeadDeleteTarget(null);
      await load();
    } catch (error) {
      toast.error(toPublicError(error, "线索未删除，请稍后重试。"));
    }
  };

  const previewDedupe = async (lead: GrowthLead) => {
    setDedupeLoading(true);
    try {
      const result = await growthApi.dedupePreview({
        leadId: lead.id,
      });
      setLeadDedupeMatches(result.matches);
      if (!result.matches.length) toast("暂未发现高相似重复线索");
    } catch (error) {
      toast.error(toPublicError(error, "重复线索预览未生成，请稍后重试。"));
    } finally {
      setDedupeLoading(false);
    }
  };

  const openLeadDedupe = async (lead: GrowthLead) => {
    await openLeadDetail(lead);
    await previewDedupe(lead);
  };

  const mergeLead = async (duplicateId: string) => {
    if (!selectedLead) return;
    try {
      const result = await growthApi.mergeLeads({
        primaryId: selectedLead.id,
        duplicateIds: [duplicateId],
      });
      toast.success(`已合并 ${result.mergedCount} 条重复线索`);
      setSelectedLead(result.lead);
      setLeadEditForm(leadToEditForm(result.lead));
      setLeadDedupeMatches([]);
      await load();
    } catch (error) {
      toast.error(toPublicError(error, "重复线索未合并，请稍后重试。"));
    }
  };

  const syncLeadToCrm = async (lead: GrowthLead) => {
    try {
      const result = await growthApi.syncLeadToCrm(lead.id);
      if (!result.enabled || !result.ok) {
        toast.error(result.message || "CRM 未启用，无法同步线索");
        return;
      }
      setLeads((current) =>
        current.map((item) =>
          item.id === result.lead.id ? result.lead : item,
        ),
      );
      if (selectedLead?.id === result.lead.id) {
        setSelectedLead(result.lead);
        setLeadEditForm((current) =>
          current
            ? {
                ...leadToEditForm(result.lead),
                followUpNote: current.followUpNote,
              }
            : current,
        );
      }
      toast.success(result.message || "线索已同步到 CRM");
      await load();
    } catch (error) {
      toast.error(
        toPublicError(error, "线索暂时无法同步到客户管理，请稍后重试。"),
      );
    }
  };

  const openGenerateStrategyReview = () => {
    setStrategyReviewErrors({});
    setStrategyReview({
      kind: "generate",
    });
  };

  const openEditStrategy = (strategy: GrowthStrategyTemplate) => {
    setEditingStrategy(strategy);
    setStrategyEditForm(strategyToForm(strategy));
    setStrategyEditErrors({});
  };

  const saveStrategy = async () => {
    if (!editingStrategy) return;
    const errors = validateStrategyForm(strategyEditForm);
    setStrategyEditErrors(errors);
    if (Object.keys(errors).length) {
      toast.error("请先修正策略字段");
      return;
    }
    try {
      const updated = await growthApi.updateStrategy(
        editingStrategy.id,
        buildStrategyPayload(strategyEditForm),
      );
      toast.success("获客策略已保存");
      setEditingStrategy(null);
      setDetailStrategy(updated);
      await load();
    } catch (error) {
      toast.error(toPublicError(error, "增长策略未保存，请稍后重试。"));
    }
  };

  const openCopyStrategyReview = (strategy: GrowthStrategyTemplate) => {
    setStrategyReviewForm({
      ...strategyToForm(strategy),
      name: `${strategy.name} 副本`,
    });
    setStrategyReviewErrors({});
    setStrategyReview({
      kind: "copy",
      source: strategy,
    });
  };

  const openApplyStrategyReview = (strategy: GrowthStrategyTemplate) => {
    setStrategyApplyForm({
      mode: strategy.diagnostics?.recommendedModes[0] || "keyword",
      platform: "douyin",
      taskName: `${strategy.name} · 自动获客`,
    });
    setStrategyReviewErrors({});
    setStrategyReview({
      kind: "apply",
      source: strategy,
    });
  };

  const confirmStrategyReview = async () => {
    if (!strategyReview) return;
    setStrategyActionLoading(true);
    try {
      if (strategyReview.kind === "generate") {
        if (!strategyForm.industry.trim() || !strategyForm.scenario.trim()) {
          toast.error("请先填写行业和场景");
          return;
        }
        await growthApi.generateStrategy(strategyForm);
        toast.success("行业获客策略已生成");
      }
      if (strategyReview.kind === "copy") {
        const errors = validateStrategyForm(strategyReviewForm);
        setStrategyReviewErrors(errors);
        if (Object.keys(errors).length) {
          toast.error("请先修正复制策略字段");
          return;
        }
        await growthApi.createStrategy(
          buildStrategyPayload(strategyReviewForm),
        );
        toast.success("获客策略副本已创建");
      }
      if (strategyReview.kind === "apply") {
        const result = await growthApi.applyStrategy(strategyReview.source.id, {
          mode: strategyApplyForm.mode,
          platform: strategyApplyForm.platform,
          taskName:
            strategyApplyForm.taskName.trim() ||
            `${strategyReview.source.name} · 自动获客`,
        });
        toast.success(result.message);
      }
      setStrategyReview(null);
      setStrategyReviewErrors({});
      await load();
    } catch (error) {
      toast.error(toPublicError(error, "增长策略状态未更新，请稍后重试。"));
    } finally {
      setStrategyActionLoading(false);
    }
  };

  const confirmDeleteStrategy = async () => {
    if (!deleteStrategyTarget) return;
    try {
      await growthApi.deleteStrategy(deleteStrategyTarget.id);
      toast.success("获客策略已删除");
      if (detailStrategy?.id === deleteStrategyTarget.id)
        setDetailStrategy(null);
      setDeleteStrategyTarget(null);
      await load();
    } catch (error) {
      toast.error(toPublicError(error, "增长策略未删除，请稍后重试。"));
    }
  };

  const createWorkflow = async (templateKey?: string) => {
    const template =
      workflowTemplates.find(
        (item) => item.key === (templateKey || workflowForm.template),
      ) || workflowTemplates[0];
    const workflowName = templateKey
      ? template.label
      : workflowForm.name.trim();
    if (!workflowName.trim()) {
      toast.error("请输入流程名称");
      return;
    }
    try {
      await growthApi.createWorkflow({
        name: workflowName.trim(),
        template: template.key,
      });
      toast.success("增长流程已创建");
      setWorkflowForm({
        name: template.label,
        template: template.key,
      });
      await load();
    } catch (error) {
      toast.error(toPublicError(error, "增长流程未创建，请稍后重试。"));
    }
  };

  const updateWorkflow = async (
    workflow: GrowthWorkflow,
    body: Partial<GrowthWorkflow> & {
      stepId?: string;
      stepDescription?: string;
      stepOutputSummary?: string;
    },
  ) => {
    try {
      await growthApi.updateWorkflow(workflow.id, body);
      toast.success("流程已保存");
      await load();
    } catch (error) {
      toast.error(toPublicError(error, "增长流程未保存，请稍后重试。"));
    }
  };

  const deleteWorkflow = async (workflow: GrowthWorkflow) => {
    setWorkflowConfirm({
      workflow,
      delete: true,
      title: "删除增长流程",
      message: `删除「${workflow.name}」后，流程步骤和备注会从当前列表移除。这里不会触发外部执行。`,
      danger: true,
    });
  };

  const performDeleteWorkflow = async (workflow: GrowthWorkflow) => {
    try {
      await growthApi.deleteWorkflow(workflow.id);
      toast.success("流程已删除");
      await load();
    } catch (error) {
      toast.error(toPublicError(error, "增长流程未删除，请稍后重试。"));
    }
  };

  const performWorkflowAction = async (
    workflow: GrowthWorkflow,
    action: WorkflowAction,
    outputSummary?: string,
    actionDraft?: WorkflowStepDraft,
  ) => {
    try {
      if (actionDraft?.saveBeforeAction) {
        await growthApi.updateWorkflow(workflow.id, {
          stepId: actionDraft.stepId,
          stepDescription: actionDraft.stepDescription,
          stepOutputSummary: actionDraft.stepOutputSummary,
        });
      }
      const finalOutputSummary =
        actionDraft?.stepOutputSummary.trim() || outputSummary;
      await growthApi.workflowAction(workflow.id, action, {
        outputSummary: finalOutputSummary,
      });
      const toastMap: Record<string, string> = {
        start: "流程已启动",
        resume: "流程已恢复",
        pause: "流程已暂停",
        advance: "已推进到下一步",
        "complete-step": "当前步骤已完成",
        fail: "当前步骤已标记异常",
        reset: "流程已重置",
      };
      toast.success(toastMap[action] || "流程已更新");
      await load();
    } catch (error) {
      toast.error(toPublicError(error, "增长流程状态未更新，请稍后重试。"));
    }
  };

  const workflowAction = (
    workflow: GrowthWorkflow,
    action: WorkflowAction,
    outputSummary?: string,
    actionDraft?: WorkflowStepDraft,
  ) => {
    const saveHint = actionDraft?.saveBeforeAction
      ? `当前步骤「${actionDraft.stepName}」的未保存说明/备注会先保存，再执行本次操作。`
      : "";
    const noManualOutputHint =
      (action === "advance" || action === "complete-step") &&
      !actionDraft?.stepOutputSummary.trim()
        ? "当前步骤没有填写确认结果，将只记录系统完成说明，建议补充人工确认结论。"
        : "";
    const confirmText: Partial<Record<WorkflowAction, string>> = {
      start: `确认启动「${workflow.name}」？这里只推进流程状态，不会触发真实外部执行。`,
      resume: `确认恢复「${workflow.name}」？`,
      advance: [
        `确认完成当前步骤并推进「${workflow.name}」？`,
        saveHint,
        noManualOutputHint,
      ]
        .filter(Boolean)
        .join(" "),
      "complete-step": ["确认完成当前步骤？", saveHint, noManualOutputHint]
        .filter(Boolean)
        .join(" "),
      fail: [
        "确认将当前步骤标记为异常？",
        saveHint,
        "请确保备注里写明异常原因和下一步处理人。",
      ]
        .filter(Boolean)
        .join(" "),
      reset: `确认重置「${workflow.name}」？所有步骤状态和备注输出会被清空。`,
    };
    if (confirmText[action]) {
      setWorkflowConfirm({
        workflow,
        action,
        outputSummary,
        actionDraft,
        title: action === "fail" ? "标记流程异常" : "确认流程操作",
        message: confirmText[action] || "确认执行该流程操作？",
        danger: action === "fail" || action === "reset",
      });
      return;
    }
    void performWorkflowAction(workflow, action, outputSummary, actionDraft);
  };

  const confirmWorkflowOperation = async () => {
    if (!workflowConfirm) return;
    const current = workflowConfirm;
    setWorkflowConfirm(null);
    if (current.delete) {
      await performDeleteWorkflow(current.workflow);
      return;
    }
    if (current.action)
      await performWorkflowAction(
        current.workflow,
        current.action,
        current.outputSummary,
        current.actionDraft,
      );
  };

  const updateReportPreset = (preset: ReportRangePreset) => {
    setReportPreset(preset);
    if (preset === "custom") return;
    setReportFilters((current) => ({
      ...current,
      ...getReportRange(preset),
    }));
  };

  const exportReportCsv = () => {
    if (!reports) return;
    const configById = new Map(configs.map((config) => [config.id, config]));
    const rows: Array<Record<string, unknown>> = [];

    reports.trend.forEach((row) => {
      rows.push({
        类型: "趋势",
        日期: row.date,
        新增线索: row.leads,
        筛选线索: row.selected,
        已触达: row.contacted,
        已转化: row.converted,
        失败: row.failed,
        跳过: row.skipped,
      });
    });

    reports.bottlenecks.forEach((row) => {
      rows.push({
        类型: "瓶颈",
        优先级:
          row.level === "danger"
            ? "高优先级"
            : row.level === "warning"
              ? "需优化"
              : "观察",
        标题: row.title,
        说明: row.detail,
        下一步: row.action,
      });
    });

    reports.taskPerformance.forEach((row) => {
      rows.push({
        类型: "任务表现",
        任务: row.taskName,
        平台: platformLabels[row.platform] || row.platform,
        玩法: getTaskExposureLabel(row.taskName, row.mode),
        执行次数: row.runCount,
        候选线索: row.candidateCount,
        筛选线索: row.selectedCount,
        已触达: row.contactedCount,
        异常: row.failedCount + row.skippedCount,
        最近执行: formatDate(row.lastRunAt),
      });
    });

    reports.accountPerformance.forEach((row) => {
      rows.push({
        类型: "账号表现",
        账号: row.accountName,
        平台: platformLabels[row.platform] || row.platform,
        执行次数: row.runCount,
        候选线索: row.candidateCount,
        筛选线索: row.selectedCount,
        已触达: row.contactedCount,
        异常: row.failedCount + row.skippedCount,
        最近执行: formatDate(row.lastRunAt),
      });
    });

    reports.copywriting.forEach((row) => {
      rows.push({
        类型: "话术表现",
        话术: row.text,
        使用次数: row.usageCount,
        线索均分: row.averageLeadScore,
        触达率: `${Math.round(row.contactRate * 100)}%`,
      });
    });

    reports.leadStatusDistribution.forEach((row) => {
      rows.push({
        类型: "线索状态",
        状态: leadStatusLabels[row.status] || row.status,
        数量: row.count,
      });
    });

    reports.tasks.forEach((run) => {
      const config = configById.get(run.configId);
      rows.push({
        类型: "任务结果",
        执行时间: formatDate(run.startedAt),
        任务: config?.taskName || run.configId,
        平台: platformLabels[run.platform] || run.platform,
        玩法: config
          ? getConfigExposureLabel(config)
          : getRunExposureLabel(run, configs),
        执行边界: runExecutionBoundaryLabel(run),
        状态: statusLabels[run.status] || run.status,
        候选线索: run.candidateCount,
        筛选线索: run.selectedCount,
        真实触达: run.contactedCount,
        线索沉淀: run.crmCapturedCount,
        证据数: run.evidenceUrls.length,
        说明: displayText(run.message),
        终态说明: runOutcomeDetail(run),
      });
    });
    downloadCsv(
      `growth-report-${reportFilters.startDate || "all"}-${reportFilters.endDate || "all"}.csv`,
      rows,
    );
  };

  const exportReportJson = () => {
    if (!reports) return;
    const snapshot = {
      exportedAt: new Date().toISOString(),
      filters: reportFilters,
      overview: reports.overview,
      funnel: reports.funnel,
      trend: reports.trend,
      copywriting: reports.copywriting,
      accounts: reports.accounts,
      bottlenecks: reports.bottlenecks,
      taskPerformance: reports.taskPerformance,
      accountPerformance: reports.accountPerformance,
      leadStatusDistribution: reports.leadStatusDistribution,
      runs: reports.tasks,
    };
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `growth-report-${reportFilters.startDate || "all"}-${reportFilters.endDate || "all"}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const selectedRun = React.useMemo(() => {
    const reportRuns = reports?.tasks || [];
    return (
      [...reportRuns, ...runs].find((run) => run.id === selectedRunId) || null
    );
  }, [reports, runs, selectedRunId]);

  const filteredLeads = React.useMemo(() => {
    const now = Date.now();
    return leads.filter((lead) => {
      const searchText =
        `${lead.nickname}${lead.sourceText}${lead.latestReply || ""}${lead.matchedKeywords.join("")}`.toLowerCase();
      const matchesSearch = !q || searchText.includes(q.toLowerCase());
      const matchesStatus =
        leadStatusFilter === "all" || lead.status === leadStatusFilter;
      const matchesPlatform =
        leadPlatformFilter === "all" || lead.platform === leadPlatformFilter;
      const matchesSource =
        leadSourceFilter === "all" || lead.sourceType === leadSourceFilter;
      const nextFollowUp = lead.nextFollowUpAt
        ? new Date(lead.nextFollowUpAt).getTime()
        : null;
      const matchesIntent =
        leadIntentFilter === "all" ||
        (leadIntentFilter === "high" &&
          lead.score >= 75 &&
          !["ignored", "blocked"].includes(lead.status)) ||
        (leadIntentFilter === "follow-up" &&
          Boolean(nextFollowUp) &&
          !["converted", "ignored", "blocked"].includes(lead.status)) ||
        (leadIntentFilter === "overdue" &&
          Boolean(nextFollowUp) &&
          Number(nextFollowUp) < now &&
          !["converted", "ignored", "blocked"].includes(lead.status));
      return (
        matchesSearch &&
        matchesStatus &&
        matchesPlatform &&
        matchesSource &&
        matchesIntent
      );
    });
  }, [
    leadIntentFilter,
    leadPlatformFilter,
    leadSourceFilter,
    leadStatusFilter,
    leads,
    q,
  ]);

  const filteredLeadIds = React.useMemo(
    () => new Set(filteredLeads.map((lead) => lead.id)),
    [filteredLeads],
  );

  const openBulkLeadConfirm = (status: GrowthLeadStatus) => {
    const selectedLeads = leads.filter((lead) => selectedLeadIds.has(lead.id));
    if (!selectedLeads.length) {
      toast("请先选择线索");
      return;
    }
    setBulkLeadConfirm({
      status,
      leads: selectedLeads,
      filteredCount: filteredLeads.length,
      visibleSelectedCount: selectedLeads.filter((lead) =>
        filteredLeadIds.has(lead.id),
      ).length,
    });
  };

  const confirmBulkLeadUpdate = async () => {
    if (!bulkLeadConfirm) return;
    const current = bulkLeadConfirm;
    setBulkLeadConfirm(null);
    await bulkUpdateLeads(
      current.status,
      current.leads.map((lead) => lead.id),
    );
  };

  const filteredStrategies = React.useMemo(() => {
    const query = strategyQuery.trim().toLowerCase();
    return strategies.filter((strategy) => {
      const matchesQuery =
        !query ||
        [
          strategy.name,
          strategy.industry,
          strategy.scenario,
          ...strategy.sourceKeywords,
          ...strategy.demandKeywords,
          ...strategy.excludeKeywords,
        ]
          .join(" ")
          .toLowerCase()
          .includes(query);
      const matchesHealth =
        strategyHealthFilter === "all" ||
        strategy.diagnostics?.level === strategyHealthFilter;
      return matchesQuery && matchesHealth;
    });
  }, [strategies, strategyHealthFilter, strategyQuery]);

  const headerActions: Record<GrowthView, React.ReactNode> = {
    overview: (
      <>
        <Button
          as={Link}
          href="/growth?view=acquisition"
          color="primary"
          startContent={<Target size={16} />}
        >
          创建获客任务
        </Button>
        <Button
          as={Link}
          href="/growth?view=leads"
          variant="flat"
          startContent={<UsersRound size={16} />}
        >
          查看线索池
        </Button>
      </>
    ),
    acquisition: (
      <>
        <Button
          as={Link}
          href="/growth?view=strategies"
          variant="flat"
          startContent={<ClipboardList size={16} />}
        >
          套用策略
        </Button>
      </>
    ),
    strategies: (
      <>
        <Button
          color="primary"
          startContent={<Sparkles size={16} />}
          onPress={openGenerateStrategyReview}
        >
          复核生成策略
        </Button>
        <Button
          as={Link}
          href="/growth?view=acquisition"
          variant="flat"
          startContent={<Target size={16} />}
        >
          查看任务矩阵
        </Button>
      </>
    ),
    leads: (
      <>
        <Button
          as={Link}
          href="/growth?view=acquisition"
          color="primary"
          startContent={<Plus size={16} />}
        >
          创建获客任务
        </Button>
        <Button
          as={Link}
          href="/growth?view=reports"
          variant="flat"
          startContent={<BarChart3 size={16} />}
        >
          查看复盘
        </Button>
      </>
    ),
    "account-health": (
      <>
        <Button
          color="primary"
          startContent={<RefreshCw size={16} />}
          onPress={load}
        >
          刷新账号状态
        </Button>
        <Button
          as={Link}
          href="/growth?view=acquisition"
          variant="flat"
          startContent={<ShieldCheck size={16} />}
        >
          查看任务检查
        </Button>
      </>
    ),
    reports: (
      <>
        <Button
          color="primary"
          variant="flat"
          startContent={<Download size={16} />}
          onPress={exportReportCsv}
        >
          导出 CSV
        </Button>
        <Button
          color="primary"
          variant="flat"
          startContent={<FileText size={16} />}
          onPress={exportReportJson}
        >
          导出快照
        </Button>
      </>
    ),
    workflows: (
      <>
        <Button
          color="primary"
          startContent={<Network size={16} />}
          onPress={() => createWorkflow()}
        >
          创建流程
        </Button>
        <Button
          as={Link}
          href="/growth?view=strategies"
          variant="flat"
          startContent={<ClipboardList size={16} />}
        >
          查看策略
        </Button>
      </>
    ),
  };

  if (loading && view === "overview" && !overview) {
    return (
      <div
        className="growth-console mx-auto flex w-full max-w-[1680px] flex-col gap-4 pb-8"
        data-growth-view={view}
      >
        <header className="flex flex-col gap-3 pb-1 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-[20px] font-bold leading-[28px] text-foreground">
              {meta.title}
            </h1>
            <p className="mt-1 text-sm text-default-500">{meta.desc}</p>
          </div>
          <div className="growth-console__header-actions flex flex-wrap gap-2">
            <Button
              variant="flat"
              startContent={<RefreshCw size={16} />}
              onPress={load}
            >
              刷新
            </Button>
          </div>
        </header>
        <Card className="border-small border-divider bg-background shadow-sm">
          <CardBody className="items-center justify-center py-12">
            <Spinner label="正在加载增长数据..." />
          </CardBody>
        </Card>
      </div>
    );
  }
  return (
    <div
      className="growth-console mx-auto flex w-full max-w-[1680px] flex-col gap-4 pb-8"
      data-growth-view={view}
    >
      <header className="flex flex-col gap-3 pb-1 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-[20px] font-bold leading-[28px] text-foreground">
            {meta.title}
          </h1>
          <p className="mt-1 text-sm text-default-500">{meta.desc}</p>
        </div>
        <div className="growth-console__header-actions flex flex-wrap gap-2">
          {headerActions[view]}
          <Button
            variant="flat"
            startContent={<RefreshCw size={16} />}
            onPress={load}
          >
            刷新
          </Button>
        </div>
      </header>
      {(view === "overview" || view === "reports") && (
        <>
          <ReportControlPanel
            filters={reportFilters}
            preset={reportPreset}
            configs={configs}
            reports={reports}
            onPresetChange={updateReportPreset}
            onFiltersChange={(nextFilters) => {
              setReportPreset("custom");
              setReportFilters((current) => ({
                ...current,
                ...nextFilters,
              }));
            }}
            onExport={exportReportCsv}
            onExportJson={exportReportJson}
          />
          <MetricGrid
            overview={overview}
            reports={reports}
            activeDrilldown={drilldown}
            onDrillDown={setDrilldown}
          />
          {drilldown && (
            <MetricDrilldownPanel
              drilldown={drilldown}
              reports={reports}
              configs={configs}
              accounts={accounts}
              onClose={() => setDrilldown(null)}
            />
          )}
        </>
      )}
      {view === "overview" && (
        <>
          <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <ExecutionRecordsTable
              configs={configs}
              runs={reports?.tasks || runs}
              selectedRunId={selectedRunId || undefined}
              onSelectRun={setSelectedRunId}
            />
            <LeadsPanel leads={leads} />
          </div>
          <RunDetailPanel run={selectedRun} configs={configs} />
        </>
      )}
      {view === "acquisition" && (
        <div className="flex flex-col gap-4">
          <ExposurePreviewPanel
            definitions={exposurePreviewDefinitions}
            form={form}
            errors={formErrors}
            accounts={accounts}
            busyType={exposurePreviewBusy}
            saveBusyType={exposureSaveBusy}
            configs={configs}
            runs={runs}
            capabilitySnapshot={capabilitySnapshot}
            capabilityLoadState={capabilityLoadState}
            onApply={applyExposurePreviewDefinition}
            onChange={setForm}
            onSave={saveExposureConfig}
            onPreview={createExposurePreviewTask}
            onRefreshCapability={loadCapabilities}
            onView={setDetailConfig}
            onEdit={openEditConfig}
            onConfirm={executeConfig}
            onToggle={toggleConfig}
            onDelete={deleteConfig}
          />
        </div>
      )}
      {view === "strategies" && (
        <div className="flex flex-col gap-4">
          <Card>
            <CardBody className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
              <Input
                label="行业"
                value={strategyForm.industry}
                onValueChange={(industry) =>
                  setStrategyForm({
                    ...strategyForm,
                    industry,
                  })
                }
              />
              <Input
                label="场景"
                value={strategyForm.scenario}
                onValueChange={(scenario) =>
                  setStrategyForm({
                    ...strategyForm,
                    scenario,
                  })
                }
              />
              <Button
                className="h-11"
                color="primary"
                startContent={<Sparkles size={16} />}
                onPress={openGenerateStrategyReview}
              >
                复核后生成
              </Button>
            </CardBody>
          </Card>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm text-default-500">
                策略会自动评估完整度，查看、复制、套用、删除都需要先复核。
              </p>
              <p className="mt-1 text-xs text-default-400">
                已显示
                {filteredStrategies.length}/{strategies.length}
                套策略。
              </p>
            </div>
            <Button
              color="primary"
              startContent={<Sparkles size={16} />}
              onPress={openGenerateStrategyReview}
            >
              再生成一套
            </Button>
          </div>
          <Card>
            <CardBody className="grid gap-3 md:grid-cols-[1fr_220px]">
              <Input
                startContent={<Search size={16} />}
                label="搜索策略"
                placeholder="按名称、行业、关键词、排除词搜索"
                value={strategyQuery}
                onValueChange={setStrategyQuery}
              />
              <Select
                label="健康度"
                selectedKeys={[strategyHealthFilter]}
                onSelectionChange={(keys) =>
                  setStrategyHealthFilter(String(Array.from(keys)[0] || "all"))
                }
              >
                <SelectItem key="all">全部健康度</SelectItem>
                <SelectItem key="excellent">优秀</SelectItem>
                <SelectItem key="healthy">健康</SelectItem>
                <SelectItem key="needs-work">待优化</SelectItem>
                <SelectItem key="risky">风险</SelectItem>
              </Select>
            </CardBody>
          </Card>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredStrategies.map((strategy) => (
              <StrategyCard
                key={strategy.id}
                strategy={strategy}
                onView={setDetailStrategy}
                onEdit={openEditStrategy}
                onCopy={openCopyStrategyReview}
                onApply={openApplyStrategyReview}
                onDelete={setDeleteStrategyTarget}
              />
            ))}
          </div>
          {!filteredStrategies.length && (
            <CommercialEmptyState
              icon={ClipboardList}
              title="没有匹配的获客策略"
              description="调整搜索条件，或先生成一套策略再进入复核、编辑、复制和套用。"
              action={
                <Button
                  color="primary"
                  startContent={<Sparkles size={16} />}
                  onPress={openGenerateStrategyReview}
                >
                  复核生成策略
                </Button>
              }
            />
          )}
        </div>
      )}
      {view === "leads" && (
        <div className="flex flex-col gap-4">
          <Card>
            <CardBody className="gap-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h2 className="text-base font-semibold">手动补充线索</h2>
                  <p className="mt-1 text-sm text-default-500">
                    默认收起，避免压缩线索管理表；用于承接线下、私信、评论未自动识别的线索。
                  </p>
                </div>
                <Button
                  className="h-10 whitespace-nowrap"
                  variant="flat"
                  startContent={
                    manualLeadPanelOpen ? (
                      <ChevronUp size={16} />
                    ) : (
                      <ChevronDown size={16} />
                    )
                  }
                  onPress={() => setManualLeadPanelOpen((current) => !current)}
                >
                  {manualLeadPanelOpen ? "收起补充表单" : "展开补充线索"}
                </Button>
              </div>
              {manualLeadPanelOpen ? (
                <>
                  <Divider />
                  <div className="grid gap-3 lg:grid-cols-2">
                    <Input
                      label="线索昵称"
                      value={leadForm.nickname}
                      onValueChange={(nickname) =>
                        setLeadForm({
                          ...leadForm,
                          nickname,
                        })
                      }
                    />
                    <Select
                      label="来源平台"
                      selectedKeys={[leadForm.platform]}
                      onSelectionChange={(keys) =>
                        setLeadForm({
                          ...leadForm,
                          platform: Array.from(
                            keys,
                          )[0] as GrowthLead["platform"],
                        })
                      }
                    >
                      {Object.entries(platformLabels).map(([key, label]) => (
                        <SelectItem key={key}>{label}</SelectItem>
                      ))}
                    </Select>
                    <Textarea
                      className="lg:col-span-2"
                      label="线索原文"
                      minRows={3}
                      value={leadForm.sourceText}
                      onValueChange={(sourceText) =>
                        setLeadForm({
                          ...leadForm,
                          sourceText,
                        })
                      }
                    />
                    <Input
                      label="命中关键词"
                      value={leadForm.matchedKeywords}
                      onValueChange={(matchedKeywords) =>
                        setLeadForm({
                          ...leadForm,
                          matchedKeywords,
                        })
                      }
                    />
                    <Textarea
                      label="最近回复"
                      minRows={2}
                      value={leadForm.latestReply}
                      onValueChange={(latestReply) =>
                        setLeadForm({
                          ...leadForm,
                          latestReply,
                        })
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs text-default-500">
                      补充后会进入当前线索池，不会触发外部触达；可在详情或表格中同步到
                      CRM。
                    </p>
                    <Button
                      className="h-11 whitespace-nowrap"
                      color="primary"
                      startContent={<Plus size={16} />}
                      onPress={createLead}
                    >
                      加入线索池
                    </Button>
                  </div>
                </>
              ) : (
                <div className="rounded-[8px] border border-default-200 bg-default-50 px-3 py-3 text-sm text-default-500">
                  已收起手动补充表单，线索表保持全宽。需要录入线下或私信线索时再展开。
                </div>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardBody className="gap-4">
              <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h2 className="text-base font-semibold">线索管理表</h2>
                  <p className="mt-1 text-sm text-default-500">
                    当前筛选
                    {filteredLeads.length}条 / 全部
                    {leads.length}
                    条，已选择
                    {selectedLeadIds.size}
                    条；批量操作只影响已勾选线索。
                  </p>
                </div>
              </div>
              <div className="grid gap-3 xl:grid-cols-[minmax(320px,1fr)_304px] xl:items-start">
                <Input
                  startContent={<Search size={16} />}
                  label="搜索线索"
                  placeholder="搜索昵称、来源、关键词"
                  value={q}
                  onValueChange={setQ}
                />
                <div className="grid grid-cols-2 gap-3">
                  <Select
                    className="w-full"
                    label="线索状态"
                    selectedKeys={[leadStatusFilter]}
                    onSelectionChange={(keys) =>
                      setLeadStatusFilter(String(Array.from(keys)[0] || "all"))
                    }
                  >
                    {leadStatusOptions.map((option) => (
                      <SelectItem key={option.key}>{option.label}</SelectItem>
                    ))}
                  </Select>
                  <Select
                    className="w-full"
                    label="平台"
                    selectedKeys={[leadPlatformFilter]}
                    onSelectionChange={(keys) =>
                      setLeadPlatformFilter(
                        String(Array.from(keys)[0] || "all"),
                      )
                    }
                  >
                    {platformOptions.map((option) => (
                      <SelectItem key={option.key}>{option.label}</SelectItem>
                    ))}
                  </Select>
                  <Select
                    className="w-full"
                    label="来源"
                    selectedKeys={[leadSourceFilter]}
                    onSelectionChange={(keys) =>
                      setLeadSourceFilter(String(Array.from(keys)[0] || "all"))
                    }
                  >
                    {leadSourceOptions.map((option) => (
                      <SelectItem key={option.key}>{option.label}</SelectItem>
                    ))}
                  </Select>
                  <Select
                    className="w-full"
                    label="跟进"
                    selectedKeys={[leadIntentFilter]}
                    onSelectionChange={(keys) =>
                      setLeadIntentFilter(String(Array.from(keys)[0] || "all"))
                    }
                  >
                    {leadIntentOptions.map((option) => (
                      <SelectItem key={option.key}>{option.label}</SelectItem>
                    ))}
                  </Select>
                </div>
              </div>
              <LeadSummary leads={leads} />
              <BulkLeadActions
                selectedCount={selectedLeadIds.size}
                filteredCount={filteredLeads.length}
                onContact={() => openBulkLeadConfirm("contacted")}
                onQualify={() => openBulkLeadConfirm("qualified")}
                onIgnore={() => openBulkLeadConfirm("ignored")}
                onClear={() => setSelectedLeadIds(new Set())}
              />
              <LeadsTable
                leads={filteredLeads}
                selectedIds={selectedLeadIds}
                onSelectionChange={setSelectedLeadIds}
                onStatusChange={updateLeadStatus}
                onOpenDetail={openLeadDetail}
                onDelete={(lead) => setLeadDeleteTarget(lead)}
                onDedupe={openLeadDedupe}
                onSyncCrm={syncLeadToCrm}
              />
            </CardBody>
          </Card>
          <LeadDetailModal
            lead={selectedLead}
            form={leadEditForm}
            dedupeMatches={leadDedupeMatches}
            dedupeLoading={dedupeLoading}
            onFormChange={(nextForm) => setLeadEditForm(nextForm)}
            onSave={saveLead}
            onClose={() => {
              setSelectedLead(null);
              setLeadEditForm(null);
              setLeadDedupeMatches([]);
            }}
            onStatusChange={updateLeadStatus}
            onDelete={(lead) => setLeadDeleteTarget(lead)}
            onDedupe={previewDedupe}
            onMerge={mergeLead}
            onSyncCrm={syncLeadToCrm}
          />
          <BulkLeadConfirmModal
            state={bulkLeadConfirm}
            onClose={() => setBulkLeadConfirm(null)}
            onConfirm={confirmBulkLeadUpdate}
          />
          <LeadDeleteModal
            lead={leadDeleteTarget}
            onClose={() => setLeadDeleteTarget(null)}
            onConfirm={confirmDeleteLead}
          />
        </div>
      )}
      {view === "account-health" && (
        <AccountHealthTable
          accounts={accounts}
          configs={configs}
          onCheck={checkAccount}
          onCooldown={cooldownAccount}
          onRelease={releaseAccountCooldown}
          capabilitySnapshot={capabilitySnapshot}
        />
      )}
      {view === "reports" && reports && (
        <div className="flex flex-col gap-4">
          <TrendPanel rows={reports.trend} />
          <BottleneckPanel rows={reports.bottlenecks} />
          <div className="grid gap-4 xl:grid-cols-2">
            <TaskPerformanceTable rows={reports.taskPerformance} />
            <AccountPerformanceTable rows={reports.accountPerformance} />
            <CopywritingTable rows={reports.copywriting} />
            <LeadStatusDistribution rows={reports.leadStatusDistribution} />
          </div>
          <ExecutionRecordsTable
            configs={configs}
            runs={reports.tasks}
            selectedRunId={selectedRunId || undefined}
            onSelectRun={setSelectedRunId}
          />
          <RunDetailPanel run={selectedRun} configs={configs} />
        </div>
      )}
      {view === "workflows" && (
        <div className="flex flex-col gap-4">
          <Card>
            <CardBody className="gap-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h2 className="text-base font-semibold">创建商用增长 SOP</h2>
                  <p className="mt-1 text-sm text-default-500">
                    选择模板后生成可确认、可备注、可复盘的流程；这里仅管理流程状态，不会触发正式发布或外部触达。
                  </p>
                </div>
                <Button
                  className="h-11"
                  color="primary"
                  startContent={<Network size={16} />}
                  onPress={() => createWorkflow()}
                >
                  创建流程
                </Button>
              </div>
              <div className="grid gap-3 lg:grid-cols-[1fr_280px]">
                <Input
                  label="工作流名称"
                  value={workflowForm.name}
                  onValueChange={(name) =>
                    setWorkflowForm({
                      ...workflowForm,
                      name,
                    })
                  }
                />
                <Select
                  label="模板"
                  selectedKeys={[workflowForm.template]}
                  onSelectionChange={(keys) => {
                    const template = String(
                      Array.from(keys)[0] || "content-to-growth",
                    );
                    const option = workflowTemplates.find(
                      (item) => item.key === template,
                    );
                    setWorkflowForm({
                      name: option?.label || workflowForm.name,
                      template,
                    });
                  }}
                >
                  {workflowTemplates.map((template) => (
                    <SelectItem key={template.key} textValue={template.label}>
                      {template.label}
                    </SelectItem>
                  ))}
                </Select>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                {workflowTemplates.map((template) => (
                  <button
                    key={template.key}
                    type="button"
                    aria-pressed={workflowForm.template === template.key}
                    className={`growth-template-option rounded-[8px] border px-3 py-3 text-left ${workflowForm.template === template.key ? "growth-template-option--active border-primary-300 bg-primary-50" : "border-default-200 bg-default-50 hover:border-default-300"}`}
                    onClick={() =>
                      setWorkflowForm({
                        name: template.label,
                        template: template.key,
                      })
                    }
                  >
                    <div className="flex items-center gap-2">
                      {workflowForm.template === template.key ? (
                        <CheckCircle2 size={16} className="text-primary" />
                      ) : (
                        <FileText size={16} className="text-primary" />
                      )}
                      <p className="text-sm font-medium">{template.label}</p>
                      {workflowForm.template === template.key && (
                        <Chip size="sm" color="primary" variant="flat">
                          已选模板
                        </Chip>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-default-500">
                      {template.desc}
                    </p>
                  </button>
                ))}
              </div>
            </CardBody>
          </Card>
          {workflows.length ? (
            <div className="grid gap-4 xl:grid-cols-2">
              {workflows.map((workflow) => (
                <WorkflowCard
                  key={workflow.id}
                  workflow={workflow}
                  onAction={workflowAction}
                  onUpdate={updateWorkflow}
                  onDelete={deleteWorkflow}
                />
              ))}
            </div>
          ) : (
            <CommercialEmptyState
              icon={Route}
              title="还没有增长流程"
              description="先选择模板并创建 SOP，再逐步填写备注、确认推进和复盘输出。"
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  {workflowTemplates.map((template) => (
                    <Button
                      key={template.key}
                      size="sm"
                      color={
                        workflowForm.template === template.key
                          ? "primary"
                          : "default"
                      }
                      variant={
                        workflowForm.template === template.key
                          ? "solid"
                          : "flat"
                      }
                      startContent={<Network size={14} />}
                      onPress={() => createWorkflow(template.key)}
                    >
                      用「
                      {template.label}
                      」创建
                    </Button>
                  ))}
                </div>
              }
            />
          )}
        </div>
      )}
      {view !== "acquisition" && !loading && (
        <GrowthReadinessStrip
          view={view}
          accounts={accounts}
          configs={configs}
          leads={leads}
          schedulePlan={schedulePlan}
          capabilitySnapshot={capabilitySnapshot}
        />
      )}
      <StrategyDetailModal
        strategy={detailStrategy}
        onClose={() => setDetailStrategy(null)}
        onEdit={(strategy) => {
          setDetailStrategy(null);
          openEditStrategy(strategy);
        }}
        onCopy={openCopyStrategyReview}
        onApply={openApplyStrategyReview}
      />
      <StrategyEditModal
        strategy={editingStrategy}
        form={strategyEditForm}
        errors={strategyEditErrors}
        onChange={setStrategyEditForm}
        onClose={() => setEditingStrategy(null)}
        onSave={saveStrategy}
      />
      <StrategyReviewModal
        review={strategyReview}
        strategyForm={strategyForm}
        copyForm={strategyReviewForm}
        copyErrors={strategyReviewErrors}
        applyForm={strategyApplyForm}
        loading={strategyActionLoading}
        onCopyFormChange={setStrategyReviewForm}
        onApplyFormChange={setStrategyApplyForm}
        onClose={() => {
          setStrategyReview(null);
          setStrategyReviewErrors({});
        }}
        onConfirm={confirmStrategyReview}
      />
      <StrategyDeleteModal
        strategy={deleteStrategyTarget}
        onClose={() => setDeleteStrategyTarget(null)}
        onConfirm={confirmDeleteStrategy}
      />
      <TaskDetailModal
        config={detailConfig}
        runs={runs.filter((run) => run.configId === detailConfig?.id)}
        onClose={() => setDetailConfig(null)}
        onEdit={(config) => {
          setDetailConfig(null);
          openEditConfig(config);
        }}
        onPreflight={executeConfig}
      />
      <TaskEditModal
        config={editingConfig}
        form={editForm}
        errors={editFormErrors}
        accounts={accounts}
        onChange={setEditForm}
        onClose={() => setEditingConfig(null)}
        onSave={saveEditingConfig}
      />
      <TaskDeleteModal
        config={deleteConfigTarget}
        onClose={() => setDeleteConfigTarget(null)}
        onConfirm={confirmDeleteConfig}
      />
      <PreflightModal
        preflight={preflight}
        loading={preflightLoading}
        executing={preflightExecuting}
        onClose={() => {
          if (!preflightExecuting) setPreflight(null);
        }}
        onExecute={confirmPreflightExecution}
      />
      <WorkflowConfirmModal
        state={workflowConfirm}
        onClose={() => setWorkflowConfirm(null)}
        onConfirm={confirmWorkflowOperation}
      />
      <AgentStatusDrawer
        session={statusSession}
        onClose={() => setStatusSession(null)}
        onUpdated={setStatusSession}
      />
    </div>
  );
}

function TaskDetailModal({
  config,
  runs,
  onClose,
  onEdit,
  onPreflight,
}: {
  config: GrowthAcquisitionConfig | null;
  runs: GrowthAcquisitionRun[];
  onClose: () => void;
  onEdit: (config: GrowthAcquisitionConfig) => void;
  onPreflight: (config: GrowthAcquisitionConfig) => void;
}) {
  return (
    <Modal
      isOpen={Boolean(config)}
      onClose={onClose}
      size="3xl"
      scrollBehavior="inside"
    >
      <ModalContent>
        {config && (
          <>
            <ModalHeader className="flex flex-col gap-1">
              <span>{config.taskName}</span>
              <span className="text-sm font-normal text-default-500">
                {getConfigExposureLabel(config)}·
                {platformLabels[config.platform] || config.platform}
              </span>
            </ModalHeader>
            <ModalBody className="gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <InfoLine
                  label="执行账号"
                  value={config.accountName || config.accountId}
                />
                <InfoLine
                  label="计划"
                  value={
                    config.scheduleEnabled
                      ? `${config.beginTime} 入队`
                      : "仅手动确认"
                  }
                />
                <InfoLine
                  label="风控"
                  value={riskModeLabels[config.riskMode] || config.riskMode}
                />
                <InfoLine
                  label="额度"
                  value={`${config.exposureCount}/${config.dailyLimit} · 单目标 ${config.perTargetLimit}`}
                />
                <InfoLine
                  label="去重"
                  value={config.deduplicate ? "开启" : "关闭"}
                />
                <InfoLine
                  label="最近执行"
                  value={formatDate(config.lastRunAt)}
                />
              </div>
              <Divider />
              <div className="grid gap-3 md:grid-cols-2">
                <InfoBlock label="来源" values={config.sourceInputs} />
                <InfoBlock label="意向关键词" values={config.includeKeywords} />
                <InfoBlock label="排除词" values={config.excludeKeywords} />
                <InfoBlock
                  label="黑名单昵称"
                  values={config.blacklistNicknames}
                />
                <InfoBlock label="评论话术" values={config.commentTemplates} />
                <InfoBlock
                  label="私信话术"
                  values={config.privateMessageTemplates}
                />
              </div>
              <Divider />
              <div className="flex flex-col gap-2">
                <h3 className="font-semibold">最近任务结果</h3>
                {runs.length ? (
                  runs.slice(0, 5).map((run) => (
                    <div
                      key={run.id}
                      className="rounded-[8px] border border-default-200 p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Chip
                          color={runStatusChipColor(run.status)}
                          size="sm"
                          variant="flat"
                        >
                          {statusLabels[run.status] || run.status}
                        </Chip>
                        <Chip size="sm" variant="flat">
                          {runExecutionBoundaryLabel(run)}
                        </Chip>
                        <span className="text-xs text-default-500">
                          {formatDate(run.startedAt)}
                        </span>
                        <span className="text-xs text-default-500">
                          线索
                          {run.selectedCount}/{run.candidateCount}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-default-500">
                        {displayText(run.message)}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-default-500">当前没有任务结果</p>
                )}
              </div>
            </ModalBody>
            <ModalFooter>
              <Button variant="flat" onPress={onClose}>
                关闭
              </Button>
              <Button
                variant="flat"
                startContent={<Edit3 size={16} />}
                onPress={() => onEdit(config)}
              >
                编辑
              </Button>
              <Button
                color="primary"
                startContent={<ShieldCheck size={16} />}
                onPress={() => onPreflight(config)}
              >
                执行前确认
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

function TaskEditModal({
  config,
  form,
  errors,
  accounts,
  onChange,
  onClose,
  onSave,
}: {
  config: GrowthAcquisitionConfig | null;
  form: AcquisitionTaskForm;
  errors: AcquisitionFormErrors;
  accounts: GrowthAccountHealth[];
  onChange: (form: AcquisitionTaskForm) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <Modal
      isOpen={Boolean(config)}
      onClose={onClose}
      size="3xl"
      scrollBehavior="inside"
    >
      <ModalContent>
        <ModalHeader>编辑获客任务</ModalHeader>
        <ModalBody>
          <TaskFormFields
            form={form}
            errors={errors}
            accounts={accounts}
            onChange={onChange}
          />
        </ModalBody>
        <ModalFooter>
          <Button
            variant="flat"
            startContent={<XCircle size={16} />}
            onPress={onClose}
          >
            取消
          </Button>
          <Button
            color="primary"
            startContent={<Save size={16} />}
            onPress={onSave}
          >
            保存任务
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
function TaskDeleteModal({
  config,
  onClose,
  onConfirm,
}: {
  config: GrowthAcquisitionConfig | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal isOpen={Boolean(config)} onClose={onClose}>
      <ModalContent>
        {config && (
          <>
            <ModalHeader>删除获客任务</ModalHeader>
            <ModalBody className="gap-3">
              <p className="text-sm text-default-600">
                删除后任务配置会从获客矩阵移除，历史任务结果和已沉淀线索不会被删除。
              </p>
              <div className="rounded-[8px] border border-danger-200 bg-danger-50 p-3">
                <p className="font-medium text-danger-700">{config.taskName}</p>
                <p className="mt-1 text-sm text-danger-700">
                  {platformLabels[config.platform] || config.platform}·
                  {config.accountName || config.accountId}
                </p>
              </div>
            </ModalBody>
            <ModalFooter>
              <Button variant="flat" onPress={onClose}>
                取消
              </Button>
              <Button
                color="danger"
                startContent={<Trash2 size={16} />}
                onPress={onConfirm}
              >
                确认删除
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

function PreflightModal({
  preflight,
  loading,
  executing,
  onClose,
  onExecute,
}: {
  preflight: GrowthAcquisitionPreflight | null;
  loading: boolean;
  executing: boolean;
  onClose: () => void;
  onExecute: () => void | Promise<void>;
}) {
  const statusColor = preflight?.allowed ? "success" : "warning";
  const executionMode = preflight
    ? getExecutionModeState(preflight.config.riskMode, preflight.account)
    : null;
  return (
    <Modal
      isOpen={loading || Boolean(preflight)}
      onClose={onClose}
      size="2xl"
      scrollBehavior="inside"
    >
      <ModalContent>
        <ModalHeader>执行前确认</ModalHeader>
        <ModalBody className="gap-4">
          {loading && <Spinner label="正在生成确认单..." />}
          {preflight && (
            <>
              <div className="rounded-[8px] border border-default-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip color={statusColor} variant="flat">
                    {preflight.allowed ? "检查通过" : "存在需处理项"}
                  </Chip>
                  <span className="text-sm font-medium">
                    {preflight.config.taskName}
                  </span>
                </div>
                <p className="mt-2 text-sm text-default-500">
                  {displayText(preflight.summary)}
                </p>
                {executionMode && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-default-500">执行模式</span>
                    <Chip size="sm" color={executionMode.color} variant="flat">
                      {executionMode.label}
                    </Chip>
                    <span className="text-xs text-default-500">
                      {executionMode.detail}
                    </span>
                  </div>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <InfoLine
                  label="账号状态"
                  value={
                    preflight.account
                      ? `${loginStatusLabels[preflight.account.loginStatus]} · ${riskStatusLabels[preflight.account.riskStatus]}`
                      : "未找到账号"
                  }
                />
                <InfoLine
                  label="玩法"
                  value={getConfigExposureLabel(preflight.config)}
                />
                <InfoLine
                  label="剩余额度"
                  value={`${preflight.remainingToday}/${preflight.config.dailyLimit}`}
                />
                <InfoLine
                  label="计划状态"
                  value={
                    preflight.planItem
                      ? scheduleStatusLabels[preflight.planItem.status]
                      : "未入队"
                  }
                />
                <InfoLine
                  label="执行风控"
                  value={
                    riskModeLabels[preflight.config.riskMode] ||
                    preflight.config.riskMode
                  }
                />
              </div>
              <div className="grid gap-2 rounded-[8px] border border-default-200 bg-default-50 p-3 text-sm md:grid-cols-4">
                <div>
                  <p className="text-xs text-default-500">1. 任务配置</p>
                  <p className="mt-1 font-medium">来源、话术、额度已锁定</p>
                </div>
                <div>
                  <p className="text-xs text-default-500">2. 到期队列</p>
                  <p className="mt-1 font-medium">
                    {preflight.planItem
                      ? scheduleStatusLabels[preflight.planItem.status]
                      : "手动打开检查"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-default-500">3. 安全检查</p>
                  <p className="mt-1 font-medium">
                    {preflight.allowed ? "可人工确认" : "先处理问题"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-default-500">4. 任务结果</p>
                  <p className="mt-1 font-medium">
                    发起执行后沉淀逐对象结果
                  </p>
                </div>
              </div>
              <InfoList title="安全检查" items={preflight.checks} positive />
              <InfoList title="风险提示" items={preflight.warnings} />
              <InfoList title="需处理原因" items={preflight.blockers} danger />
              <div className="rounded-[8px] bg-default-50 p-3 text-sm text-default-600">
                本页在确认前只展示锁定内容，不会自动采集、回复或调度；只有检查通过后点击"确认并执行"才会发起操作。
              </div>
              {preflight.blockers.length ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    as={Link}
                    href="/growth?view=account-health"
                    size="sm"
                    variant="flat"
                  >
                    处理账号与风控
                  </Button>
                  <Button
                    as={Link}
                    href="/apps/ai-employee"
                    size="sm"
                    variant="flat"
                  >
                    查看执行能力
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </ModalBody>
        <ModalFooter>
          <Button isDisabled={executing} variant="flat" onPress={onClose}>
            关闭
          </Button>
          <Button
            color="primary"
            isDisabled={
              !preflight?.allowed || Boolean(preflight?.blockers.length)
            }
            isLoading={executing}
            startContent={<CheckCircle2 size={16} />}
            onPress={() => void onExecute()}
          >
            {executing ? "正在发起执行" : "确认并执行"}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function WorkflowConfirmModal({
  state,
  onClose,
  onConfirm,
}: {
  state: WorkflowConfirmState | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal isOpen={Boolean(state)} onClose={onClose} placement="center">
      <ModalContent>
        {state && (
          <>
            <ModalHeader>{state.title}</ModalHeader>
            <ModalBody className="gap-3">
              <p className="text-sm text-default-600">{state.message}</p>
              {state.actionDraft?.saveBeforeAction && (
                <div className="rounded-[8px] border border-primary-200 bg-primary-50 px-3 py-3 text-sm text-primary-700">
                  将先保存步骤「
                  {state.actionDraft.stepName}
                  」的说明和执行备注，再更新流程状态。
                </div>
              )}
              {(state.action === "advance" ||
                state.action === "complete-step") &&
                !state.actionDraft?.stepOutputSummary.trim() && (
                  <div className="rounded-[8px] border border-warning-200 bg-warning-50 px-3 py-3 text-sm text-warning-700">
                    当前没有人工确认结果。可以继续完成，但复盘时只能看到系统默认完成记录。
                  </div>
                )}
              <div
                className={`rounded-[8px] px-3 py-3 text-sm ${state.danger ? "bg-danger-50 text-danger-700" : "bg-default-50 text-default-600"}`}
              >
                流程操作只改变本系统内的 SOP
                状态、步骤备注和复盘记录，不会触发正式发布或外部触达。
              </div>
            </ModalBody>
            <ModalFooter>
              <Button variant="flat" onPress={onClose}>
                取消
              </Button>
              <Button
                color={state.danger ? "danger" : "primary"}
                startContent={<CheckCircle2 size={16} />}
                onPress={onConfirm}
              >
                确认
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

function GrowthReadinessStrip({
  view,
  accounts,
  configs,
  leads,
  schedulePlan,
  capabilitySnapshot,
}: {
  view: GrowthView;
  accounts: GrowthAccountHealth[];
  configs: GrowthAcquisitionConfig[];
  leads: GrowthLead[];
  schedulePlan: GrowthSchedulePlan | null;
  capabilitySnapshot?: AiEmployeeCapabilitiesSnapshot | null;
}) {
  const readyAccounts = accounts.filter(isAccountReady).length;
  const riskAccounts = accounts.filter((account) => !isAccountReady(account));
  const enabledConfigs = configs.filter(
    (config) => config.status === "enabled",
  );
  const readyPlans =
    schedulePlan?.items.filter((item) =>
      ["ready", "waiting-confirmation"].includes(item.status),
    ).length || 0;
  const highIntentLeads = leads.filter(
    (lead) => lead.score >= 75 && !["ignored", "blocked"].includes(lead.status),
  ).length;
  const platforms = Array.from(
    new Set<GrowthPlatform>([
      ...accounts.map((account) => account.platform),
      ...configs.map((config) => config.platform),
      "douyin",
    ]),
  );
  const primaryPlatform = platforms.includes("douyin")
    ? "douyin"
    : platforms[0];
  const capability = resolvedPlatformCapability(
    primaryPlatform,
    capabilitySnapshot,
  );
  const viewHelp: Record<GrowthView, string> = {
    overview: "总览页用于判断今天增长流程是否有线索、有触达、有风险。",
    acquisition: "任务创建后先进入计划和安全检查，确认通过后才进入任务结果。",
    strategies: "策略是可复用资产，套用前会先复核字段和风险。",
    leads: "真实触达成功会自动沉淀到 CRM，手动线索可单条同步。",
    "account-health": "账号健康决定任务能否通过检查和进入正式执行。",
    reports: "复盘按当前筛选导出趋势、瓶颈、任务、账号和话术表现。",
    workflows: "流程只推进本系统 SOP 状态，不直接触发外部发布或触达。",
  };
  const statusItems = [
    {
      label: "可执行账号",
      value: `${readyAccounts}/${accounts.length}`,
      tone:
        readyAccounts > 0
          ? ("success" as const)
          : accounts.length
            ? ("warning" as const)
            : ("danger" as const),
      detail:
        readyAccounts > 0
          ? "已有账号可通过安全检查。"
          : "需要先处理授权、验证或冷却。",
      href: "/growth?view=account-health",
    },
    {
      label: "启用任务",
      value: String(enabledConfigs.length),
      tone: enabledConfigs.length ? ("success" as const) : ("warning" as const),
      detail: enabledConfigs.length
        ? "任务矩阵已有可进入计划的配置。"
        : "先创建获客任务再进入检查。",
      href: "/growth?view=acquisition",
    },
    {
      label: "到期检查",
      value: String(readyPlans),
      tone: readyPlans ? ("primary" as const) : ("default" as const),
      detail:
        schedulePlan && readyPlans
          ? "有任务可打开确认单。"
          : "当前没有需要立即处理的到期任务。",
      href: "/growth?view=acquisition",
    },
    {
      label: "高意向线索",
      value: String(highIntentLeads),
      tone: highIntentLeads ? ("success" as const) : ("default" as const),
      detail: highIntentLeads
        ? "建议进入线索池安排跟进。"
        : "暂无高意向线索沉淀。",
      href: "/growth?view=leads",
    },
  ];
  return (
    <Card>
      <CardBody className="gap-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Chip size="sm" color="primary" variant="flat">
                当前页主线
              </Chip>
              <p className="text-sm font-medium">{viewHelp[view]}</p>
            </div>
            <p className="mt-2 text-sm text-default-500">
              平台能力：
              {platformLabels[primaryPlatform] || primaryPlatform}·
              {capability.status}。{capability.detail}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {capability.modes.map((mode) => (
              <Chip key={mode} size="sm" variant="flat">
                {mode}
              </Chip>
            ))}
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {statusItems.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="rounded-[8px] border border-default-200 bg-default-50 px-3 py-3 transition hover:border-primary-200 hover:bg-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-semibold text-default-500">
                  {item.label}
                </span>
                <Chip size="sm" color={item.tone} variant="flat">
                  {item.value}
                </Chip>
              </div>
              <p className="mt-2 text-xs leading-5 text-default-500">
                {item.detail}
              </p>
            </Link>
          ))}
        </div>
        {riskAccounts.length > 0 && (
          <div className="rounded-[8px] border border-warning-200 bg-warning-50 px-3 py-2 text-sm text-warning-700">
            {riskAccounts.length}
            个账号需要处理。高风险账号会暂停正式执行，请先到账号健康中心复核。
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function ExposurePreviewPanel({
  definitions,
  form,
  errors,
  accounts,
  busyType,
  saveBusyType,
  configs,
  runs,
  capabilitySnapshot,
  capabilityLoadState,
  onApply,
  onChange,
  onSave,
  onPreview,
  onRefreshCapability,
  onView,
  onEdit,
  onConfirm,
  onToggle,
  onDelete,
}: {
  definitions: typeof exposurePreviewDefinitions;
  form: AcquisitionTaskForm;
  errors: AcquisitionFormErrors;
  accounts: GrowthAccountHealth[];
  busyType: ExposurePreviewType | "";
  saveBusyType: ExposurePreviewType | "";
  configs: GrowthAcquisitionConfig[];
  runs: GrowthAcquisitionRun[];
  capabilitySnapshot?: AiEmployeeCapabilitiesSnapshot | null;
  capabilityLoadState: CapabilityLoadState;
  onApply: (definition: ExposurePreviewDefinition) => void;
  onChange: (form: AcquisitionTaskForm) => void;
  onSave: (definition: ExposurePreviewDefinition) => void;
  onPreview: (definition: ExposurePreviewDefinition) => void;
  onRefreshCapability: () => void | Promise<void>;
  onView: (config: GrowthAcquisitionConfig) => void;
  onEdit: (config: GrowthAcquisitionConfig) => void;
  onConfirm: (config: GrowthAcquisitionConfig) => void;
  onToggle: (config: GrowthAcquisitionConfig) => void | Promise<void>;
  onDelete: (config: GrowthAcquisitionConfig) => void;
}) {
  const [activeType, setActiveType] = React.useState<ExposurePreviewType>(
    definitions[0]?.type || "exposure.auto",
  );
  const [sidePanel, setSidePanel] = React.useState<
    "form" | "reuse" | "import" | "stats" | "records"
  >("form");
  const [bulkSourceText, setBulkSourceText] =
    React.useState("装修\n旧房翻新\n全屋定制");
  const activeDefinition =
    definitions.find((definition) => definition.type === activeType) ||
    definitions[0];
  const activeConfigs = React.useMemo(
    () =>
      activeDefinition
        ? configs.filter((config) =>
            isConfigForExposureDefinition(config, activeDefinition),
          )
        : [],
    [activeDefinition, configs],
  );
  const activeRuns = React.useMemo(
    () =>
      activeDefinition
        ? runs.filter((run) =>
            isRunForExposureDefinition(run, configs, activeDefinition),
          )
        : [],
    [activeDefinition, configs, runs],
  );
  const latestRunByConfig = React.useMemo(() => {
    const map = new Map<string, GrowthAcquisitionRun>();
    activeRuns.forEach((run) => {
      if (!map.has(run.configId)) map.set(run.configId, run);
    });
    return map;
  }, [activeRuns]);
  const activeStats = React.useMemo(
    () =>
      activeRuns.reduce(
        (acc, run) => {
          acc.candidate += run.candidateCount;
          acc.selected += run.selectedCount;
          acc.contacted += run.contactedCount;
          acc.crm += run.crmCapturedCount;
          if (run.status === "failed" || run.status === "skipped")
            acc.failed += 1;
          if (run.status === "success" || run.status === "partial")
            acc.success += 1;
          return acc;
        },
        {
          candidate: 0,
          selected: 0,
          contacted: 0,
          crm: 0,
          failed: 0,
          success: 0,
        },
      ),
    [activeRuns],
  );
  if (!activeDefinition) return null;
  const activeCapability = capabilitySnapshot?.capabilities.find(
    (capability) =>
      capability.key === exposureCapabilityKeys[activeDefinition.type],
  );
  const activeExecutionBoundary = exposureExecutionBoundary(
    activeCapability,
    capabilityLoadState,
  );
  const realExecutionBlocked = !activeExecutionBoundary.canExecute;
  const openCreatePanel = (definition: ExposurePreviewDefinition) => {
    onApply(definition);
    setSidePanel("form");
  };
  const applyConfigToForm = (config: GrowthAcquisitionConfig) => {
    onChange(configToForm(config));
    setSidePanel("form");
    toast.success(`${config.taskName}已套用到配置表单`);
  };
  const applyBulkSource = () => {
    const sourceInputs = splitLines(bulkSourceText).join("\n");
    if (!sourceInputs) {
      toast.error("请先粘贴账号、链接、关键词或候选线索");
      return;
    }
    onChange({
      ...exposureDefinitionToForm(activeDefinition, form),
      sourceInputs,
      taskName: form.taskName.includes(activeDefinition.title)
        ? form.taskName
        : `${activeDefinition.title}批量配置`,
    });
    setSidePanel("form");
    toast.success("批量来源已回填到配置表单");
  };
  const selectedAccount = findAccountByKey(accounts, form.accountKey);
  const sidePanelTitle = {
    form: "配置表单",
    reuse: "复用配置",
    import: "批量导入",
    stats: "曝光统计",
    records: "曝光记录",
  }[sidePanel];
  return (
    <OpsPanel
      extra={
        <Button
          as={Link}
          href="/tasks"
          size="sm"
          startContent={<ExternalLink size={14} />}
          variant="flat"
        >
          任务中心
        </Button>
      }
      title="自动获客矩阵"
    >
      <div className="grid gap-3">
        <OpsToolbar>
          <OpsMetric label="曝光类型" tone="brand" value={definitions.length} />
          <OpsMetric label="获客任务" value={configs.length} />
          <OpsMetric label="记录" value={runs.length} />
          <OpsStatusPill tone="brand">创建获客任务</OpsStatusPill>
          <OpsStatusPill tone="success">安全检查</OpsStatusPill>
          <OpsStatusPill tone="warning">到期检查</OpsStatusPill>
          <OpsStatusPill tone="warning">发送前确认</OpsStatusPill>
          <OpsStatusPill tone="brand">获客任务列表</OpsStatusPill>
          <OpsStatusPill
            tone={activeExecutionBoundary.tone}
          >
            当前模式：{activeExecutionBoundary.label}
          </OpsStatusPill>
        </OpsToolbar>
        <div className="grid gap-3 xl:grid-cols-[220px_1fr]">
          <div className="grid content-start gap-2">
            {definitions.map((definition) => {
              const configCount = configs.filter((config) =>
                isConfigForExposureDefinition(config, definition),
              ).length;
              const runCount = runs.filter((run) =>
                isRunForExposureDefinition(run, configs, definition),
              ).length;
              const definitionCapability =
                capabilitySnapshot?.capabilities.find(
                  (capability) =>
                    capability.key === exposureCapabilityKeys[definition.type],
                );
              const definitionBoundary = exposureExecutionBoundary(
                definitionCapability,
                capabilityLoadState,
              );
              const active = definition.type === activeDefinition.type;
              return (
                <button
                  key={definition.type}
                  data-growth-metric-card
                  className={`rounded-[6px] border px-3 py-2 text-left transition ${
                    active
                      ? "border-[#f759ab] bg-[#fff0f6] dark:bg-[#f759ab]/15"
                      : "border-divider bg-default-50 hover:border-[#f759ab]"
                  }`}
                  type="button"
                  onClick={() => setActiveType(definition.type)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold text-foreground">
                      {definition.title}
                    </span>
                    <OpsStatusPill
                      tone={
                        definition.riskLabel === "高风险" ? "danger" : "warning"
                      }
                    >
                      {definition.riskLabel}
                    </OpsStatusPill>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-default-500">
                    <span>配置 {configCount}</span>
                    <span>记录 {runCount}</span>
                    <OpsStatusPill
                      tone={definitionBoundary.tone}
                    >
                      {definitionBoundary.label}
                    </OpsStatusPill>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="grid gap-3">
            <div className="grid gap-3 rounded-[8px] border border-divider bg-default-50 p-3 md:grid-cols-2 xl:grid-cols-4">
              <div>
                <p className="text-[12px] font-medium text-default-500">
                  曝光类型
                </p>
                <p className="mt-1 text-[14px] font-semibold text-foreground">
                  {activeDefinition.title}
                </p>
              </div>
              <div>
                <p className="text-[12px] font-medium text-default-500">
                  关键来源
                </p>
                <p className="mt-1 text-[14px] font-semibold text-foreground">
                  {activeDefinition.sourceLabel}
                </p>
              </div>
              <div>
                <p className="text-[12px] font-medium text-default-500">
                  执行方式
                </p>
                <p className="mt-1 text-[14px] font-semibold text-foreground">
                  低频执行，发送前确认
                </p>
              </div>
              <div>
                <p className="text-[12px] font-medium text-default-500">
                  停止条件
                </p>
                <p className="mt-1 text-[14px] font-semibold text-foreground">
                  达到数量、账号异常或手动停用
                </p>
              </div>
              <div className="md:col-span-2 xl:col-span-4">
                <p className="text-[12px] font-medium text-default-500">
                  目标说明
                </p>
                <p className="mt-1 text-[13px] leading-5 text-default-700">
                  {activeDefinition.goal}
                </p>
              </div>
              <div
                className="flex flex-col gap-3 rounded-[6px] border border-divider bg-background p-3 md:col-span-2 xl:col-span-4 sm:flex-row sm:items-center sm:justify-between"
                data-testid="growth-exposure-execution-boundary"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[12px] font-semibold text-foreground">
                      当前运行边界
                    </p>
                    <Chip
                      color={activeExecutionBoundary.color}
                      size="sm"
                      variant="flat"
                    >
                      {activeExecutionBoundary.label}
                    </Chip>
                    <Chip color="primary" size="sm" variant="flat">
                      预览任务可创建
                    </Chip>
                    <Chip
                      color={
                        activeExecutionBoundary.canExecute
                          ? "success"
                          : "danger"
                      }
                      size="sm"
                      variant="flat"
                    >
                      外部动作
                      {activeExecutionBoundary.canExecute ? "已放行" : "已阻止"}
                    </Chip>
                  </div>
                  <p className="mt-1 text-[12px] leading-5 text-default-500">
                    {activeExecutionBoundary.detail}
                  </p>
                  <p className="mt-1 text-[12px] leading-5 text-default-500">
                    预览任务只进入任务状态页；下方曝光记录与触达统计不会把预览结果显示为真实触达。
                  </p>
                </div>
                {realExecutionBlocked ? (
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="flat"
                      onPress={() => void onRefreshCapability()}
                      isLoading={capabilityLoadState === "loading"}
                    >
                      重新检查能力
                    </Button>
                    <Button
                      as={Link}
                      href="/apps/ai-employee"
                      size="sm"
                      variant="flat"
                    >
                      查看处理方式
                    </Button>
                  </div>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2 md:col-span-2 xl:col-span-4">
                <Button
                  data-testid={`growth-exposure-save-${activeDefinition.type}`}
                  size="sm"
                  startContent={<Plus size={14} />}
                  variant="flat"
                  onPress={() => openCreatePanel(activeDefinition)}
                >
                  添加配置
                </Button>
                <Button
                  size="sm"
                  variant="flat"
                  onPress={() => {
                    onApply(activeDefinition);
                    setSidePanel("reuse");
                  }}
                >
                  应用此配置
                </Button>
                <Button
                  size="sm"
                  variant="flat"
                  onPress={() => setSidePanel("import")}
                >
                  批量导入
                </Button>
                <Button
                  color="primary"
                  data-testid={`growth-exposure-preview-${activeDefinition.type}`}
                  isLoading={busyType === activeDefinition.type}
                  size="sm"
                  startContent={
                    busyType === activeDefinition.type ? null : (
                      <ShieldCheck size={14} />
                    )
                  }
                  variant="flat"
                  onPress={() => onPreview(activeDefinition)}
                >
                  生成预览任务
                </Button>
                <Button
                  size="sm"
                  variant="flat"
                  onPress={() => setSidePanel("stats")}
                >
                  曝光统计
                </Button>
                <Button
                  size="sm"
                  variant="flat"
                  onPress={() => setSidePanel("records")}
                >
                  曝光记录
                </Button>
              </div>
            </div>

            <div className="grid gap-3 2xl:grid-cols-[minmax(0,1fr)_390px]">
              <div className="grid gap-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-[15px] font-semibold text-foreground">
                    获客任务列表
                  </h3>
                  <OpsStatusPill
                    tone={activeConfigs.length ? "brand" : "default"}
                  >
                    获客任务 {activeConfigs.length}
                  </OpsStatusPill>
                </div>
                <OpsDenseTable>
                  <div data-table-title className="sr-only">
                    获客任务
                  </div>
                  <table>
                    <thead>
                      <tr>
                        <th>获客任务</th>
                        <th>曝光类型</th>
                        <th>平台账号</th>
                        <th>任务执行方式</th>
                        <th>启动时间</th>
                        <th>曝光间隔</th>
                        <th>每账号数量</th>
                        <th>最近状态</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeConfigs.map((config) => {
                        const latestRun = latestRunByConfig.get(config.id);
                        const executionBlockedReason =
                          config.status !== "enabled"
                            ? "任务已停用，请先点击“启用”"
                            : config.riskMode === "draft-only"
                              ? "任务设置为“只生成线索草稿”，不会执行外部动作；需要外部动作时请先编辑任务执行方式"
                            : realExecutionBlocked
                              ? `${activeExecutionBoundary.label}：${activeExecutionBoundary.detail}`
                              : undefined;
                        return (
                          <tr key={config.id}>
                            <td>{config.taskName}</td>
                            <td>{getConfigExposureLabel(config)}</td>
                            <td>
                              {config.accountName ||
                                config.accountId ||
                                "待选择账号"}
                            </td>
                            <td>
                              {riskModeLabels[config.riskMode] ||
                                config.riskMode}
                            </td>
                            <td>{config.beginTime || "立即开始"}</td>
                            <td>{config.perTargetLimit || 1} 条/轮</td>
                            <td>{config.dailyLimit} / 天</td>
                            <td>
                              <OpsStatusPill
                                tone={
                                  latestRun
                                    ? runStatusTone(latestRun.status)
                                    : config.status === "enabled"
                                      ? "brand"
                                      : "default"
                                }
                              >
                                {latestRun
                                  ? statusLabels[latestRun.status] ||
                                    latestRun.status
                                  : statusLabels[config.status] ||
                                    config.status}
                              </OpsStatusPill>
                            </td>
                            <td>
                              <div className="flex min-w-[360px] flex-wrap gap-2">
                                <Button
                                  size="sm"
                                  variant="flat"
                                  onPress={() => onView(config)}
                                >
                                  详情
                                </Button>
                                <Button
                                  size="sm"
                                  variant="flat"
                                  onPress={() => onEdit(config)}
                                >
                                  编辑
                                </Button>
                                <Button
                                  size="sm"
                                  variant="flat"
                                  onPress={() => applyConfigToForm(config)}
                                >
                                  复用
                                </Button>
                                <Button
                                  size="sm"
                                  variant="flat"
                                  onPress={() => onConfirm(config)}
                                >
                                  执行前确认
                                </Button>
                                <Button
                                  color="primary"
                                  isDisabled={
                                    config.status !== "enabled" ||
                                    config.riskMode === "draft-only" ||
                                    realExecutionBlocked
                                  }
                                  size="sm"
                                  variant="flat"
                                  onPress={() => onConfirm(config)}
                                  title={executionBlockedReason}
                                >
                                  {config.status !== "enabled"
                                    ? "任务已停用"
                                    : config.riskMode === "draft-only"
                                      ? "仅生成线索草稿"
                                    : realExecutionBlocked
                                      ? "外部动作不可用"
                                      : "立即执行"}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="flat"
                                  onPress={() => void onToggle(config)}
                                >
                                  {config.status === "enabled"
                                    ? "停用"
                                    : "启用"}
                                </Button>
                                <Button
                                  color="danger"
                                  size="sm"
                                  variant="flat"
                                  onPress={() => onDelete(config)}
                                >
                                  删除
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {!activeConfigs.length ? (
                        <tr>
                          <td colSpan={9}>
                            当前没有{activeDefinition.title}
                            获客任务。点击“添加配置”创建获客任务后，先补齐来源、账号和话术，再保存。
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </OpsDenseTable>

                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-[15px] font-semibold text-foreground">
                    曝光记录
                  </h3>
                  <OpsStatusPill tone={activeRuns.length ? "brand" : "default"}>
                    {activeRuns.length} 条
                  </OpsStatusPill>
                </div>
                <OpsDenseTable>
                  <table>
                    <thead>
                      <tr>
                        <th>曝光类型</th>
                        <th>平台</th>
                        <th>执行边界</th>
                        <th>候选</th>
                        <th>已选</th>
                        <th>真实触达</th>
                        <th>客户沉淀</th>
                        <th>状态</th>
                        <th>开始时间</th>
                        <th>结果说明/失败原因</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeRuns.slice(0, 8).map((run) => (
                        <tr key={run.id}>
                          <td>{getRunExposureLabel(run, configs)}</td>
                          <td>
                            {platformLabels[run.platform] || run.platform}
                          </td>
                          <td>{runExecutionBoundaryLabel(run)}</td>
                          <td>{run.candidateCount}</td>
                          <td>{run.selectedCount}</td>
                          <td>{run.contactedCount}</td>
                          <td>{run.crmCapturedCount}</td>
                          <td>
                            <OpsStatusPill
                              tone={runStatusTone(run.status)}
                            >
                              {statusLabels[run.status] || run.status}
                            </OpsStatusPill>
                          </td>
                          <td>{formatDate(run.startedAt)}</td>
                          <td>
                            <p>{runOutcomeDetail(run)}</p>
                            {run.failureReason ? (
                              <p className="mt-1 text-[11px] text-danger-600">
                                原因代码：{run.failureReason}
                              </p>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                      {!activeRuns.length ? (
                        <tr>
                          <td colSpan={10}>当前没有曝光记录。</td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </OpsDenseTable>
              </div>

              <aside className="rounded-[8px] border border-divider bg-background p-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-[15px] font-semibold text-foreground">
                      {sidePanelTitle}
                    </p>
                    <p className="mt-1 text-[12px] text-default-500">
                      {activeDefinition.title} · {activeDefinition.sourceLabel}
                    </p>
                  </div>
                  <OpsStatusPill tone="brand">
                    {activeDefinition.riskLabel}
                  </OpsStatusPill>
                </div>
                {sidePanel === "form" ? (
                  <div className="grid gap-3">
                    <Input
                      isInvalid={Boolean(errors.taskName)}
                      errorMessage={errors.taskName}
                      label="配置名称"
                      size="sm"
                      value={form.taskName}
                      onValueChange={(taskName) =>
                        onChange({ ...form, taskName })
                      }
                    />
                    <Select
                      label="平台账号"
                      placeholder="选择在线账号"
                      selectedKeys={form.accountKey ? [form.accountKey] : []}
                      size="sm"
                      onSelectionChange={(keys) =>
                        onChange({
                          ...form,
                          accountKey: String(Array.from(keys)[0] || ""),
                        })
                      }
                    >
                      {accounts.map((account) => (
                        <SelectItem
                          key={accountKey(account)}
                          textValue={`${platformLabels[account.platform] || account.platform} ${account.accountName}`}
                        >
                          {platformLabels[account.platform] || account.platform}{" "}
                          · {account.accountName}
                        </SelectItem>
                      ))}
                    </Select>
                    <Textarea
                      isInvalid={Boolean(errors.sourceInputs)}
                      errorMessage={errors.sourceInputs}
                      label={activeDefinition.sourceLabel}
                      minRows={4}
                      placeholder={activeDefinition.sourcePlaceholder}
                      size="sm"
                      value={form.sourceInputs}
                      onValueChange={(sourceInputs) =>
                        onChange({ ...form, sourceInputs })
                      }
                    />
                    <Textarea
                      isInvalid={Boolean(errors.includeKeywords)}
                      errorMessage={errors.includeKeywords}
                      label="意向关键词"
                      minRows={2}
                      size="sm"
                      value={form.includeKeywords}
                      onValueChange={(includeKeywords) =>
                        onChange({ ...form, includeKeywords })
                      }
                    />
                    <Textarea
                      label="排除词/黑名单"
                      minRows={2}
                      size="sm"
                      value={form.excludeKeywords}
                      onValueChange={(excludeKeywords) =>
                        onChange({ ...form, excludeKeywords })
                      }
                    />
                    <Textarea
                      isInvalid={Boolean(errors.commentTemplates)}
                      errorMessage={errors.commentTemplates}
                      label="评论话术"
                      minRows={2}
                      size="sm"
                      value={form.commentTemplates}
                      onValueChange={(commentTemplates) =>
                        onChange({ ...form, commentTemplates })
                      }
                    />
                    <Textarea
                      isInvalid={Boolean(errors.privateMessageTemplates)}
                      errorMessage={errors.privateMessageTemplates}
                      label="私信话术"
                      minRows={2}
                      size="sm"
                      value={form.privateMessageTemplates}
                      onValueChange={(privateMessageTemplates) =>
                        onChange({ ...form, privateMessageTemplates })
                      }
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        isInvalid={Boolean(errors.dailyLimit)}
                        errorMessage={errors.dailyLimit}
                        label="每日上限"
                        size="sm"
                        value={form.dailyLimit}
                        onValueChange={(dailyLimit) =>
                          onChange({ ...form, dailyLimit })
                        }
                      />
                      <Input
                        isInvalid={Boolean(errors.perTargetLimit)}
                        errorMessage={errors.perTargetLimit}
                        label="单目标上限"
                        size="sm"
                        value={form.perTargetLimit}
                        onValueChange={(perTargetLimit) =>
                          onChange({ ...form, perTargetLimit })
                        }
                      />
                      <Input
                        isInvalid={Boolean(errors.beginTime)}
                        errorMessage={errors.beginTime}
                        label="开始时间"
                        size="sm"
                        value={form.beginTime}
                        onValueChange={(beginTime) =>
                          onChange({ ...form, beginTime })
                        }
                      />
                      <Select
                        label="执行方式"
                        selectedKeys={[form.riskMode]}
                        size="sm"
                        onSelectionChange={(keys) =>
                          onChange({
                            ...form,
                            riskMode: String(
                              Array.from(keys)[0] || "confirm-first",
                            ) as AcquisitionTaskForm["riskMode"],
                          })
                        }
                      >
                        {Object.entries(riskModeLabels).map(([key, label]) => (
                          <SelectItem key={key}>{label}</SelectItem>
                        ))}
                      </Select>
                    </div>
                    <div className="rounded-[6px] border border-divider bg-default-50 p-3 text-[12px] leading-5 text-default-600">
                      当前账号：
                      {selectedAccount
                        ? `${platformLabels[selectedAccount.platform] || selectedAccount.platform} · ${selectedAccount.accountName}`
                        : "尚未选择"}
                      。保存后会进入配置表，执行前仍可再次确认。
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        size="sm"
                        variant="flat"
                        onPress={() => openCreatePanel(activeDefinition)}
                      >
                        重置为默认
                      </Button>
                      <Button
                        color="primary"
                        data-testid={`growth-exposure-save-${activeDefinition.type}`}
                        isLoading={saveBusyType === activeDefinition.type}
                        size="sm"
                        startContent={
                          saveBusyType === activeDefinition.type ? null : (
                            <Save size={14} />
                          )
                        }
                        variant="flat"
                        onPress={() => onSave(activeDefinition)}
                      >
                        保存配置
                      </Button>
                    </div>
                  </div>
                ) : null}
                {sidePanel === "reuse" ? (
                  <div className="grid gap-3">
                    <p className="text-[12px] leading-5 text-default-500">
                      从同类配置中复用来源、账号、话术和数量限制，复用后可继续修改。
                    </p>
                    <OpsDenseTable>
                      <table>
                        <thead>
                          <tr>
                            <th>配置</th>
                            <th>账号</th>
                            <th>操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activeConfigs.map((config) => (
                            <tr key={`reuse-${config.id}`}>
                              <td>{config.taskName}</td>
                              <td>{config.accountName || config.accountId}</td>
                              <td>
                                <Button
                                  size="sm"
                                  variant="flat"
                                  onPress={() => applyConfigToForm(config)}
                                >
                                  复用
                                </Button>
                              </td>
                            </tr>
                          ))}
                          {!activeConfigs.length ? (
                            <tr>
                              <td colSpan={3}>暂无可复用配置。</td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </OpsDenseTable>
                  </div>
                ) : null}
                {sidePanel === "import" ? (
                  <div className="grid gap-3">
                    <Textarea
                      label="批量来源"
                      minRows={10}
                      placeholder={activeDefinition.sourcePlaceholder}
                      size="sm"
                      value={bulkSourceText}
                      onValueChange={setBulkSourceText}
                    />
                    <div className="rounded-[6px] border border-divider bg-default-50 p-3 text-[12px] leading-5 text-default-600">
                      支持一行一个关键词、账号、链接或候选线索；系统会自动拆分并回填到配置表单。
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        size="sm"
                        variant="flat"
                        onPress={() =>
                          setBulkSourceText(activeDefinition.sourceExample)
                        }
                      >
                        使用示例
                      </Button>
                      <Button
                        color="primary"
                        size="sm"
                        variant="flat"
                        onPress={applyBulkSource}
                      >
                        套用到表单
                      </Button>
                    </div>
                  </div>
                ) : null}
                {sidePanel === "stats" ? (
                  <div className="grid gap-3">
                    <div className="grid grid-cols-2 gap-2">
                      <OpsMetric
                        label="配置"
                        tone="brand"
                        value={activeConfigs.length}
                      />
                      <OpsMetric label="记录" value={activeRuns.length} />
                      <OpsMetric label="候选" value={activeStats.candidate} />
                      <OpsMetric label="已选" value={activeStats.selected} />
                      <OpsMetric
                        label="真实触达"
                        value={activeStats.contacted}
                      />
                      <OpsMetric
                        label="客户沉淀"
                        tone="success"
                        value={activeStats.crm}
                      />
                    </div>
                    <div className="rounded-[6px] border border-divider bg-default-50 p-3 text-[12px] leading-5 text-default-600">
                      成功记录 {activeStats.success} 条，失败或跳过{" "}
                      {activeStats.failed}
                      条。这里不统计“生成预览任务”；先处理失败原因，再扩大执行数量。
                    </div>
                  </div>
                ) : null}
                {sidePanel === "records" ? (
                  <div className="grid gap-3">
                    <OpsDenseTable>
                      <table>
                        <thead>
                          <tr>
                            <th>时间</th>
                            <th>执行边界</th>
                            <th>结果</th>
                            <th>线索</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activeRuns.slice(0, 10).map((run) => (
                            <tr key={`side-record-${run.id}`}>
                              <td>{formatDate(run.startedAt)}</td>
                              <td>{runExecutionBoundaryLabel(run)}</td>
                              <td>{statusLabels[run.status] || run.status}</td>
                              <td>
                                {run.selectedCount}/{run.candidateCount}
                              </td>
                            </tr>
                          ))}
                          {!activeRuns.length ? (
                            <tr>
                              <td colSpan={4}>暂无曝光记录。</td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </OpsDenseTable>
                  </div>
                ) : null}
              </aside>
            </div>
          </div>
        </div>
      </div>
    </OpsPanel>
  );
}

function TaskFormFields({
  form,
  errors,
  accounts,
  onChange,
}: {
  form: AcquisitionTaskForm;
  errors: AcquisitionFormErrors;
  accounts: GrowthAccountHealth[];
  onChange: (form: AcquisitionTaskForm) => void;
}) {
  const guidance = modeGuidance[form.mode];
  const selectedAccount = findAccountByKey(accounts, form.accountKey);
  const executionMode = getExecutionModeState(form.riskMode, selectedAccount);
  return (
    <div className="flex flex-col gap-4">
      <TaskFormSection
        title="目标"
        description="先定义任务类型和运营目标，后续字段会跟随玩法给出不同输入提示。"
      >
        <Input
          label="任务名称"
          value={form.taskName}
          onValueChange={(taskName) =>
            onChange({
              ...form,
              taskName,
            })
          }
          isInvalid={Boolean(errors.taskName)}
          errorMessage={errors.taskName}
        />
        <Select
          label="获客玩法"
          selectedKeys={[form.mode]}
          onSelectionChange={(keys) =>
            onChange({
              ...form,
              mode: Array.from(keys)[0] as GrowthAcquisitionMode,
            })
          }
        >
          {modes.map((mode) => (
            <SelectItem key={mode.key}>{mode.label}</SelectItem>
          ))}
        </Select>
        <ModeGuidanceCard mode={form.mode} />
      </TaskFormSection>
      <TaskFormSection
        title="平台账号"
        description="明确由哪个账号承担检查和触达风险；不可用账号会停止正式执行。"
      >
        <Select
          label="执行账号"
          placeholder="优先选择在线正常账号"
          selectedKeys={form.accountKey ? [form.accountKey] : []}
          onSelectionChange={(keys) =>
            onChange({
              ...form,
              accountKey: String(Array.from(keys)[0] || ""),
            })
          }
        >
          {accounts.map((account) => (
            <SelectItem
              key={accountKey(account)}
              textValue={`${account.accountName} ${platformLabels[account.platform] || account.platform}`}
            >
              {platformLabels[account.platform] || account.platform}·
              {account.accountName}·
              {loginStatusLabels[account.loginStatus] || account.loginStatus}·
              {riskStatusLabels[account.riskStatus] || account.riskStatus}
            </SelectItem>
          ))}
        </Select>
        <AccountReadiness accounts={accounts} selectedKey={form.accountKey} />
      </TaskFormSection>
      <TaskFormSection title="来源" description={guidance.sourceHelp}>
        <Textarea
          label={guidance.sourceLabel}
          minRows={4}
          placeholder={guidance.sourcePlaceholder}
          value={form.sourceInputs}
          onValueChange={(sourceInputs) =>
            onChange({
              ...form,
              sourceInputs,
            })
          }
          isInvalid={Boolean(errors.sourceInputs)}
          errorMessage={errors.sourceInputs}
        />
        <Textarea
          label="意向关键词"
          description={guidance.intentHelp}
          value={form.includeKeywords}
          onValueChange={(includeKeywords) =>
            onChange({
              ...form,
              includeKeywords,
            })
          }
          isInvalid={Boolean(errors.includeKeywords)}
          errorMessage={errors.includeKeywords}
        />
      </TaskFormSection>
      <TaskFormSection
        title="话术"
        description="评论和私信至少配置一类；检查会提示是否只生成草稿或需要人工确认。"
      >
        <Textarea
          label="评论话术池"
          minRows={3}
          value={form.commentTemplates}
          onValueChange={(commentTemplates) =>
            onChange({
              ...form,
              commentTemplates,
            })
          }
          isInvalid={Boolean(errors.commentTemplates)}
          errorMessage={errors.commentTemplates}
        />
        <Textarea
          label="私信承接话术池"
          minRows={3}
          value={form.privateMessageTemplates}
          onValueChange={(privateMessageTemplates) =>
            onChange({
              ...form,
              privateMessageTemplates,
            })
          }
          isInvalid={Boolean(errors.privateMessageTemplates)}
          errorMessage={errors.privateMessageTemplates}
        />
      </TaskFormSection>
      <TaskFormSection title="风控" description={guidance.riskHelp}>
        <ExecutionModeBanner state={executionMode} />
        <Select
          label="执行风控"
          selectedKeys={[form.riskMode]}
          onSelectionChange={(keys) =>
            onChange({
              ...form,
              riskMode: Array.from(keys)[0] as typeof form.riskMode,
            })
          }
          isInvalid={Boolean(errors.riskMode)}
          errorMessage={errors.riskMode}
        >
          {Object.entries(riskModeLabels).map(([key, label]) => (
            <SelectItem key={key}>{label}</SelectItem>
          ))}
        </Select>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="每日上限"
            value={form.dailyLimit}
            onValueChange={(dailyLimit) =>
              onChange({
                ...form,
                dailyLimit,
              })
            }
            isInvalid={Boolean(errors.dailyLimit)}
            errorMessage={errors.dailyLimit}
          />
          <Input
            label="单目标上限"
            value={form.perTargetLimit}
            onValueChange={(perTargetLimit) =>
              onChange({
                ...form,
                perTargetLimit,
              })
            }
            isInvalid={Boolean(errors.perTargetLimit)}
            errorMessage={errors.perTargetLimit}
          />
        </div>
        <Textarea
          label="排除词/黑名单关键词"
          value={form.excludeKeywords}
          onValueChange={(excludeKeywords) =>
            onChange({
              ...form,
              excludeKeywords,
            })
          }
        />
        <Input
          label="黑名单昵称"
          value={form.blacklistNicknames}
          onValueChange={(blacklistNicknames) =>
            onChange({
              ...form,
              blacklistNicknames,
            })
          }
        />
        <Select
          label="线索去重"
          selectedKeys={[form.deduplicate]}
          onSelectionChange={(keys) =>
            onChange({
              ...form,
              deduplicate: String(Array.from(keys)[0] || "true"),
            })
          }
        >
          <SelectItem key="true">按昵称/主页/原文去重</SelectItem>
          <SelectItem key="false">允许重复入池</SelectItem>
        </Select>
      </TaskFormSection>
      <TaskFormSection
        title="计划"
        description="到期任务会先进入队列检查，需处理原因和最近执行结果会回写到任务表。"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="加入执行计划"
            selectedKeys={[form.scheduleEnabled]}
            onSelectionChange={(keys) =>
              onChange({
                ...form,
                scheduleEnabled: String(Array.from(keys)[0] || "true"),
              })
            }
          >
            <SelectItem key="true">加入计划队列</SelectItem>
            <SelectItem key="false">仅手动确认</SelectItem>
          </Select>
          <Input
            label="计划开始时间"
            value={form.beginTime}
            onValueChange={(beginTime) =>
              onChange({
                ...form,
                beginTime,
              })
            }
            isInvalid={Boolean(errors.beginTime)}
            errorMessage={errors.beginTime}
          />
        </div>
      </TaskFormSection>
    </div>
  );
}

function TaskFormSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[8px] border border-default-200 bg-default-50 p-3">
      <div className="mb-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-1 text-xs leading-5 text-default-500">{description}</p>
      </div>
      <div className="grid gap-3">{children}</div>
    </section>
  );
}
function ModeGuidanceCard({ mode }: { mode: GrowthAcquisitionMode }) {
  const guidance = modeGuidance[mode];
  return (
    <div className="rounded-[8px] border border-primary-100 bg-primary-50 px-3 py-2 text-sm text-primary-700">
      <p className="font-medium">
        {modes.find((item) => item.key === mode)?.label || mode}
      </p>
      <p className="mt-1 text-xs leading-5">{guidance.sourceHelp}</p>
    </div>
  );
}
function ExecutionModeBanner({
  state,
}: {
  state: ReturnType<typeof getExecutionModeState>;
}) {
  return (
    <div className="rounded-[8px] border border-default-200 bg-background px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">当前执行模式</span>
        <Chip size="sm" color={state.color} variant="flat">
          {state.label}
        </Chip>
      </div>
      <p className="mt-1 text-xs leading-5 text-default-500">{state.detail}</p>
    </div>
  );
}
function InfoBlock({ label, values }: { label: string; values: string[] }) {
  return (
    <div>
      <p className="text-xs text-default-500">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {values.length ? (
          values.map((value) => (
            <Chip key={value} size="sm" variant="flat">
              {value}
            </Chip>
          ))
        ) : (
          <span className="text-sm text-default-400">未配置</span>
        )}
      </div>
    </div>
  );
}

function InfoList({
  title,
  items,
  positive,
  danger,
}: {
  title: string;
  items: string[];
  positive?: boolean;
  danger?: boolean;
}) {
  const color = danger
    ? "text-danger-700"
    : positive
      ? "text-success-700"
      : "text-warning-700";
  if (!items.length) return null;
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="mt-2 flex flex-col gap-2">
        {items.map((item) => (
          <p key={item} className={`text-sm ${color}`}>
            {displayText(item)}
          </p>
        ))}
      </div>
    </div>
  );
}
function CommercialEmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="growth-empty-state flex flex-col items-center gap-3 rounded-[8px] border border-default-200 bg-default-50 px-4 py-10 text-center">
      <Icon size={34} className="text-default-400" />
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-1 max-w-xl text-sm text-default-500">{description}</p>
      </div>
      {action ? (
        <div className="flex flex-wrap justify-center gap-2">{action}</div>
      ) : null}
    </div>
  );
}

function ReportControlPanel({
  filters,
  preset,
  configs,
  reports,
  onPresetChange,
  onFiltersChange,
  onExport,
  onExportJson,
}: {
  filters: GrowthReportQuery;
  preset: ReportRangePreset;
  configs: GrowthAcquisitionConfig[];
  reports: GrowthReports | null;
  onPresetChange: (preset: ReportRangePreset) => void;
  onFiltersChange: (filters: Partial<GrowthReportQuery>) => void;
  onExport: () => void;
  onExportJson: () => void;
}) {
  const taskOptions = [
    {
      key: "all",
      label: "全部任务",
    },
    ...configs.map((config) => ({
      key: config.id,
      label: config.taskName,
    })),
  ];
  return (
    <Card>
      <CardBody className="gap-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="grid flex-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
            <Select
              label="时间范围"
              startContent={<Filter size={16} />}
              selectedKeys={[preset]}
              onSelectionChange={(keys) =>
                onPresetChange(
                  (Array.from(keys)[0] || "7d") as ReportRangePreset,
                )
              }
            >
              {reportRangeOptions.map((option) => (
                <SelectItem key={option.key}>{option.label}</SelectItem>
              ))}
            </Select>
            <Input
              type="date"
              label="开始日期"
              value={filters.startDate || ""}
              onValueChange={(startDate) =>
                onFiltersChange({
                  startDate,
                })
              }
            />
            <Input
              type="date"
              label="结束日期"
              value={filters.endDate || ""}
              onValueChange={(endDate) =>
                onFiltersChange({
                  endDate,
                })
              }
            />
            <Select
              label="平台"
              selectedKeys={[filters.platform || "all"]}
              onSelectionChange={(keys) =>
                onFiltersChange({
                  platform: String(Array.from(keys)[0] || "all"),
                })
              }
            >
              {platformOptions.map((option) => (
                <SelectItem key={option.key}>{option.label}</SelectItem>
              ))}
            </Select>
            <Select
              label="任务"
              selectedKeys={[filters.configId || "all"]}
              onSelectionChange={(keys) =>
                onFiltersChange({
                  configId: String(Array.from(keys)[0] || "all"),
                })
              }
            >
              {taskOptions.map((option) => (
                <SelectItem key={option.key} textValue={option.label}>
                  {option.label}
                </SelectItem>
              ))}
            </Select>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              className="h-11"
              color="primary"
              variant="flat"
              startContent={<Download size={16} />}
              onPress={onExport}
            >
              导出 CSV
            </Button>
            <Button
              className="h-11"
              color="primary"
              variant="flat"
              startContent={<FileText size={16} />}
              onPress={onExportJson}
            >
              导出快照
            </Button>
          </div>
        </div>
        <div className="grid gap-3 border-t border-default-100 pt-4 text-sm lg:grid-cols-3">
          <div className="rounded-[8px] bg-default-50 px-3 py-2">
            <p className="font-medium">CSV 内容范围</p>
            <p className="mt-1 text-default-500">
              趋势、瓶颈、任务表现、账号表现、话术、线索状态和任务结果。
            </p>
          </div>
          <div className="rounded-[8px] bg-default-50 px-3 py-2">
            <p className="font-medium">快照内容范围</p>
            <p className="mt-1 text-default-500">
              保留筛选条件、漏斗汇总、账号健康、瓶颈诊断和原始运行数据。
            </p>
          </div>
          <div className="rounded-[8px] bg-default-50 px-3 py-2">
            <p className="font-medium">当前可导出</p>
            <p className="mt-1 text-default-500">
              {reports
                ? `${reports.tasks.length} 条任务结果 · ${reports.accounts.length} 个账号 · ${reports.trend.length} 天趋势`
                : "数据加载完成后可导出。"}
            </p>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function MetricDrilldownPanel({
  drilldown,
  reports,
  configs,
  accounts,
  onClose,
}: {
  drilldown: ReportDrilldownKey;
  reports: GrowthReports | null;
  configs: GrowthAcquisitionConfig[];
  accounts: GrowthAccountHealth[];
  onClose: () => void;
}) {
  const configById = new Map(configs.map((config) => [config.id, config]));
  const relatedRuns = (reports?.tasks || []).filter((run) => {
    if (drilldown === "contacted") return run.contactedCount > 0;
    if (drilldown === "candidates") return run.candidateCount > 0;
    if (drilldown === "selected") return run.selectedCount > 0;
    if (drilldown === "crmCaptured") return run.crmCapturedCount > 0;
    return true;
  });
  const riskAccounts = (reports?.accounts || accounts).filter(
    (account) =>
      account.riskStatus !== "normal" || account.loginStatus !== "online",
  );
  return (
    <Card>
      <CardBody className="gap-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-semibold">
              {reportDrilldownLabels[drilldown]}
              下钻
            </h2>
            <p className="text-sm text-default-500">
              按当前筛选条件展示可追溯的任务、账号和转化线索入口。
            </p>
          </div>
          <Button size="sm" variant="flat" onPress={onClose}>
            收起
          </Button>
        </div>
        {drilldown === "risk" ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {riskAccounts.map((account) => (
              <div
                key={account.id}
                className="rounded-[8px] border border-default-200 p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{account.accountName}</p>
                  <Chip size="sm" color="warning" variant="flat">
                    {riskStatusLabels[account.riskStatus] || account.riskStatus}
                  </Chip>
                </div>
                <p className="mt-1 text-sm text-default-500">
                  {platformLabels[account.platform] || account.platform}· 失败率
                  {Math.round(account.failureRate * 100)}%
                </p>
                <p className="mt-2 text-sm">{account.recommendation}</p>
                <Button
                  as={Link}
                  href={`/growth?view=account-health&account=${encodeURIComponent(accountKey(account))}`}
                  className="mt-3"
                  size="sm"
                  variant="flat"
                  startContent={<HeartPulse size={14} />}
                >
                  去处理账号
                </Button>
              </div>
            ))}
            {!riskAccounts.length && (
              <p className="text-sm text-default-500">
                当前筛选范围内暂无风险账号。
              </p>
            )}
          </div>
        ) : (
          <Table
            aria-label={`${reportDrilldownLabels[drilldown]}下钻`}
            classNames={growthTableClassNames}
          >
            <TableHeader>
              <TableColumn>任务</TableColumn>
              <TableColumn>平台</TableColumn>
              <TableColumn>结果</TableColumn>
              <TableColumn>候选/筛选/触达</TableColumn>
              <TableColumn>证据</TableColumn>
              <TableColumn>动作</TableColumn>
            </TableHeader>
            <TableBody emptyContent="当前筛选范围内暂无可下钻记录">
              {relatedRuns.slice(0, 8).map((run) => {
                const config = configById.get(run.configId);
                return (
                  <TableRow key={run.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">
                          {config?.taskName || run.configId}
                        </p>
                        <p className="text-xs text-default-500">
                          {formatDate(run.startedAt)}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      {platformLabels[run.platform] || run.platform}
                    </TableCell>
                    <TableCell>
                      <Chip
                        color={runStatusChipColor(run.status)}
                        size="sm"
                        variant="flat"
                      >
                        {statusLabels[run.status] || run.status}
                      </Chip>
                      <p className="mt-1 text-xs text-default-500">
                        {runExecutionBoundaryLabel(run)}
                      </p>
                    </TableCell>
                    <TableCell>
                      {run.candidateCount}/{run.selectedCount}/
                      {run.contactedCount}
                    </TableCell>
                    <TableCell>{run.evidenceUrls.length}</TableCell>
                    <TableCell>
                      <Button
                        as={Link}
                        href={`/growth?view=acquisition&configId=${encodeURIComponent(run.configId)}`}
                        size="sm"
                        variant="flat"
                        startContent={<ArrowRight size={14} />}
                      >
                        查看任务
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardBody>
    </Card>
  );
}

function StrategyCard({
  strategy,
  onView,
  onEdit,
  onCopy,
  onApply,
  onDelete,
}: {
  strategy: GrowthStrategyTemplate;
  onView: (strategy: GrowthStrategyTemplate) => void;
  onEdit: (strategy: GrowthStrategyTemplate) => void;
  onCopy: (strategy: GrowthStrategyTemplate) => void;
  onApply: (strategy: GrowthStrategyTemplate) => void;
  onDelete: (strategy: GrowthStrategyTemplate) => void;
}) {
  const diagnostics = strategy.diagnostics;
  const levelColor =
    diagnostics?.level === "excellent"
      ? "success"
      : diagnostics?.level === "healthy"
        ? "primary"
        : diagnostics?.level === "needs-work"
          ? "warning"
          : "danger";
  const levelLabel: Record<string, string> = {
    excellent: "优秀",
    healthy: "健康",
    "needs-work": "待优化",
    risky: "风险",
  };
  return (
    <Card>
      <CardBody className="gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold">{strategy.name}</h3>
            <p className="mt-1 text-sm text-default-500">
              {strategy.industry}·{strategy.scenario}
            </p>
          </div>
          <Chip size="sm" color={levelColor} variant="flat">
            {diagnostics
              ? `${diagnostics.score} · ${levelLabel[diagnostics.level]}`
              : strategy.industry}
          </Chip>
        </div>
        {diagnostics && (
          <Progress
            aria-label="策略健康度"
            size="sm"
            value={diagnostics.score}
            color={levelColor}
          />
        )}
        <div className="grid gap-3 rounded-[8px] border border-default-200 bg-default-50 p-3 sm:grid-cols-3">
          <InfoLine label="资产版本" value={formatStrategyVersion(strategy)} />
          <InfoLine label="复核状态" value={strategyReviewLabel(strategy)} />
          <InfoLine
            label="默认动作"
            value={`${riskModeLabels[strategy.defaultRiskMode]} · ${strategy.defaultDailyLimit}/天`}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <InfoLine
            label="来源词"
            value={strategy.sourceKeywords.join("、") || "-"}
          />
          <InfoLine
            label="需求词"
            value={strategy.demandKeywords.join("、") || "-"}
          />
          <InfoLine
            label="排除词"
            value={strategy.excludeKeywords.join("、") || "-"}
          />
          <InfoLine
            label="话术池"
            value={`${strategy.commentTemplates.length} 条评论 · ${strategy.privateMessageTemplates.length} 条私信`}
          />
        </div>
        {diagnostics && (
          <>
            <Divider />
            <div className="flex flex-col gap-2">
              {diagnostics.strengths.slice(0, 2).map((item) => (
                <p key={item} className="text-sm text-success-700">
                  {item}
                </p>
              ))}
              {diagnostics.issues.slice(0, 2).map((item) => (
                <p key={item} className="text-sm text-warning-700">
                  {item}
                </p>
              ))}
              {diagnostics.suggestions.slice(0, 2).map((item) => (
                <p key={item} className="text-sm text-default-500">
                  {item}
                </p>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {diagnostics.recommendedModes.map((mode) => (
                <Chip key={mode} size="sm" variant="flat">
                  {modes.find((item) => item.key === mode)?.label || mode}
                </Chip>
              ))}
            </div>
          </>
        )}
        <div className="rounded-[8px] bg-warning-50 p-3 text-sm text-warning-700">
          {strategyRiskSummary(strategy).map((item) => (
            <p key={item}>{item}</p>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="flat"
            startContent={<Eye size={14} />}
            onPress={() => onView(strategy)}
          >
            查看
          </Button>
          <Button
            size="sm"
            variant="flat"
            startContent={<Edit3 size={14} />}
            onPress={() => onEdit(strategy)}
          >
            编辑
          </Button>
          <Button
            size="sm"
            variant="flat"
            startContent={<Copy size={14} />}
            onPress={() => onCopy(strategy)}
          >
            复制
          </Button>
          <Button
            size="sm"
            color="danger"
            variant="flat"
            startContent={<Trash2 size={14} />}
            onPress={() => onDelete(strategy)}
          >
            删除
          </Button>
          <Button
            size="sm"
            color="primary"
            variant="flat"
            startContent={<Target size={14} />}
            onPress={() => onApply(strategy)}
          >
            套用前复核
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function StrategyDetailModal({
  strategy,
  onClose,
  onEdit,
  onCopy,
  onApply,
}: {
  strategy: GrowthStrategyTemplate | null;
  onClose: () => void;
  onEdit: (strategy: GrowthStrategyTemplate) => void;
  onCopy: (strategy: GrowthStrategyTemplate) => void;
  onApply: (strategy: GrowthStrategyTemplate) => void;
}) {
  return (
    <Modal
      isOpen={Boolean(strategy)}
      onOpenChange={(open) => !open && onClose()}
      size="3xl"
      scrollBehavior="inside"
    >
      <ModalContent>
        {strategy ? (
          <>
            <ModalHeader className="flex flex-col gap-1">
              {strategy.name}
              <span className="text-sm font-normal text-default-500">
                {strategy.industry}·{strategy.scenario}
              </span>
            </ModalHeader>
            <ModalBody className="gap-4">
              <div className="grid gap-3 md:grid-cols-4">
                <InfoLine
                  label="资产版本"
                  value={formatStrategyVersion(strategy)}
                />
                <InfoLine
                  label="默认上限"
                  value={`${strategy.defaultDailyLimit} / 天`}
                />
                <InfoLine
                  label="默认风控"
                  value={
                    riskModeLabels[strategy.defaultRiskMode] ||
                    strategy.defaultRiskMode
                  }
                />
                <InfoLine
                  label="最近更新"
                  value={formatDate(strategy.updatedAt)}
                />
              </div>
              <div className="rounded-[8px] border border-warning-200 bg-warning-50 p-3 text-sm text-warning-700">
                <p className="font-medium">动作边界</p>
                <p className="mt-1">
                  编辑会更新当前策略版本；复制会创建独立资产；套用只生成获客任务，不会立即执行外部触达；删除不会删除已生成任务。
                </p>
              </div>
              {strategy.diagnostics && (
                <div className="rounded-[8px] border border-default-200 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">策略健康度</p>
                    <Chip size="sm" variant="flat">
                      {strategy.diagnostics.score}
                    </Chip>
                  </div>
                  <Progress
                    className="mt-2"
                    aria-label="策略健康度"
                    value={strategy.diagnostics.score}
                  />
                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    <StrategyList
                      title="优势"
                      items={strategy.diagnostics.strengths}
                    />
                    <StrategyList
                      title="问题"
                      items={strategy.diagnostics.issues}
                    />
                    <StrategyList
                      title="建议"
                      items={strategy.diagnostics.suggestions}
                    />
                  </div>
                </div>
              )}
              <div className="grid gap-3 md:grid-cols-2">
                <StrategyList title="来源词" items={strategy.sourceKeywords} />
                <StrategyList title="需求词" items={strategy.demandKeywords} />
                <StrategyList title="排除词" items={strategy.excludeKeywords} />
                <StrategyList
                  title="黑名单昵称"
                  items={strategy.blacklistNicknames}
                />
              </div>
              <StrategyList
                title="评论话术池"
                items={strategy.commentTemplates}
              />
              <StrategyList
                title="私信承接话术池"
                items={strategy.privateMessageTemplates}
              />
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={onClose}>
                关闭
              </Button>
              <Button
                variant="flat"
                startContent={<Edit3 size={16} />}
                onPress={() => onEdit(strategy)}
              >
                编辑
              </Button>
              <Button
                variant="flat"
                startContent={<Copy size={16} />}
                onPress={() => onCopy(strategy)}
              >
                复制
              </Button>
              <Button
                color="primary"
                startContent={<Target size={16} />}
                onPress={() => onApply(strategy)}
              >
                套用前复核
              </Button>
            </ModalFooter>
          </>
        ) : null}
      </ModalContent>
    </Modal>
  );
}

function StrategyEditModal({
  strategy,
  form,
  errors,
  onChange,
  onClose,
  onSave,
}: {
  strategy: GrowthStrategyTemplate | null;
  form: StrategyFormState;
  errors: StrategyFormErrors;
  onChange: (form: StrategyFormState) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <Modal
      isOpen={Boolean(strategy)}
      onOpenChange={(open) => !open && onClose()}
      size="3xl"
      scrollBehavior="inside"
    >
      <ModalContent>
        {strategy ? (
          <>
            <ModalHeader className="flex flex-col gap-1">
              编辑获客策略
            </ModalHeader>
            <ModalBody>
              <StrategyFormFields
                form={form}
                errors={errors}
                onChange={onChange}
              />
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={onClose}>
                取消
              </Button>
              <Button
                color="primary"
                startContent={<Save size={16} />}
                onPress={onSave}
              >
                保存策略
              </Button>
            </ModalFooter>
          </>
        ) : null}
      </ModalContent>
    </Modal>
  );
}

function StrategyReviewModal({
  review,
  strategyForm,
  copyForm,
  copyErrors,
  applyForm,
  loading,
  onCopyFormChange,
  onApplyFormChange,
  onClose,
  onConfirm,
}: {
  review: StrategyReview | null;
  strategyForm: {
    industry: string;
    scenario: string;
  };
  copyForm: StrategyFormState;
  copyErrors: StrategyFormErrors;
  applyForm: {
    mode: GrowthAcquisitionMode;
    platform: GrowthPlatform;
    taskName: string;
  };
  loading: boolean;
  onCopyFormChange: (form: StrategyFormState) => void;
  onApplyFormChange: (form: {
    mode: GrowthAcquisitionMode;
    platform: GrowthPlatform;
    taskName: string;
  }) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const title =
    review?.kind === "generate"
      ? "复核生成策略"
      : review?.kind === "copy"
        ? "复核复制策略"
        : "复核套用策略";
  return (
    <Modal
      isOpen={Boolean(review)}
      onOpenChange={(open) => !open && onClose()}
      size="3xl"
      scrollBehavior="inside"
    >
      <ModalContent>
        {review ? (
          <>
            <ModalHeader className="flex flex-col gap-1">{title}</ModalHeader>
            <ModalBody className="gap-4">
              {review.kind === "generate" && (
                <div className="rounded-[8px] border border-default-200 p-3">
                  <p className="text-sm text-default-500">
                    即将基于以下条件生成一套完整策略，生成后仍可编辑、复制或删除。
                  </p>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <InfoLine
                      label="行业"
                      value={strategyForm.industry || "-"}
                    />
                    <InfoLine
                      label="场景"
                      value={strategyForm.scenario || "-"}
                    />
                  </div>
                </div>
              )}
              {review.kind === "copy" && (
                <>
                  <p className="text-sm text-default-500">
                    来源策略：
                    {review.source.name}
                    。复制前可调整副本字段，确认后会创建新的策略资产。
                  </p>
                  <StrategyFormFields
                    form={copyForm}
                    errors={copyErrors}
                    onChange={onCopyFormChange}
                  />
                </>
              )}
              {review.kind === "apply" && (
                <>
                  <div className="rounded-[8px] border border-default-200 p-3">
                    <p className="font-medium">{review.source.name}</p>
                    <p className="mt-1 text-sm text-default-500">
                      {review.source.industry}·{review.source.scenario}
                    </p>
                    <div className="mt-3 grid gap-2 md:grid-cols-4">
                      <InfoLine
                        label="资产版本"
                        value={formatStrategyVersion(review.source)}
                      />
                      <InfoLine
                        label="来源词"
                        value={
                          review.source.sourceKeywords.slice(0, 6).join("、") ||
                          "-"
                        }
                      />
                      <InfoLine
                        label="需求词"
                        value={
                          review.source.demandKeywords.slice(0, 6).join("、") ||
                          "-"
                        }
                      />
                      <InfoLine
                        label="话术"
                        value={`${review.source.commentTemplates.length} 条评论 · ${review.source.privateMessageTemplates.length} 条私信`}
                      />
                      <InfoLine
                        label="默认风控"
                        value={`${riskModeLabels[review.source.defaultRiskMode]} · ${review.source.defaultDailyLimit}/天`}
                      />
                    </div>
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <Input
                      className="md:col-span-3"
                      label="生成任务名称"
                      value={applyForm.taskName}
                      onValueChange={(taskName) =>
                        onApplyFormChange({
                          ...applyForm,
                          taskName,
                        })
                      }
                    />
                    <Select
                      label="获客玩法"
                      selectedKeys={[applyForm.mode]}
                      onSelectionChange={(keys) =>
                        onApplyFormChange({
                          ...applyForm,
                          mode: Array.from(keys)[0] as GrowthAcquisitionMode,
                        })
                      }
                    >
                      {modes.map((mode) => (
                        <SelectItem key={mode.key}>{mode.label}</SelectItem>
                      ))}
                    </Select>
                    <Select
                      label="目标平台"
                      selectedKeys={[applyForm.platform]}
                      onSelectionChange={(keys) =>
                        onApplyFormChange({
                          ...applyForm,
                          platform: Array.from(keys)[0] as GrowthPlatform,
                        })
                      }
                    >
                      {Object.entries(platformLabels).map(([key, label]) => (
                        <SelectItem key={key}>{label}</SelectItem>
                      ))}
                    </Select>
                    <div className="md:col-span-3 rounded-[8px] border border-warning-200 bg-warning-50 p-3 text-sm text-warning-700">
                      确认后会创建一条获客任务，并继承来源词、需求词、排除词、黑名单、话术池、每日上限和默认风控；系统会尝试绑定目标平台可用账号。不会立即触发外部执行，执行前仍需在任务矩阵确认。
                    </div>
                  </div>
                </>
              )}
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={onClose} isDisabled={loading}>
                取消
              </Button>
              <Button
                color="primary"
                startContent={<ShieldCheck size={16} />}
                onPress={onConfirm}
                isLoading={loading}
              >
                确认提交
              </Button>
            </ModalFooter>
          </>
        ) : null}
      </ModalContent>
    </Modal>
  );
}

function StrategyDeleteModal({
  strategy,
  onClose,
  onConfirm,
}: {
  strategy: GrowthStrategyTemplate | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [confirmText, setConfirmText] = React.useState("");
  React.useEffect(() => {
    setConfirmText("");
  }, [strategy?.id]);
  const canDelete = Boolean(strategy && confirmText.trim() === strategy.name);
  return (
    <Modal
      isOpen={Boolean(strategy)}
      onOpenChange={(open) => !open && onClose()}
      placement="center"
    >
      <ModalContent>
        {strategy ? (
          <>
            <ModalHeader className="flex flex-col gap-1">
              确认删除获客策略
            </ModalHeader>
            <ModalBody>
              <p className="text-sm text-default-600">
                删除「
                {strategy.name}
                」后，已由它生成的获客任务不会被删除，但策略资产无法在当前列表恢复。
              </p>
              <div className="rounded-[8px] bg-danger-50 p-3 text-sm text-danger-700">
                请确认不是正在复用的行业模板，再执行删除。
              </div>
              <Input
                label="输入策略名称确认删除"
                placeholder={strategy.name}
                value={confirmText}
                onValueChange={setConfirmText}
                description="只有名称完全一致时才能删除。"
              />
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={onClose}>
                取消
              </Button>
              <Button
                color="danger"
                startContent={<Trash2 size={16} />}
                onPress={onConfirm}
                isDisabled={!canDelete}
              >
                确认删除
              </Button>
            </ModalFooter>
          </>
        ) : null}
      </ModalContent>
    </Modal>
  );
}
function StrategyFormFields({
  form,
  errors,
  onChange,
}: {
  form: StrategyFormState;
  errors: StrategyFormErrors;
  onChange: (form: StrategyFormState) => void;
}) {
  return (
    <div className="grid gap-3">
      <Input
        label="策略名称"
        value={form.name}
        onValueChange={(name) =>
          onChange({
            ...form,
            name,
          })
        }
        isInvalid={Boolean(errors.name)}
        errorMessage={errors.name}
      />
      <div className="grid gap-3 md:grid-cols-2">
        <Input
          label="行业"
          value={form.industry}
          onValueChange={(industry) =>
            onChange({
              ...form,
              industry,
            })
          }
          isInvalid={Boolean(errors.industry)}
          errorMessage={errors.industry}
        />
        <Input
          label="场景"
          value={form.scenario}
          onValueChange={(scenario) =>
            onChange({
              ...form,
              scenario,
            })
          }
          isInvalid={Boolean(errors.scenario)}
          errorMessage={errors.scenario}
        />
      </div>
      <Textarea
        label="来源词"
        minRows={3}
        value={form.sourceKeywords}
        onValueChange={(sourceKeywords) =>
          onChange({
            ...form,
            sourceKeywords,
          })
        }
        isInvalid={Boolean(errors.sourceKeywords)}
        errorMessage={errors.sourceKeywords}
      />
      <Textarea
        label="需求词"
        value={form.demandKeywords}
        onValueChange={(demandKeywords) =>
          onChange({
            ...form,
            demandKeywords,
          })
        }
        isInvalid={Boolean(errors.demandKeywords)}
        errorMessage={errors.demandKeywords}
      />
      <Textarea
        label="排除词"
        value={form.excludeKeywords}
        onValueChange={(excludeKeywords) =>
          onChange({
            ...form,
            excludeKeywords,
          })
        }
      />
      <Textarea
        label="黑名单昵称"
        value={form.blacklistNicknames}
        onValueChange={(blacklistNicknames) =>
          onChange({
            ...form,
            blacklistNicknames,
          })
        }
      />
      <Textarea
        label="评论话术池"
        minRows={4}
        value={form.commentTemplates}
        onValueChange={(commentTemplates) =>
          onChange({
            ...form,
            commentTemplates,
          })
        }
        isInvalid={Boolean(errors.commentTemplates)}
        errorMessage={errors.commentTemplates}
      />
      <Textarea
        label="私信承接话术池"
        minRows={3}
        value={form.privateMessageTemplates}
        onValueChange={(privateMessageTemplates) =>
          onChange({
            ...form,
            privateMessageTemplates,
          })
        }
        isInvalid={Boolean(errors.privateMessageTemplates)}
        errorMessage={errors.privateMessageTemplates}
      />
      <div className="grid gap-3 md:grid-cols-2">
        <Input
          label="默认每日上限"
          value={form.defaultDailyLimit}
          onValueChange={(defaultDailyLimit) =>
            onChange({
              ...form,
              defaultDailyLimit,
            })
          }
          isInvalid={Boolean(errors.defaultDailyLimit)}
          errorMessage={errors.defaultDailyLimit}
        />
        <Select
          label="默认风控"
          selectedKeys={[form.defaultRiskMode]}
          onSelectionChange={(keys) =>
            onChange({
              ...form,
              defaultRiskMode: Array.from(keys)[0] as GrowthRiskMode,
            })
          }
          isInvalid={Boolean(errors.defaultRiskMode)}
          errorMessage={errors.defaultRiskMode}
        >
          {Object.entries(riskModeLabels).map(([key, label]) => (
            <SelectItem key={key}>{label}</SelectItem>
          ))}
        </Select>
      </div>
    </div>
  );
}
function StrategyList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-[8px] bg-default-50 p-3">
      <p className="text-xs text-default-500">{title}</p>
      {items.length ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {items.map((item) => (
            <Chip key={item} size="sm" variant="flat">
              {item}
            </Chip>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-default-400">暂无</p>
      )}
    </div>
  );
}

function WorkflowCard({
  workflow,
  onAction,
  onUpdate,
  onDelete,
}: {
  workflow: GrowthWorkflow;
  onAction: (
    workflow: GrowthWorkflow,
    action: WorkflowAction,
    outputSummary?: string,
    actionDraft?: WorkflowStepDraft,
  ) => void;
  onUpdate: (
    workflow: GrowthWorkflow,
    body: Partial<GrowthWorkflow> & {
      stepId?: string;
      stepDescription?: string;
      stepOutputSummary?: string;
    },
  ) => void;
  onDelete: (workflow: GrowthWorkflow) => void;
}) {
  const [name, setName] = React.useState(workflow.name);
  const [selectedStepId, setSelectedStepId] = React.useState(
    workflow.currentStepId || workflow.steps[0]?.id || "",
  );
  const selectedStep =
    workflow.steps.find((step) => step.id === selectedStepId) ||
    workflow.steps[0];
  const [stepDescription, setStepDescription] = React.useState(
    selectedStep?.description || "",
  );
  const [stepOutputSummary, setStepOutputSummary] = React.useState(
    selectedStep?.outputSummary || "",
  );

  React.useEffect(() => {
    setName(workflow.name);
    setSelectedStepId(workflow.currentStepId || workflow.steps[0]?.id || "");
  }, [workflow.id, workflow.name, workflow.currentStepId, workflow.steps]);

  React.useEffect(() => {
    const step =
      workflow.steps.find((item) => item.id === selectedStepId) ||
      workflow.steps[0];
    setStepDescription(step?.description || "");
    setStepOutputSummary(step?.outputSummary || "");
  }, [selectedStepId, workflow.steps]);

  const completedCount = workflow.steps.filter(
    (step) => step.status === "completed",
  ).length;
  const progress = workflow.steps.length
    ? Math.round((completedCount / workflow.steps.length) * 100)
    : 0;
  const currentStep =
    workflow.steps.find((step) => step.id === workflow.currentStepId) ||
    workflow.steps.find(
      (step) =>
        step.status === "running" || step.status === "waiting-confirmation",
    ) ||
    workflow.steps.find((step) => step.status === "pending");
  const statusColor =
    workflow.status === "failed"
      ? "danger"
      : workflow.status === "completed"
        ? "success"
        : workflow.status === "running"
          ? "primary"
          : workflow.status === "paused"
            ? "warning"
            : "default";
  const saveName = () => {
    if (!name.trim()) {
      toast.error("请输入流程名称");
      return;
    }
    onUpdate(workflow, {
      name: name.trim(),
    });
  };
  const saveStep = () => {
    if (!selectedStep) return;
    onUpdate(workflow, {
      stepId: selectedStep.id,
      stepDescription,
      stepOutputSummary,
    });
  };
  const selectedStepDirty = isStepDraftDirty(
    selectedStep,
    stepDescription,
    stepOutputSummary,
  );
  const buildStepDraft = (
    step: GrowthWorkflow["steps"][number] | undefined,
  ): WorkflowStepDraft | undefined => {
    if (!step) return undefined;
    const isEditingSelectedStep = step.id === selectedStep?.id;
    const description = isEditingSelectedStep
      ? stepDescription
      : step.description || "";
    const outputSummary = isEditingSelectedStep
      ? stepOutputSummary
      : step.outputSummary || "";
    return {
      stepId: step.id,
      stepName: step.name,
      stepDescription: description,
      stepOutputSummary: outputSummary,
      saveBeforeAction:
        isEditingSelectedStep &&
        isStepDraftDirty(step, description, outputSummary),
    };
  };
  return (
    <Card>
      <CardBody className="gap-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">{workflow.name}</h3>
              <Chip size="sm" color={statusColor} variant="flat">
                {workflowStatusLabels[workflow.status] || workflow.status}
              </Chip>
              <Chip size="sm" variant="flat">
                {workflowTemplateLabels[workflow.template] || workflow.template}
              </Chip>
            </div>
            <p className="mt-1 text-sm text-default-500">
              {currentStep ? `当前：${currentStep.name}` : "暂无待处理步骤"}
            </p>
            {workflow.lastAction && (
              <p className="mt-1 text-xs text-default-400">
                {workflow.lastAction}·{formatDate(workflow.lastActionAt)}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="flat"
              startContent={<Save size={14} />}
              onPress={saveName}
            >
              保存名称
            </Button>
            {(workflow.status === "draft" ||
              workflow.status === "enabled" ||
              workflow.status === "failed") && (
              <Button
                size="sm"
                color="primary"
                startContent={<Play size={14} />}
                onPress={() => onAction(workflow, "start")}
              >
                启动
              </Button>
            )}
            {workflow.status === "paused" && (
              <Button
                size="sm"
                color="primary"
                startContent={<Play size={14} />}
                onPress={() => onAction(workflow, "resume")}
              >
                恢复
              </Button>
            )}
            {workflow.status === "running" && (
              <>
                <Button
                  size="sm"
                  color="success"
                  variant="flat"
                  startContent={<CheckCircle2 size={14} />}
                  onPress={() =>
                    onAction(
                      workflow,
                      "advance",
                      currentStep ? `${currentStep.name} 已完成` : undefined,
                      buildStepDraft(currentStep),
                    )
                  }
                >
                  完成并推进
                </Button>
                <Button
                  size="sm"
                  color="warning"
                  variant="flat"
                  startContent={<PauseCircle size={14} />}
                  onPress={() => onAction(workflow, "pause")}
                >
                  暂停
                </Button>
                <Button
                  size="sm"
                  color="danger"
                  variant="flat"
                  onPress={() =>
                    onAction(
                      workflow,
                      "fail",
                      currentStep ? `${currentStep.name} 执行异常` : undefined,
                      buildStepDraft(currentStep),
                    )
                  }
                >
                  标记异常
                </Button>
              </>
            )}
            {(workflow.status === "completed" ||
              workflow.status === "failed" ||
              workflow.status === "paused") && (
              <Button
                size="sm"
                variant="flat"
                startContent={<RefreshCw size={14} />}
                onPress={() => onAction(workflow, "reset")}
              >
                重置
              </Button>
            )}
            <Button
              size="sm"
              color="danger"
              variant="flat"
              isIconOnly
              aria-label="删除流程"
              onPress={() => onDelete(workflow)}
            >
              <Trash2 size={14} />
            </Button>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_220px]">
          <Input
            label="流程改名"
            value={name}
            onValueChange={setName}
            labelPlacement="outside"
          />
          <Select
            label="模板"
            selectedKeys={[workflow.template]}
            isDisabled={workflow.status !== "draft"}
            onSelectionChange={(keys) => {
              const template = String(Array.from(keys)[0] || workflow.template);
              onUpdate(workflow, {
                template,
              });
            }}
          >
            {workflowTemplates.map((template) => (
              <SelectItem key={template.key}>{template.label}</SelectItem>
            ))}
          </Select>
        </div>
        <Progress aria-label="流程进度" value={progress} />
        {selectedStep && (
          <div className="rounded-[8px] border border-default-200 bg-default-50 p-3">
            <div className="grid gap-3 md:grid-cols-[220px_1fr]">
              <Select
                label="步骤详情"
                selectedKeys={[selectedStep.id]}
                onSelectionChange={(keys) =>
                  setSelectedStepId(
                    String(Array.from(keys)[0] || selectedStep.id),
                  )
                }
              >
                {workflow.steps.map((step, index) => (
                  <SelectItem
                    key={step.id}
                    textValue={`${index + 1}. ${step.name}`}
                  >
                    {index + 1}.{step.name}
                  </SelectItem>
                ))}
              </Select>
              <div className="grid gap-3">
                <Textarea
                  label="步骤说明"
                  minRows={2}
                  value={stepDescription}
                  onValueChange={setStepDescription}
                  labelPlacement="outside"
                />
                <Textarea
                  label="执行备注/确认结果"
                  minRows={2}
                  value={stepOutputSummary}
                  onValueChange={setStepOutputSummary}
                  placeholder="记录人工确认结论、风险、下一步动作或复盘结果"
                  labelPlacement="outside"
                />
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-h-6 text-xs text-default-500">
                    {selectedStepDirty ? (
                      <span className="text-warning-700">
                        当前步骤有未保存内容；完成、推进或异常标记前会自动保存。
                      </span>
                    ) : selectedStep?.status === "running" ||
                      selectedStep?.status === "waiting-confirmation" ? (
                      <span>完成前建议填写确认结果，便于后续复盘。</span>
                    ) : null}
                  </div>
                  <Button
                    size="sm"
                    color="primary"
                    variant="flat"
                    startContent={<Save size={14} />}
                    onPress={saveStep}
                    isDisabled={!selectedStepDirty}
                  >
                    {selectedStepDirty ? "保存步骤详情" : "步骤已保存"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
        <div className="flex flex-col gap-2">
          {workflow.steps.map((step, index) => {
            const active =
              step.id === currentStep?.id &&
              ["running", "waiting-confirmation"].includes(step.status);
            const stepColor =
              step.status === "failed"
                ? "danger"
                : step.status === "completed"
                  ? "success"
                  : active
                    ? "primary"
                    : step.status === "waiting-confirmation"
                      ? "warning"
                      : "default";
            return (
              <div
                key={step.id}
                className={`rounded-[8px] border px-3 py-3 ${active ? "border-primary-300 bg-primary-50" : "border-default-200"}`}
              >
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div className="flex min-w-0 gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-default-100 text-xs font-semibold">
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{step.name}</p>
                        <Chip size="sm" variant="flat">
                          {workflowStepTypeLabels[step.type] || step.type}
                        </Chip>
                        <Chip size="sm" color={stepColor} variant="flat">
                          {workflowStepStatusLabels[step.status] || step.status}
                        </Chip>
                      </div>
                      <p className="mt-1 text-sm text-default-500">
                        {step.description || riskModeLabels[step.riskMode]}
                      </p>
                      {step.outputSummary && (
                        <p className="mt-1 text-xs text-default-500">
                          {step.outputSummary}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {step.status === "running" ||
                    step.status === "waiting-confirmation" ? (
                      <Button
                        size="sm"
                        color="success"
                        variant="flat"
                        onPress={() =>
                          onAction(
                            workflow,
                            "complete-step",
                            `${step.name} 已确认完成`,
                            buildStepDraft(step),
                          )
                        }
                      >
                        完成本步
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
}

function MetricGrid({
  overview,
  reports,
  activeDrilldown,
  onDrillDown,
}: {
  overview: GrowthOverview | null;
  reports: GrowthReports | null;
  activeDrilldown?: ReportDrilldownKey | null;
  onDrillDown?: (key: ReportDrilldownKey) => void;
}) {
  const metricSource = reports?.overview || overview;
  const items = [
    {
      key: "leads" as const,
      label: "新增线索",
      value: metricSource?.todayLeadCount || 0,
      icon: UsersRound,
    },
    {
      key: "contacted" as const,
      label: "已触达",
      value: metricSource?.todayContactedCount || 0,
      icon: CheckCircle2,
    },
    {
      key: "intent" as const,
      label: "高意向线索",
      value: metricSource?.highIntentLeadCount || 0,
      icon: Target,
    },
    {
      key: "risk" as const,
      label: "风险账号",
      value: metricSource?.accountRiskCount || 0,
      icon: HeartPulse,
    },
  ];
  const funnel = reports?.funnel || overview?.funnel;
  const funnelLabels: Record<string, string> = {
    candidates: "候选线索",
    selected: "筛选线索",
    contacted: "已触达",
    crmCaptured: "线索沉淀",
    converted: "已转化",
  };
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Card
            key={item.label}
            data-growth-metric-card
            isPressable={Boolean(onDrillDown)}
            className={
              activeDrilldown === item.key
                ? "border border-primary-300"
                : undefined
            }
            onPress={() => onDrillDown?.(item.key)}
          >
            <CardBody className="gap-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-default-500">{item.label}</span>
                <Icon size={18} className="text-primary" />
              </div>
              <strong className="text-3xl">{item.value}</strong>
              <Progress
                aria-label={`${item.label}进度`}
                size="sm"
                value={Math.min(100, Number(item.value) * 8)}
              />
              <span className="text-xs text-primary">查看明细</span>
            </CardBody>
          </Card>
        );
      })}
      {funnel && (
        <Card className="md:col-span-2 xl:col-span-4">
          <CardBody>
            <div className="grid gap-3 md:grid-cols-5">
              {Object.entries(funnel).map(([key, value]) => (
                <button
                  key={key}
                  type="button"
                  data-growth-funnel-cell
                  className={`rounded-[8px] bg-default-50 p-3 text-left transition hover:bg-default-100 ${activeDrilldown === key ? "ring-1 ring-primary-300" : ""}`}
                  onClick={() => onDrillDown?.(key as ReportDrilldownKey)}
                >
                  <p className="text-xs text-default-500">
                    {funnelLabels[key] || key}
                  </p>
                  <p className="text-xl font-semibold">{value}</p>
                </button>
              ))}
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
function AccountReadiness({
  accounts,
  selectedKey,
}: {
  accounts: GrowthAccountHealth[];
  selectedKey: string;
}) {
  const account = findAccountByKey(accounts, selectedKey);
  if (!account) {
    return (
      <div className="rounded-[8px] border border-warning-200 bg-warning-50 px-3 py-2 text-sm text-warning-700">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span>暂无可用平台账号，任务可创建但执行会被安全闸拦截。</span>
          <Button
            as={Link}
            href="/distribution?tab=accounts"
            size="sm"
            variant="flat"
            startContent={<ShieldCheck size={14} />}
          >
            去登录平台账号
          </Button>
        </div>
      </div>
    );
  }
  const ready =
    account.loginStatus === "online" && account.riskStatus === "normal";
  return (
    <div className="rounded-[8px] border border-default-200 bg-default-50 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{account.accountName}</span>
        <Chip size="sm" color={ready ? "success" : "warning"} variant="flat">
          {ready ? "可执行" : "执行前需处理"}
        </Chip>
        <Chip size="sm" variant="flat">
          {loginStatusLabels[account.loginStatus] || account.loginStatus}
        </Chip>
        <Chip size="sm" variant="flat">
          {riskStatusLabels[account.riskStatus] || account.riskStatus}
        </Chip>
      </div>
      <p className="mt-1 text-xs text-default-500">{account.recommendation}</p>
      {!ready && (
        <Button
          as={Link}
          href="/distribution?tab=accounts"
          className="mt-2"
          size="sm"
          variant="flat"
          startContent={<ShieldCheck size={14} />}
        >
          登录或重新授权
        </Button>
      )}
    </div>
  );
}

function RunsTable({
  runs,
  configs = [],
  selectedRunId,
  onSelectRun,
  title = "任务结果",
}: {
  runs: GrowthAcquisitionRun[];
  configs?: GrowthAcquisitionConfig[];
  selectedRunId?: string | null;
  onSelectRun?: (id: string) => void;
  title?: string;
}) {
  const { page, setPage, totalPages, pageItems, start, end } =
    usePagedItems(runs);
  return (
    <Card>
      <CardBody className="gap-3">
        <h2 className="font-semibold">{title}</h2>
        <Table aria-label={title} classNames={growthTableClassNames}>
          <TableHeader>
            <TableColumn>时间</TableColumn>
            <TableColumn>玩法</TableColumn>
            <TableColumn>执行边界</TableColumn>
            <TableColumn>结果</TableColumn>
            <TableColumn>线索</TableColumn>
            <TableColumn>说明</TableColumn>
            <TableColumn>详情</TableColumn>
          </TableHeader>
          <TableBody emptyContent="当前没有任务结果">
            {pageItems.map((run) => (
              <TableRow
                key={run.id}
                className={
                  selectedRunId === run.id ? "bg-primary-50" : undefined
                }
              >
                <TableCell>{formatDate(run.startedAt)}</TableCell>
                <TableCell>{getRunExposureLabel(run, configs)}</TableCell>
                <TableCell>{runExecutionBoundaryLabel(run)}</TableCell>
                <TableCell>
                  <Chip
                    color={runStatusChipColor(run.status)}
                    size="sm"
                    variant="flat"
                  >
                    {statusLabels[run.status] || run.status}
                  </Chip>
                </TableCell>
                <TableCell>
                  {run.selectedCount}/{run.candidateCount}
                </TableCell>
                <TableCell>
                  <span className="line-clamp-2 max-w-md">
                    {runOutcomeDetail(run)}
                  </span>
                </TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant="flat"
                    startContent={<Eye size={14} />}
                    onPress={() => onSelectRun?.(run.id)}
                  >
                    查看
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {runs.length ? (
          <TablePager
            page={page}
            totalPages={totalPages}
            total={runs.length}
            start={start}
            end={end}
            onPageChange={setPage}
          />
        ) : (
          <CommercialEmptyState
            icon={Activity}
            title="当前没有任务结果"
            description="当前增长模块会先创建任务并打开执行前确认，确认记录会沉淀到这里。"
            action={
              <Button
                as={Link}
                href="/growth?view=acquisition"
                color="primary"
                startContent={<Plus size={16} />}
              >
                创建获客任务
              </Button>
            }
          />
        )}
      </CardBody>
    </Card>
  );
}
function RunDetailPanel({
  run,
  configs,
}: {
  run: GrowthAcquisitionRun | null;
  configs: GrowthAcquisitionConfig[];
}) {
  if (!run) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-default-500">
            选择一条任务结果后，可查看任务详情、失败原因、线索 ID 和结果留存。
          </p>
        </CardBody>
      </Card>
    );
  }
  const config = configs.find((item) => item.id === run.configId);
  const evidence = run.evidenceUrls.length ? run.evidenceUrls : [];
  return (
    <Card>
      <CardBody className="gap-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold">任务结果详情</h2>
              <Chip
                color={runStatusChipColor(run.status)}
                size="sm"
                variant="flat"
              >
                {statusLabels[run.status] || run.status}
              </Chip>
              <Chip size="sm" variant="flat">
                {runExecutionBoundaryLabel(run)}
              </Chip>
            </div>
            <p className="mt-1 text-sm text-default-500">
              {config?.taskName || run.configId}·
              {getRunExposureLabel(run, configs)}·
              {platformLabels[run.platform] || run.platform}·
              {formatDate(run.startedAt)}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-[8px] bg-default-50 px-3 py-2">
              <p className="text-xs text-default-500">候选</p>
              <p className="font-semibold">{run.candidateCount}</p>
            </div>
            <div className="rounded-[8px] bg-default-50 px-3 py-2">
              <p className="text-xs text-default-500">入池</p>
              <p className="font-semibold">{run.selectedCount}</p>
            </div>
            <div className="rounded-[8px] bg-default-50 px-3 py-2">
              <p className="text-xs text-default-500">真实触达</p>
              <p className="font-semibold">{run.contactedCount}</p>
            </div>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <InfoLine label="终态说明" value={runOutcomeDetail(run)} />
          <InfoLine label="处理说明" value={displayText(run.message)} />
          <InfoLine label="失败原因" value={run.failureReason || "无"} />
          <InfoLine label="结束时间" value={formatDate(run.endedAt)} />
          <InfoLine
            label="关联线索"
            value={run.leadIds.length ? run.leadIds.join("、") : "暂无"}
          />
        </div>
        <Divider />
        <div>
          <h3 className="text-sm font-semibold">结果留存</h3>
          {evidence.length ? (
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {evidence.map((url, index) => {
                const isHttp = /^https?:\/\//.test(url);
                return (
                  <div
                    key={`${url}-${index}`}
                    className="rounded-[8px] border border-default-200 p-3"
                  >
                    <p className="text-xs text-default-500">
                      记录
                      {index + 1}
                    </p>
                    {isHttp ? (
                      <a
                        className="mt-1 flex items-center gap-2 text-sm text-primary"
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        打开记录
                        <ExternalLink size={14} />
                      </a>
                    ) : (
                      <p className="mt-1 break-all text-sm text-default-600">
                        {url}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-2 text-sm text-default-500">
              该任务结果尚未返回结果留存。
            </p>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
function LeadsPanel({ leads }: { leads: GrowthLead[] }) {
  return (
    <Card>
      <CardBody className="gap-3">
        <h2 className="font-semibold">最新线索</h2>
        {leads.length === 0 ? (
          <div className="growth-empty-inline rounded-[8px] border border-default-200 bg-default-50 px-3 py-4">
            <p className="text-sm text-default-500">
              暂无线索。先创建获客任务或手动补充线索，后续可在这里快速打开来源和跟进。
            </p>
            <Button
              as={Link}
              href="/growth?view=acquisition"
              className="mt-3"
              size="sm"
              color="primary"
              variant="flat"
              startContent={<Plus size={14} />}
            >
              创建获客任务
            </Button>
          </div>
        ) : (
          leads.map((lead) => (
            <div
              key={lead.id}
              className="rounded-[8px] border border-default-200 p-3"
            >
              <div className="flex items-center justify-between">
                <p className="font-medium">{lead.nickname}</p>
                <Chip
                  size="sm"
                  color={lead.score >= 75 ? "success" : "default"}
                  variant="flat"
                >
                  {lead.score}
                </Chip>
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-default-500">
                {lead.sourceText}
              </p>
            </div>
          ))
        )}
      </CardBody>
    </Card>
  );
}

function LeadSummary({ leads }: { leads: GrowthLead[] }) {
  const highIntent = leads.filter(
    (lead) => lead.score >= 75 && !["ignored", "blocked"].includes(lead.status),
  ).length;
  const replied = leads.filter(
    (lead) => lead.status === "replied" || lead.status === "qualified",
  ).length;
  const converted = leads.filter((lead) => lead.status === "converted").length;
  return (
    <div className="grid gap-3 md:grid-cols-4">
      <div className="rounded-[8px] bg-default-50 p-3">
        <p className="text-xs text-default-500">全部线索</p>
        <p className="text-2xl font-semibold">{leads.length}</p>
      </div>
      <div className="rounded-[8px] bg-default-50 p-3">
        <p className="text-xs text-default-500">高意向</p>
        <p className="text-2xl font-semibold">{highIntent}</p>
      </div>
      <div className="rounded-[8px] bg-default-50 p-3">
        <p className="text-xs text-default-500">有回复</p>
        <p className="text-2xl font-semibold">{replied}</p>
      </div>
      <div className="rounded-[8px] bg-default-50 p-3">
        <p className="text-xs text-default-500">已转化</p>
        <p className="text-2xl font-semibold">{converted}</p>
      </div>
    </div>
  );
}
function BulkLeadActions({
  selectedCount,
  filteredCount,
  onContact,
  onQualify,
  onIgnore,
  onClear,
}: {
  selectedCount: number;
  filteredCount: number;
  onContact: () => void;
  onQualify: () => void;
  onIgnore: () => void;
  onClear: () => void;
}) {
  if (!selectedCount) {
    return (
      <div className="rounded-[8px] border border-default-200 bg-default-50 px-3 py-2 text-sm text-default-500">
        当前筛选
        {filteredCount}
        条。选择线索后可批量推进状态，提交前会二次确认影响范围。
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-[8px] border border-primary-200 bg-primary-50 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-medium text-primary">
          已选择
          {selectedCount}
          条线索
        </p>
        <p className="text-xs text-primary-700">
          批量状态变更会写入跟进备注；未勾选线索不受影响。
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          className="whitespace-nowrap"
          size="sm"
          color="primary"
          variant="flat"
          onPress={onContact}
        >
          批量已触达
        </Button>
        <Button
          className="whitespace-nowrap"
          size="sm"
          color="success"
          variant="flat"
          onPress={onQualify}
        >
          批量已合格
        </Button>
        <Button
          className="whitespace-nowrap"
          size="sm"
          color="warning"
          variant="flat"
          onPress={onIgnore}
        >
          批量忽略
        </Button>
        <Button
          className="whitespace-nowrap"
          size="sm"
          variant="flat"
          onPress={onClear}
        >
          清空选择
        </Button>
      </div>
    </div>
  );
}

function BulkLeadConfirmModal({
  state,
  onClose,
  onConfirm,
}: {
  state: BulkLeadConfirmState | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const statusCounts = React.useMemo(() => {
    if (!state) return [];
    return Object.entries(leadStatusLabels)
      .map(([status, label]) => ({
        status,
        label,
        count: state.leads.filter((lead) => lead.status === status).length,
      }))
      .filter((item) => item.count > 0);
  }, [state]);
  const targetLabel = state ? leadStatusLabels[state.status] : "";
  const tone = state?.status === "ignored" ? "warning" : "primary";
  return (
    <Modal isOpen={Boolean(state)} onClose={onClose} size="2xl">
      <ModalContent>
        {state && (
          <>
            <ModalHeader>确认批量更新线索</ModalHeader>
            <ModalBody className="gap-4">
              <p className="text-sm text-default-600">
                将把
                {state.leads.length}
                条已勾选线索更新为「
                {targetLabel}
                」。当前筛选结果共
                {state.filteredCount}
                条，其中已勾选
                {state.visibleSelectedCount}
                条；未勾选线索不会被修改。
              </p>
              <div className="rounded-[8px] border border-default-200 bg-default-50 p-3">
                <p className="text-sm font-semibold">影响范围</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Chip size="sm" color={tone} variant="flat">
                    目标状态:
                    {targetLabel}
                  </Chip>
                  {statusCounts.map((item) => (
                    <Chip key={item.status} size="sm" variant="flat">
                      {item.label}:{item.count}
                    </Chip>
                  ))}
                </div>
                <div className="mt-3 flex flex-col gap-1 text-xs text-default-500">
                  {state.leads.slice(0, 5).map((lead) => (
                    <span key={lead.id}>
                      {lead.nickname}·
                      {leadStatusLabels[lead.status] || lead.status}
                    </span>
                  ))}
                  {state.leads.length > 5 && (
                    <span>
                      另有
                      {state.leads.length - 5}
                      条线索...
                    </span>
                  )}
                </div>
              </div>
              <p className="text-xs text-default-500">
                本操作仅更新增长获客线索池状态并追加批量备注；如需入
                CRM，请在线索表格或详情中单条同步。
              </p>
            </ModalBody>
            <ModalFooter>
              <Button variant="flat" onPress={onClose}>
                取消
              </Button>
              <Button
                color={state.status === "ignored" ? "warning" : "primary"}
                onPress={onConfirm}
              >
                确认更新
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
function LeadsTable({
  leads,
  selectedIds,
  onSelectionChange,
  onStatusChange,
  onOpenDetail,
  onDelete,
  onDedupe,
  onSyncCrm,
}: {
  leads: GrowthLead[];
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  onStatusChange: (lead: GrowthLead, status: GrowthLeadStatus) => void;
  onOpenDetail: (lead: GrowthLead) => void;
  onDelete: (lead: GrowthLead) => void;
  onDedupe: (lead: GrowthLead) => void;
  onSyncCrm: (lead: GrowthLead) => void;
}) {
  const { page, setPage, totalPages, pageItems, start, end } =
    usePagedItems(leads);
  const pageIds = pageItems.map((lead) => lead.id);
  const allPageSelected =
    pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const toggleOne = (leadId: string, checked: boolean) => {
    const next = new Set(selectedIds);
    if (checked) next.add(leadId);
    else next.delete(leadId);
    onSelectionChange(next);
  };
  const togglePage = (checked: boolean) => {
    const next = new Set(selectedIds);
    pageIds.forEach((id) => {
      if (checked) next.add(id);
      else next.delete(id);
    });
    onSelectionChange(next);
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 text-sm text-default-500 sm:flex-row sm:items-center sm:justify-between">
        <span>
          当前页
          {pageItems.length ? start + 1 : 0}-{end}/{leads.length}条
        </span>
        <span>
          已选择
          {selectedIds.size}
          条，表头勾选只选择当前页。
        </span>
      </div>
      <Table aria-label="线索池" classNames={growthTableClassNames}>
        <TableHeader>
          <TableColumn>
            <Checkbox
              aria-label="选择当前页线索"
              isSelected={allPageSelected}
              isIndeterminate={
                pageIds.some((id) => selectedIds.has(id)) && !allPageSelected
              }
              onValueChange={togglePage}
            />
          </TableColumn>
          <TableColumn>线索</TableColumn>
          <TableColumn>平台</TableColumn>
          <TableColumn>来源</TableColumn>
          <TableColumn>评分</TableColumn>
          <TableColumn>状态</TableColumn>
          <TableColumn>CRM</TableColumn>
          <TableColumn>下次跟进</TableColumn>
          <TableColumn>原文</TableColumn>
          <TableColumn>证据</TableColumn>
          <TableColumn>操作</TableColumn>
        </TableHeader>
        <TableBody emptyContent="当前筛选范围内暂无线索，可调整筛选或展开手动补充线索。">
          {pageItems.map((lead) => (
            <TableRow key={lead.id}>
              <TableCell>
                <Checkbox
                  aria-label={`选择线索 ${lead.nickname}`}
                  isSelected={selectedIds.has(lead.id)}
                  onValueChange={(checked) => toggleOne(lead.id, checked)}
                />
              </TableCell>
              <TableCell>
                <div>
                  <p className="font-medium">{lead.nickname}</p>
                  <p className="text-xs text-default-500">
                    {formatDate(lead.createdAt)}
                  </p>
                </div>
              </TableCell>
              <TableCell>
                {platformLabels[lead.platform] || lead.platform}
              </TableCell>
              <TableCell>
                {leadSourceLabels[lead.sourceType] || lead.sourceType}
              </TableCell>
              <TableCell>
                <Chip
                  size="sm"
                  color={lead.score >= 75 ? "success" : "default"}
                  variant="flat"
                >
                  {lead.score}
                </Chip>
              </TableCell>
              <TableCell>
                <Chip size="sm" variant="flat">
                  {leadStatusLabels[lead.status] || lead.status}
                </Chip>
              </TableCell>
              <TableCell>
                {lead.crmCustomerId ? (
                  <Chip
                    size="sm"
                    color="success"
                    variant="flat"
                    startContent={<CheckCircle2 size={12} />}
                  >
                    已入 CRM
                  </Chip>
                ) : (
                  <Button
                    className="h-8 whitespace-nowrap"
                    size="sm"
                    color="primary"
                    variant="flat"
                    startContent={<Network size={12} />}
                    onPress={() => onSyncCrm(lead)}
                  >
                    同步
                  </Button>
                )}
              </TableCell>
              <TableCell>{formatDate(lead.nextFollowUpAt)}</TableCell>
              <TableCell>
                <span className="line-clamp-1 max-w-md">{lead.sourceText}</span>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2 whitespace-nowrap">
                  <Chip size="sm" variant="flat">
                    {lead.evidenceUrls.length}条
                  </Chip>
                  {lead.sourceUrl && (
                    <Button
                      as="a"
                      className="h-8 whitespace-nowrap"
                      href={lead.sourceUrl}
                      rel="noreferrer"
                      size="sm"
                      target="_blank"
                      variant="light"
                      endContent={<ExternalLink size={12} />}
                    >
                      来源
                    </Button>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-2 whitespace-nowrap">
                  <Button
                    className="whitespace-nowrap"
                    size="sm"
                    variant="flat"
                    startContent={<Eye size={14} />}
                    onPress={() => onOpenDetail(lead)}
                  >
                    详情
                  </Button>
                  {leadStatusFlow
                    .filter((status) => status !== lead.status)
                    .slice(0, 2)
                    .map((status) => (
                      <Button
                        key={status}
                        className="whitespace-nowrap"
                        size="sm"
                        variant="flat"
                        onPress={() => onStatusChange(lead, status)}
                      >
                        {leadStatusLabels[status]}
                      </Button>
                    ))}
                  <Button
                    className="whitespace-nowrap"
                    size="sm"
                    variant="flat"
                    startContent={<Sparkles size={14} />}
                    onPress={() => onDedupe(lead)}
                  >
                    去重
                  </Button>
                  <Button
                    size="sm"
                    color="danger"
                    variant="flat"
                    isIconOnly
                    aria-label="删除线索"
                    onPress={() => onDelete(lead)}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <TablePager
        page={page}
        totalPages={totalPages}
        total={leads.length}
        start={start}
        end={end}
        onPageChange={setPage}
      />
    </div>
  );
}
function LeadDetailSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[8px] border border-default-200 p-4">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {description && (
          <p className="mt-1 text-xs text-default-500">{description}</p>
        )}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function LeadDetailModal({
  lead,
  form,
  dedupeMatches,
  dedupeLoading,
  onFormChange,
  onSave,
  onClose,
  onStatusChange,
  onDelete,
  onDedupe,
  onMerge,
  onSyncCrm,
}: {
  lead: GrowthLead | null;
  form: LeadEditForm | null;
  dedupeMatches: GrowthLeadDedupeMatch[];
  dedupeLoading: boolean;
  onFormChange: (form: LeadEditForm) => void;
  onSave: () => void;
  onClose: () => void;
  onStatusChange: (lead: GrowthLead, status: GrowthLeadStatus) => void;
  onDelete: (lead: GrowthLead) => void;
  onDedupe: (lead: GrowthLead) => void;
  onMerge: (duplicateId: string) => void;
  onSyncCrm: (lead: GrowthLead) => void;
}) {
  if (!lead || !form) return null;
  const evidenceLinks = Array.from(
    new Map(
      [
        lead.sourceUrl
          ? {
              label: "来源链接",
              url: lead.sourceUrl,
            }
          : null,
        lead.profileUrl
          ? {
              label: "主页链接",
              url: lead.profileUrl,
            }
          : null,
        ...lead.evidenceUrls.map((url, index) => ({
          label: `任务结果 ${index + 1}`,
          url,
        })),
      ]
        .filter(
          (
            item,
          ): item is {
            label: string;
            url: string;
          } => Boolean(item),
        )
        .map((item) => [item.url, item] as const),
    ).values(),
  );
  return (
    <Modal
      isOpen={Boolean(lead)}
      onClose={onClose}
      size="5xl"
      scrollBehavior="inside"
    >
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span>{lead.nickname}</span>
            <Chip
              size="sm"
              color={lead.score >= 75 ? "success" : "default"}
              variant="flat"
            >
              {lead.score}分
            </Chip>
            <Chip size="sm" variant="flat">
              {leadStatusLabels[lead.status] || lead.status}
            </Chip>
            {lead.crmCustomerId && (
              <Chip size="sm" color="success" variant="flat">
                已入 CRM
              </Chip>
            )}
          </div>
          <p className="text-sm font-normal text-default-500">
            {platformLabels[lead.platform] || lead.platform}·
            {leadSourceLabels[lead.sourceType] || lead.sourceType}· 更新于
            {formatDate(lead.updatedAt)}
          </p>
        </ModalHeader>
        <ModalBody className="gap-4">
          <LeadDetailSection
            title="基本信息"
            description="用于识别线索来源、评分和原始需求，不会触发外部联系动作。"
          >
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                label="线索昵称"
                value={form.nickname}
                onValueChange={(nickname) =>
                  onFormChange({
                    ...form,
                    nickname,
                  })
                }
              />
              <Input
                label="评分"
                type="number"
                min={0}
                max={100}
                value={form.score}
                onValueChange={(score) =>
                  onFormChange({
                    ...form,
                    score,
                  })
                }
              />
              <Input
                label="主页链接"
                value={form.profileUrl}
                onValueChange={(profileUrl) =>
                  onFormChange({
                    ...form,
                    profileUrl,
                  })
                }
              />
              <Input
                label="来源链接"
                value={form.sourceUrl}
                onValueChange={(sourceUrl) =>
                  onFormChange({
                    ...form,
                    sourceUrl,
                  })
                }
              />
              <Input
                className="md:col-span-2"
                label="命中关键词"
                value={form.matchedKeywords}
                onValueChange={(matchedKeywords) =>
                  onFormChange({
                    ...form,
                    matchedKeywords,
                  })
                }
              />
              <Textarea
                className="md:col-span-2"
                label="线索原文"
                minRows={4}
                value={form.sourceText}
                onValueChange={(sourceText) =>
                  onFormChange({
                    ...form,
                    sourceText,
                  })
                }
              />
            </div>
          </LeadDetailSection>
          <LeadDetailSection
            title="跟进"
            description="维护状态、下次跟进时间和新增备注，便于运营接力。"
          >
            <div className="flex flex-col gap-4">
              <div>
                <p className="text-xs font-medium text-default-500">状态流转</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {Object.entries(leadStatusLabels).map(([status, label]) => (
                    <Button
                      key={status}
                      className="whitespace-nowrap"
                      size="sm"
                      color={lead.status === status ? "primary" : "default"}
                      variant={lead.status === status ? "solid" : "flat"}
                      onPress={() =>
                        onStatusChange(lead, status as GrowthLeadStatus)
                      }
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Textarea
                  label="最近回复/触达内容"
                  minRows={3}
                  value={form.latestReply}
                  onValueChange={(latestReply) =>
                    onFormChange({
                      ...form,
                      latestReply,
                    })
                  }
                />
                <div className="flex flex-col gap-3">
                  <Input
                    label="下一次跟进时间"
                    type="datetime-local"
                    value={form.nextFollowUpAt}
                    onValueChange={(nextFollowUpAt) =>
                      onFormChange({
                        ...form,
                        nextFollowUpAt,
                      })
                    }
                  />
                  <Textarea
                    label="新增跟进备注"
                    minRows={3}
                    value={form.followUpNote}
                    onValueChange={(followUpNote) =>
                      onFormChange({
                        ...form,
                        followUpNote,
                      })
                    }
                  />
                </div>
              </div>
              <div className="rounded-[8px] bg-default-50 p-3">
                <p className="text-xs font-medium text-default-500">历史备注</p>
                <div className="mt-3 flex max-h-56 flex-col gap-2 overflow-auto">
                  {(lead.notes || []).length === 0 ? (
                    <p className="text-sm text-default-500">暂无备注。</p>
                  ) : (
                    lead.notes?.map((note) => (
                      <div
                        key={note.id}
                        className="rounded-[8px] border border-default-200 bg-background p-3"
                      >
                        <p className="text-sm">{note.text}</p>
                        <p className="mt-1 text-xs text-default-400">
                          {formatDate(note.createdAt)}·{note.type}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </LeadDetailSection>
          <div className="grid gap-4 lg:grid-cols-2">
            <LeadDetailSection
              title="去重"
              description="先扫描高相似线索，再决定是否合并到当前线索。"
            >
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm text-default-500">
                    {dedupeMatches.length
                      ? `发现 ${dedupeMatches.length} 条可能重复`
                      : "暂无高相似重复线索。"}
                  </p>
                  <Button
                    className="whitespace-nowrap"
                    size="sm"
                    variant="flat"
                    startContent={<Sparkles size={14} />}
                    onPress={() => onDedupe(lead)}
                    isLoading={dedupeLoading}
                  >
                    扫描重复
                  </Button>
                </div>
                <div className="flex flex-col gap-2">
                  {dedupeMatches.map((match) => (
                    <div
                      key={match.lead.id}
                      className="rounded-[8px] bg-default-50 p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium">
                            {match.lead.nickname}
                          </p>
                          <p className="mt-1 text-xs text-default-500">
                            {match.reasons.join(" · ")}
                          </p>
                        </div>
                        <Chip size="sm" variant="flat">
                          {match.score}
                        </Chip>
                      </div>
                      <Button
                        className="mt-2 whitespace-nowrap"
                        size="sm"
                        color="primary"
                        variant="flat"
                        onPress={() => onMerge(match.lead.id)}
                      >
                        合并到当前线索
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </LeadDetailSection>
            <LeadDetailSection
              title="结果留存"
              description="展示来源、任务结果和外部记录链接，便于回溯判断。"
            >
              <div className="flex flex-col gap-3">
                <div className="grid gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <p className="text-xs text-default-500">线索 ID</p>
                    <p className="mt-1 break-all font-medium">{lead.id}</p>
                  </div>
                  <div>
                    <p className="text-xs text-default-500">来源类型</p>
                    <p className="mt-1 font-medium">
                      {leadSourceLabels[lead.sourceType] || lead.sourceType}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-default-500">CRM 客户 ID</p>
                    <p className="mt-1 break-all font-medium">
                      {lead.crmCustomerId || "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-default-500">任务 ID</p>
                    <p className="mt-1 break-all font-medium">
                      {lead.sourceTaskId || "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-default-500">执行 ID</p>
                    <p className="mt-1 break-all font-medium">
                      {lead.sourceRunId || "-"}
                    </p>
                  </div>
                </div>
                <Divider />
                <div className="flex flex-col gap-2">
                  {evidenceLinks.length === 0 ? (
                    <p className="text-sm text-default-500">
                      暂无可打开的结果留存。
                    </p>
                  ) : (
                    evidenceLinks.map((item) => (
                      <div
                        key={item.url}
                        className="flex flex-col gap-2 rounded-[8px] bg-default-50 p-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{item.label}</p>
                          <p className="mt-1 truncate text-xs text-default-500">
                            {item.url}
                          </p>
                        </div>
                        <Button
                          as="a"
                          className="h-9 whitespace-nowrap"
                          href={item.url}
                          rel="noreferrer"
                          size="sm"
                          target="_blank"
                          variant="flat"
                          endContent={<ExternalLink size={12} />}
                        >
                          打开
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </LeadDetailSection>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose}>
            关闭
          </Button>
          <Button
            color="danger"
            variant="flat"
            startContent={<Trash2 size={16} />}
            onPress={() => onDelete(lead)}
          >
            删除
          </Button>
          <Button
            color={lead.crmCustomerId ? "success" : "primary"}
            variant="flat"
            startContent={<Network size={16} />}
            onPress={() => onSyncCrm(lead)}
          >
            {lead.crmCustomerId ? "重新同步 CRM" : "同步 CRM"}
          </Button>
          <Button
            color="primary"
            startContent={<Save size={16} />}
            onPress={onSave}
          >
            保存线索
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
function LeadDeleteModal({
  lead,
  onClose,
  onConfirm,
}: {
  lead: GrowthLead | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal isOpen={Boolean(lead)} onClose={onClose}>
      <ModalContent>
        <ModalHeader>删除线索确认</ModalHeader>
        <ModalBody>
          <p className="text-sm text-default-600">
            确认删除「
            {lead?.nickname}
            」？删除后会从线索池和任务结果关联中移除。若只是暂不跟进，建议改为「已忽略」。
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose}>
            取消
          </Button>
          <Button
            color="danger"
            startContent={<Trash2 size={16} />}
            onPress={onConfirm}
          >
            确认删除
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function AccountHealthTable({
  accounts,
  configs,
  onCheck,
  onCooldown,
  onRelease,
  capabilitySnapshot,
}: {
  accounts: GrowthAccountHealth[];
  configs: GrowthAcquisitionConfig[];
  onCheck: (account: GrowthAccountHealth) => void;
  onCooldown: (account: GrowthAccountHealth, minutes: number) => void;
  onRelease: (account: GrowthAccountHealth) => void;
  capabilitySnapshot?: AiEmployeeCapabilitiesSnapshot | null;
}) {
  const [cooldownMinutes, setCooldownMinutes] = React.useState<
    Record<string, string>
  >({});
  const activeConfigCountByAccount = new Map<string, number>();
  configs.forEach((config) => {
    const key = `${config.platform}:${config.accountId}`;
    activeConfigCountByAccount.set(
      key,
      (activeConfigCountByAccount.get(key) || 0) +
        (config.status === "enabled" ? 1 : 0),
    );
  });
  const sortedAccounts = sortAccountsByRisk(accounts);
  const riskQueue = sortedAccounts.filter(
    (account) => accountSeverityScore(account) > 0,
  );
  const readyCount = accounts.filter(isAccountReady).length;
  const manualCount = accounts.filter(
    (account) =>
      account.loginStatus !== "online" || account.riskStatus === "needs-human",
  ).length;
  const cooldownCount = accounts.filter(
    (account) => account.riskStatus === "cooldown",
  ).length;
  const verificationCount = accounts.filter(
    (account) =>
      account.loginStatus === "verification-required" ||
      account.loginStatus === "expired",
  ).length;
  const platforms = Array.from(
    new Set<GrowthAccountHealth["platform"]>([
      ...accounts.map((account) => account.platform),
      "douyin",
      "wechat-channel",
      "wechat",
      "wecom",
    ]),
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Card>
          <CardBody className="gap-4">
            <div className="flex items-center gap-2">
              <ShieldCheck size={18} className="text-primary" />
              <h2 className="font-semibold">账号可执行状态</h2>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <HealthMetric
                label="在线正常"
                value={readyCount}
                tone="success"
              />
              <HealthMetric
                label="需验证/登录"
                value={verificationCount}
                tone="danger"
              />
              <HealthMetric
                label="需人工处理"
                value={manualCount}
                tone="danger"
              />
              <HealthMetric
                label="冷却中"
                value={cooldownCount}
                tone="warning"
              />
              <HealthMetric
                label="启用任务"
                value={
                  configs.filter((config) => config.status === "enabled").length
                }
                tone="primary"
              />
            </div>
            <div className="rounded-[8px] border border-warning-200 bg-warning-50 px-3 py-3 text-sm text-warning-800">
              <div className="flex items-start gap-2">
                <XCircle size={16} className="mt-0.5 shrink-0" />
                <span>
                  {capabilitySnapshot
                    ? `功能状态已同步：${capabilitySnapshot.summary.real} 项可执行、${capabilitySnapshot.summary.simulated} 项可生成预览、${capabilitySnapshot.summary.needsConfig} 项待配置。具体动作仍会在执行前检查账号和风险。`
                    : "正在读取能力快照；具体动作会在执行前检查账号和风险。"}
                </span>
              </div>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="gap-4">
            <div className="flex items-center gap-2">
              <Sparkles size={18} className="text-primary" />
              <h2 className="font-semibold">平台可用范围</h2>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {platforms.map((platform) => {
                const capability = resolvedPlatformCapability(
                  platform,
                  capabilitySnapshot,
                );
                return (
                  <div
                    key={platform}
                    className="rounded-[8px] border border-default-200 p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">
                          {platformLabels[platform] || platform}
                        </p>
                        <p className="mt-1 text-xs text-default-500">
                          {capability.detail}
                        </p>
                      </div>
                      <Chip
                        size="sm"
                        color={
                          platform === "douyin" || platform === "wechat-channel"
                            ? "primary"
                            : "default"
                        }
                        variant="flat"
                      >
                        {capability.status}
                      </Chip>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {capability.modes.map((mode) => (
                        <Chip key={mode} size="sm" variant="flat">
                          {mode}
                        </Chip>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardBody className="gap-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <AlertTriangle size={18} className="text-warning-600" />
                <h2 className="font-semibold">风控处理队列</h2>
              </div>
              <p className="mt-1 text-sm text-default-500">
                按需验证、暂停、冷却、失败率排序，优先处理会影响任务的账号。
              </p>
            </div>
            <Button
              as={Link}
              href="/growth?view=acquisition"
              size="sm"
              variant="flat"
              startContent={<Target size={14} />}
            >
              查看受影响任务
            </Button>
          </div>
          {riskQueue.length ? (
            <div className="grid gap-3 lg:grid-cols-3">
              {riskQueue.slice(0, 6).map((account) => (
                <div
                  key={account.id}
                  className="rounded-[8px] border border-default-200 p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {account.accountName}
                      </p>
                      <p className="mt-1 text-xs text-default-500">
                        {platformLabels[account.platform] || account.platform}·
                        失败率
                        {Math.round(account.failureRate * 100)}%
                      </p>
                    </div>
                    <Chip
                      size="sm"
                      color={accountSeverityColor(account)}
                      variant="flat"
                    >
                      {accountSeverityLabel(account)}
                    </Chip>
                  </div>
                  <p className="mt-3 text-sm text-default-600">
                    {accountNextAction(account)}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="flat"
                      startContent={<RefreshCw size={14} />}
                      onPress={() => onCheck(account)}
                    >
                      重检
                    </Button>
                    {account.riskStatus === "cooldown" ? (
                      <Button
                        size="sm"
                        color="success"
                        variant="flat"
                        startContent={<Unlock size={14} />}
                        onPress={() => onRelease(account)}
                      >
                        解除冷却
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        color="warning"
                        variant="flat"
                        startContent={<PauseCircle size={14} />}
                        onPress={() => onCooldown(account, 60)}
                      >
                        冷却 1 小时
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : accounts.length ? (
            <div className="rounded-[8px] border border-success-200 bg-success-50 px-3 py-3 text-sm text-success-800">
              当前账号没有集中风控限制。继续观察失败率，新增任务时优先选择在线正常账号。
            </div>
          ) : (
            <div className="rounded-[8px] border border-default-200 bg-default-50 p-4">
              <p className="font-medium">还没有账号健康记录</p>
              <p className="mt-1 text-sm text-default-500">
                先到发布中心登录平台账号；如果已有获客任务绑定了账号，刷新后这里会直接显示需处理的账号和原因。
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  as={Link}
                  href="/distribution?tab=accounts"
                  size="sm"
                  color="primary"
                  variant="flat"
                  startContent={<ShieldCheck size={14} />}
                >
                  去登录平台账号
                </Button>
                <Button
                  as={Link}
                  href="/growth?view=acquisition"
                  size="sm"
                  variant="flat"
                  startContent={<Target size={14} />}
                >
                  查看获客任务
                </Button>
                <Button
                  size="sm"
                  variant="flat"
                  startContent={<RefreshCw size={14} />}
                  onPress={() => window.location.reload()}
                >
                  刷新检测
                </Button>
              </div>
            </div>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardBody className="gap-4">
          <div>
            <h2 className="font-semibold">账号风控台</h2>
            <p className="text-sm text-default-500">
              重新检测、选择冷却时长、解除冷却，并查看每个账号的执行暂停提示。
            </p>
          </div>
          <Table aria-label="账号健康" classNames={growthTableClassNames}>
            <TableHeader>
              <TableColumn>账号</TableColumn>
              <TableColumn>风险等级</TableColumn>
              <TableColumn>状态</TableColumn>
              <TableColumn>失败率/动作</TableColumn>
              <TableColumn>冷却</TableColumn>
              <TableColumn>检测时间</TableColumn>
              <TableColumn>建议与下一步</TableColumn>
              <TableColumn>操作</TableColumn>
            </TableHeader>
            <TableBody emptyContent="当前没有账号健康记录：先配置获客任务或刷新账号检测。">
              {sortedAccounts.map((account) => {
                const key = accountKey(account);
                const selectedMinutes = Number(cooldownMinutes[key] || "60");
                const taskCount = activeConfigCountByAccount.get(key) || 0;
                return (
                  <TableRow key={account.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{account.accountName}</p>
                        <p className="text-xs text-default-500">
                          {platformLabels[account.platform] || account.platform}
                          ·{taskCount}
                          个启用任务
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="sm"
                        color={accountSeverityColor(account)}
                        variant="flat"
                      >
                        {accountSeverityLabel(account)}
                      </Chip>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <Chip
                          size="sm"
                          color={
                            account.loginStatus === "online"
                              ? "success"
                              : "warning"
                          }
                          variant="flat"
                        >
                          {loginStatusLabels[account.loginStatus] ||
                            account.loginStatus}
                        </Chip>
                        <Chip
                          size="sm"
                          color={accountHealthColor(account)}
                          variant="flat"
                        >
                          {isAccountReady(account)
                            ? "可执行"
                            : riskStatusLabels[account.riskStatus] ||
                              account.riskStatus}
                        </Chip>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="text-sm">
                          {Math.round(account.failureRate * 100)}%
                        </p>
                        <p className="text-xs text-default-500">
                          今日
                          {account.todayActionCount}次
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      {account.riskStatus === "cooldown" ? (
                        <div>
                          <Chip size="sm" color="warning" variant="flat">
                            剩余
                            {formatCooldownRemaining(account.cooldownUntil)}
                          </Chip>
                          <p className="mt-1 text-xs text-default-500">
                            {formatDate(account.cooldownUntil)}
                          </p>
                        </div>
                      ) : (
                        <span className="text-sm text-default-500">未冷却</span>
                      )}
                    </TableCell>
                    <TableCell>{formatDate(account.lastCheckedAt)}</TableCell>
                    <TableCell>
                      <div className="max-w-md">
                        <span className="line-clamp-2">
                          {account.recommendation}
                        </span>
                        <p className="mt-1 line-clamp-2 text-xs text-default-500">
                          {accountNextAction(account)}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex min-w-[270px] flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          variant="flat"
                          startContent={<RefreshCw size={14} />}
                          onPress={() => onCheck(account)}
                        >
                          重新检测
                        </Button>
                        <Select
                          aria-label={`${account.accountName} 冷却时长`}
                          className="w-28"
                          size="sm"
                          selectedKeys={[String(selectedMinutes)]}
                          onSelectionChange={(keys) =>
                            setCooldownMinutes({
                              ...cooldownMinutes,
                              [key]: String(Array.from(keys)[0] || "60"),
                            })
                          }
                        >
                          {cooldownOptions.map((option) => (
                            <SelectItem key={option.key}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </Select>
                        <Button
                          size="sm"
                          color="warning"
                          variant="flat"
                          startContent={<PauseCircle size={14} />}
                          onPress={() => onCooldown(account, selectedMinutes)}
                        >
                          冷却
                        </Button>
                        <Button
                          size="sm"
                          color="success"
                          variant="flat"
                          startContent={<Unlock size={14} />}
                          onPress={() => onRelease(account)}
                          isDisabled={account.riskStatus !== "cooldown"}
                        >
                          解除
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardBody>
      </Card>
    </div>
  );
}

function HealthMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "success" | "danger" | "warning" | "primary";
}) {
  const color = {
    success: "text-success-600",
    danger: "text-danger-600",
    warning: "text-warning-600",
    primary: "text-primary",
  }[tone];
  return (
    <div className="rounded-[8px] bg-default-50 p-3">
      <p className="text-xs text-default-500">{label}</p>
      <p className={`text-2xl font-semibold ${color}`}>{value}</p>
    </div>
  );
}
function CopywritingTable({ rows }: { rows: GrowthReports["copywriting"] }) {
  return (
    <Card>
      <CardBody className="gap-3">
        <h2 className="font-semibold">话术表现</h2>
        <Table aria-label="话术表现" classNames={growthTableClassNames}>
          <TableHeader>
            <TableColumn>话术</TableColumn>
            <TableColumn>次数</TableColumn>
            <TableColumn>均分</TableColumn>
            <TableColumn>触达率</TableColumn>
          </TableHeader>
          <TableBody emptyContent="当前没有话术数据">
            {rows.map((row) => (
              <TableRow key={row.text}>
                <TableCell>
                  <span className="line-clamp-2 max-w-md">{row.text}</span>
                </TableCell>
                <TableCell>{row.usageCount}</TableCell>
                <TableCell>{row.averageLeadScore}</TableCell>
                <TableCell>{Math.round(row.contactRate * 100)}%</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardBody>
    </Card>
  );
}

function TrendPanel({ rows }: { rows: GrowthReports["trend"] }) {
  const totals = rows.reduce(
    (sum, row) => ({
      leads: sum.leads + row.leads,
      selected: sum.selected + row.selected,
      contacted: sum.contacted + row.contacted,
      converted: sum.converted + row.converted,
      risk: sum.risk + row.failed + row.skipped,
    }),
    {
      leads: 0,
      selected: 0,
      contacted: 0,
      converted: 0,
      risk: 0,
    },
  );
  const peak = rows.reduce<GrowthReports["trend"][number] | null>(
    (current, row) =>
      !current || row.leads + row.contacted > current.leads + current.contacted
        ? row
        : current,
    null,
  );
  const first = rows[0];
  const last = rows[rows.length - 1];
  const leadDelta = first && last ? last.leads - first.leads : 0;
  const selectedRate = totals.leads
    ? Math.round((totals.selected / totals.leads) * 100)
    : 0;
  const contactRate = totals.selected
    ? Math.round((totals.contacted / totals.selected) * 100)
    : 0;
  const maxValue = Math.max(
    1,
    ...rows.flatMap((row) => [
      row.leads,
      row.contacted,
      row.converted,
      row.failed + row.skipped,
    ]),
  );
  return (
    <Card>
      <CardBody className="gap-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <BarChart3 size={18} className="text-primary" />
              <h2 className="font-semibold">增长趋势</h2>
            </div>
            <p className="mt-1 text-sm text-default-500">
              解释新增、触达、转化和异常的变化，辅助判断是流量问题、筛选问题还是账号问题。
            </p>
          </div>
          <Button
            as={Link}
            href="/growth?view=acquisition"
            size="sm"
            variant="flat"
            startContent={<ArrowRight size={14} />}
          >
            回到任务矩阵
          </Button>
        </div>
        {rows.length ? (
          <>
            <div className="grid gap-3 md:grid-cols-4">
              <div className="rounded-[8px] bg-default-50 p-3">
                <p className="text-xs text-default-500">筛选命中率</p>
                <p className="mt-1 text-xl font-semibold">{selectedRate}%</p>
              </div>
              <div className="rounded-[8px] bg-default-50 p-3">
                <p className="text-xs text-default-500">入池触达率</p>
                <p className="mt-1 text-xl font-semibold">{contactRate}%</p>
              </div>
              <div className="rounded-[8px] bg-default-50 p-3">
                <p className="text-xs text-default-500">异常次数</p>
                <p className="mt-1 text-xl font-semibold">{totals.risk}</p>
              </div>
              <div className="rounded-[8px] bg-default-50 p-3">
                <p className="text-xs text-default-500">新增变化</p>
                <p className="mt-1 text-xl font-semibold">
                  {leadDelta > 0 ? `+${leadDelta}` : leadDelta}
                </p>
              </div>
            </div>
            <div className="rounded-[8px] border border-default-200 p-3 text-sm text-default-600">
              {leadDelta > 0
                ? "新增线索在区间末端抬升，优先确认高分线索是否及时触达。"
                : leadDelta < 0
                  ? "新增线索在区间末端回落，优先检查任务来源、关键词和账号可用性。"
                  : "新增线索整体平稳，重点观察触达率和异常次数是否拖慢转化。"}
              {peak ? ` 峰值出现在 ${peak.date.slice(5)}。` : ""}
            </div>
            <div className="grid gap-3">
              {rows.map((row) => {
                const riskCount = row.failed + row.skipped;
                return (
                  <div
                    key={row.date}
                    className="grid gap-2 md:grid-cols-[96px_1fr] md:items-center"
                  >
                    <span className="text-sm text-default-500">
                      {row.date.slice(5)}
                    </span>
                    <div className="grid gap-2">
                      <TrendBar
                        label="新增"
                        value={row.leads}
                        max={maxValue}
                        color="bg-primary"
                      />
                      <TrendBar
                        label="触达"
                        value={row.contacted}
                        max={maxValue}
                        color="bg-success-500"
                      />
                      <TrendBar
                        label="转化"
                        value={row.converted}
                        max={maxValue}
                        color="bg-secondary-500"
                      />
                      <TrendBar
                        label="异常"
                        value={riskCount}
                        max={maxValue}
                        color="bg-warning-500"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="rounded-[8px] border border-default-200 bg-default-50 p-4">
            <p className="font-medium">当前筛选范围内暂无趋势数据</p>
            <p className="mt-1 text-sm text-default-500">
              可能是时间范围内没有任务结果、任务仍处于演练模式，或平台账号需要处理。
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                as={Link}
                href="/growth?view=acquisition"
                size="sm"
                color="primary"
                variant="flat"
                startContent={<Target size={14} />}
              >
                创建获客任务
              </Button>
              <Button
                as={Link}
                href="/growth?view=account-health"
                size="sm"
                variant="flat"
                startContent={<HeartPulse size={14} />}
              >
                检查账号健康
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
function TrendBar({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  return (
    <div className="grid grid-cols-[42px_1fr_36px] items-center gap-2">
      <span className="text-xs text-default-500">{label}</span>
      <div className="h-2 overflow-hidden rounded-full bg-default-100">
        <div
          className={`h-full rounded-full ${color}`}
          style={{
            width: value
              ? `${Math.max(3, Math.round((value / max) * 100))}%`
              : "0%",
          }}
        />
      </div>
      <span className="text-right text-xs text-default-500">{value}</span>
    </div>
  );
}

function bottleneckActionHref(row: GrowthReports["bottlenecks"][number]) {
  const text = `${row.title} ${row.detail} ${row.action}`;
  if (/账号|登录|验证|冷却|风控/.test(text))
    return "/growth?view=account-health";
  if (/高意向|线索|触达|跟进|入池/.test(text)) return "/growth?view=leads";
  if (/任务|关键词|来源|执行|失败|跳过/.test(text))
    return "/growth?view=acquisition";
  return "/growth?view=reports";
}

function BottleneckPanel({ rows }: { rows: GrowthReports["bottlenecks"] }) {
  const colorMap = {
    danger: "danger",
    warning: "warning",
    info: "primary",
  } as const;
  return (
    <Card>
      <CardBody className="gap-3">
        <div className="flex items-center gap-2">
          <Activity size={18} className="text-primary" />
          <h2 className="font-semibold">增长瓶颈诊断</h2>
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          {rows.map((row) => (
            <div
              key={`${row.level}-${row.title}`}
              className="rounded-[8px] border border-default-200 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{row.title}</p>
                <Chip size="sm" color={colorMap[row.level]} variant="flat">
                  {row.level === "danger"
                    ? "高优先级"
                    : row.level === "warning"
                      ? "需优化"
                      : "观察"}
                </Chip>
              </div>
              <p className="mt-2 text-sm text-default-500">{row.detail}</p>
              <p className="mt-2 text-sm text-foreground">{row.action}</p>
              <Button
                as={Link}
                href={bottleneckActionHref(row)}
                className="mt-3"
                size="sm"
                color={row.level === "danger" ? "danger" : "primary"}
                variant="flat"
                startContent={<ArrowRight size={14} />}
              >
                处理瓶颈
              </Button>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

function TaskPerformanceTable({
  rows,
}: {
  rows: GrowthReports["taskPerformance"];
}) {
  return (
    <Card>
      <CardBody className="gap-3">
        <h2 className="font-semibold">任务表现</h2>
        <Table aria-label="任务表现" classNames={growthTableClassNames}>
          <TableHeader>
            <TableColumn>任务</TableColumn>
            <TableColumn>玩法</TableColumn>
            <TableColumn>候选/入池</TableColumn>
            <TableColumn>触达</TableColumn>
            <TableColumn>异常</TableColumn>
            <TableColumn>最近执行</TableColumn>
            <TableColumn>动作</TableColumn>
          </TableHeader>
          <TableBody emptyContent="当前没有任务表现记录">
            {rows.map((row) => (
              <TableRow key={row.configId}>
                <TableCell>
                  <div>
                    <p className="font-medium">{row.taskName}</p>
                    <p className="text-xs text-default-500">
                      {platformLabels[row.platform] || row.platform}
                    </p>
                  </div>
                </TableCell>
                <TableCell>
                  {getTaskExposureLabel(row.taskName, row.mode)}
                </TableCell>
                <TableCell>
                  {row.candidateCount}/{row.selectedCount}
                </TableCell>
                <TableCell>{row.contactedCount}</TableCell>
                <TableCell>{row.failedCount + row.skippedCount}</TableCell>
                <TableCell>{formatDate(row.lastRunAt)}</TableCell>
                <TableCell>
                  <Button
                    as={Link}
                    href={`/growth?view=acquisition&configId=${encodeURIComponent(row.configId)}`}
                    size="sm"
                    variant="flat"
                    startContent={<ArrowRight size={14} />}
                  >
                    查看任务
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardBody>
    </Card>
  );
}

function ExecutionRecordsTable({
  configs,
  runs,
  selectedRunId,
  onSelectRun,
}: {
  configs: GrowthAcquisitionConfig[];
  runs: GrowthAcquisitionRun[];
  selectedRunId?: string;
  onSelectRun: (id: string) => void;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">执行记录</h2>
          <p className="mt-1 text-sm text-default-500">
            查看近期任务的候选、入池、触达和异常情况。
          </p>
        </div>
      </div>
      <RunsTable
        runs={runs}
        configs={configs}
        selectedRunId={selectedRunId}
        onSelectRun={onSelectRun}
        title="执行记录"
      />
    </section>
  );
}

function AccountPerformanceTable({
  rows,
}: {
  rows: GrowthReports["accountPerformance"];
}) {
  return (
    <Card>
      <CardBody className="gap-3">
        <h2 className="font-semibold">账号表现</h2>
        <Table aria-label="账号表现" classNames={growthTableClassNames}>
          <TableHeader>
            <TableColumn>账号</TableColumn>
            <TableColumn>平台</TableColumn>
            <TableColumn>执行</TableColumn>
            <TableColumn>线索</TableColumn>
            <TableColumn>触达</TableColumn>
            <TableColumn>异常</TableColumn>
            <TableColumn>动作</TableColumn>
          </TableHeader>
          <TableBody emptyContent="当前没有账号表现记录">
            {rows.map((row) => (
              <TableRow key={row.accountKey}>
                <TableCell>
                  <div>
                    <p className="font-medium">{row.accountName}</p>
                    <p className="text-xs text-default-500">
                      {formatDate(row.lastRunAt)}
                    </p>
                  </div>
                </TableCell>
                <TableCell>
                  {platformLabels[row.platform] || row.platform}
                </TableCell>
                <TableCell>{row.runCount}</TableCell>
                <TableCell>
                  {row.selectedCount}/{row.candidateCount}
                </TableCell>
                <TableCell>{row.contactedCount}</TableCell>
                <TableCell>{row.failedCount + row.skippedCount}</TableCell>
                <TableCell>
                  <Button
                    as={Link}
                    href={`/growth?view=account-health&account=${encodeURIComponent(row.accountKey)}`}
                    size="sm"
                    variant="flat"
                    startContent={<HeartPulse size={14} />}
                  >
                    查看账号
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardBody>
    </Card>
  );
}

function LeadStatusDistribution({
  rows,
}: {
  rows: GrowthReports["leadStatusDistribution"];
}) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return (
    <Card>
      <CardBody className="gap-3">
        <h2 className="font-semibold">线索状态分布</h2>
        {rows.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {rows.map((row) => {
              const percent = total ? Math.round((row.count / total) * 100) : 0;
              return (
                <div
                  key={row.status}
                  className="rounded-[8px] bg-default-50 p-3"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-default-500">
                      {leadStatusLabels[row.status] || row.status}
                    </p>
                    <strong>{row.count}</strong>
                  </div>
                  <Progress
                    aria-label={`${leadStatusLabels[row.status] || row.status}占比`}
                    className="mt-2"
                    size="sm"
                    value={percent}
                  />
                  <Button
                    as={Link}
                    href={`/growth?view=leads&status=${encodeURIComponent(row.status)}`}
                    className="mt-3"
                    size="sm"
                    variant="flat"
                    startContent={<ArrowRight size={14} />}
                  >
                    查看线索
                  </Button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-[8px] border border-default-200 bg-default-50 p-4">
            <p className="font-medium">暂无线索状态数据</p>
            <p className="mt-1 text-sm text-default-500">
              创建获客任务或手动补充线索后，这里会展示新线索、已触达、已合格和已转化分布。
            </p>
            <Button
              as={Link}
              href="/growth?view=leads"
              className="mt-3"
              size="sm"
              color="primary"
              variant="flat"
              startContent={<UsersRound size={14} />}
            >
              去线索池
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-default-500">{label}</p>
      <p className="mt-1 line-clamp-2 text-sm">{value}</p>
    </div>
  );
}
