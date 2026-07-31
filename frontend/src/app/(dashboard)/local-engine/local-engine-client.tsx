"use client";

import React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Button,
  Card,
  CardBody,
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
  Switch,
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
  Textarea,
  addToast,
} from "@heroui/react";
import { Icon } from "@/components/lucide-icon-compat";
import {
  buildLocalEngineRiskConfirmation,
  localEngineApi,
  type AgentSManagerStatus,
  type CreateInteractionTaskInput,
  type InteractionBusinessRouteKey,
  type InteractionEvidenceCleanupResult,
  type InteractionRecordsSummary,
  type InteractionRouteKey,
  type InteractionReplyRuleConfig,
  type InteractionSendMode,
  type InteractionTask,
  type InteractionTaskType,
  type LocalEngineBrowserStatus,
  type LocalEngineCapability,
  type LocalEngineActionBlocker,
  type LocalEngineFailureContext,
  type LocalEngineEvidenceType,
  type LocalEngineWechatSessionStatus,
  type LocalEngineExecutorsStatus,
  type LocalEngineFileAccessStatus,
  type LocalEngineHealth,
  type LocalEngineReadiness,
  type LocalEngineRuntimeAction,
  type LocalEngineRuntimeLog,
  type LocalEngineRuntimeServiceKey,
  type LocalEngineRuntimeStatus,
  type WechatContactsReadinessCheck,
  type WechatContactsReadinessResult,
  type WechatContactsSyncDiagnostics,
} from "@/lib/api/local-engine";
import { AgentSStatusPanel } from "@/components/agent-s-status-panel";
import { OpsWorkbenchView } from "@/components/ops-workbench/ops-workbench-view";
import { commercialDisplayText, commercialPrimaryText } from "@/lib/commercial-display-text";
import { toPublicError } from "@/lib/public-error";
import { FailureActionPanel } from "../components/failure-action-panel";
import { FunctionalEmptyState } from "../components/functional-empty-state";

type LocalEngineTabKey =
  | "engine"
  | "workbench"
  | "browser"
  | "desktop"
  | "files"
  | "permissions"
  | "tasks"
  | "remote"
  | "evidence"
  | "logs";

type ActiveInteractionBusinessRouteKey = Exclude<
  InteractionBusinessRouteKey,
  "moments" | "wechat" | "groups"
>;
type ActiveInteractionRouteKey = Exclude<
  InteractionRouteKey,
  "moments" | "wechat" | "groups"
>;
type AgentSStatusSnapshot = AgentSManagerStatus;

const tabKeys: LocalEngineTabKey[] = [
  "engine",
  "workbench",
  "browser",
  "desktop",
  "files",
  "permissions",
  "tasks",
  "remote",
  "evidence",
  "logs",
];

const legacyInteractionRoutes: Partial<Record<string, string>> = {
  comments: "/engagement/douyin-comments",
  messages: "/engagement/douyin-messages",
  "channel-comments": "/engagement/wechat-channel-comments",
  "channel-messages": "/engagement/channel-messages",
  wechat: "/engagement/wechat",
  groups: "/engagement/wechat-groups",
  moments: "/engagement/wechat-moments",
  customers: "/engagement/customers",
  rules: "/engagement/rules",
  records: "/engagement/records",
};

const pageMeta: Record<
  LocalEngineTabKey,
  {
    title: string;
    description: string;
    icon: string;
  }
> = {
  engine: {
    title: "运行检查",
    description: "查看可用状态和待处理项。",
    icon: "solar:server-square-cloud-linear",
  },
  workbench: {
    title: "客户互动",
    description:
      "集中处理抖音评论、私信、视频号评论和视频号私信；微信会话和群发请从微信任务入口处理。",
    icon: "solar:widget-linear",
  },
  browser: {
    title: "平台账号检查",
    description: "查看平台账号是否可用。",
    icon: "solar:window-frame-linear",
  },
  desktop: {
    title: "微信桌面检查",
    description: "查看微信桌面权限是否可用。",
    icon: "solar:monitor-linear",
  },
  files: {
    title: "文件与凭证",
    description: "查看素材和结果是否可保存。",
    icon: "solar:folder-with-files-linear",
  },
  permissions: {
    title: "安全检查",
    description: "查看账号和权限状态。",
    icon: "solar:shield-check-linear",
  },
  tasks: {
    title: "互动记录",
    description: "查看正在处理、等待继续和失败的客户互动任务。",
    icon: "solar:chat-square-check-linear",
  },
  remote: {
    title: "远程接管",
    description: "查看远程检查、权限边界和人工确认状态。",
    icon: "solar:cloud-line-duotone",
  },
  evidence: {
    title: "结果留存",
    description: "按任务查看处理结果。",
    icon: "solar:video-library-linear",
  },
  logs: {
    title: "高级信息",
    description: "遇到问题时查看详细原因。",
    icon: "solar:document-text-linear",
  },
};

function interactionDisplayText(value?: string | null) {
  const text = commercialDisplayText(value || "").trim();
  if (!text) return "";
  if (
    /^\s*[\[{]/.test(text) ||
    /(?:https?:\/\/|internal:\/\/|localhost|127\.0\.0\.1|(?:\/Users|\/Volumes|\/private|\/tmp|\/var)\/|[A-Za-z]:\\|\b(?:PID|API|JSON|hash)\b|\b(?:pid|path|profile|stage|status)\s*=|\.(?:js|exe)\b|\b[a-f0-9]{32,}\b)/i.test(
      text,
    )
  ) {
    return "已保存处理记录";
  }
  return commercialPrimaryText(text).replace(/真实执行/g, "正式执行");
}

const runCheckNavItems: Array<{
  key: LocalEngineTabKey;
  title: string;
  href: string;
  icon: string;
}> = [
  {
    key: "engine",
    title: "总览",
    href: "/local-engine",
    icon: "solar:server-square-cloud-linear",
  },
  {
    key: "browser",
    title: "平台账号",
    href: "/local-engine?tab=browser",
    icon: "solar:window-frame-linear",
  },
  {
    key: "desktop",
    title: "桌面权限",
    href: "/local-engine?tab=desktop",
    icon: "solar:monitor-linear",
  },
  {
    key: "files",
    title: "文件凭证",
    href: "/local-engine?tab=files",
    icon: "solar:folder-with-files-linear",
  },
  {
    key: "permissions",
    title: "安全检查",
    href: "/local-engine?tab=permissions",
    icon: "solar:shield-check-linear",
  },
  {
    key: "tasks",
    title: "互动记录",
    href: "/local-engine?tab=tasks",
    icon: "solar:chat-square-check-linear",
  },
  {
    key: "evidence",
    title: "结果留存",
    href: "/local-engine?tab=evidence",
    icon: "solar:video-library-linear",
  },
  {
    key: "logs",
    title: "高级信息",
    href: "/local-engine?tab=logs",
    icon: "solar:document-text-linear",
  },
];

const interactionPageMeta: Record<
  ActiveInteractionRouteKey,
  {
    title: string;
    description: string;
    icon: string;
  }
> = {
  comments: {
    title: "评论回复",
    description: "处理平台评论回复任务，默认先进入本机账号后台做检查。",
    icon: "solar:chat-round-like-linear",
  },
  messages: {
    title: "私信回复",
    description:
      "处理私信会话回复任务，默认自动发送；只有用户切到确认后发送才停下。",
    icon: "solar:inbox-line-linear",
  },
  "channel-comments": {
    title: "视频号评论",
    description:
      "进入视频号后台读取真实客户评论，AI 按评论内容生成回复并按发送模式执行。",
    icon: "solar:chat-round-like-linear",
  },
  "channel-messages": {
    title: "视频号私信",
    description:
      "进入视频号后台读取真实私信会话，AI 按对方内容生成回复并按发送模式执行。",
    icon: "solar:inbox-line-linear",
  },
  customers: {
    title: "客户跟进",
    description: "把客户线索转成微信跟进动作，默认自动发送。",
    icon: "solar:user-check-linear",
  },
  rules: {
    title: "自动回复规则",
    description: "配置传统服务业的话术边界、升级人工条件和发送防线。",
    icon: "solar:settings-minimalistic-linear",
  },
  records: {
    title: "回复记录",
    description: "查看已完成、失败和跳过的互动任务记录。",
    icon: "solar:clipboard-list-linear",
  },
};

const taskTypes: Array<{
  key: InteractionTaskType;
  label: string;
  helper: string;
}> = [
  {
    key: "douyin-comment-reply",
    label: "抖音自动评论",
    helper: "从评论管理页定位留言，生成回复并按发送模式执行。",
  },
  {
    key: "douyin-direct-message-reply",
    label: "抖音私信回复",
    helper: "从私信会话读取上下文，连续处理待回复对象并按发送模式执行。",
  },
  {
    key: "wechat-channel-comment-reply",
    label: "视频号评论回复",
    helper:
      "从视频号评论管理页读取真实评论，AI 按客户内容回复并按发送模式执行。",
  },
  {
    key: "wechat-channel-direct-message-reply",
    label: "视频号私信回复",
    helper: "从视频号私信入口读取真实会话，AI 按对方内容回复并按发送模式执行。",
  },
  {
    key: "customer-follow-up",
    label: "客户跟进",
    helper: "把客户对象、来源内容和跟进话术转成微信跟进动作。",
  },
];

const interactionViews: Record<
  ActiveInteractionBusinessRouteKey,
  {
    title: string;
    subtitle: string;
    defaultType: InteractionTaskType;
    platformType: number;
    platformLabel: string;
    sourceLabel: string;
    replyLabel: string;
    defaultTarget: string;
    defaultSource: string;
    defaultReply: string;
  }
> = {
  comments: {
    title: "评论回复",
    subtitle:
      "选择已登录平台账号，本机会打开对应后台入口；默认自动发送，确认后发送才停下。",
    defaultType: "douyin-comment-reply",
    platformType: 3,
    platformLabel: "抖音",
    sourceLabel: "评论内容",
    replyLabel: "回复内容",
    defaultTarget: "评论用户",
    defaultSource: "想了解一下现在还能预约吗？",
    defaultReply: "您好，可以预约。您方便留下联系方式吗？我们马上帮您安排。",
  },
  messages: {
    title: "私信回复",
    subtitle: "进入账号私信入口读取真实会话；默认自动发送，确认后发送才停下。",
    defaultType: "douyin-direct-message-reply",
    platformType: 3,
    platformLabel: "抖音",
    sourceLabel: "私信内容",
    replyLabel: "私信回复",
    defaultTarget: "私信客户",
    defaultSource: "你好，想问下服务流程和价格。",
    defaultReply: "您好，我们可以先了解您的需求，再给您匹配合适方案。",
  },
  "channel-comments": {
    title: "视频号评论回复",
    subtitle: "进入视频号后台读取真实评论；默认自动发送，确认后发送才停下。",
    defaultType: "wechat-channel-comment-reply",
    platformType: 2,
    platformLabel: "视频号",
    sourceLabel: "评论内容",
    replyLabel: "回复内容",
    defaultTarget: "视频号评论用户",
    defaultSource: "等待系统读取真实视频号评论。",
    defaultReply: "",
  },
  "channel-messages": {
    title: "视频号私信回复",
    subtitle:
      "进入视频号私信入口读取真实会话；默认自动发送，确认后发送才停下。",
    defaultType: "wechat-channel-direct-message-reply",
    platformType: 2,
    platformLabel: "视频号",
    sourceLabel: "私信内容",
    replyLabel: "私信回复",
    defaultTarget: "视频号私信客户",
    defaultSource: "等待系统读取真实视频号私信。",
    defaultReply: "",
  },
  customers: {
    title: "客户跟进",
    subtitle: "按客户对象生成跟进话术，并默认转到桌面微信跟进发送。",
    defaultType: "customer-follow-up",
    platformType: 2,
    platformLabel: "客户",
    sourceLabel: "客户来源/待跟进事项",
    replyLabel: "跟进话术",
    defaultTarget: "重点客户",
    defaultSource: "客户咨询过价格，尚未留下电话。",
    defaultReply:
      "您好，想跟进一下您上次咨询的需求。您方便补充下时间和联系方式吗？我们帮您安排专人对接。",
  },
};

const sendModes: Array<{ key: InteractionSendMode; label: string }> = [
  { key: "auto-send", label: "自动发送" },
  { key: "approval-send", label: "确认后发送" },
];

const permissionStatusLabel: Record<string, string> = {
  allowed: "商用可执行",
  approval_required: "需人工确认",
  blocked: "商用未授权",
  trial_limited: "试用限制",
};

const emptyRecordsSummary: InteractionRecordsSummary = {
  total: 0,
  completed: 0,
  failed: 0,
  blocked: 0,
  skipped: 0,
  noTarget: 0,
  evidenceCount: 0,
  byType: {
    "douyin-comment-reply": 0,
    "douyin-direct-message-reply": 0,
    "wechat-channel-comment-reply": 0,
    "wechat-channel-direct-message-reply": 0,
    "wechat-reply-draft": 0,
    "wechat-group-broadcast": 0,
    "wechat-contact-add": 0,
    "wechat-friend-accept": 0,
    "wechat-moments-publish": 0,
    "wechat-moments-marketing": 0,
    "customer-follow-up": 0,
  },
};
export default function LocalEnginePage() {
  return (
    <React.Suspense
      fallback={
        <div className="flex min-h-[360px] items-center justify-center">
          <Spinner size="sm" />
        </div>
      }
    >
      <LocalEngineContent />
    </React.Suspense>
  );
}
export function InteractionRoutePage({
  route,
}: {
  route: InteractionRouteKey;
}) {
  return (
    <React.Suspense
      fallback={
        <div className="flex min-h-[360px] items-center justify-center">
          <Spinner size="sm" />
        </div>
      }
    >
      <InteractionRouteContent route={route} />
    </React.Suspense>
  );
}

function LocalEngineContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const requestedTaskId = searchParams.get("taskId") || "";
  const selectedTab = tabKeys.includes(
    (requestedTab || "") as LocalEngineTabKey,
  )
    ? (requestedTab as LocalEngineTabKey)
    : "engine";
  const [health, setHealth] = React.useState<LocalEngineHealth | null>(null);
  const [browserStatus, setBrowserStatus] =
    React.useState<LocalEngineBrowserStatus | null>(null);
  const [executorsStatus, setExecutorsStatus] =
    React.useState<LocalEngineExecutorsStatus | null>(null);
  const [fileStatus, setFileStatus] =
    React.useState<LocalEngineFileAccessStatus | null>(null);
  const [readiness, setReadiness] = React.useState<LocalEngineReadiness | null>(
    null,
  );
  const [wechatContactsReadiness, setWechatContactsReadiness] =
    React.useState<WechatContactsReadinessResult | null>(null);
  const [runtimeStatus, setRuntimeStatus] =
    React.useState<LocalEngineRuntimeStatus | null>(null);
  const [tasks, setTasks] = React.useState<InteractionTask[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [browserLoading, setBrowserLoading] = React.useState(true);
  const [executorsLoading, setExecutorsLoading] = React.useState(true);
  const [filesLoading, setFilesLoading] = React.useState(true);
  const [readinessLoading, setReadinessLoading] = React.useState(true);
  const [wechatContactsLoading, setWechatContactsLoading] =
    React.useState(true);
  const [runtimeLoading, setRuntimeLoading] = React.useState(true);
  const [runtimeAction, setRuntimeAction] =
    React.useState<LocalEngineRuntimeAction | null>(null);
  const [tasksLoading, setTasksLoading] = React.useState(true);
  const [agentSStatus, setAgentSStatus] =
    React.useState<AgentSStatusSnapshot | null>(null);
  const [agentSLoading, setAgentSLoading] = React.useState(true);

  React.useEffect(() => {
    if (requestedTab && legacyInteractionRoutes[requestedTab]) {
      router.replace(legacyInteractionRoutes[requestedTab]);
    }
  }, [requestedTab, router]);

  const refreshHealth = React.useCallback(async () => {
    setLoading(true);
    try {
      const result = await localEngineApi.health();
      setHealth(result);
    } catch {
      setHealth(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshTasks = React.useCallback(async () => {
    setTasksLoading(true);
    try {
      const result = await localEngineApi.tasks();
      setTasks(result);
    } catch (e: unknown) {
      addToast({
        title: "互动任务读取失败",
        description: shortToastDescription(e, "请稍后重试"),
        color: "danger",
      });
      setTasks([]);
    } finally {
      setTasksLoading(false);
    }
  }, []);

  const refreshBrowserStatus = React.useCallback(async () => {
    setBrowserLoading(true);
    try {
      const result = await localEngineApi.browserStatus();
      setBrowserStatus(result);
    } catch (e: unknown) {
      setBrowserStatus(null);
      addToast({
        title: "平台账号检查失败",
        description: shortToastDescription(e, "请稍后重试"),
        color: "danger",
      });
    } finally {
      setBrowserLoading(false);
    }
  }, []);

  const refreshExecutorsStatus = React.useCallback(async () => {
    setExecutorsLoading(true);
    try {
      const result = await localEngineApi.executorsStatus();
      setExecutorsStatus(result);
    } catch (e: unknown) {
      setExecutorsStatus(null);
      addToast({
        title: "客户互动可用性读取失败",
        description: shortToastDescription(e, "请稍后重试"),
        color: "danger",
      });
    } finally {
      setExecutorsLoading(false);
    }
  }, []);

  const refreshFileStatus = React.useCallback(async () => {
    setFilesLoading(true);
    try {
      const result = await localEngineApi.fileAccessStatus();
      setFileStatus(result);
    } catch (e: unknown) {
      setFileStatus(null);
      addToast({
        title: "文件访问状态读取失败",
        description: shortToastDescription(e, "请稍后重试"),
        color: "danger",
      });
    } finally {
      setFilesLoading(false);
    }
  }, []);

  const refreshReadiness = React.useCallback(async () => {
    setReadinessLoading(true);
    try {
      const result = await localEngineApi.readiness();
      setReadiness(result);
    } catch (e: unknown) {
      setReadiness(null);
      addToast({
        title: "权限检查读取失败",
        description: shortToastDescription(e, "请稍后重试"),
        color: "danger",
      });
    } finally {
      setReadinessLoading(false);
    }
  }, []);

  const refreshWechatContactsReadiness = React.useCallback(async () => {
    setWechatContactsLoading(true);
    try {
      const result = await localEngineApi.wechatContactsReadiness();
      setWechatContactsReadiness(result);
    } catch (e: unknown) {
      setWechatContactsReadiness(null);
      addToast({
        title: "微信通讯录检查失败",
        description: shortToastDescription(e, "请稍后重试"),
        color: "danger",
      });
    } finally {
      setWechatContactsLoading(false);
    }
  }, []);

  const refreshRuntimeStatus = React.useCallback(async () => {
    setRuntimeLoading(true);
    try {
      const result = await localEngineApi.runtimeStatus();
      setRuntimeStatus(result);
    } catch (e: unknown) {
      setRuntimeStatus(null);
      addToast({
        title: "运行状态读取失败",
        description: shortToastDescription(e, "请稍后重试"),
        color: "danger",
      });
    } finally {
      setRuntimeLoading(false);
    }
  }, []);

  const refreshAgentSStatus = React.useCallback(async () => {
    setAgentSLoading(true);
    try {
      setAgentSStatus(await localEngineApi.agentSStatus());
    } catch {
      setAgentSStatus(null);
    } finally {
      setAgentSLoading(false);
    }
  }, []);

  const runRuntimeAction = React.useCallback(
    async (action: LocalEngineRuntimeAction) => {
      setRuntimeAction(action);
      try {
        const result = await localEngineApi.runRuntimeAction(action);
        addToast({
          title:
            action === "restart"
              ? "正在重启本机服务"
              : action === "stop"
                ? "正在停止本机服务"
                : "正在启动本机服务",
          description: result.message,
          color: action === "stop" ? "warning" : "success",
        });
        window.setTimeout(
          () => {
            refreshRuntimeStatus().catch(() => {
              addToast({ title: "状态刷新失败", color: "danger" });
            });
          },
          action === "stop" ? 1500 : 5000,
        );
      } catch (e: unknown) {
        addToast({
          title: "运行检查异常",
          description: shortToastDescription(e, "请稍后重试"),
          color: "danger",
        });
      } finally {
        setRuntimeAction(null);
      }
    },
    [refreshRuntimeStatus],
  );

  React.useEffect(() => {
    refreshHealth();
    refreshTasks();
    refreshBrowserStatus();
    refreshExecutorsStatus();
    refreshFileStatus();
    refreshReadiness();
    refreshWechatContactsReadiness();
    refreshRuntimeStatus();
    refreshAgentSStatus();
  }, [
    refreshBrowserStatus,
    refreshExecutorsStatus,
    refreshFileStatus,
    refreshHealth,
    refreshReadiness,
    refreshWechatContactsReadiness,
    refreshRuntimeStatus,
    refreshTasks,
    refreshAgentSStatus,
  ]);

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      refreshHealth();
      if (
        selectedTab === "browser" ||
        selectedTab === "tasks" ||
        selectedTab === "desktop"
      ) {
        refreshBrowserStatus();
        refreshExecutorsStatus();
      }
      if (selectedTab === "browser") {
        refreshAgentSStatus();
      }
      if (selectedTab === "tasks") {
        refreshTasks();
      }
      if (selectedTab === "engine") {
        refreshRuntimeStatus();
        refreshAgentSStatus();
        refreshWechatContactsReadiness();
      }
      if (selectedTab === "files") {
        refreshFileStatus();
      }
      if (selectedTab === "permissions") {
        refreshReadiness();
      }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [
    refreshAgentSStatus,
    refreshBrowserStatus,
    refreshExecutorsStatus,
    refreshFileStatus,
    refreshHealth,
    refreshReadiness,
    refreshWechatContactsReadiness,
    refreshRuntimeStatus,
    refreshTasks,
    selectedTab,
  ]);

  const capabilityByKey = React.useMemo(() => {
    const map = new Map<LocalEngineCapability["key"], LocalEngineCapability>();
    health?.capabilities.forEach((capability) =>
      map.set(capability.key, capability),
    );
    return map;
  }, [health]);
  const meta = pageMeta[selectedTab];
  const statusChecking = loading || readinessLoading;
  const readinessBlockerCount = readiness?.summary.blockers ?? 0;
  const requiredIssueCount =
    (health?.requiredBlocked ?? 0) + readinessBlockerCount;
  const requiredReady =
    health?.ready === true &&
    (health.requiredBlocked ?? 0) === 0 &&
    (health.blockers?.length ?? 0) === 0 &&
    readiness?.ready === true &&
    readinessBlockerCount === 0;
  return (
    <div className="local-engine-console mx-auto flex w-full max-w-6xl flex-col gap-4">
      <header className="local-engine-console__header flex flex-col gap-4 rounded-[8px] border-small border-divider bg-background p-5 shadow-sm md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 flex-none items-center justify-center rounded-[8px] bg-primary/10 text-primary">
            <Icon icon={meta.icon} width={26} />
          </div>
          <div>
            <h2 className="text-[17px] font-bold leading-6 text-[var(--kaypal-v3-ink)]">
              {meta.title}
            </h2>
            <p className="mt-1 text-small text-default-500">
              {meta.description}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Chip
            color={
              statusChecking ? "default" : requiredReady ? "success" : "danger"
            }
            variant="flat"
          >
            {statusChecking
              ? "检查中"
              : requiredReady
                ? "当前可用"
                : requiredIssueCount > 0
                  ? `需处理 ${requiredIssueCount}`
                  : "状态未确认"}
          </Chip>
          <Button
            color="primary"
            isLoading={
              loading ||
              tasksLoading ||
              browserLoading ||
              executorsLoading ||
              filesLoading ||
              readinessLoading ||
              wechatContactsLoading ||
              runtimeLoading
            }
            startContent={
              loading ||
              tasksLoading ||
              browserLoading ||
              executorsLoading ||
              filesLoading ||
              readinessLoading ||
              wechatContactsLoading ||
              runtimeLoading ? null : (
                <Icon icon="solar:refresh-linear" />
              )
            }
            variant="flat"
            onPress={() => {
              Promise.all([
                refreshHealth(),
                refreshTasks(),
                refreshBrowserStatus(),
                refreshExecutorsStatus(),
                refreshFileStatus(),
                refreshReadiness(),
                refreshWechatContactsReadiness(),
                refreshRuntimeStatus(),
                refreshAgentSStatus(),
              ]).catch(() => {
                addToast({ title: "刷新失败", color: "danger" });
              });
            }}
          >
            刷新
          </Button>
        </div>
      </header>
      <RunCheckNav selectedTab={selectedTab} />
      {selectedTab === "engine" ? (
        <EngineOverview
          browserLoading={browserLoading}
          browserStatus={browserStatus}
          executorsLoading={executorsLoading}
          executorsStatus={executorsStatus}
          fileStatus={fileStatus}
          filesLoading={filesLoading}
          health={health}
          loading={loading}
          readiness={readiness}
          readinessLoading={readinessLoading}
          wechatContactsLoading={wechatContactsLoading}
          wechatContactsReadiness={wechatContactsReadiness}
          runtimeLoading={runtimeLoading}
          runtimeStatus={runtimeStatus}
          agentSStatus={agentSStatus}
          agentSLoading={agentSLoading}
        />
      ) : null}
      {selectedTab === "workbench" ? <OpsWorkbenchView /> : null}
      {selectedTab === "browser" ? (
        <div className="grid gap-4">
          <QuickAgentTaskPanel
            defaultInstruction="打开当前已登录的平台后台，只读检查登录态、页面可访问性和可处理对象；需要发送或发布时先进入待我确认。"
            description="从这里直接创建浏览器任务，会进入任务并沉淀截图、页面记录和失败原因。"
            icon="solar:window-frame-linear"
            scope="browser"
            targetApp="本机浏览器"
            title="新建浏览器任务"
          />
          <BrowserControlPanel
            capability={capabilityByKey.get("browser-control")}
            executorsLoading={executorsLoading}
            executorsStatus={executorsStatus}
            agentSLoading={agentSLoading}
            agentSStatus={agentSStatus}
            loading={browserLoading}
            status={browserStatus}
            onRefreshAgentS={refreshAgentSStatus}
            onRefreshExecutors={refreshExecutorsStatus}
            onRefresh={refreshBrowserStatus}
            onTaskCreated={async () => {
              await Promise.all([
                refreshTasks(),
                refreshBrowserStatus(),
                refreshExecutorsStatus(),
              ]);
            }}
          />
        </div>
      ) : null}
      {selectedTab === "desktop" ? (
        <div className="grid gap-4">
          <QuickAgentTaskPanel
            defaultInstruction="检查桌面微信窗口和辅助功能权限；如果要填入草稿，先截图留证并进入待我确认，不要自动发送。"
            description="从这里直接创建桌面任务，适合微信会话、当前窗口确认、草稿填入和桌面截图。"
            icon="solar:monitor-linear"
            scope="desktop"
            targetApp="桌面应用"
            title="新建桌面任务"
          />
          <WechatSessionPanel />
          <DesktopCapabilityPanel
            capabilityByKey={capabilityByKey}
            executorsLoading={executorsLoading}
            executorsStatus={executorsStatus}
          />
        </div>
      ) : null}
      {selectedTab === "files" ? (
        <FileAccessPanel
          capability={capabilityByKey.get("file-access")}
          loading={filesLoading}
          status={fileStatus}
          onRefresh={refreshFileStatus}
        />
      ) : null}
      {selectedTab === "permissions" ? (
        <PermissionCheckPanel
          capability={capabilityByKey.get("permission-check")}
          loading={readinessLoading}
          readiness={readiness}
          onRefresh={refreshReadiness}
        />
      ) : null}
      {selectedTab === "tasks" ? (
        <TasksPanel
          tasks={tasks}
          loading={tasksLoading}
          onRefresh={refreshTasks}
        />
      ) : null}
      {selectedTab === "remote" ? (
        <QuickAgentTaskPanel
          defaultInstruction="检查远程任务触发来源、授权用户和执行风险；不要真正运行命令，先进入待我确认。"
          description="远程任务先创建可追溯记录，确认目标主机、授权人和命令范围后再继续。"
          icon="solar:cloud-line-duotone"
          scope="remote"
          targetApp="远程任务"
          title="远程任务"
        />
      ) : null}
      {selectedTab === "evidence" ? (
        <EvidenceReplayPanel
          tasks={tasks}
          tasksLoading={tasksLoading}
          selectedTaskId={requestedTaskId}
          onRefreshTasks={refreshTasks}
        />
      ) : null}
      {selectedTab === "logs" ? (
        <div className="grid gap-4">
          <RuntimeStatusPanel
            loading={runtimeLoading}
            status={runtimeStatus}
            onRefresh={refreshRuntimeStatus}
            onRunAction={runRuntimeAction}
            runningAction={runtimeAction}
          />
          <McpStatusCard />
        </div>
      ) : null}
    </div>
  );
}

function InteractionRouteContent({ route }: { route: InteractionRouteKey }) {
  const [health, setHealth] = React.useState<LocalEngineHealth | null>(null);
  const [browserStatus, setBrowserStatus] =
    React.useState<LocalEngineBrowserStatus | null>(null);
  const [executorsStatus, setExecutorsStatus] =
    React.useState<LocalEngineExecutorsStatus | null>(null);
  const [replyRule, setReplyRule] =
    React.useState<InteractionReplyRuleConfig | null>(null);
  const [tasks, setTasks] = React.useState<InteractionTask[]>([]);
  const [recordsSummary, setRecordsSummary] =
    React.useState<InteractionRecordsSummary>(emptyRecordsSummary);
  const [healthLoading, setHealthLoading] = React.useState(true);
  const [browserLoading, setBrowserLoading] = React.useState(true);
  const [executorsLoading, setExecutorsLoading] = React.useState(true);
  const [replyRuleLoading, setReplyRuleLoading] = React.useState(true);
  const [tasksLoading, setTasksLoading] = React.useState(true);

  const refreshHealth = React.useCallback(async () => {
    setHealthLoading(true);
    try {
      setHealth(await localEngineApi.health());
    } catch {
      setHealth(null);
    } finally {
      setHealthLoading(false);
    }
  }, []);

  const refreshBrowserStatus = React.useCallback(async () => {
    setBrowserLoading(true);
    try {
      setBrowserStatus(await localEngineApi.browserStatus());
    } catch (e: unknown) {
      setBrowserStatus(null);
      addToast({
        title: "账号状态读取失败",
        description: shortToastDescription(e),
        color: "danger",
      });
    } finally {
      setBrowserLoading(false);
    }
  }, []);

  const refreshExecutorsStatus = React.useCallback(async () => {
    setExecutorsLoading(true);
    try {
      setExecutorsStatus(await localEngineApi.executorsStatus());
    } catch (e: unknown) {
      setExecutorsStatus(null);
      addToast({
        title: "互动服务状态读取失败",
        description: shortToastDescription(e),
        color: "danger",
      });
    } finally {
      setExecutorsLoading(false);
    }
  }, []);

  const refreshReplyRule = React.useCallback(async () => {
    setReplyRuleLoading(true);
    try {
      setReplyRule(await localEngineApi.replyRule());
    } catch (e: unknown) {
      setReplyRule(null);
      addToast({
        title: "规则读取失败",
        description: shortToastDescription(e),
        color: "danger",
      });
    } finally {
      setReplyRuleLoading(false);
    }
  }, []);

  const isBusinessRoute = (
    [
      "comments",
      "messages",
      "channel-comments",
      "channel-messages",
      "customers",
    ] as InteractionRouteKey[]
  ).includes(route);
  const businessRoute = isBusinessRoute
    ? (route as ActiveInteractionBusinessRouteKey)
    : null;

  const refreshTasks = React.useCallback(async () => {
    setTasksLoading(true);
    try {
      if (route === "records") {
        const result = await localEngineApi.records();
        setTasks(result.items);
        setRecordsSummary(result.summary);
      } else if (businessRoute) {
        setTasks(await localEngineApi.businessTasks(businessRoute));
      } else {
        setTasks([]);
        setRecordsSummary(emptyRecordsSummary);
      }
    } catch (e: unknown) {
      setTasks([]);
      addToast({
        title: "互动任务读取失败",
        description: shortToastDescription(e),
        color: "danger",
      });
    } finally {
      setTasksLoading(false);
    }
  }, [businessRoute, route]);

  React.useEffect(() => {
    refreshHealth();
    if (businessRoute) {
      refreshBrowserStatus();
      refreshExecutorsStatus();
    } else {
      setBrowserLoading(false);
      setExecutorsLoading(false);
    }
    if (route === "rules") {
      refreshReplyRule();
    } else {
      setReplyRuleLoading(false);
    }
    if (route === "records" || isBusinessRoute) {
      refreshTasks();
    } else {
      setTasksLoading(false);
    }
  }, [
    businessRoute,
    isBusinessRoute,
    refreshBrowserStatus,
    refreshExecutorsStatus,
    refreshHealth,
    refreshReplyRule,
    refreshTasks,
    route,
  ]);

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      refreshHealth();
      if (businessRoute) {
        refreshBrowserStatus();
        refreshExecutorsStatus();
      }
      if (route === "records" || isBusinessRoute) {
        refreshTasks();
      }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [
    businessRoute,
    isBusinessRoute,
    refreshBrowserStatus,
    refreshExecutorsStatus,
    refreshHealth,
    refreshTasks,
    route,
  ]);

  if (route === "moments" || route === "wechat" || route === "groups") {
    return (
      <div className="local-engine-console mx-auto flex w-full max-w-3xl flex-col gap-4 rounded-[8px] border-small border-divider bg-background p-5 shadow-sm">
        <h2 className="text-[17px] font-bold leading-6 text-[var(--kaypal-v3-ink)]">
          客户互动
        </h2>
        <p className="text-small text-default-500">
          当前版本暂不支持微信会话、微信群发和朋友圈发布，请使用抖音和视频号互动功能。
        </p>
        <Button
          as={Link}
          color="primary"
          href="/engagement"
          startContent={<Icon icon="solar:widget-linear" />}
        >
          返回客户互动
        </Button>
      </div>
    );
  }
  const meta = interactionPageMeta[route];
  const isLoading =
    healthLoading ||
    browserLoading ||
    executorsLoading ||
    replyRuleLoading ||
    tasksLoading;
  return (
    <div className="local-engine-console mx-auto flex w-full max-w-6xl flex-col gap-4">
      <header className="local-engine-console__header flex flex-col gap-4 rounded-[8px] border-small border-divider bg-background p-5 shadow-sm md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 flex-none items-center justify-center rounded-[8px] bg-primary/10 text-primary">
            <Icon icon={meta.icon} width={26} />
          </div>
          <div>
            <h2 className="text-[17px] font-bold leading-6 text-[var(--kaypal-v3-ink)]">
              {meta.title}
            </h2>
            <p className="mt-1 text-small text-default-500">
              {meta.description}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Chip color={health?.online ? "success" : "danger"} variant="flat">
            {healthLoading
              ? "检查中"
              : health?.online
                ? "引擎在线"
                : "引擎离线"}
          </Chip>
          <Button
            color="primary"
            isLoading={isLoading}
            startContent={
              isLoading ? null : <Icon icon="solar:refresh-linear" />
            }
            variant="flat"
            onPress={() => {
              const calls: Array<Promise<void>> = [refreshHealth()];
              if (businessRoute) {
                calls.push(refreshBrowserStatus());
                calls.push(refreshExecutorsStatus());
              }
              if (route === "rules") {
                calls.push(refreshReplyRule());
              }
              if (route === "records" || isBusinessRoute) {
                calls.push(refreshTasks());
              }
              Promise.all(calls).catch(() => {
                addToast({ title: "刷新失败", color: "danger" });
              });
            }}
          >
            刷新
          </Button>
        </div>
      </header>
      {isBusinessRoute ? (
        <InteractionCreatePanel
          browserStatus={browserStatus}
          executorsStatus={executorsStatus}
          route={businessRoute!}
          view={interactionViews[businessRoute!]}
          onCreated={() => {
            refreshHealth();
            refreshTasks();
          }}
        />
      ) : null}
      {isBusinessRoute ? (
        <TasksPanel
          tasks={tasks}
          loading={tasksLoading}
          onRefresh={refreshTasks}
        />
      ) : null}
      {route === "rules" ? (
        <RulesPanel
          loading={replyRuleLoading}
          rule={replyRule}
          onSaved={(nextRule) => setReplyRule(nextRule)}
        />
      ) : null}
      {route === "records" ? (
        <RecordsPanel
          tasks={tasks}
          loading={tasksLoading}
          summary={recordsSummary}
          onRefresh={async (filters) => {
            setTasksLoading(true);
            try {
              const result = await localEngineApi.records({
                status: filters.status === "all" ? undefined : filters.status,
                type: filters.type === "all" ? undefined : filters.type,
              });
              setTasks(result.items);
              setRecordsSummary(result.summary);
            } finally {
              setTasksLoading(false);
            }
          }}
        />
      ) : null}
    </div>
  );
}
function RunCheckNav({ selectedTab }: { selectedTab: LocalEngineTabKey }) {
  return (
    <nav
      className="local-engine-console__nav rounded-[8px] border-small border-divider bg-background p-2 shadow-sm"
      aria-label="运行检查分类"
    >
      <div className="grid gap-2 md:grid-cols-4 xl:grid-cols-8">
        {runCheckNavItems.map((item) => {
          const active = item.key === selectedTab;
          return (
            <Button
              key={item.key}
              as={Link}
              className="justify-start"
              color={active ? "primary" : "default"}
              href={item.href}
              size="sm"
              startContent={<Icon icon={item.icon} />}
              variant={active ? "flat" : "light"}
            >
              {item.title}
            </Button>
          );
        })}
      </div>
    </nav>
  );
}

function EngineOverview({
  health,
  loading,
  browserLoading,
  browserStatus,
  executorsLoading,
  executorsStatus,
  filesLoading,
  fileStatus,
  readinessLoading,
  readiness,
  wechatContactsLoading,
  wechatContactsReadiness,
  runtimeLoading,
  runtimeStatus,
  agentSStatus,
  agentSLoading,
}: {
  health: LocalEngineHealth | null;
  loading: boolean;
  browserLoading: boolean;
  browserStatus: LocalEngineBrowserStatus | null;
  executorsLoading: boolean;
  executorsStatus: LocalEngineExecutorsStatus | null;
  filesLoading: boolean;
  fileStatus: LocalEngineFileAccessStatus | null;
  readinessLoading: boolean;
  readiness: LocalEngineReadiness | null;
  wechatContactsLoading: boolean;
  wechatContactsReadiness: WechatContactsReadinessResult | null;
  runtimeLoading: boolean;
  runtimeStatus: LocalEngineRuntimeStatus | null;
  agentSStatus: AgentSStatusSnapshot | null;
  agentSLoading: boolean;
}) {
  if (loading && !health) {
    return <Spinner size="sm" />;
  }
  if (!health) {
    return (
      <Card className="border-small border-danger-200 bg-danger-50 shadow-sm">
        <CardBody className="text-small text-danger-700">
          本机助手暂不可用，请稍后重新检查。
        </CardBody>
      </Card>
    );
  }
  const agentSAssessment = getAgentSAssessment(agentSStatus, agentSLoading);
  const readinessBlockerCount = readiness?.summary.blockers ?? 0;
  const systemReady =
    health.ready === true &&
    (health.requiredBlocked ?? 0) === 0 &&
    (health.blockers?.length ?? 0) === 0 &&
    readiness?.ready === true &&
    readinessBlockerCount === 0;
  const systemIssueCount =
    (health.requiredBlocked ?? 0) + readinessBlockerCount;
  return (
    <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr] lg:items-start">
      <Card className="border-small border-divider bg-background shadow-sm">
        <CardBody className="gap-4">
          <div>
            <h3 className="text-medium font-semibold text-default-900">
              本机助手总览
            </h3>
            <p className="mt-1 text-small text-default-500">
              看今天能不能正常处理客户互动；需要修复的账号、权限和服务会在这里集中提示。
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <StatusItem
              label="运行状态"
              value={
                readinessLoading
                  ? "检查中"
                  : systemReady
                    ? "当前可用"
                    : systemIssueCount > 0
                      ? `需处理 ${systemIssueCount}`
                      : "状态未确认"
              }
            />
            <StatusItem
              label="处理方式"
              value={
                agentSAssessment.isRealExecutionReady
                  ? "当前可用"
                  : "需处理"
              }
            />
            <StatusItem
              label="服务状态"
              value={runtimeLoading ? "检查中" : runtimeStatus?.allOnline ? "可用" : "需处理"}
              wide
            />
            <StatusItem
              label="最近检查"
              value={new Date(health.checkedAt).toLocaleString()}
              wide
            />
          </div>
        </CardBody>
      </Card>
      <Card className="border-small border-divider bg-background shadow-sm">
        <CardBody className="gap-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-medium font-semibold text-default-900">
                处理服务
              </h3>
              <p className="mt-1 text-small text-default-500">
                {runtimeLoading
                  ? "正在检查服务状态。"
                  : runtimeStatus?.allOnline
                    ? "客户互动和发布服务当前可用。"
                    : "部分服务需要处理，完成后再继续任务。"}
              </p>
            </div>
            <Chip
              color={runtimeStatus?.allOnline ? "success" : "warning"}
              variant="flat"
            >
              {runtimeLoading
                ? "检查中"
                : runtimeStatus?.allOnline
                  ? "可用"
                  : "需处理"}
            </Chip>
          </div>
          <Button
            as={Link}
            href="/local-engine?tab=logs"
            size="sm"
            variant="flat"
          >
            查看高级信息
          </Button>
        </CardBody>
      </Card>
      <Card className="border-small border-divider bg-background shadow-sm">
        <CardBody className="gap-4">
          <h3 className="text-medium font-semibold text-default-900">
            任务概况
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <QueueItem label="执行中" value={health.queue.running} />
            <QueueItem label="待继续" value={health.queue.waitingForApproval} />
            <QueueItem label="已完成" value={health.queue.completed} />
            <QueueItem label="失败" value={health.queue.failed} />
          </div>
        </CardBody>
      </Card>
      <div className="lg:col-span-2">
        <RunCheckDetailsPanel
          health={health}
          runtimeLoading={runtimeLoading}
          runtimeStatus={runtimeStatus}
          browserLoading={browserLoading}
          browserStatus={browserStatus}
          executorsLoading={executorsLoading}
          executorsStatus={executorsStatus}
          filesLoading={filesLoading}
          fileStatus={fileStatus}
          readinessLoading={readinessLoading}
          readiness={readiness}
          wechatContactsLoading={wechatContactsLoading}
          wechatContactsReadiness={wechatContactsReadiness}
          agentSLoading={agentSLoading}
          agentSStatus={agentSStatus}
        />
      </div>
      <div className="grid gap-4 lg:col-span-2 md:grid-cols-2">
        {health.capabilities
          .filter(
            (capability) =>
              !capabilityKeysWithDedicatedStatus.has(capability.key),
          )
          .map((capability) => (
            <CapabilitySummary
              key={capability.key}
              capability={capability}
              agentSAssessment={agentSAssessment}
            />
          ))}
      </div>
      <div className="lg:col-span-2">
        <AgentSStatusPanel
          sidecar={{
            status: agentSAssessment.panelStatus,
            label: agentSAssessment.label,
            detail: commercialDisplayText(
              `${agentSAssessment.summary} ${agentSAssessment.detail}`,
            ),
          }}
          session={{
            status: "idle",
            label: "无活跃任务",
            detail: "从客户互动、发布准备或本机服务页面创建新任务",
          }}
          events={[]}
          approvalRequest={null}
          timelineTitle="本机助手任务记录"
        />
      </div>
    </div>
  );
}

type RunCheckDetailTone =
  | "ready"
  | "warning"
  | "danger"
  | "deferred"
  | "muted";

type RunCheckDetailItem = {
  key: string;
  name: string;
  status: RunCheckDetailTone;
  statusLabel: string;
  summary: string;
  detail?: string;
  actionHref?: string;
  actionLabel?: string;
};

function getReadinessAction(capability: string) {
  if (/(?:Kaypal|JIUZHANG AI).*账号|账号与权益/i.test(capability)) {
    return {
      actionHref:
        "/login?reauth=1&next=%2Flocal-engine%3Ftab%3Dengine",
      actionLabel: "重新登录",
    };
  }
  if (/AI.*模型|AI.*服务/i.test(capability)) {
    return {
      actionHref: "/settings?tab=ai",
      actionLabel: "设置 AI 服务",
    };
  }
  return {};
}

type RunCheckTableItem = RunCheckDetailItem & {
  groupKey: string;
  groupTitle: string;
  groupIcon: string;
};

function commercialRunCheckItem(item: RunCheckDetailItem): RunCheckDetailItem {
  return {
    ...item,
    name: commercialDisplayText(item.name),
    statusLabel: commercialDisplayText(item.statusLabel),
    summary: commercialDisplayText(item.summary),
    detail: item.detail ? commercialDisplayText(item.detail) : item.detail,
  };
}

type AgentSRunCheckAssessment = {
  status: RunCheckDetailTone;
  statusLabel: string;
  panelStatus: "disconnected" | "connecting" | "ready" | "error";
  label: string;
  summary: string;
  detail: string;
  runnerMode: string;
  browserControl: boolean | null;
  blockers: string[];
  warnings: string[];
  isRealExecutionReady: boolean;
};

function readRecordValue(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  return (value as Record<string, unknown>)[key];
}

function readStringValue(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function readBooleanValue(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "boolean") return value;
  }
  return null;
}

function readStringArrayValue(...values: unknown[]) {
  const items: string[] = [];
  values.forEach((value) => {
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (typeof item === "string" && item.trim()) items.push(item.trim());
      });
    }
  });
  return Array.from(new Set(items));
}

function shortToastDescription(value: unknown, fallback = "请稍后重试") {
  return toPublicError(value, fallback);
}

function statusTextLooksBlocked(value?: string) {
  return /blocked|failed|error|unsupported|not-found|not-logged-in|not-wechat/i.test(
    value || "",
  );
}

function statusTextLooksWarning(value?: string) {
  return /warning|missing|unknown|empty|low-confidence|encrypted-or-locked|detected-not-runnable|starting|not-applicable|candidate-found/i.test(
    value || "",
  );
}

function diagnosticToneFromStatus(value?: string): RunCheckDetailTone {
  if (!value) return "muted";
  if (statusTextLooksBlocked(value)) return "danger";
  if (statusTextLooksWarning(value)) return "warning";
  return "ready";
}

function mergeRunCheckTones(tones: RunCheckDetailTone[]): RunCheckDetailTone {
  if (tones.includes("danger")) return "danger";
  if (tones.includes("warning")) return "warning";
  if (tones.includes("ready")) return "ready";
  return "muted";
}

function wechatCheckStatusToTone(
  status: WechatContactsReadinessCheck["status"],
): RunCheckDetailTone {
  if (status === "ready") return "ready";
  if (status === "blocked" || status === "missing") return "danger";
  if (status === "warning" || status === "degraded") return "warning";
  return "muted";
}

function buildWechatContactDiagnosticItems(
  diagnostics?: WechatContactsSyncDiagnostics | null,
): RunCheckDetailItem[] {
  if (!diagnostics) return [];
  const runtimeTone = diagnostics.nativeRuntimePath
    ? "ready"
    : diagnostics.enginePath || diagnostics.engine
      ? "warning"
      : diagnosticToneFromStatus(diagnostics.platformStatus);
  const ocrTone: RunCheckDetailTone =
    diagnostics.ocrContactCount && diagnostics.ocrContactCount > 0
      ? "ready"
      : diagnostics.ocrPreview?.length
        ? "warning"
        : diagnostics.runtimeCapabilities?.some((item) =>
              /ocr|vision/i.test(item),
            )
          ? "warning"
          : "muted";

  const items: RunCheckDetailItem[] = [];
  if (
    diagnostics.nativeRuntimePath ||
    diagnostics.enginePath ||
    diagnostics.engine ||
    diagnostics.platformStatus
  ) {
    items.push({
      key: "wechat-diagnostics:runtime",
      name: "微信本机服务",
      status: runtimeTone,
      statusLabel: runCheckToneLabel(runtimeTone),
      summary: diagnostics.nativeRuntimePath
        ? "本机服务已可用，可参与联系人同步。"
        : "未确认本机服务可用，会影响完整同步可信度。",
      detail:
        diagnostics.nativeRuntimeVersion ||
        diagnostics.nativeRuntimePath ||
        diagnostics.engine ||
        diagnostics.platformStatus,
    });
  }
  if (
    diagnostics.windowStatus ||
    diagnostics.windowTitle ||
    diagnostics.processName
  ) {
    items.push({
      key: "wechat-diagnostics:window",
      name: "微信窗口",
      status: diagnosticToneFromStatus(diagnostics.windowStatus),
      statusLabel: runCheckToneLabel(
        diagnosticToneFromStatus(diagnostics.windowStatus),
      ),
      summary: diagnostics.windowStatus
        ? `窗口状态：${diagnostics.windowStatus}`
        : "未返回微信窗口状态。",
      detail:
        diagnostics.windowTitle ||
        diagnostics.processName ||
        diagnostics.failureReason,
    });
  }
  if (
    diagnostics.dbStatus ||
    diagnostics.dbKeyStatus ||
    diagnostics.dbContactCount !== undefined ||
    diagnostics.dbError ||
    diagnostics.sqlitePath ||
    diagnostics.dbPaths?.length
  ) {
    const dbTone = mergeRunCheckTones([
      diagnosticToneFromStatus(diagnostics.dbStatus),
      diagnosticToneFromStatus(diagnostics.dbKeyStatus),
    ]);
    items.push({
      key: "wechat-diagnostics:db",
      name: "微信联系人库",
      status: dbTone,
      statusLabel: runCheckToneLabel(dbTone),
      summary:
        diagnostics.dbContactCount !== undefined
          ? `联系人库返回 ${diagnostics.dbContactCount} 个联系人。`
          : diagnostics.dbStatus
            ? `联系人库状态：${commercialDisplayText(diagnostics.dbStatus)}`
            : "未返回联系人库读取结果。",
      detail:
        diagnostics.dbError ||
        diagnostics.sqlitePath ||
        diagnostics.dbKeyStatus ||
        diagnostics.dbPaths?.slice(0, 2).join("；"),
    });
  }
  if (
    diagnostics.helperStatus ||
    diagnostics.decryptionHelperPath ||
    diagnostics.dbHelper
  ) {
    const helperTone = diagnosticToneFromStatus(diagnostics.helperStatus);
    items.push({
      key: "wechat-diagnostics:helper",
      name: "微信数据辅助服务",
      status: helperTone,
      statusLabel: runCheckToneLabel(helperTone),
      summary: diagnostics.helperStatus
        ? `辅助服务状态：${commercialDisplayText(diagnostics.helperStatus)}`
        : "未返回辅助服务状态。",
      detail:
        diagnostics.decryptionHelperPath ||
        diagnostics.dbHelper ||
        diagnostics.failureReason,
    });
  }
  if (
    diagnostics.uiaStatus ||
    diagnostics.uiaContactCount !== undefined ||
    diagnostics.uiaNodeCount !== undefined
  ) {
    const uiaTone = diagnosticToneFromStatus(diagnostics.uiaStatus);
    items.push({
      key: "wechat-diagnostics:uia",
      name: "微信桌面识别",
      status: uiaTone,
      statusLabel: runCheckToneLabel(uiaTone),
      summary:
        diagnostics.uiaContactCount !== undefined
          ? `桌面识别返回 ${diagnostics.uiaContactCount} 个联系人。`
          : diagnostics.uiaStatus
            ? `桌面识别状态：${commercialDisplayText(diagnostics.uiaStatus)}`
            : "未返回桌面识别状态。",
      detail:
        diagnostics.uiaStopReason ||
        diagnostics.failureReason ||
        (diagnostics.uiaNodeCount !== undefined
          ? `桌面节点 ${diagnostics.uiaNodeCount}`
          : undefined),
    });
  }
  if (
    diagnostics.ocrContactCount !== undefined ||
    diagnostics.ocrPreview?.length ||
    diagnostics.rawPreview?.length ||
    diagnostics.runtimeCapabilities?.some((item) => /ocr|vision/i.test(item))
  ) {
    items.push({
      key: "wechat-diagnostics:ocr",
      name: "微信文字识别",
      status: ocrTone,
      statusLabel: runCheckToneLabel(ocrTone),
      summary:
        diagnostics.ocrContactCount !== undefined
          ? `文字识别返回 ${diagnostics.ocrContactCount} 个联系人。`
          : "未返回单独文字识别联系人结果。",
      detail:
        diagnostics.ocrPreview?.slice(0, 3).join(" / ") ||
        diagnostics.rawPreview?.slice(0, 3).join(" / "),
    });
  }
  return items;
}

function getAgentSAssessment(
  status: AgentSStatusSnapshot | null,
  loading = false,
): AgentSRunCheckAssessment {
  if (loading && !status) {
    return {
      status: "warning",
      statusLabel: "检查中",
      panelStatus: "connecting",
      label: "本机操作能力检查中",
      summary: "正在读取本机操作状态。",
      detail: "检查完成后会显示当前是否可用。",
      runnerMode: "unknown",
      browserControl: null,
      blockers: [],
      warnings: [],
      isRealExecutionReady: false,
    };
  }

  if (!status) {
    return {
      status: "danger",
      statusLabel: "需处理",
      panelStatus: "error",
      label: "本机操作能力未确认",
      summary: "当前无法确认本机操作能力。",
      detail: "请确认本机服务可用后重新检查。",
      runnerMode: "unknown",
      browserControl: null,
      blockers: ["未读取到本机操作服务状态"],
      warnings: [],
      isRealExecutionReady: false,
    };
  }

  const health = status.sidecar?.health;
  const runtimeStatus = status.sidecar?.status;
  const healthCapabilities = readRecordValue(health, "capabilities");
  const runtimeCapabilities = readRecordValue(runtimeStatus, "capabilities");
  const topCapabilities = readRecordValue(status, "capabilities");
  const runnerMode = readStringValue(
    status.runner_mode,
    status.runnerMode,
    health?.runner_mode,
    health?.runnerMode,
    runtimeStatus?.runner_mode,
    runtimeStatus?.runnerMode,
  );
  const browserControl = readBooleanValue(
    status.browserControl,
    readRecordValue(topCapabilities, "browserControl"),
    readRecordValue(healthCapabilities, "browserControl"),
    readRecordValue(runtimeCapabilities, "browserControl"),
  );
  const blockers = readStringArrayValue(
    status.blockers,
    health?.blockers,
    runtimeStatus?.blockers,
  );
  const warnings = readStringArrayValue(
    status.warnings,
    health?.warnings,
    runtimeStatus?.warnings,
  );
  const normalizedRunnerMode = runnerMode.toLowerCase();
  const isMockRunner =
    !runnerMode ||
    normalizedRunnerMode.includes("mock") ||
    normalizedRunnerMode.includes("compatible");
  const hasBlockers = blockers.length > 0;
  const isConnected = status.connected === true;
  const isRealExecutionReady =
    isConnected && !isMockRunner && browserControl === true && !hasBlockers;

  if (isRealExecutionReady) {
    return {
      status: "ready",
      statusLabel: "正常",
      panelStatus: "ready",
      label: "本机操作正常",
      summary: "本机操作能力当前可用。",
      detail: "可继续处理平台任务；微信操作以完整检查结果为准。",
      runnerMode,
      browserControl,
      blockers,
      warnings,
      isRealExecutionReady,
    };
  }

  const stillConnecting = status.phase === "connecting";

  return {
    status: stillConnecting ? "warning" : "danger",
    statusLabel: stillConnecting ? "检查中" : "需处理",
    panelStatus: stillConnecting ? "connecting" : "error",
    label: stillConnecting ? "本机操作能力检查中" : "本机操作能力未接通",
    summary: stillConnecting
      ? "正在检查本机操作能力。"
      : "本机操作能力尚未准备好。",
    detail: "请按待处理项完成设置后重新检查。",
    runnerMode: runnerMode || "unknown",
    browserControl,
    blockers,
    warnings,
    isRealExecutionReady,
  };
}

const capabilityKeysWithDedicatedStatus = new Set<LocalEngineCapability["key"]>([
  "interaction-capabilities",
  "kaypal-entitlement",
  "ai-reply-model",
  "desktop-control",
  "mcp-manager",
  "agent-s-sidecar",
  "wechat-execution",
  "remote-control",
  "plugin-runtime",
  "memory-context",
  "sandbox-execution",
  "file-access",
]);

const internalExecutorKeys = new Set([
  "local-runtime",
  "platform-publish",
  "agent-s-legacy-desktop",
]);

const wechatRunnerBackedExecutorKeys = new Set([
  "wechat-group-broadcast",
  "wechat-contact-add",
  "wechat-moments-publish",
  "wechat-moments-marketing",
]);

function RunCheckDetailsPanel({
  health,
  runtimeLoading,
  runtimeStatus,
  browserLoading,
  browserStatus,
  executorsLoading,
  executorsStatus,
  filesLoading,
  fileStatus,
  readinessLoading,
  readiness,
  wechatContactsLoading,
  wechatContactsReadiness,
  agentSLoading,
  agentSStatus,
}: {
  health: LocalEngineHealth | null;
  runtimeLoading: boolean;
  runtimeStatus: LocalEngineRuntimeStatus | null;
  browserLoading: boolean;
  browserStatus: LocalEngineBrowserStatus | null;
  executorsLoading: boolean;
  executorsStatus: LocalEngineExecutorsStatus | null;
  filesLoading: boolean;
  fileStatus: LocalEngineFileAccessStatus | null;
  readinessLoading: boolean;
  readiness: LocalEngineReadiness | null;
  wechatContactsLoading: boolean;
  wechatContactsReadiness: WechatContactsReadinessResult | null;
  agentSLoading: boolean;
  agentSStatus: AgentSStatusSnapshot | null;
}) {
  const [query, setQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<
    "all" | RunCheckDetailTone
  >("all");
  const [groupFilter, setGroupFilter] = React.useState("all");
  const [selectedItem, setSelectedItem] =
    React.useState<RunCheckTableItem | null>(null);
  const agentSAssessment = getAgentSAssessment(agentSStatus, agentSLoading);
  const usingNodeRuntime =
    agentSStatus?.baseUrl?.startsWith("in-process://") ||
    agentSStatus?.sidecar?.health?.service === "node-agent-runtime";
  const capabilityItems: RunCheckDetailItem[] = (
    health?.capabilities || []
  )
    .filter((capability) => !capabilityKeysWithDedicatedStatus.has(capability.key))
    .flatMap((capability) => {
      const isRequired = capability.required !== false;
      const baseStatus = capabilityStatusToRunCheckTone(
        capability.status,
        isRequired,
        capability.key,
      );
      const base: RunCheckDetailItem = {
        key: `capability:${capability.key}`,
        name: capability.name,
        status: baseStatus,
        statusLabel: runCheckToneLabel(baseStatus),
        summary:
          baseStatus === "ready"
            ? "当前可用。"
            : baseStatus === "danger"
              ? "此项会影响相关功能使用。"
              : "建议在使用前完成设置。",
        detail:
          baseStatus === "ready"
            ? "无需处理。"
            : "完成设置后重新检查。",
      };
      return [base];
    });

  const serviceItems: RunCheckDetailItem[] = [
    ...(runtimeStatus?.services || []).flatMap((service) => {
      if (service.key === "agent-s" && usingNodeRuntime) {
        return [];
      }
      const status: RunCheckDetailTone = service.online ? "ready" : "danger";
      return [
        {
          key: `runtime:${service.key}`,
          name: commercialDisplayText(service.name),
          status,
          statusLabel: service.online ? "正常" : "需处理",
          summary: service.online ? "服务当前可用。" : "服务当前不可用。",
          detail: service.online
            ? "无需处理。"
            : "请先尝试启动服务；仍未恢复时查看高级信息。",
        },
      ];
    }),
    {
      key: "runtime:agent-s-connection",
      name: "本机操作能力",
      status: agentSAssessment.status,
      statusLabel: agentSAssessment.statusLabel,
      summary: agentSAssessment.summary,
      detail: commercialDisplayText(
        `${agentSAssessment.detail} 浏览器操作能力=${
          agentSAssessment.browserControl === null
            ? "未知"
            : agentSAssessment.browserControl
              ? "已开启"
              : "未开启"
        }。`,
      ),
    },
  ];

  const accountItems: RunCheckDetailItem[] = [
    {
      key: "browser:engine",
      name: "平台浏览器引擎",
      status: browserStatus
        ? browserStatus.engineOnline
          ? "ready"
          : "danger"
        : "deferred",
      statusLabel: browserStatus
        ? browserStatus.engineOnline
          ? "在线"
          : "不可用"
        : browserLoading
          ? "检查中"
          : "待检查",
      summary:
        browserStatus?.engineOnline
          ? "平台账号服务当前可用。"
          : "平台账号服务需要处理。",
      detail:
        "进入“平台账号”页完成登录或重新检查。",
    },
    ...(browserStatus?.accounts || []).map((account) => {
      const status: RunCheckDetailTone =
        account.status === "ready"
          ? "ready"
          : account.status === "blocked"
            ? "danger"
            : "warning";
      return {
        key: `browser-account:${account.platform}:${account.id}`,
        name: `${account.platform} · ${account.displayName}`,
        status,
        statusLabel: account.statusLabel,
        summary:
          account.status === "ready"
            ? "账号当前可用。"
            : "账号需要重新登录或确认授权。",
        detail:
          account.status === "ready"
            ? "无需处理。"
            : "进入“平台账号”页完成处理。",
      };
    }),
  ];

  const wechatRunnerCheck = wechatContactsReadiness?.checks.find(
    (check) => check.key === "wechat-command-runners",
  );
  const wechatRunnersReady = wechatRunnerCheck?.status === "ready";
  const executorItems: RunCheckDetailItem[] = (
    executorsStatus?.executors || []
  )
    .filter((executor) => !internalExecutorKeys.has(executor.key))
    .map((executor) => {
      const runnerNeedsConnection =
        wechatRunnerBackedExecutorKeys.has(executor.key) &&
        !wechatRunnersReady;
      const optionalButRunnable =
        executor.status === "optional" && executor.entryPreflight;
      const declaredStatus: RunCheckDetailTone = runnerNeedsConnection
        ? "warning"
        : executor.status === "ready" || optionalButRunnable
          ? "ready"
          : executor.status === "optional"
            ? "muted"
            : executor.status === "preflight_only"
              ? "warning"
              : "danger";
      const needsAgentSDesktop =
        isAgentSDesktopExecutor(executor) && executor.status !== "optional";
      const isBlockedByAgentS =
        needsAgentSDesktop &&
        !agentSAssessment.isRealExecutionReady &&
        executor.status !== "missing";
      const status: RunCheckDetailTone = isBlockedByAgentS
        ? agentSAssessment.status === "danger"
          ? "danger"
          : "warning"
        : declaredStatus;
      return {
        key: `executor:${executor.key}`,
        name: `${executor.platformName} · ${executor.name}`,
        status,
        statusLabel: isBlockedByAgentS
          ? agentSAssessment.statusLabel
          : runnerNeedsConnection
            ? "待接通"
            : executor.status === "preflight_only"
              ? "待确认"
              : optionalButRunnable
                ? "可使用"
                : executor.status === "optional"
                  ? "未启用"
                  : executorStatusLabel(executor.status),
        summary:
          status === "ready"
            ? "当前可用。"
            : status === "muted"
              ? "此项尚未启用。"
              : "此项需要处理后才能使用。",
        detail:
          status === "ready"
            ? "无需处理。"
            : "完成账号或本机设置后重新检查。",
      };
    });

  const fileItems: RunCheckDetailItem[] = (fileStatus?.roots || []).map(
    (item) => {
      const status: RunCheckDetailTone =
        item.exists && item.readable && item.writable
          ? "ready"
          : item.exists && item.readable
            ? "warning"
            : "danger";
      return {
        key: `file:${item.key}`,
        name: item.name,
        status,
        statusLabel:
          item.exists && item.readable && item.writable
            ? "正常"
            : item.exists
              ? "注意"
              : "需处理",
        summary:
          item.exists && item.readable && item.writable
            ? "文件可正常读取和保存。"
            : item.exists && item.readable
              ? "文件可读取，但暂时无法保存。"
              : "文件当前不可用。",
        detail:
          item.exists && item.readable && item.writable
            ? "无需处理。"
            : "请检查本机文件权限后重试。",
      };
    },
  );

  const readinessItems: RunCheckDetailItem[] = [
    ...(readiness?.blockers || []).map((item, index) => ({
      key: `readiness:blocker:${index}:${item.capability}`,
      name: item.capability,
      status: "danger" as const,
      statusLabel: "需处理",
      summary: "此项会影响相关功能使用。",
      detail: "请按页面提示完成设置后重新检查。",
      ...getReadinessAction(item.capability),
    })),
    ...(readiness?.warnings || []).map((item, index) => ({
      key: `readiness:warning:${index}:${item.capability}`,
      name: item.capability,
      status: "warning" as const,
      statusLabel: item.capability === "AI 回复模型" ? "待设置" : "需留意",
      summary: "建议在使用相关功能前完成设置。",
      detail: "完成设置后重新检查。",
      ...getReadinessAction(item.capability),
    })),
  ];
  const wechatContactItems: RunCheckDetailItem[] = [
    ...(wechatContactsReadiness?.checks || []).map((check) => {
      const status = wechatCheckStatusToTone(check.status);
      return {
        key: `wechat-readiness:${check.key}`,
        name: check.name,
        status,
        statusLabel:
          check.status === "ready"
            ? "正常"
            : check.key === "platform"
              ? "能力受限"
              : check.key === "wechat-command-runners"
                ? "待接通"
                : check.key === "cached-contacts"
                  ? "待复核"
                  : check.key === "last-failure"
                    ? "同步失败"
                    : runCheckToneLabel(status),
        summary:
          status === "ready"
            ? "当前可用。"
            : status === "danger"
              ? "此项会影响联系人同步。"
              : "建议在同步前完成设置。",
        detail:
          status === "ready" ? "无需处理。" : "完成设置后重新检查。",
      };
    }),
    ...buildWechatContactDiagnosticItems(
      wechatContactsReadiness?.diagnostics,
    ).map((item) => ({
      ...item,
      summary:
        item.status === "ready"
          ? "当前可用。"
          : "此项需要处理后才能使用。",
      detail:
        item.status === "ready" ? "无需处理。" : "完成设置后重新检查。",
    })),
  ];

  const groups = [
    {
      key: "services",
      title: "处理服务",
      icon: "solar:server-square-cloud-linear",
      loading: runtimeLoading || agentSLoading,
      items: serviceItems,
    },
    {
      key: "capabilities",
      title: "功能准备",
      icon: "solar:shield-check-linear",
      loading: false,
      items: capabilityItems,
    },
    {
      key: "accounts",
      title: "平台账号",
      icon: "solar:window-frame-linear",
      loading: browserLoading,
      items: accountItems,
    },
    {
      key: "executors",
      title: "互动处理",
      icon: "solar:chat-round-like-linear",
      loading: executorsLoading,
      items: executorItems,
    },
    {
      key: "wechat-contacts",
      title: "微信通讯录",
      icon: "solar:users-group-rounded-linear",
      loading: wechatContactsLoading,
      items: wechatContactItems,
    },
    {
      key: "files",
      title: "文件状态",
      icon: "solar:folder-with-files-linear",
      loading: filesLoading,
      items: fileItems,
    },
    {
      key: "safety",
      title: "安全检查",
      icon: "solar:danger-triangle-linear",
      loading: readinessLoading,
      items: readinessItems,
    },
  ];

  const displayGroups = groups.map((group) => ({
    ...group,
    title: commercialDisplayText(group.title),
    items: group.items.map(commercialRunCheckItem),
  }));

  const allItems = displayGroups.flatMap((group) => group.items);
  const tableRows: RunCheckTableItem[] = displayGroups.flatMap((group) =>
    group.items.map((item) => ({
      ...item,
      groupKey: group.key,
      groupTitle: group.title,
      groupIcon: group.icon,
    })),
  );
  const groupFilterOptions = [
    { key: "all", title: "全部分类" },
    ...displayGroups.map((group) => ({ key: group.key, title: group.title })),
  ];
  const normalizedQuery = query.trim().toLowerCase();
  const filteredRows = tableRows.filter((item) => {
    const matchesQuery = normalizedQuery
      ? [
          item.name,
          item.summary,
          item.detail,
          item.groupTitle,
          item.statusLabel,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery)
      : true;
    const matchesStatus =
      statusFilter === "all" ? true : item.status === statusFilter;
    const matchesGroup =
      groupFilter === "all" ? true : item.groupKey === groupFilter;
    return matchesQuery && matchesStatus && matchesGroup;
  });
  const readyCount = allItems.filter((item) => item.status === "ready").length;
  const warningCount = allItems.filter(
    (item) => item.status === "warning",
  ).length;
  const dangerCount = allItems.filter(
    (item) => item.status === "danger",
  ).length;
  const deferredCount = allItems.filter(
    (item) => item.status === "deferred",
  ).length;
  const mutedCount = allItems.filter((item) => item.status === "muted").length;

  React.useEffect(() => {
    if (!selectedItem) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedItem(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedItem]);

  return (
    <Card className="border-small border-divider bg-background shadow-sm">
      <CardBody className="gap-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-medium font-semibold text-default-900">
              功能状态
            </h3>
            <p className="mt-1 text-small text-default-500">
              汇总当前可用、需留意和需要处理的功能；优先完成“需处理”事项。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Chip color="success" size="sm" variant="flat">
              正常 {readyCount}
            </Chip>
            <Chip color="warning" size="sm" variant="flat">
              需留意 {warningCount}
            </Chip>
            <Chip color="danger" size="sm" variant="flat">
              需处理 {dangerCount}
            </Chip>
            <Chip size="sm" variant="flat">
              待检查 {deferredCount}
            </Chip>
            <Chip size="sm" variant="flat">
              未启用 {mutedCount}
            </Chip>
            <Chip size="sm" variant="flat">
              合计 {allItems.length}
            </Chip>
          </div>
        </div>
        <div className="local-engine-console__filterbar grid gap-3 rounded-[8px] border-small border-divider bg-default-50 p-3 md:grid-cols-[minmax(240px,1fr)_180px_180px_auto] md:items-end">
          <Input
            aria-label="搜索功能状态"
            label="搜索"
            placeholder="功能、账号或处理建议"
            size="sm"
            startContent={
              <Icon
                icon="solar:magnifer-linear"
                className="text-lg text-default-400"
              />
            }
            value={query}
            onValueChange={setQuery}
          />
          <Select
            aria-label="按状态筛选"
            label="状态"
            selectedKeys={[statusFilter]}
            size="sm"
            onSelectionChange={(keys) => {
              const value = Array.from(keys)[0] as
                "all" | RunCheckDetailTone | undefined;
              if (value) setStatusFilter(value);
            }}
          >
            <SelectItem key="all">全部状态</SelectItem>
            <SelectItem key="danger">需处理</SelectItem>
            <SelectItem key="warning">需留意</SelectItem>
            <SelectItem key="deferred">待检查</SelectItem>
            <SelectItem key="ready">正常</SelectItem>
            <SelectItem key="muted">未启用</SelectItem>
          </Select>
          <Select
            aria-label="按分类筛选"
            items={groupFilterOptions}
            label="分类"
            selectedKeys={[groupFilter]}
            size="sm"
            onSelectionChange={(keys) => {
              const value = Array.from(keys)[0] as string | undefined;
              if (value) setGroupFilter(value);
            }}
          >
            {(group) => <SelectItem key={group.key}>{group.title}</SelectItem>}
          </Select>
          <Button
            className="local-engine-console__service-action md:self-end"
            size="sm"
            variant="flat"
            onPress={() => {
              setQuery("");
              setStatusFilter("all");
              setGroupFilter("all");
            }}
          >
            重置筛选
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-small text-default-500">
            当前显示 {filteredRows.length} 条，点击“详情”查看下一步。
          </p>
          <div className="flex flex-wrap gap-2">
            {displayGroups.map((group) => (
              <Chip key={group.key} size="sm" variant="flat">
                {group.title} {group.items.length}
              </Chip>
            ))}
          </div>
        </div>
        <Table
          aria-label="功能状态表"
          classNames={{
            wrapper:
              "local-engine-console__run-table-wrapper border-small border-divider shadow-none",
            th: "bg-default-50 text-default-500",
            td: "align-top",
          }}
        >
          <TableHeader>
            <TableColumn>状态</TableColumn>
            <TableColumn>分类</TableColumn>
            <TableColumn>功能</TableColumn>
            <TableColumn>当前摘要</TableColumn>
            <TableColumn>下一步</TableColumn>
            <TableColumn>操作</TableColumn>
          </TableHeader>
          <TableBody
            emptyContent={
              runtimeLoading ||
              browserLoading ||
              executorsLoading ||
              filesLoading ||
              readinessLoading ||
              wechatContactsLoading ||
              agentSLoading
                ? "正在读取功能状态..."
                : "当前筛选没有结果。"
            }
            items={filteredRows}
          >
            {(item) => (
              <TableRow key={item.key}>
                <TableCell>
                  <Chip
                    color={runCheckToneColor(item.status)}
                    size="sm"
                    variant="flat"
                  >
                    {item.statusLabel}
                  </Chip>
                </TableCell>
                <TableCell>
                  <div className="flex min-w-[120px] items-center gap-2">
                    <Icon
                      icon={item.groupIcon}
                      className="text-lg text-default-400"
                    />
                    <span className="text-small text-default-700">
                      {item.groupTitle}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <Button
                    className="h-auto min-h-0 justify-start px-0 py-0 text-left text-small font-semibold text-default-900"
                    variant="light"
                    onPress={() => setSelectedItem(item)}
                  >
                    <span className="max-w-[220px] truncate">{item.name}</span>
                  </Button>
                </TableCell>
                <TableCell>
                  <p className="max-w-[320px] break-words text-small text-default-600">
                    {item.summary}
                  </p>
                </TableCell>
                <TableCell>
                  <p className="max-w-[260px] break-words text-tiny text-default-400">
                    {item.detail || "无额外处理建议"}
                  </p>
                </TableCell>
                <TableCell>
                  {item.actionHref ? (
                    <Button
                      as={Link}
                      className="local-engine-console__service-action"
                      color="primary"
                      href={item.actionHref}
                      size="sm"
                      variant="flat"
                    >
                      {item.actionLabel || "去处理"}
                    </Button>
                  ) : (
                    <Button
                      className="local-engine-console__service-action"
                      size="sm"
                      variant="flat"
                      onPress={() => setSelectedItem(item)}
                    >
                      详情
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardBody>
      {selectedItem ? (
        <RunCheckDetailDrawer
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
        />
      ) : null}
    </Card>
  );
}

function RunCheckDetailDrawer({
  item,
  onClose,
}: {
  item: RunCheckTableItem;
  onClose: () => void;
}) {
  return (
    <div
      className="local-engine-console__drawer-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <aside
        aria-labelledby="run-check-detail-title"
        aria-modal="true"
        className="local-engine-console__drawer"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="local-engine-console__drawer-header">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Chip size="sm" variant="flat">
                <span className="inline-flex items-center gap-1">
                  <Icon icon={item.groupIcon} className="text-base" />
                  {item.groupTitle}
                </span>
              </Chip>
              <Chip
                color={runCheckToneColor(item.status)}
                size="sm"
                variant="flat"
              >
                {item.statusLabel}
              </Chip>
            </div>
            <h3
              className="break-words text-large font-semibold text-default-900"
              id="run-check-detail-title"
            >
              {item.name}
            </h3>
          </div>
          <Button
            isIconOnly
            aria-label="关闭详情"
            className="local-engine-console__service-action shrink-0"
            size="sm"
            variant="flat"
            onPress={onClose}
          >
            <Icon icon="solar:close-circle-linear" className="text-lg" />
          </Button>
        </div>
        <div className="local-engine-console__drawer-body">
          <section className="local-engine-console__drawer-section">
            <p className="text-tiny font-medium text-default-400">当前摘要</p>
            <p className="mt-2 break-words text-small text-default-700">
              {item.summary}
            </p>
          </section>
          <section className="local-engine-console__drawer-section">
            <p className="text-tiny font-medium text-default-400">下一步</p>
            <p className="mt-2 break-words text-small text-default-700">
              {item.detail || "暂无额外处理建议。"}
            </p>
          </section>
          <section className="local-engine-console__drawer-section">
            <p className="text-tiny font-medium text-default-400">状态流转</p>
            <div className="mt-3 grid gap-3">
              <div className="local-engine-console__timeline-row">
                <span aria-hidden="true" />
                <div>
                  <p className="text-small font-medium text-default-800">
                    读取状态
                  </p>
                  <p className="text-tiny text-default-500">
                    来源：{item.groupTitle}
                  </p>
                </div>
              </div>
              <div className="local-engine-console__timeline-row">
                <span aria-hidden="true" />
                <div>
                  <p className="text-small font-medium text-default-800">
                    判定状态
                  </p>
                  <p className="text-tiny text-default-500">
                    当前为“{item.statusLabel}”
                  </p>
                </div>
              </div>
              <div className="local-engine-console__timeline-row">
                <span aria-hidden="true" />
                <div>
                  <p className="text-small font-medium text-default-800">
                    下一步处理
                  </p>
                  <p className="text-tiny text-default-500">
                    {item.detail || item.summary}
                  </p>
                </div>
              </div>
            </div>
          </section>
        </div>
        <div className="local-engine-console__drawer-footer">
          {item.actionHref ? (
            <Button
              as={Link}
              color="primary"
              href={item.actionHref}
              onPress={onClose}
            >
              {item.actionLabel || "去处理"}
            </Button>
          ) : null}
          <Button
            className="local-engine-console__service-action"
            variant="flat"
            onPress={onClose}
          >
            关闭
          </Button>
        </div>
      </aside>
    </div>
  );
}

function capabilityStatusToRunCheckTone(
  status: LocalEngineCapability["status"],
  required = false,
  key?: LocalEngineCapability["key"],
): RunCheckDetailTone {
  if (status === "ready") return "ready";
  if (status === "blocked" || status === "missing")
    return required ? "danger" : "deferred";
  if (status === "degraded" || status === "warning")
    return required ? "warning" : "deferred";
  if (
    status === "optional" &&
    !["remote-control", "plugin-runtime", "memory-context", "sandbox-execution"].includes(
      key || "",
    )
  ) {
    return "deferred";
  }
  return "muted";
}

function runCheckToneColor(status: RunCheckDetailTone) {
  const map = {
    ready: "success",
    warning: "warning",
    danger: "danger",
    deferred: "default",
    muted: "default",
  } as const;
  return map[status];
}

function runCheckToneLabel(status: RunCheckDetailTone) {
  const map = {
    ready: "正常",
    warning: "需留意",
    danger: "需处理",
    deferred: "待检查",
    muted: "未启用",
  };
  return map[status];
}

function WechatSessionPanel() {
  const [status, setStatus] =
    React.useState<LocalEngineWechatSessionStatus | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState<
    "confirm" | "takeover" | "stop" | null
  >(null);
  const [draft, setDraft] = React.useState({
    targetContact: "",
    currentWindowConfirmed: false,
    contactConfirmed: false,
    draftBeforeFillConfirmed: false,
    popupCleared: false,
    contactAmbiguityResolved: false,
    loggedInConfirmed: false,
  });

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const next = await localEngineApi.wechatSessionStatus();
      setStatus(next);
      setDraft({
        targetContact:
          next.targetContact || next.desktop.window.targetContact || "",
        currentWindowConfirmed: next.currentWindowConfirmed,
        contactConfirmed: next.contactConfirmed,
        draftBeforeFillConfirmed: next.draftBeforeFillConfirmed,
        popupCleared: !next.anomalySummary?.popupDetected,
        contactAmbiguityResolved: !next.anomalySummary?.contactAmbiguous,
        loggedInConfirmed: !next.anomalySummary?.loggedOut,
      });
    } catch (e: unknown) {
      setStatus(null);
      addToast({
        title: "微信会话状态读取失败",
        description: shortToastDescription(e),
        color: "danger",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const run = async (action: "confirm" | "takeover" | "stop") => {
    setSaving(action);
    try {
      let next: LocalEngineWechatSessionStatus;
      if (action === "confirm") {
        next = await localEngineApi.confirmWechatSession({
          ...draft,
          currentWindowTitle:
            status?.desktop.window.windowTitle ||
            status?.desktop.window.currentWindowTitle ||
            null,
          operator: "当前登录用户",
          note: "微信会话执行前确认",
        });
      } else if (action === "takeover") {
        next = await localEngineApi.takeoverWechatSession({
          operator: "当前登录用户",
          reason: "人工接管微信会话",
          riskConfirmation: buildLocalEngineRiskConfirmation(
            "remote-control",
            "high",
            "用户在本机服务页面点击人工接管微信会话",
          ),
        });
      } else {
        next = await localEngineApi.stopWechatSession({
          operator: "当前登录用户",
          reason: "用户停止微信会话",
        });
      }
      setStatus(next);
      setDraft({
        targetContact:
          next.targetContact || next.desktop.window.targetContact || "",
        currentWindowConfirmed: next.currentWindowConfirmed,
        contactConfirmed: next.contactConfirmed,
        draftBeforeFillConfirmed: next.draftBeforeFillConfirmed,
        popupCleared: !next.anomalySummary?.popupDetected,
        contactAmbiguityResolved: !next.anomalySummary?.contactAmbiguous,
        loggedInConfirmed: !next.anomalySummary?.loggedOut,
      });
      addToast({
        title:
          action === "confirm"
            ? "已确认微信会话"
            : action === "takeover"
              ? "已进入人工接管"
              : "已停止微信会话",
        color: "success",
      });
    } catch (e: unknown) {
      addToast({
        title: "微信会话操作失败",
        description: shortToastDescription(e),
        color: "danger",
      });
    } finally {
      setSaving(null);
    }
  };
  const desktop = status?.desktop;
  const permissionChecks = desktop?.permissionChecks ?? [];
  const recentEvidence = desktop?.recentEvidence ?? [];
  const blockers = desktop?.blockers ?? [];
  const warnings = desktop?.warnings ?? [];
  const latestEvidence = desktop?.screenshot || recentEvidence[0];
  const sessionBlockers = status?.blockers ?? [];
  const sessionWarnings = status?.warnings ?? [];
  const anomalies = status?.anomalySummary;
  const lock = status?.lock;
  return (
    <Card className="border-small border-divider bg-background shadow-sm">
      <CardBody className="gap-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-medium font-semibold text-default-900">
              微信桌面会话
            </h3>
            <p className="mt-1 text-small text-default-500">
              执行前检查桌面权限、当前窗口、目标联系人和写入前结果确认。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Chip
              color={status?.canDraft ? "success" : "warning"}
              variant="flat"
            >
              {status?.canDraft ? "可写入内容" : "等待确认"}
            </Chip>
            {status?.takeoverActive ? (
              <Chip color="primary" variant="flat">
                人工接管中
              </Chip>
            ) : null}
            {status?.stopped ? (
              <Chip color="danger" variant="flat">
                已停止
              </Chip>
            ) : null}
            <Button
              size="sm"
              variant="flat"
              isLoading={loading}
              startContent={
                loading ? null : <Icon icon="solar:refresh-linear" />
              }
              onPress={() => {
                refresh().catch(() => undefined);
              }}
            >
              刷新
            </Button>
          </div>
        </div>
        {desktop ? (
          <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-3">
                <StatusItem
                  label="桌面能力"
                  value={desktop.available ? "可用" : "不可用"}
                />
                <StatusItem
                  label="当前应用"
                  value={desktop.window.appName || "未知"}
                />
                <StatusItem
                  label="窗口标题"
                  value={
                    desktop.window.windowTitle ||
                    desktop.window.currentWindowTitle ||
                    "未识别"
                  }
                />
                <StatusItem
                  label="窗口数量"
                  value={String(desktop.window.windowCount ?? "-")}
                />
                <StatusItem
                  label="会话锁定"
                  value={lock?.locked ? "已锁定" : "未锁定"}
                />
                <StatusItem
                  label="下一步"
                  value={status?.nextAction || desktop.nextAction || "-"}
                />
              </div>
              <div className="grid gap-2 md:grid-cols-4">
                <Chip
                  color={anomalies?.loggedOut ? "danger" : "success"}
                  variant="flat"
                >
                  {anomalies?.loggedOut ? "疑似掉线" : "登录正常"}
                </Chip>
                <Chip
                  color={anomalies?.popupDetected ? "warning" : "success"}
                  variant="flat"
                >
                  {anomalies?.popupDetected ? "有弹窗/遮挡" : "窗口正常"}
                </Chip>
                <Chip
                  color={anomalies?.contactAmbiguous ? "warning" : "success"}
                  variant="flat"
                >
                  {anomalies?.contactAmbiguous ? "联系人需核对" : "联系人清晰"}
                </Chip>
                <Chip
                  color={anomalies?.permissionBlocked ? "danger" : "success"}
                  variant="flat"
                >
                  {anomalies?.permissionBlocked ? "权限需处理" : "权限正常"}
                </Chip>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {permissionChecks.map((check) => (
                  <div
                    key={check.key}
                    className="rounded-small border-small border-divider bg-default-50 p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-small font-medium text-default-800">
                        {check.label}
                      </span>
                      <Chip
                        color={
                          check.status === "allowed"
                            ? "success"
                            : check.status === "blocked"
                              ? "danger"
                              : "warning"
                        }
                        size="sm"
                        variant="flat"
                      >
                        {permissionStatusLabel[check.status] || check.status}
                      </Chip>
                    </div>
                    <p className="mt-1 text-tiny text-default-500">
                      {commercialDisplayText(check.message)}
                    </p>
                    {check.nextAction ? (
                      <p className="mt-1 text-tiny text-warning-600">
                        {commercialDisplayText(check.nextAction)}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
              {blockers.length ||
              warnings.length ||
              sessionBlockers.length ||
              sessionWarnings.length ? (
                <div className="rounded-[8px] border-small border-warning-200 bg-warning-50 p-3 text-small text-warning-700">
                  {[
                    ...new Set([
                      ...sessionBlockers,
                      ...blockers,
                      ...sessionWarnings,
                      ...warnings,
                    ]),
                  ].map((item) => (
                    <p key={item}>{item}</p>
                  ))}
                </div>
              ) : null}
              {lock ? (
                <div className="rounded-[8px] border-small border-divider bg-default-50 p-3 text-small text-default-600">
                  <p className="font-medium text-default-800">会话锁定</p>
                  <p className="mt-1">{lock.message}</p>
                  <p className="mt-1 text-tiny">
                    {lock.targetContact
                      ? `联系人：${lock.targetContact}`
                      : "联系人未填写"}
                    {lock.windowTitle ? ` · 窗口：${lock.windowTitle}` : ""}
                    {lock.lockedAt ? ` · ${formatDate(lock.lockedAt)}` : ""}
                  </p>
                </div>
              ) : null}
            </div>
            <div className="rounded-[8px] border-small border-divider bg-default-50 p-3">
              <div className="grid gap-3">
                <Input
                  label="目标联系人"
                  placeholder="例如：张先生 / 某门店客户"
                  value={draft.targetContact}
                  onValueChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      targetContact: value,
                    }))
                  }
                />
                <Switch
                  isSelected={draft.currentWindowConfirmed}
                  onValueChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      currentWindowConfirmed: value,
                    }))
                  }
                >
                  当前微信窗口已切到目标会话
                </Switch>
                <Switch
                  isSelected={draft.contactConfirmed}
                  onValueChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      contactConfirmed: value,
                    }))
                  }
                >
                  已核对联系人/当前窗口
                </Switch>
                <Switch
                  color="danger"
                  isSelected={draft.draftBeforeFillConfirmed}
                  onValueChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      draftBeforeFillConfirmed: value,
                    }))
                  }
                >
                  草稿填入前再次确认
                </Switch>
                <Switch
                  isSelected={draft.loggedInConfirmed}
                  onValueChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      loggedInConfirmed: value,
                    }))
                  }
                >
                  微信已登录，没有掉线
                </Switch>
                <Switch
                  isSelected={draft.popupCleared}
                  onValueChange={(value) =>
                    setDraft((current) => ({ ...current, popupCleared: value }))
                  }
                >
                  弹窗/遮挡已处理
                </Switch>
                <Switch
                  isSelected={draft.contactAmbiguityResolved}
                  onValueChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      contactAmbiguityResolved: value,
                    }))
                  }
                >
                  联系人歧义已人工排除
                </Switch>
                <div className="flex flex-wrap gap-2">
                  <Button
                    color="primary"
                    isLoading={saving === "confirm"}
                    startContent={
                      saving === "confirm" ? null : (
                        <Icon icon="solar:check-circle-linear" />
                      )
                    }
                    onPress={() => run("confirm")}
                  >
                    确认会话
                  </Button>
                  <Button
                    variant="flat"
                    isLoading={saving === "takeover"}
                    startContent={
                      saving === "takeover" ? null : (
                        <Icon icon="solar:hand-shake-linear" />
                      )
                    }
                    onPress={() => run("takeover")}
                  >
                    人工接管
                  </Button>
                  <Button
                    color="danger"
                    variant="flat"
                    isLoading={saving === "stop"}
                    startContent={
                      saving === "stop" ? null : (
                        <Icon icon="solar:stop-circle-linear" />
                      )
                    }
                    onPress={() => run("stop")}
                  >
                    停止会话
                  </Button>
                </div>
              </div>
              {latestEvidence ? (
                <div className="mt-4 rounded-small bg-background p-3 text-small">
                  <p className="font-medium text-default-800">
                    {latestEvidence.label}
                  </p>
                  <p className="mt-1 break-all text-tiny text-default-500">
                    已保存 · {formatDate(latestEvidence.capturedAt)}
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="flex justify-center py-5">
            <Spinner size="sm" />
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function RuntimeStatusPanel({
  loading,
  status,
  onRefresh,
  onRunAction,
  runningAction,
}: {
  loading: boolean;
  status: LocalEngineRuntimeStatus | null;
  onRefresh: () => Promise<void>;
  onRunAction: (action: LocalEngineRuntimeAction) => Promise<void>;
  runningAction: LocalEngineRuntimeAction | null;
}) {
  const [selectedLogKey, setSelectedLogKey] =
    React.useState<LocalEngineRuntimeServiceKey>("backend");
  const [runtimeLog, setRuntimeLog] =
    React.useState<LocalEngineRuntimeLog | null>(null);
  const [logLoading, setLogLoading] = React.useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = React.useState(false);

  const loadRuntimeLog = React.useCallback(
    async (key: LocalEngineRuntimeServiceKey) => {
      setSelectedLogKey(key);
      setLogLoading(true);
      try {
        const result = await localEngineApi.runtimeLog(key);
        setRuntimeLog(result);
      } catch (e: unknown) {
        setRuntimeLog(null);
        addToast({
          title: "任务记录读取失败",
          description: shortToastDescription(e),
          color: "danger",
        });
      } finally {
        setLogLoading(false);
      }
    },
    [],
  );

  React.useEffect(() => {
    if (status?.services.length && !runtimeLog) {
      loadRuntimeLog(selectedLogKey).catch(() => {
        addToast({ title: "任务记录读取失败", color: "danger" });
      });
    }
  }, [loadRuntimeLog, runtimeLog, selectedLogKey, status?.services.length]);
  return (
    <Card className="border-small border-divider bg-background shadow-sm">
      <CardBody className="gap-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-medium font-semibold text-default-900">
              处理服务检查
            </h3>
            <p className="mt-1 text-small text-default-500">
              确认客户互动、发布和本机助手相关服务能正常工作；异常时先按这里的建议处理。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Chip
              color={status?.allOnline ? "success" : "warning"}
              variant="flat"
            >
              {status?.allOnline ? "全部在线" : "需检查"}
            </Chip>
            <Button
              size="sm"
              variant="flat"
              isLoading={loading}
              startContent={
                loading ? null : <Icon icon="solar:refresh-linear" />
              }
              onPress={() => {
                onRefresh().catch(() => {
                  addToast({ title: "刷新失败", color: "danger" });
                });
              }}
            >
              刷新
            </Button>
          </div>
        </div>
        <div className="local-engine-console__service-actions grid gap-2 md:grid-cols-3">
          <Button
            className="local-engine-console__service-action"
            color="success"
            isLoading={runningAction === "start"}
            size="sm"
            startContent={
              runningAction === "start" ? null : (
                <Icon icon="solar:play-circle-linear" />
              )
            }
            variant="flat"
            onPress={() => {
              onRunAction("start").catch(() => {
                addToast({ title: "启动失败", color: "danger" });
              });
            }}
          >
            启动服务
          </Button>
          <Button
            className="local-engine-console__service-action"
            color="primary"
            isLoading={runningAction === "restart"}
            size="sm"
            startContent={
              runningAction === "restart" ? null : (
                <Icon icon="solar:restart-linear" />
              )
            }
            variant="flat"
            onPress={() => {
              onRunAction("restart").catch(() => {
                addToast({ title: "重启失败", color: "danger" });
              });
            }}
          >
            重新启动
          </Button>
          <Button
            className="local-engine-console__service-action"
            color="warning"
            isLoading={runningAction === "stop"}
            size="sm"
            startContent={
              runningAction === "stop" ? null : (
                <Icon icon="solar:stop-circle-linear" />
              )
            }
            variant="flat"
            onPress={() => {
              onRunAction("stop").catch(() => {
                addToast({ title: "停止失败", color: "danger" });
              });
            }}
          >
            停止服务
          </Button>
        </div>
        <div className="rounded-[8px] border-small border-warning-200 bg-warning-50 px-4 py-3 text-tiny text-warning-700">
          重新启动或停止会让页面短暂断开；等待服务恢复后刷新即可。
        </div>
        {loading && !status ? (
          <div className="flex justify-center py-8">
            <Spinner size="sm" />
          </div>
        ) : null}
        {status ? (
          <>
            <div className="grid gap-3">
              {status.services.map((service) => (
                <div
                  key={service.key}
                  className="local-engine-console__service-row rounded-[8px] border-small border-divider bg-default-50 p-4"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Chip
                          color={service.online ? "success" : "danger"}
                          size="sm"
                          variant="flat"
                        >
                          {service.online ? "在线" : "离线"}
                        </Chip>
                        <span className="text-small font-semibold text-default-900">
                          {commercialDisplayText(service.name)}
                        </span>
                      </div>
                      <p className="mt-2 text-small text-default-600">
                        {commercialDisplayText(service.message)}
                      </p>
                      {!service.online ? (
                        <p className="mt-2 text-small text-warning-700">
                          建议先点击“启动服务”；如果仍失败，再打开高级信息查看最近记录。
                        </p>
                      ) : null}
                    </div>
                    <Button
                      size="sm"
                      variant={
                        selectedLogKey === service.key && diagnosticsOpen
                          ? "solid"
                          : "flat"
                      }
                      isLoading={logLoading && selectedLogKey === service.key}
                      onPress={() => {
                        setDiagnosticsOpen(true);
                        loadRuntimeLog(service.key).catch(() => {
                          addToast({
                            title: "任务记录读取失败",
                            color: "danger",
                          });
                        });
                      }}
                    >
                      查看高级信息
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <div className="local-engine-console__diagnostic rounded-[8px] border-small border-divider bg-default-50 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <h4 className="text-small font-semibold text-default-900">
                    高级信息
                  </h4>
                  <p className="mt-1 text-tiny text-default-500">
                    普通处理不用看这里；启动失败、任务失败时再展开最近记录和服务细节。
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="flat"
                    onPress={() => setDiagnosticsOpen((value) => !value)}
                  >
                    {diagnosticsOpen ? "收起高级信息" : "展开高级信息"}
                  </Button>
                  {diagnosticsOpen ? (
                    <Button
                      size="sm"
                      variant="flat"
                      isLoading={logLoading}
                      startContent={
                        logLoading ? null : <Icon icon="solar:refresh-linear" />
                      }
                      onPress={() => {
                        loadRuntimeLog(selectedLogKey).catch(() => {
                          addToast({
                            title: "任务记录刷新失败",
                            color: "danger",
                          });
                        });
                      }}
                    >
                      刷新记录
                    </Button>
                  ) : null}
                </div>
              </div>
              {diagnosticsOpen ? (
                <div className="mt-4 grid gap-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    {status.services.map((service) => (
                      <div
                        key={`${service.key}-diagnostic`}
                        className="rounded-small bg-background p-3 text-tiny text-default-500"
                      >
                        <p className="font-medium text-default-800">
                          {commercialDisplayText(service.name)}
                        </p>
                        <p className="mt-1">
                          服务状态：{service.online ? "可用" : "需处理"}
                        </p>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-[8px] border border-divider bg-[var(--kaypal-v3-paper-muted)] p-3 font-mono text-[11px] leading-5 text-default-700">
                    <p className="mb-2 text-default-500">
                      {runtimeLog
                        ? `${commercialDisplayText(runtimeLog.name)} 最近记录`
                        : "选择一个服务查看最近记录。"}
                    </p>
                    <div className="max-h-64 overflow-auto">
                      {logLoading && !runtimeLog ? (
                        <div className="text-default-500">正在读取记录...</div>
                      ) : runtimeLog?.exists && runtimeLog.lines.length ? (
                        <div>
                          已收集 {runtimeLog.lines.length} 条运行记录，可供技术支持排查。
                        </div>
                      ) : runtimeLog?.exists ? (
                        <div className="text-default-400">
                          最近没有任务记录。
                        </div>
                      ) : (
                        <div className="text-default-400">暂无任务记录。</div>
                      )}
                    </div>
                  </div>
                  <div className="grid gap-2 text-tiny text-default-500">
                    <p>
                      最近检查：{new Date(status.checkedAt).toLocaleString()}
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          </>
        ) : !loading ? (
          <div className="rounded-[8px] border-small border-divider bg-default-50 p-4 text-small text-default-500">
            暂未读取到处理服务状态。
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function QuickAgentTaskPanel({
  defaultInstruction,
  description,
  icon,
  scope,
  targetApp,
  title,
}: {
  defaultInstruction: string;
  description: string;
  icon: string;
  scope: "browser" | "desktop" | "remote" | "local-files" | "mixed";
  targetApp: string;
  title: string;
}) {
  const [instruction, setInstruction] = React.useState(defaultInstruction);
  const [creating, setCreating] = React.useState(false);

  const createSession = async () => {
    setCreating(true);
    try {
      const session = await localEngineApi.createAgentSession({
        source: "system",
        executionScope: scope,
        targetApp,
        title,
        instruction,
      });
      addToast({
        title: "任务已创建",
        description: session.nextAction,
        color: "success",
      });
    } catch (error: unknown) {
      addToast({
        title: "创建失败",
        description: shortToastDescription(error),
        color: "danger",
      });
    } finally {
      setCreating(false);
    }
  };
  return (
    <Card className="local-engine-console__capability-card border-small border-divider bg-background shadow-sm">
      <CardBody className="gap-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-primary/10 text-primary">
              <Icon icon={icon} width={22} />
            </div>
            <div>
              <h3 className="text-medium font-semibold text-default-900">
                {title}
              </h3>
              <p className="mt-1 text-small text-default-500">{description}</p>
            </div>
          </div>
	          <Button as={Link} href="/tasks/records" variant="flat">
            查看会话
          </Button>
        </div>
        <Textarea
          label="本机任务指令"
          minRows={4}
          value={instruction}
          onValueChange={setInstruction}
        />
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            color="primary"
            isLoading={creating}
            startContent={
              creating ? null : <Icon icon="solar:play-circle-linear" />
            }
            onPress={createSession}
          >
            创建本机任务
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function EvidenceReplayPanel({
  tasks,
  tasksLoading,
  selectedTaskId,
  onRefreshTasks,
}: {
  tasks: InteractionTask[];
  tasksLoading: boolean;
  selectedTaskId: string;
  onRefreshTasks: () => Promise<void>;
}) {
  const [exportingTaskId, setExportingTaskId] = React.useState("");
  const [selectedTaskDetail, setSelectedTaskDetail] =
    React.useState<InteractionTask | null>(null);
  const [selectedTaskLoading, setSelectedTaskLoading] = React.useState(false);
  const [cleanupPreview, setCleanupPreview] =
    React.useState<InteractionEvidenceCleanupResult | null>(null);
  const [retentionDays, setRetentionDays] = React.useState("7");
  const [cleanupLoading, setCleanupLoading] = React.useState(false);
  const evidenceTaskPool = React.useMemo(() => {
    if (!selectedTaskDetail) return tasks;
    const others = tasks.filter((task) => task.id !== selectedTaskDetail.id);
    return [selectedTaskDetail, ...others];
  }, [selectedTaskDetail, tasks]);
  const evidenceTasks = evidenceTaskPool.filter(
    (task) => evidenceCountForTask(task) > 0,
  );
  const evidenceCountByType = evidenceTasks.reduce<Record<string, number>>(
    (acc, task) => {
      Object.entries(evidenceTypeCountsForTask(task)).forEach(
        ([type, count]) => {
          acc[type] = (acc[type] || 0) + count;
        },
      );
      return acc;
    },
    {},
  );
  const riskPolicyTasks = evidenceTaskPool.filter((task) => task.riskPolicy);

  React.useEffect(() => {
    if (!selectedTaskId) {
      setSelectedTaskDetail(null);
      setSelectedTaskLoading(false);
      return;
    }
    let cancelled = false;
    setSelectedTaskLoading(true);
    localEngineApi
      .task(selectedTaskId)
      .then((task) => {
        if (!cancelled) setSelectedTaskDetail(task);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setSelectedTaskDetail(null);
        addToast({
          title: "任务记录详情读取失败",
          description: shortToastDescription(error, "请刷新后重试"),
          color: "danger",
        });
      })
      .finally(() => {
        if (!cancelled) setSelectedTaskLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedTaskId]);

  const exportTask = async (task: InteractionTask) => {
    setExportingTaskId(task.id);
    try {
      const result = await localEngineApi.exportTaskDiagnostics(task.id);
      downloadTextFile(result.filename, result.content, result.mimeType);
      addToast({
        title: "排查资料已导出",
        description: result.filename,
        color: "success",
      });
    } catch (error: unknown) {
      addToast({
        title: "导出失败",
        description: shortToastDescription(error),
        color: "danger",
      });
    } finally {
      setExportingTaskId("");
    }
  };

  const previewCleanup = async () => {
    setCleanupLoading(true);
    try {
      setCleanupPreview(
        await localEngineApi.previewEvidenceCleanup(Number(retentionDays) || 7),
      );
    } catch (error: unknown) {
      addToast({
        title: "记录清理预览失败",
        description: shortToastDescription(error),
        color: "danger",
      });
    } finally {
      setCleanupLoading(false);
    }
  };

  const cleanupEvidence = async () => {
    setCleanupLoading(true);
    try {
      const result = await localEngineApi.cleanupEvidence(
        Number(retentionDays) || 7,
        buildLocalEngineRiskConfirmation(
          "local-file-delete",
          "high",
          "用户在本机检查页面确认清理旧记录",
        ),
      );
      setCleanupPreview(result);
      addToast({
        title: "旧记录已清理",
        description: `删除 ${result.deletedCount} 个文件`,
        color: "success",
      });
      await onRefreshTasks();
    } catch (error: unknown) {
      addToast({
        title: "记录清理失败",
        description: shortToastDescription(error),
        color: "danger",
      });
    } finally {
      setCleanupLoading(false);
    }
  };
  return (
    <div className="grid gap-4">
      <Card className="border-small border-divider bg-background shadow-sm">
        <CardBody className="gap-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h3 className="text-medium font-semibold text-default-900">
                结果留存
              </h3>
              <p className="mt-1 text-small text-default-500">
                按任务查看截图、页面记录、文本记录和排查资料；这里可以直接导出。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                isLoading={tasksLoading}
                variant="flat"
                onPress={onRefreshTasks}
              >
                刷新任务
              </Button>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <StatusItem
              label="任务总数"
              value={String(evidenceTaskPool.length)}
            />
            <StatusItem
              label="有记录任务"
              value={String(evidenceTasks.length)}
            />
            <StatusItem
              label="待继续"
              value={String(
                evidenceTaskPool.filter(
                  (task) => task.status === "waiting_for_send_confirmation",
                ).length,
              )}
            />
            <StatusItem
              label="失败"
              value={String(
                evidenceTaskPool.filter((task) => task.status === "failed")
                  .length,
              )}
            />
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <StatusItem
              label="页面记录"
              value={String(evidenceCountByType.page_snapshot || 0)}
            />
            <StatusItem
              label="桌面截图"
              value={String(evidenceCountByType.desktop_screenshot || 0)}
            />
            <StatusItem
              label="步骤记录"
              value={String(evidenceCountByType.stage_log || 0)}
            />
            <StatusItem
              label="失败原因"
              value={String(evidenceCountByType.failure_reason || 0)}
            />
          </div>
          <div className="rounded-[8px] border-small border-warning-200 bg-warning-50 p-3 text-small text-warning-700">
            <p className="font-semibold">权限风控覆盖</p>
            <p className="mt-1">
              已记录风控策略任务 {riskPolicyTasks.length}
              个；包含试用/商用权限、角色审批、白名单、禁止动作和远程接管记录。
            </p>
          </div>
          <div className="grid gap-3">
            {evidenceTasks.map((task) => (
              <div
                key={task.id}
                className="rounded-[8px] border-small border-divider bg-default-50 p-4"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusChip
                        status={task.status}
                        label={task.statusLabel}
                      />
                      <Chip size="sm" variant="flat">
                        {task.typeLabel}
                      </Chip>
                      <Chip size="sm" variant="flat">
                        {evidenceCountForTask(task)} 条记录
                      </Chip>
                      {task.safetyBoundary ? (
                        <Chip
                          color={
                            task.safetyBoundary.permissionStatus === "allowed"
                              ? "success"
                              : "warning"
                          }
                          size="sm"
                          variant="flat"
                        >
                          {permissionStatusLabel[
                            task.safetyBoundary.permissionStatus
                          ] || task.safetyBoundary.permissionStatus}
                        </Chip>
                      ) : null}
                      {task.riskPolicy?.remoteTakeoverAuditRequired ? (
                        <Chip color="danger" size="sm" variant="flat">
                          远程记录
                        </Chip>
                      ) : null}
                    </div>
                    <p className="mt-2 text-small font-semibold text-default-900">
                      {task.accountName} {"->"} {task.targetName}
                    </p>
                    <p className="mt-1 text-small text-default-500">
                      {task.diagnostics?.summary || task.nextAction}
                    </p>
                    {task.riskPolicy ? (
                      <p className="mt-1 text-tiny text-default-400">
                        {task.riskPolicy.message}
                        {(task.riskPolicy.forbiddenActions || []).length
                          ? `；禁止动作：${(task.riskPolicy.forbiddenActions || []).join("、")}`
                          : ""}
                      </p>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {Object.entries(evidenceTypeCountsForTask(task)).map(
                        ([type, count]) => (
                          <Chip key={type} size="sm" variant="flat">
                            {evidenceTypeLabel(type as LocalEngineEvidenceType)}
                            : {count}
                          </Chip>
                        ),
                      )}
                    </div>
                    {task.events.some((event) => event.evidence) ? (
                      <div className="mt-3 grid gap-2">
                        {task.events
                          .filter((event) => event.evidence)
                          .slice(0, 4)
                          .map((event) => (
                            <EvidenceEventPreview
                              key={event.id}
                              event={event}
                            />
                          ))}
                      </div>
                    ) : null}
                  </div>
                  <Button
                    isLoading={exportingTaskId === task.id}
                    size="sm"
                    startContent={
                      exportingTaskId === task.id ? null : (
                        <Icon icon="solar:download-minimalistic-linear" />
                      )
                    }
                    variant="flat"
                    onPress={() => exportTask(task)}
                  >
                    导出排查资料
                  </Button>
                </div>
              </div>
            ))}
            {selectedTaskLoading ? (
              <div className="flex justify-center py-5">
                <Spinner size="sm" />
              </div>
            ) : null}
            {!tasksLoading && !selectedTaskLoading && !evidenceTasks.length ? (
              <FunctionalEmptyState
                actions={[
                  { href: "/engagement", label: "客户互动" },
                  { href: "/distribution", label: "发布中心" },
                ]}
                description="还没有本机任务结果留存。先从评论、私信、微信或发布准备创建任务，完成后这里会显示截图、步骤和失败原因。"
                examples={["截图", "步骤记录", "失败原因", "排查资料"]}
                surface="plain"
                title="当前没有结果留存"
              />
            ) : null}
          </div>
        </CardBody>
      </Card>
      <Card className="border-small border-divider bg-background shadow-sm">
        <CardBody className="gap-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h3 className="text-medium font-semibold text-default-900">
                记录文件管理
              </h3>
              <p className="mt-1 text-small text-default-500">
                清理前必须预览数量、大小和目录，避免误删近期记录。
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <Input
                className="w-32"
                label="保留天数"
                min={0}
                size="sm"
                type="number"
                value={retentionDays}
                onValueChange={setRetentionDays}
              />
              <Button
                isLoading={cleanupLoading}
                variant="flat"
                onPress={previewCleanup}
              >
                预览清理
              </Button>
              <Button
                color="danger"
                isDisabled={!cleanupPreview?.candidateCount}
                isLoading={cleanupLoading}
                variant="flat"
                onPress={cleanupEvidence}
              >
                清理旧记录
              </Button>
            </div>
          </div>
          {cleanupPreview ? (
            <div className="grid gap-3 md:grid-cols-4">
              <StatusItem
                label="目录文件"
                value={String(cleanupPreview.status.fileCount)}
              />
              <StatusItem
                label="目录大小"
                value={formatBytes(cleanupPreview.status.totalBytes)}
              />
              <StatusItem
                label={cleanupPreview.execute ? "已清理" : "可清理"}
                value={String(
                  cleanupPreview.execute
                    ? cleanupPreview.deletedCount
                    : cleanupPreview.candidateCount,
                )}
              />
              <StatusItem
                label="预计释放"
                value={formatBytes(cleanupPreview.totalBytes)}
              />
            </div>
          ) : (
            <div className="rounded-small bg-default-50 p-3 text-small text-default-500">
              点击“预览清理”后，再决定是否清理旧截图和快照。
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function evidenceCountForTask(task: InteractionTask) {
  const eventEvidenceCount = task.events.filter(
    (event) => event.evidence,
  ).length;
  return Math.max(
    eventEvidenceCount,
    task.diagnostics?.evidenceCount || 0,
    task.resultSummary?.evidenceCount || 0,
  );
}

function evidenceTypeCountsForTask(task: InteractionTask) {
  const counts = task.events.reduce<
    Partial<Record<LocalEngineEvidenceType, number>>
  >((acc, event) => {
    if (event.evidence)
      acc[event.evidence.type] = (acc[event.evidence.type] || 0) + 1;
    return acc;
  }, {});
  if (!Object.keys(counts).length) {
    const fallbackCount = evidenceCountForTask(task);
    if (fallbackCount > 0) counts.diagnostic_bundle = fallbackCount;
  }
  return counts;
}

function EvidenceEventPreview({
  event,
}: {
  event: InteractionTask["events"][number];
}) {
  if (!event.evidence) return null;
  const imageEvidenceTypes = new Set(["screenshot", "desktop_screenshot"]);
  const evidenceUrl = imageEvidenceTypes.has(event.evidence.type)
    ? localEngineApi.evidenceFileUrl(event.evidence.value)
    : "";
  return (
    <div className="rounded-small border-small border-divider bg-background px-3 py-2 text-tiny text-default-500">
      <div className="flex flex-wrap items-center gap-1">
        <span className="font-medium text-default-700">
          {evidenceTypeLabel(event.evidence.type)}
        </span>
        <span>{event.evidence.label}</span>
        <span className="text-default-400">{formatDate(event.createdAt)}</span>
      </div>
      {evidenceUrl ? (
        <div className="mt-2 grid gap-2">
          <a
            className="text-primary underline-offset-2 hover:underline"
            href={evidenceUrl}
            rel="noreferrer"
            target="_blank"
          >
            打开截图
          </a>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt={event.evidence.label}
            className="max-h-44 w-full max-w-lg rounded-small border-small border-divider object-contain"
            src={evidenceUrl}
          />
        </div>
      ) : (
        <p className="mt-1 break-all">{event.evidence.value}</p>
      )}
    </div>
  );
}

function BrowserControlPanel({
  capability,
  executorsLoading,
  executorsStatus,
  agentSLoading,
  agentSStatus,
  loading,
  status,
  onRefreshAgentS,
  onRefreshExecutors,
  onRefresh,
  onTaskCreated,
}: {
  capability?: LocalEngineCapability;
  executorsLoading: boolean;
  executorsStatus: LocalEngineExecutorsStatus | null;
  agentSLoading: boolean;
  agentSStatus: AgentSStatusSnapshot | null;
  loading: boolean;
  status: LocalEngineBrowserStatus | null;
  onRefreshAgentS: () => Promise<void>;
  onRefreshExecutors: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onTaskCreated?: () => Promise<void>;
}) {
  const [creatingTaskKey, setCreatingTaskKey] = React.useState<string | null>(
    null,
  );

  const createBrowserTask = async (
    account: LocalEngineBrowserStatus["accounts"][number],
    interactionKind: "comments" | "messages",
  ) => {
    const isCommentTask = interactionKind === "comments";
    const isWechatChannel =
      account.type === 2 ||
      account.platform === "wechat-channel" ||
      account.platform === "视频号";
    const route: Extract<
      InteractionBusinessRouteKey,
      "comments" | "messages" | "channel-comments" | "channel-messages"
    > = isWechatChannel
      ? isCommentTask
        ? "channel-comments"
        : "channel-messages"
      : isCommentTask
        ? "comments"
        : "messages";
    const type: InteractionTaskType = isWechatChannel
      ? isCommentTask
        ? "wechat-channel-comment-reply"
        : "wechat-channel-direct-message-reply"
      : isCommentTask
        ? "douyin-comment-reply"
        : "douyin-direct-message-reply";
    const taskKey = `${account.id}-${interactionKind}`;
    const platformLabel = isWechatChannel ? "视频号" : "抖音";
    setCreatingTaskKey(taskKey);
    try {
      const task = await localEngineApi.createBusinessTask(route, {
        type,
        accountId: String(account.id),
        accountName: account.displayName,
        platformType: account.type,
        platformName: account.platform,
        targetName: isCommentTask ? "浏览器读取评论" : "浏览器读取私信",
        sourceText: isCommentTask
          ? `平台检查会自动打开${platformLabel}后台并读取第一条可处理评论。`
          : `平台检查会自动打开${platformLabel}后台并读取第一条可处理私信。`,
        replyText: "",
        sendMode: "approval-send",
      });
      addToast({
        title: isCommentTask ? "已创建评论检查任务" : "已创建私信检查任务",
        description: `${task.accountName}：将打开后台、读取页面并按受控发送规则推进。`,
        color: "success",
      });
      await onTaskCreated?.();
    } catch (e: unknown) {
      addToast({
        title: "创建浏览器任务失败",
        description: shortToastDescription(e),
        color: "danger",
      });
    } finally {
      setCreatingTaskKey(null);
    }
  };
  return (
    <Card className="border-small border-divider bg-background shadow-sm">
      <CardBody className="gap-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-medium font-semibold text-default-900">
              平台页面操作
            </h3>
            <p className="mt-1 text-small text-default-500">
              从这里选择真实平台账号发起检查：打开后台、读取页面、保存记录，并在填入草稿前暂停确认。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <CapabilityChip status={capability?.status || "missing"} />
            <Button
              size="sm"
              variant="flat"
              isLoading={loading}
              startContent={
                loading ? null : <Icon icon="solar:refresh-linear" />
              }
              onPress={() => {
                onRefresh().catch(() => {
                  addToast({ title: "刷新失败", color: "danger" });
                });
              }}
            >
              刷新
            </Button>
          </div>
        </div>
        <ExecutorStatusPanel
          loading={executorsLoading}
          status={executorsStatus}
          agentSAssessment={getAgentSAssessment(agentSStatus, agentSLoading)}
          onRefresh={async () => {
            await Promise.all([onRefreshExecutors(), onRefreshAgentS()]);
          }}
        />
        <div className="grid gap-3 md:grid-cols-4">
          <StatusItem
            label="引擎状态"
            value={status?.engineOnline ? "在线" : "不可用"}
          />
          <StatusItem
            label="账号总数"
            value={String(status?.totalAccounts ?? 0)}
          />
          <StatusItem
            label="正常账号"
            value={String(status?.readyAccounts ?? 0)}
          />
          <StatusItem
            label="失效账号"
            value={String(status?.expiredAccounts ?? 0)}
          />
        </div>
        <div className="rounded-[8px] border-small border-divider bg-default-50 p-4">
          <p className="text-small text-default-700">
            {status?.engineOnline
              ? "平台页面操作当前可用。"
              : "平台页面操作暂不可用，请重新检查本机服务。"}
          </p>
        </div>
        <div className="grid gap-3">
          {status?.accounts.map((account) => {
            const isSupportedInteractionAccount =
              account.type === 2 ||
              account.type === 3 ||
              account.platform === "wechat-channel" ||
              account.platform === "视频号" ||
              account.platform === "douyin" ||
              account.platform === "抖音";
            const canCreateTask = Boolean(
              status.engineOnline &&
              account.status === "ready" &&
              isSupportedInteractionAccount,
            );
            const commentKey = `${account.id}-comments`;
            const messageKey = `${account.id}-messages`;
            return (
              <div
                key={account.id}
                className="flex flex-col gap-3 rounded-[8px] border-small border-divider bg-default-50 p-4 md:flex-row md:items-center md:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip size="sm" variant="flat">
                      {account.platform}
                    </Chip>
                    <span className="text-small font-semibold text-default-900">
                      {account.displayName}
                    </span>
                  </div>
                  {account.status === "expired" ? (
                    <p className="mt-2 text-tiny text-warning-600">
                      登录态失效：请先在本机浏览器重新登录，再发起评论/私信检查。
                    </p>
                  ) : null}
                  {account.status === "needs_login" ||
                  account.status === "blocked" ? (
                    <p className="mt-2 text-tiny text-warning-600">
                      当前账号不可用，请重新登录后再试。
                    </p>
                  ) : null}
                  {account.status === "ready" &&
                  !isSupportedInteractionAccount ? (
                    <p className="mt-2 text-tiny text-default-500">
                      当前评论/私信检查只支持抖音和视频号账号。
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2 md:justify-end">
                  <Chip
                    color={account.status === "ready" ? "success" : "warning"}
                    size="sm"
                    variant="flat"
                  >
                    {account.statusLabel}
                  </Chip>
                  <Button
                    size="sm"
                    variant="flat"
                    color="primary"
                    isDisabled={!canCreateTask || Boolean(creatingTaskKey)}
                    isLoading={creatingTaskKey === commentKey}
                    startContent={
                      creatingTaskKey === commentKey ? null : (
                        <Icon icon="solar:chat-round-line-linear" />
                      )
                    }
                    onPress={() => createBrowserTask(account, "comments")}
                  >
                    评论检查
                  </Button>
                  <Button
                    size="sm"
                    variant="flat"
                    color="secondary"
                    isDisabled={!canCreateTask || Boolean(creatingTaskKey)}
                    isLoading={creatingTaskKey === messageKey}
                    startContent={
                      creatingTaskKey === messageKey ? null : (
                        <Icon icon="solar:letter-linear" />
                      )
                    }
                    onPress={() => createBrowserTask(account, "messages")}
                  >
                    私信检查
                  </Button>
                </div>
              </div>
            );
          })}
          {!loading && !status?.accounts.length ? (
            <div className="rounded-[8px] border-small border-divider bg-default-50 p-4 text-small text-default-500">
              暂无平台账号。请先到发布中心的平台账号里绑定抖音、小红书、视频号等账号。
            </div>
          ) : null}
          {loading ? (
            <div className="flex justify-center py-8">
              <Spinner size="sm" />
            </div>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}

function ExecutorStatusPanel({
  loading,
  status,
  agentSAssessment,
  onRefresh,
}: {
  loading: boolean;
  status: LocalEngineExecutorsStatus | null;
  agentSAssessment?: AgentSRunCheckAssessment;
  onRefresh: () => Promise<void>;
}) {
  const agentSRequiredExecutors =
    status?.executors.filter(
      (executor) =>
        isAgentSDesktopExecutor(executor) && executor.status !== "optional",
    ) ?? [];
  const agentSBlocksDesktop = Boolean(
    agentSAssessment &&
    !agentSAssessment.isRealExecutionReady &&
    agentSRequiredExecutors.length > 0,
  );
  const displayReadyCount = agentSBlocksDesktop
    ? Math.max(0, (status?.summary.ready ?? 0) - agentSRequiredExecutors.length)
    : (status?.summary.ready ?? 0);
  const displayMissingCount =
    (status?.summary.missing ?? 0) +
    (agentSBlocksDesktop ? agentSRequiredExecutors.length : 0);
  return (
    <section className="rounded-[8px] border-small border-divider bg-default-50 p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h4 className="text-small font-semibold text-default-900">
            客户互动可用性
          </h4>
          <p className="mt-1 text-tiny text-default-500">
            检查评论、私信和微信回复能不能真实读取、生成内容并继续执行。
          </p>
        </div>
        <Button
          size="sm"
          variant="flat"
          isLoading={loading}
          startContent={loading ? null : <Icon icon="solar:refresh-linear" />}
          onPress={() => {
            onRefresh().catch(() => {
              addToast({ title: "刷新失败", color: "danger" });
            });
          }}
        >
          重新检查
        </Button>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <StatusItem label="检查项" value={String(status?.summary.total ?? 0)} />
        <StatusItem label="真实可处理" value={String(displayReadyCount)} />
        <StatusItem
          label="提醒/需确认"
          value={String(status?.summary.preflightOnly ?? 0)}
        />
        <StatusItem label="需处理" value={String(displayMissingCount)} />
      </div>
      {agentSBlocksDesktop && agentSAssessment ? (
        <div className="mt-4 rounded-[8px] border-small border-danger-200 bg-danger-50 p-3 text-small text-danger-700">
          <p className="font-semibold">本机操作能力需处理</p>
          <p className="mt-1">{agentSAssessment.summary}</p>
          <p className="mt-1 text-tiny text-danger-600">
            {agentSAssessment.detail}
          </p>
        </div>
      ) : null}
      {loading && !status ? (
        <div className="flex justify-center py-5">
          <Spinner size="sm" />
        </div>
      ) : null}
      <div className="mt-4 grid gap-3">
        {status?.executors.map((executor) => (
          <div key={executor.key} className="rounded-small bg-background p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <ExecutorStatusChip
                    status={executor.status}
                    isAgentSDesktop={isAgentSDesktopExecutor(executor)}
                    agentSAssessment={agentSAssessment}
                  />
                  <Chip size="sm" variant="flat">
                    {executor.platformName}
                  </Chip>
                  <span className="text-small font-semibold text-default-900">
                    {executor.name}
                  </span>
                </div>
                <p className="mt-2 text-small text-default-600">
                  {agentSAssessment &&
                  !agentSAssessment.isRealExecutionReady &&
                  isAgentSDesktopExecutor(executor) &&
                  executor.status !== "missing" &&
                  executor.status !== "optional"
                    ? commercialDisplayText(
                        `入口已接入，但本机操作能力未接通，不能显示为可直接处理。${executor.message}`,
                      )
                    : commercialDisplayText(executor.message)}
                </p>
                <p className="mt-2 text-tiny text-default-400">
                  {commercialDisplayText(executor.nextAction)}
                </p>
              </div>
              <div className="grid min-w-[260px] grid-cols-2 gap-2">
                <ExecutorAbilityChip
                  label="打开入口"
                  ready={executor.entryPreflight}
                />
                <ExecutorAbilityChip
                  label="读取对象"
                  ready={executor.targetRead}
                />
                <ExecutorAbilityChip
                  label="生成回复"
                  ready={executor.replyGenerate}
                />
                <ExecutorAbilityChip
                  label="受控发送"
                  ready={executor.controlledSend}
                />
              </div>
            </div>
          </div>
        ))}
        {!loading && !status?.executors.length ? (
          <div className="rounded-small bg-background p-4 text-small text-default-500">
            暂未读取到客户互动可用性。
          </div>
        ) : null}
      </div>
      {status ? (
        <p className="mt-3 text-tiny text-default-400">
          最近检查：{new Date(status.checkedAt).toLocaleString()}
        </p>
      ) : null}
    </section>
  );
}

type McpStatusPayload = {
  data?: { data?: McpStatusPayload } & McpStatusPayload;
  playwright?: {
    online: boolean;
    childProcessRunning: boolean;
    transport: string;
    endpoint: string;
    pid?: number;
    toolCount?: number;
    message: string;
  };
  runtime?: {
    available: boolean;
    serverCount: number;
    toolCount: number;
    message: string;
  };
};

type McpToolsPayload = {
  data?: { data?: McpToolsPayload } & McpToolsPayload;
  playwright?: Array<{ name: string; description?: string }>;
};

function unwrapMcpStatusPayload(value: unknown): McpStatusPayload {
  if (value && typeof value === "object") {
    return value as McpStatusPayload;
  }
  return {};
}

function unwrapMcpToolsPayload(value: unknown): McpToolsPayload {
  if (value && typeof value === "object") {
    return value as McpToolsPayload;
  }
  return {};
}
function McpStatusCard() {
  const [status, setStatus] = React.useState<{
    playwright?: {
      online: boolean;
      childProcessRunning: boolean;
      transport: string;
      endpoint: string;
      pid?: number;
      toolCount?: number;
      message: string;
    };
    runtime?: {
      available: boolean;
      serverCount: number;
      toolCount: number;
      message: string;
    };
  } | null>(null);
  const [tools, setTools] = React.useState<
    Array<{ name: string; description?: string }>
  >([]);
  const [loading, setLoading] = React.useState(false);
  const [testUrl, setTestUrl] = React.useState("https://example.com");
  const [testRunning, setTestRunning] = React.useState(false);
  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const [s, t] = await Promise.all([
        localEngineApi.mcpStatus(),
        localEngineApi.mcpTools(),
      ]);
      // 后端返 { success, data: { success, data: { playwright, ... } } } (双重 wrap by TransformInterceptor)
      // 兼容 1 层 / 2 层 wrap
      const sData = unwrapMcpStatusPayload(s.data);
      const tData = unwrapMcpToolsPayload(t.data);
      setStatus(sData?.data?.data ?? sData?.data ?? sData);
      setTools(
        tData?.data?.data?.playwright ??
          tData?.data?.playwright ??
          tData?.playwright ??
          [],
      );
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);
  React.useEffect(() => {
    refresh().catch(() => {});
    const id = setInterval(() => {
      refresh().catch(() => {});
    }, 8000);
    return () => clearInterval(id);
  }, [refresh]);
  const onTestNavigate = async () => {
    if (!testUrl.trim()) return;
    setTestRunning(true);
    try {
      const r = await localEngineApi.mcpCallTool("browser_navigate", {
        url: testUrl.trim(),
      });
      const text =
        r.result?.content?.[0]?.text ?? r.error?.message ?? "(无响应)";
      addToast({
        title: r.error ? "浏览器调用失败" : "已用自动化动作打开页面",
        description: String(text).slice(0, 220),
        color: r.error ? "danger" : "success",
      });
    } catch (e: unknown) {
      addToast({
        title: "调用失败",
        description: shortToastDescription(e),
        color: "danger",
      });
    } finally {
      setTestRunning(false);
    }
  };
  const onOpenLogin = async (loginUrl: string, platformLabel: string) => {
    setTestRunning(true);
    try {
      const r = await localEngineApi.mcpCallTool("browser_navigate", {
        url: loginUrl,
      });
      const text = r.result?.content?.[0]?.text ?? r.error?.message ?? "";
      addToast({
        title: `${platformLabel} 登录页已打开`,
        description:
          "在浏览器里扫码或输入账号登录，登录态会自动保存。下次打开平台会继续沿用。" +
          (text ? ` 当前页: ${String(text).slice(0, 80)}` : ""),
        color: "success",
      });
    } catch (e: unknown) {
      addToast({
        title: "打开登录页失败",
        description: shortToastDescription(e),
        color: "danger",
      });
    } finally {
      setTestRunning(false);
    }
  };
  const online = !!status?.playwright?.online;
  return (
    <section className="rounded-[8px] border-small border-divider bg-default-50 p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h4 className="text-small font-semibold text-default-900">
            浏览器自动化能力
          </h4>
          <p className="mt-1 text-tiny text-default-500">
            当前可用 {tools.length}
            个浏览器动作；平台服务会用这条路径真实打开抖音和视频号页面。
          </p>
        </div>
        <Button
          size="sm"
          variant="flat"
          isLoading={loading}
          startContent={loading ? null : <Icon icon="solar:refresh-linear" />}
          onPress={() => {
            refresh().catch(() => {
              addToast({ title: "刷新失败", color: "danger" });
            });
          }}
        >
          刷新
        </Button>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <StatusItem label="浏览器服务" value={online ? "在线" : "离线"} />
        <StatusItem label="可用动作" value={String(tools.length)} />
      </div>
      {status?.playwright?.message ? (
        <p className="mt-2 text-tiny text-default-500">
          {interactionDisplayText(status.playwright.message)}
        </p>
      ) : null}
      <div className="mt-4 flex flex-col gap-2 md:flex-row md:items-end">
        <Input
          size="sm"
          value={testUrl}
          onValueChange={setTestUrl}
          placeholder="https://example.com"
          label="打开网页"
          className="flex-1"
        />
        <Button
          size="sm"
          color="primary"
          isLoading={testRunning}
          isDisabled={!online}
          onPress={onTestNavigate}
          startContent={
            !testRunning ? <Icon icon="solar:globus-linear" /> : null
          }
        >
          打开
        </Button>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        <p className="text-tiny text-default-500">
          <strong className="text-default-700">保持登录状态</strong>：
          先在浏览器里登录账号，登录态会自动保存。之后系统打开平台时会带着已登录账号。
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="bordered"
            isDisabled={!online || testRunning}
            onPress={() =>
              onOpenLogin("https://creator.douyin.com/", "抖音创作者中心")
            }
            startContent={<Icon icon="solar:user-circle-linear" />}
          >
            打开抖音登录页
          </Button>
          <Button
            size="sm"
            variant="bordered"
            isDisabled={!online || testRunning}
            onPress={() =>
              onOpenLogin(
                "https://channels.weixin.qq.com/platform",
                "视频号助手",
              )
            }
            startContent={<Icon icon="solar:user-circle-linear" />}
          >
            打开视频号登录页
          </Button>
        </div>
      </div>
      {tools.length > 0 ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-tiny text-default-600">
            查看全部 {tools.length} 个自动化动作
          </summary>
          <div className="mt-2 grid gap-1 md:grid-cols-2">
            {tools.map((t) => (
              <div
                key={t.name}
                className="rounded-small border-small border-divider bg-background px-2 py-1 text-tiny"
              >
                <code className="font-mono text-primary">{t.name}</code>
                {t.description ? (
                  <span className="ml-2 text-default-500">
                    {commercialDisplayText(t.description).slice(0, 60)}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}

const desktopReplicaCapabilityKeys: Array<LocalEngineCapability["key"]> = [
  "desktop-control",
  "mcp-manager",
  "agent-s-sidecar",
  "wechat-execution",
  "remote-control",
  "plugin-runtime",
  "memory-context",
  "sandbox-execution",
  "evidence-replay",
];

function DesktopCapabilityPanel({
  capabilityByKey,
  executorsLoading,
  executorsStatus,
}: {
  capabilityByKey: Map<LocalEngineCapability["key"], LocalEngineCapability>;
  executorsLoading: boolean;
  executorsStatus: LocalEngineExecutorsStatus | null;
}) {
  const directCapabilities = desktopReplicaCapabilityKeys
    .map((key) => capabilityByKey.get(key))
    .filter((capability): capability is LocalEngineCapability =>
      Boolean(capability),
    );
  const capabilities = directCapabilities.length
    ? directCapabilities
    : desktopCapabilitiesFromExecutors(executorsStatus);
  const missingCount = capabilities.filter(
    (capability) => capability.status === "missing",
  ).length;
  const warningCount = capabilities.filter(
    (capability) => capability.status === "warning",
  ).length;
  const readyCount = capabilities.filter(
    (capability) => capability.status === "ready",
  ).length;

  const openMacPrivacyPane = (
    pane: "accessibility" | "screen" | "files" | "automation",
  ) => {
    const urls = {
      accessibility:
        "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
      screen:
        "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
      files:
        "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
      automation:
        "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation",
    };
    window.open(urls[pane], "_self");
  };
  return (
    <Card className="border-small border-divider bg-background shadow-sm">
      <CardBody className="gap-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-medium font-semibold text-default-900">
              本机助手能力
            </h3>
            <p className="mt-1 max-w-3xl text-small text-default-500">
              这里检查浏览器、微信桌面、远程接管、结果凭证等商用处理所需能力。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Chip color="success" size="sm" variant="flat">
              可用 {readyCount}
            </Chip>
            <Chip color="warning" size="sm" variant="flat">
              需确认 {warningCount}
            </Chip>
            <Chip color="danger" size="sm" variant="flat">
              需要处理 {missingCount}
            </Chip>
          </div>
        </div>
        <div className="rounded-[8px] border-small border-warning-200 bg-warning-50 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-small font-semibold text-warning-800">
                macOS 桌面权限
              </p>
              <p className="mt-1 text-small text-warning-700">
                JIUZHANG AI
                需要这些权限来识别窗口、输入内容、点击按钮和选择素材文件。开完权限后回到本页刷新检查。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="flat"
                onPress={() => openMacPrivacyPane("accessibility")}
              >
                辅助功能
              </Button>
              <Button
                size="sm"
                variant="flat"
                onPress={() => openMacPrivacyPane("screen")}
              >
                屏幕录制
              </Button>
              <Button
                size="sm"
                variant="flat"
                onPress={() => openMacPrivacyPane("automation")}
              >
                自动化
              </Button>
              <Button
                size="sm"
                variant="flat"
                onPress={() => openMacPrivacyPane("files")}
              >
                完全磁盘访问
              </Button>
            </div>
          </div>
          <div className="mt-3 grid gap-2 text-tiny text-warning-700 md:grid-cols-2">
            <p>辅助功能：允许输入、粘贴、点击和控制窗口。</p>
            <p>屏幕录制：允许识别当前窗口和页面状态。</p>
            <p>自动化：允许控制微信、浏览器、Finder 等应用。</p>
            <p>文件权限：允许选择图片、视频和账号素材文件。</p>
          </div>
        </div>
        <div className="grid gap-3 xl:grid-cols-2">
          {capabilities.map((capability) => (
            <div
              key={capability.key}
              className="rounded-[8px] border-small border-divider bg-default-50 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-small font-semibold text-default-900">
                    {commercialDisplayText(capability.name)}
                  </p>
                  <p className="mt-1 text-small text-default-600">
                    {commercialDisplayText(capability.summary)}
                  </p>
                </div>
                <CapabilityChip status={capability.status} />
              </div>
              {capability.nextAction ? (
                <p className="mt-3 text-tiny text-default-500">
                  {commercialDisplayText(capability.nextAction)}
                </p>
              ) : null}
              {capability.checks?.length ? (
                <div className="mt-3 grid gap-2">
                  {capability.checks.map((check) => (
                    <div
                      key={check.name}
                      className="rounded-small bg-background p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-tiny font-medium text-default-800">
                          {commercialDisplayText(check.name)}
                        </span>
                        <CapabilityChip status={check.status} />
                      </div>
                      <p className="mt-1 break-all text-tiny text-default-500">
                        {commercialDisplayText(check.message)}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
          {executorsLoading && !capabilities.length ? (
            <div className="rounded-[8px] border-small border-divider bg-default-50 p-4 text-small text-default-500">
              正在读取本机助手能力...
            </div>
          ) : null}
          {!executorsLoading && !capabilities.length ? (
            <div className="rounded-[8px] border-small border-divider bg-default-50 p-4 text-small text-default-500">
              暂未读取到本机助手能力，请重新检查。
            </div>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}

function desktopCapabilitiesFromExecutors(
  status: LocalEngineExecutorsStatus | null,
): LocalEngineCapability[] {
  if (!status?.executors?.length) {
    return [];
  }

  const checkedAt = status.checkedAt || new Date().toISOString();
  const executorByKey = new Map(
    status.executors.map((executor) => [executor.key, executor]),
  );
  const statusFromExecutors = (
    keys: string[],
  ): LocalEngineCapability["status"] => {
    const items = keys.map((key) => executorByKey.get(key)).filter(Boolean);
    if (!items.length) return "missing";
    if (
      items.every(
        (item) => item?.status === "ready" || item?.status === "optional",
      )
    )
      return "ready";
    if (items.some((item) => item?.status === "missing")) return "missing";
    return "warning";
  };
  const checksFromExecutors = (keys: string[]) =>
    keys
      .map((key) => executorByKey.get(key))
      .filter(
        (
          executor,
        ): executor is LocalEngineExecutorsStatus["executors"][number] =>
          Boolean(executor),
      )
      .map((executor) => ({
        name: executor.name,
        status:
          executor.status === "ready" || executor.status === "optional"
            ? ("ready" as const)
            : executor.status === "missing"
              ? ("missing" as const)
              : ("warning" as const),
        message: executor.message,
      }));
  const wechatKeys = [
    "wechat-reply-draft",
    "wechat-group-broadcast",
    "wechat-contact-add",
    "wechat-moments-publish",
    "wechat-moments-marketing",
  ];
  const browserKeys = [
    "douyin-comment-reply",
    "douyin-direct-message-reply",
    "douyin-exposure",
    "wechat-channel-comment-reply",
    "wechat-channel-direct-message-reply",
  ];

  return [
    {
      key: "wechat-execution",
      name: "桌面微信执行",
      status: statusFromExecutors(wechatKeys),
      required: true,
      summary:
        "微信会话回复、群发、自动加好友、朋友圈发布和朋友圈运营处理能力已接入。",
      checkedAt,
      nextAction: "以具体任务结果和结果留存判断发送、发布、评论是否完成。",
      checks: checksFromExecutors(wechatKeys),
    },
    {
      key: "desktop-control",
      name: "平台浏览器与互动执行",
      status: statusFromExecutors(browserKeys),
      required: true,
      summary: "抖音评论/私信、抖音获客、视频号评论/私信处理能力已接入。",
      checkedAt,
      nextAction:
        "账号登录态以平台账号检查为准；视频号需要保持当前浏览器 profile 登录。",
      checks: checksFromExecutors(browserKeys),
    },
    {
      key: "agent-s-sidecar",
      name: "本机操作兼容能力",
      status: statusFromExecutors(["agent-s-legacy-desktop"]),
      required: false,
      summary:
        executorByKey.get("agent-s-legacy-desktop")?.message ||
        "本机操作兼容能力可用。",
      checkedAt,
      nextAction:
        executorByKey.get("agent-s-legacy-desktop")?.nextAction ||
        "旧外部服务不作为微信主入口。",
      checks: checksFromExecutors(["agent-s-legacy-desktop"]),
    },
    {
      key: "evidence-replay",
      name: "发布与剪辑执行",
      status: statusFromExecutors(["platform-publish", "video-template-clip"]),
      required: false,
      summary: "发布中心和视频工坊处理能力可作为 AI 员工的发布、剪辑交接能力。",
      checkedAt,
      nextAction: "发布成功仍需要平台回执或页面结果确认记录。",
      checks: checksFromExecutors(["platform-publish", "video-template-clip"]),
    },
  ];
}
function FileAccessPanel({
  capability,
  loading,
  status,
  onRefresh,
}: {
  capability?: LocalEngineCapability;
  loading: boolean;
  status: LocalEngineFileAccessStatus | null;
  onRefresh: () => Promise<void>;
}) {
  return (
    <Card className="border-small border-divider bg-background shadow-sm">
      <CardBody className="gap-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-medium font-semibold text-default-900">
              文件与凭证
            </h3>
            <p className="mt-1 text-small text-default-500">
              检查素材、截图、排查资料和结果凭证能不能正常读取和保存。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <CapabilityChip status={capability?.status || "missing"} />
            <Button
              size="sm"
              variant="flat"
              isLoading={loading}
              startContent={
                loading ? null : <Icon icon="solar:refresh-linear" />
              }
              onPress={() => {
                onRefresh().catch(() => {
                  addToast({ title: "刷新失败", color: "danger" });
                });
              }}
            >
              刷新
            </Button>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <StatusItem
            label="检查项"
            value={String(status?.summary.total ?? 0)}
          />
          <StatusItem
            label="可访问"
            value={String(status?.summary.ready ?? 0)}
          />
          <StatusItem
            label="需处理"
            value={String(status?.summary.warnings ?? 0)}
          />
        </div>
        {capability ? (
          <div className="rounded-[8px] border-small border-divider bg-default-50 p-4">
            <p className="text-small text-default-700">
              {capability.status === "ready"
                ? "文件读取和保存功能当前可用。"
                : "部分文件功能需要处理。"}
            </p>
            {capability.nextAction ? (
              <p className="mt-2 text-small text-default-500">
                请检查本机文件权限后重新检查。
              </p>
            ) : null}
            <p className="mt-3 text-tiny text-default-400">
              最近检查：{new Date(capability.checkedAt).toLocaleString()}
            </p>
          </div>
        ) : null}
        {loading && !status ? (
          <div className="flex justify-center py-8">
            <Spinner size="sm" />
          </div>
        ) : null}
        <div className="grid gap-4">
          {status?.roots.map((item) => {
            const isReady = item.exists && item.readable;
            return (
              <section
                key={item.key}
                className="rounded-[8px] border-small border-divider bg-default-50 p-4"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip
                        color={isReady ? "success" : "warning"}
                        size="sm"
                        variant="flat"
                      >
                        {isReady ? "可访问" : "需处理"}
                      </Chip>
                      <span className="text-small font-semibold text-default-900">
                        {item.name}
                      </span>
                      <Chip size="sm" variant="flat">
                        {fileKindLabel(item.kind)}
                      </Chip>
                    </div>
                    {item.note ? (
                      <p className="mt-2 text-small text-default-600">
                        {interactionDisplayText(item.note)}
                      </p>
                    ) : null}
                  </div>
                  <div className="grid min-w-[240px] grid-cols-2 gap-2 text-tiny text-default-600">
                    <span>读取：{item.readable ? "正常" : "不可读"}</span>
                    <span>写入：{item.writable ? "正常" : "不可写"}</span>
                    <span>文件：{item.fileCount ?? "-"}</span>
                    <span>目录：{item.directoryCount ?? "-"}</span>
                    <span>大小：{formatBytes(item.sizeBytes)}</span>
                    <span>更新：{formatDate(item.updatedAt)}</span>
                  </div>
                </div>
                {item.recentFiles?.length ? (
                  <>
                    <Divider className="my-3" />
                    <div className="grid gap-2">
                      {item.recentFiles.map((file) => (
                        <div
                          key={file.path}
                          className="flex flex-col gap-1 rounded-small bg-background p-3 md:flex-row md:items-center md:justify-between"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <Icon
                                icon={
                                  file.kind === "directory"
                                    ? "solar:folder-linear"
                                    : "solar:file-text-linear"
                                }
                                width={18}
                              />
                              <span className="truncate text-small text-default-800">
                                {file.name}
                              </span>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2 text-tiny text-default-500">
                            <span>{fileKindLabel(file.kind)}</span>
                            <span>{formatBytes(file.sizeBytes)}</span>
                            <span>{formatDate(file.updatedAt)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : null}
              </section>
            );
          })}
          {!loading && !status ? (
            <div className="rounded-[8px] border-small border-divider bg-default-50 p-4 text-small text-default-500">
              暂未读取到文件访问状态。
            </div>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}
function PermissionCheckPanel({
  capability,
  loading,
  readiness,
  onRefresh,
}: {
  capability?: LocalEngineCapability;
  loading: boolean;
  readiness: LocalEngineReadiness | null;
  onRefresh: () => Promise<void>;
}) {
  const ready = Boolean(readiness?.ready);
  return (
    <Card className="border-small border-divider bg-background shadow-sm">
      <CardBody className="gap-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-medium font-semibold text-default-900">
              使用前检查
            </h3>
            <p className="mt-1 text-small text-default-500">
              在评论、私信、微信回复和发布前，统一检查账号、文件权限和安全设置。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Chip color={ready ? "success" : "warning"} variant="flat">
              {ready ? "可执行" : "需处理"}
            </Chip>
            <Button
              size="sm"
              variant="flat"
              isLoading={loading}
              startContent={
                loading ? null : <Icon icon="solar:refresh-linear" />
              }
              onPress={() => {
                onRefresh().catch(() => {
                  addToast({ title: "刷新失败", color: "danger" });
                });
              }}
            >
              重新检查
            </Button>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-5">
          <StatusItem
            label="需处理项"
            value={String(readiness?.summary.blockers ?? 0)}
          />
          <StatusItem
            label="提醒项"
            value={String(readiness?.summary.warnings ?? 0)}
          />
          <StatusItem
            label="可用账号"
            value={String(readiness?.summary.readyAccounts ?? 0)}
          />
          <StatusItem
            label="失效账号"
            value={String(readiness?.summary.expiredAccounts ?? 0)}
          />
          <StatusItem
            label="文件风险"
            value={String(readiness?.summary.fileWarnings ?? 0)}
          />
        </div>
        {capability ? (
          <div className="rounded-[8px] border-small border-divider bg-default-50 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <CapabilityChip status={capability.status} />
              <span className="text-small font-medium text-default-900">
                安全设置
              </span>
            </div>
            <p className="mt-2 text-small text-default-700">
              {capability.status === "ready"
                ? "当前安全设置可满足任务需要。"
                : "部分安全设置需要处理。"}
            </p>
            {capability.nextAction ? (
              <p className="mt-2 text-small text-default-500">
                完成页面提示的设置后重新检查。
              </p>
            ) : null}
          </div>
        ) : null}
        {loading && !readiness ? (
          <div className="flex justify-center py-8">
            <Spinner size="sm" />
          </div>
        ) : null}
        {readiness ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <ReadinessList
              emptyText="没有必须处理项，可以继续执行本机任务。"
              items={readiness.blockers}
              tone="danger"
              title="必须处理"
            />
            <ReadinessList
              emptyText="没有提醒项。"
              items={readiness.warnings}
              tone="warning"
              title="建议处理"
            />
            <div className="rounded-[8px] border-small border-divider bg-default-50 p-4 lg:col-span-2">
              <p className="text-tiny text-default-400">
                最近检查：{new Date(readiness.checkedAt).toLocaleString()}
              </p>
            </div>
          </div>
        ) : !loading ? (
          <div className="rounded-[8px] border-small border-divider bg-default-50 p-4 text-small text-default-500">
            暂未读取到权限检查结果。
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function ReadinessList({
  emptyText,
  items,
  title,
  tone,
}: {
  emptyText: string;
  items: LocalEngineReadiness["blockers"];
  title: string;
  tone: "danger" | "warning";
}) {
  const color = tone === "danger" ? "danger" : "warning";
  return (
    <section className="rounded-[8px] border-small border-divider bg-default-50 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h4 className="text-small font-semibold text-default-900">{title}</h4>
        <Chip color={color} size="sm" variant="flat">
          {items.length}
        </Chip>
      </div>
      <div className="grid gap-3">
        {items.map((item) => (
          <div
            key={`${item.capability}-${item.message}`}
            className="rounded-small bg-background p-3"
          >
            <p className="text-small font-medium text-default-800">
              {interactionDisplayText(item.capability)}
            </p>
            <p className="mt-1 text-small text-default-600">
              {interactionDisplayText(item.message) || "此项需要处理。"}
            </p>
            {item.nextAction ? (
              <p className="mt-2 text-tiny text-default-400">
                {interactionDisplayText(item.nextAction) || "完成设置后重新检查。"}
              </p>
            ) : null}
          </div>
        ))}
        {!items.length ? (
          <div className="rounded-small bg-background p-3 text-small text-default-500">
            {emptyText}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function InteractionCreatePanel({
  browserStatus,
  executorsStatus,
  route,
  view,
  onCreated,
}: {
  browserStatus: LocalEngineBrowserStatus | null;
  executorsStatus: LocalEngineExecutorsStatus | null;
  route: ActiveInteractionBusinessRouteKey;
  view: (typeof interactionViews)[ActiveInteractionBusinessRouteKey];
  onCreated: () => void;
}) {
  const [submitting, setSubmitting] = React.useState(false);
  const [form, setForm] = React.useState<CreateInteractionTaskInput>({
    type: view.defaultType,
    accountName: `${view.platformLabel}账号`,
    platformType: view.platformType,
    platformName: view.platformLabel,
    targetName: view.defaultTarget,
    sourceText: view.defaultSource,
    replyText: view.defaultReply,
    sendMode: "auto-send",
  });
  const [batchText, setBatchText] = React.useState("");

  React.useEffect(() => {
    setForm((current) => ({
      ...current,
      type: view.defaultType,
      accountId: undefined,
      accountName: `${view.platformLabel}账号`,
      platformType: view.platformType,
      platformName: view.platformLabel,
      targetName:
        current.targetName && current.type === view.defaultType
          ? current.targetName
          : view.defaultTarget,
      sourceText:
        current.sourceText && current.type === view.defaultType
          ? current.sourceText
          : view.defaultSource,
      replyText:
        current.replyText && current.type === view.defaultType
          ? current.replyText
          : view.defaultReply,
      sendMode: current.sendMode || "auto-send",
      followUpMethod:
        view.defaultType === "customer-follow-up"
          ? "wechat"
          : current.followUpMethod,
    }));
  }, [view]);

  const selectedType = taskTypes.find((taskType) => taskType.key === form.type);
  const availableSendModes = sendModes;
  const isDesktopRoute = ["wechat", "groups"].includes(route);
  const readyAccounts =
    route === "customers" || isDesktopRoute
      ? []
      : browserStatus?.accounts.filter(
          (account) =>
            account.status === "ready" && account.type === view.platformType,
        ) || [];
  const hasSelectedLocalAccount = Boolean(form.accountId);
  const selectedExecutor = React.useMemo(
    () =>
      executorsStatus?.executors.find((executor) => executor.key === form.type),
    [executorsStatus?.executors, form.type],
  );
  const blockers = React.useMemo(() => {
    const items: LocalEngineActionBlocker[] = [];
    const platform = view.platformLabel;
    const account = form.accountName || "未选择账号";
    const target = form.targetName || view.defaultTarget;
    if (route !== "customers" && !isDesktopRoute && !readyAccounts.length) {
      items.push({
        platform,
        account: "无可用本机登录账号",
        target,
        stage: "创建真实平台任务",
        reason: `${platform}没有可用登录账号，当前不能创建任务。`,
        nextAction: "先到发布中心-平台账号完成登录或重登，再回来创建任务。",
        capability: "account",
      });
    }
    if (route !== "customers" && !isDesktopRoute && !hasSelectedLocalAccount) {
      items.push({
        platform,
        account,
        target,
        stage: "账号选择",
        reason: "真实平台任务必须绑定一个已登录账号。",
        nextAction: "从账号下拉框选择可用账号；若列表为空，请先登录平台账号。",
        capability: "account",
      });
    }
    if (
      route !== "customers" &&
      (!selectedExecutor || selectedExecutor.status !== "ready")
    ) {
      items.push({
        platform,
        account,
        target,
        stage: "服务能力",
        reason: selectedExecutor
          ? `${selectedExecutor.name}当前为"${executorStatusLabel(selectedExecutor.status)}"，还不能真实读取对象并受控发送。`
          : "没有读取到该任务类型的互动服务。",
        nextAction:
          selectedExecutor?.nextAction ||
          "请到运行检查里重新检查客户互动可用性。",
        capability: "executor",
      });
    }
    return items;
  }, [
    form.accountName,
    form.targetName,
    hasSelectedLocalAccount,
    isDesktopRoute,
    readyAccounts.length,
    route,
    selectedExecutor,
    view.defaultTarget,
    view.platformLabel,
  ]);
  const canSubmit = blockers.length === 0;

  const handleSubmit = async () => {
    if (!canSubmit) {
      addToast({
        title: "任务创建需处理",
        description: blockers[0]?.nextAction || "请先补齐账号和执行权限。",
        color: "warning",
      });
      return;
    }
    setSubmitting(true);
    try {
      const batchTargets = parseBatchTargets(
        batchText,
        view.defaultTarget,
        form.replyText,
      );
      const payload: CreateInteractionTaskInput = {
        ...form,
        batchTargets: batchTargets.length ? batchTargets : undefined,
        targetName: batchTargets[0]?.targetName || form.targetName,
        sourceText: batchTargets[0]?.sourceText || form.sourceText,
        replyText: batchTargets[0]?.replyText || form.replyText,
      };
      const task = await localEngineApi.createBusinessTask(route, payload);
      addToast({
        title: "互动任务已创建",
        description: task.typeLabel,
        color: "success",
      });
      onCreated();
    } catch (e: unknown) {
      addToast({
        title: "创建失败",
        description: formatFailureContext({
          platform: view.platformLabel,
          account: form.accountName || "未选择账号",
          target: form.targetName || view.defaultTarget,
          stage: "创建互动任务",
          reason: shortToastDescription(e),
          nextAction: "检查平台账号、本机助手和客户互动可用性后重试。",
        }),
        color: "danger",
      });
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <Card className="border-small border-divider bg-background shadow-sm">
      <CardBody className="gap-5">
        <div>
          <h3 className="text-medium font-semibold text-default-900">
            {view.title}
          </h3>
          <p className="mt-1 text-small text-default-500">{view.subtitle}</p>
          {selectedType ? (
            <p className="mt-2 text-tiny text-default-400">
              {selectedType.helper}
            </p>
          ) : null}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Select
            label="任务类型"
            selectedKeys={[form.type || view.defaultType]}
            onSelectionChange={(keys) => {
              const value = Array.from(keys)[0] as
                InteractionTaskType | undefined;
              if (value) setForm((current) => ({ ...current, type: value }));
            }}
          >
            {taskTypes
              .filter((taskType) => taskType.key === view.defaultType)
              .map((taskType) => (
                <SelectItem key={taskType.key}>{taskType.label}</SelectItem>
              ))}
          </Select>
          <Select
            label="发送模式"
            selectedKeys={[form.sendMode || "auto-send"]}
            onSelectionChange={(keys) => {
              const value = Array.from(keys)[0] as
                InteractionSendMode | undefined;
              if (value)
                setForm((current) => ({ ...current, sendMode: value }));
            }}
          >
            {availableSendModes.map((mode) => (
              <SelectItem key={mode.key}>{mode.label}</SelectItem>
            ))}
          </Select>
          {readyAccounts.length ? (
            <Select
              label={`${view.platformLabel}账号`}
              placeholder="选择本地已登录账号"
              selectedKeys={form.accountId ? [form.accountId] : []}
              onSelectionChange={(keys) => {
                const value = Array.from(keys)[0] as string | undefined;
                const account = readyAccounts.find(
                  (item) => String(item.id) === value,
                );
                setForm((current) => ({
                  ...current,
                  accountId: value,
                  accountName: account?.displayName || current.accountName,
                  platformType: account?.type || view.platformType,
                  platformName: account?.platform || view.platformLabel,
                }));
              }}
            >
              {readyAccounts.map((account) => (
                <SelectItem key={String(account.id)}>
                  {account.platform} · {account.displayName}
                </SelectItem>
              ))}
            </Select>
          ) : (
            <Input
              label={`${view.platformLabel}账号`}
              value={form.accountName || ""}
              isDisabled={route !== "customers" && !isDesktopRoute}
              description={
                isDesktopRoute
                  ? "桌面微信任务使用本机微信，不需要平台账号。"
                  : route === "customers"
                    ? "客户跟进默认转为桌面微信跟进发送。"
                    : `暂无可用${view.platformLabel}账号，当前不能创建任务。请先到发布中心-平台账号登录。`
              }
              onValueChange={(value) =>
                setForm((current) => ({
                  ...current,
                  accountName: value,
                  platformType: view.platformType,
                  platformName: view.platformLabel,
                }))
              }
            />
          )}
          <Input
            label="目标对象"
            value={form.targetName || ""}
            onValueChange={(value) =>
              setForm((current) => ({ ...current, targetName: value }))
            }
          />
        </div>
        <Textarea
          label={view.sourceLabel}
          minRows={3}
          value={form.sourceText || ""}
          onValueChange={(value) =>
            setForm((current) => ({ ...current, sourceText: value }))
          }
        />
        <Textarea
          label={view.replyLabel}
          minRows={3}
          value={form.replyText || ""}
          onValueChange={(value) =>
            setForm((current) => ({ ...current, replyText: value }))
          }
        />
        {isDesktopRoute ? (
          <div className="rounded-[8px] border-small border-success-200 bg-success-50 p-3 text-small text-success-700">
            <p className="font-semibold">桌面微信执行</p>
            <p className="mt-1">
              默认自动发送；选择确认后发送才停在发送前。目标、内容、窗口或权限不明确时会停下提示，不会伪造成功。
            </p>
          </div>
        ) : null}
        {selectedExecutor ? (
          <div className="rounded-[8px] border-small border-divider bg-default-50 p-3 text-small text-default-600">
            <div className="flex flex-wrap items-center gap-2">
              <ExecutorStatusChip status={selectedExecutor.status} />
              <span className="font-semibold text-default-900">
                {selectedExecutor.name}
              </span>
            </div>
            <p className="mt-1">{selectedExecutor.message}</p>
            <p className="mt-1 text-tiny text-default-500">
              下一步：{selectedExecutor.nextAction}
            </p>
          </div>
        ) : null}
        {blockers.length ? <ActionBlockerList blockers={blockers} /> : null}
        <Textarea
          label="批量对象（可选）"
          minRows={4}
          value={batchText}
          description="每行一个对象；支持“客户名｜留言内容”，不写客户名时会自动编号。"
          placeholder={`张女士｜想了解今天还能预约吗？\n李先生｜价格大概多少？`}
          onValueChange={setBatchText}
        />
        <div className="flex justify-end">
          <Button
            color="primary"
            isDisabled={!canSubmit}
            isLoading={submitting}
            startContent={
              submitting ? null : <Icon icon="solar:play-circle-linear" />
            }
            onPress={handleSubmit}
          >
            {canSubmit
              ? route === "customers"
                ? "创建并微信跟进"
                : "打开入口并创建任务"
              : "需处理，先补齐条件"}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function TasksPanel({
  tasks,
  loading,
  onRefresh,
  recordsOnly,
}: {
  tasks: InteractionTask[];
  loading: boolean;
  onRefresh: () => Promise<void>;
  recordsOnly?: boolean;
}) {
  const visibleTasks = recordsOnly
    ? tasks.filter((task) =>
        ["completed", "failed", "skipped", "no_target"].includes(task.status),
      )
    : tasks;
  const [pendingApprovalTask, setPendingApprovalTask] =
    React.useState<InteractionTask | null>(null);
  const [approvalDraft, setApprovalDraft] = React.useState({
    currentWindowConfirmed: false,
    contactConfirmed: false,
    draftBeforeFillConfirmed: false,
    targetContact: "",
    targetConfirmed: true,
    contentConfirmed: true,
    checklistConfirmed: false,
    commercialPermissionConfirmed: false,
    misfireProtectionConfirmed: false,
    doubleConfirmationConfirmed: false,
    note: "",
  });
  const [approving, setApproving] = React.useState(false);

  const handleAction = async (
    task: InteractionTask,
    action: "approve" | "skip" | "fail" | "retry",
  ) => {
    if (action === "approve" && task.blockers?.length) {
      addToast({
        title: "确认需处理",
        description: commercialDisplayText(task.blockers[0].nextAction),
        color: "warning",
      });
      return;
    }
    if (action === "approve") {
      setPendingApprovalTask(task);
      setApprovalDraft({
        currentWindowConfirmed: !isDesktopInteractionTask(task.type),
        contactConfirmed: !isDesktopInteractionTask(task.type),
        draftBeforeFillConfirmed: !isDesktopInteractionTask(task.type),
        targetContact: isDesktopInteractionTask(task.type)
          ? task.targetName
          : "",
        targetConfirmed: true,
        contentConfirmed: true,
        checklistConfirmed: false,
        commercialPermissionConfirmed:
          task.safetyBoundary?.permissionStatus === "allowed",
        misfireProtectionConfirmed: false,
        doubleConfirmationConfirmed: !task.requiresDoubleConfirmation,
        note: "",
      });
      return;
    }
    try {
      if (action === "skip") await localEngineApi.skipTask(task.id);
      if (action === "fail")
        await localEngineApi.failTask(task.id, "用户停止任务");
      if (action === "retry") {
        const retryTask = await localEngineApi.retryTask(task.id);
        addToast({
          title: "已创建重试任务",
          description: retryTask.typeLabel,
          color: "success",
        });
      }
      await onRefresh();
    } catch (e: unknown) {
      addToast({
        title: "操作失败",
        description: formatFailureContext({
          platform: task.platformName || task.typeLabel,
          account: task.accountName,
          target: task.targetName,
          stage: task.diagnostics?.currentStep || task.statusLabel,
          reason: shortToastDescription(e),
          nextAction:
            task.nextAction || "刷新任务状态，检查账号/服务/权限后重试。",
        }),
        color: "danger",
      });
    }
  };

  const confirmApproval = async () => {
    if (!pendingApprovalTask) return;
    if (pendingApprovalTask.blockers?.length) {
      addToast({
        title: "确认需处理",
        description: commercialDisplayText(
          pendingApprovalTask.blockers[0].nextAction,
        ),
        color: "warning",
      });
      return;
    }
    setApproving(true);
    try {
      await localEngineApi.approveTask(pendingApprovalTask.id, {
        operator: "当前登录用户",
        currentWindowConfirmed: approvalDraft.currentWindowConfirmed,
        contactConfirmed: approvalDraft.contactConfirmed,
        draftBeforeFillConfirmed: approvalDraft.draftBeforeFillConfirmed,
        targetContact: approvalDraft.targetContact,
        targetConfirmed: approvalDraft.targetConfirmed,
        contentConfirmed: approvalDraft.contentConfirmed,
        checklistConfirmed: approvalDraft.checklistConfirmed,
        commercialPermissionConfirmed:
          approvalDraft.commercialPermissionConfirmed,
        misfireProtectionConfirmed: approvalDraft.misfireProtectionConfirmed,
        doubleConfirmationConfirmed: approvalDraft.doubleConfirmationConfirmed,
        riskConfirmation: buildLocalEngineRiskConfirmation(
          "interaction-approval",
          pendingApprovalTask.riskLevel || "medium",
          `用户确认继续执行 ${pendingApprovalTask.typeLabel || pendingApprovalTask.type}：${pendingApprovalTask.targetName}`,
        ),
        note: approvalDraft.note,
      });
      setPendingApprovalTask(null);
      await onRefresh();
    } catch (e: unknown) {
      addToast({
        title: "确认失败",
        description: formatFailureContext({
          platform:
            pendingApprovalTask.platformName || pendingApprovalTask.typeLabel,
          account: pendingApprovalTask.accountName,
          target: pendingApprovalTask.targetName,
          stage: "继续受控执行",
          reason: shortToastDescription(e),
          nextAction:
            pendingApprovalTask.nextAction ||
            "重新核对窗口、目标和内容后继续。",
        }),
        color: "danger",
      });
    } finally {
      setApproving(false);
    }
  };
  return (
    <>
      <Card className="border-small border-divider bg-background shadow-sm">
        <CardBody className="gap-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-medium font-semibold text-default-900">
                {recordsOnly ? "回复记录" : "互动任务"}
              </h3>
              <p className="mt-1 text-small text-default-500">
                显示每条互动任务的阶段、结果、结果留存和下一步动作。
              </p>
            </div>
            <Button
              variant="flat"
              isLoading={loading}
              startContent={
                loading ? null : <Icon icon="solar:refresh-linear" />
              }
              onPress={() => {
                onRefresh().catch(() => {
                  addToast({ title: "刷新失败", color: "danger" });
                });
              }}
            >
              刷新
            </Button>
          </div>
          <div className="grid gap-4">
            {visibleTasks.map((task) => (
              <TaskCard key={task.id} task={task} onAction={handleAction} />
            ))}
            {!loading && !visibleTasks.length ? (
              <div className="rounded-[8px] border-small border-divider bg-default-50 p-4 text-small text-default-500">
                暂无{recordsOnly ? "回复记录" : "互动任务"}。
              </div>
            ) : null}
            {loading ? (
              <div className="flex justify-center py-8">
                <Spinner size="sm" />
              </div>
            ) : null}
          </div>
        </CardBody>
      </Card>
      <ApprovalConfirmModal
        isOpen={Boolean(pendingApprovalTask)}
        isLoading={approving}
        task={pendingApprovalTask}
        draft={approvalDraft}
        onDraftChange={setApprovalDraft}
        onClose={() => {
          if (!approving) setPendingApprovalTask(null);
        }}
        onConfirm={confirmApproval}
      />
    </>
  );
}

function ApprovalConfirmModal({
  isOpen,
  isLoading,
  task,
  draft,
  onDraftChange,
  onClose,
  onConfirm,
}: {
  isOpen: boolean;
  isLoading: boolean;
  task: InteractionTask | null;
  draft: {
    currentWindowConfirmed: boolean;
    contactConfirmed: boolean;
    draftBeforeFillConfirmed: boolean;
    targetContact: string;
    targetConfirmed: boolean;
    contentConfirmed: boolean;
    checklistConfirmed: boolean;
    commercialPermissionConfirmed: boolean;
    misfireProtectionConfirmed: boolean;
    doubleConfirmationConfirmed: boolean;
    note: string;
  };
  onDraftChange: React.Dispatch<
    React.SetStateAction<{
      currentWindowConfirmed: boolean;
      contactConfirmed: boolean;
      draftBeforeFillConfirmed: boolean;
      targetContact: string;
      targetConfirmed: boolean;
      contentConfirmed: boolean;
      checklistConfirmed: boolean;
      commercialPermissionConfirmed: boolean;
      misfireProtectionConfirmed: boolean;
      doubleConfirmationConfirmed: boolean;
      note: string;
    }>
  >;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const isWechatTask = task ? isDesktopInteractionTask(task.type) : false;
  const requiresCommercialPermission =
    task?.safetyBoundary?.permissionStatus !== "allowed";
  const requiresDoubleConfirmation = Boolean(task?.requiresDoubleConfirmation);

  return (
    <Modal
      isOpen={isOpen}
      size="2xl"
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1">
          <span>{isWechatTask ? "继续微信会话执行" : "继续受控执行"}</span>
          <span className="text-small font-normal text-default-500">
            系统会核对目标、内容和窗口；异常会停止并留下记录。
          </span>
        </ModalHeader>
        <ModalBody>
          {task ? (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <StatusItem
                  label="平台"
                  value={task.platformName || task.typeLabel}
                />
                <StatusItem label="账号" value={task.accountName} />
                <StatusItem label="目标" value={task.targetName} />
              </div>
              <div className="rounded-[8px] border-small border-warning-200 bg-warning-50 p-3 text-small text-warning-700">
                <p className="font-semibold">执行前检查</p>
                <p className="mt-1">
                  系统会核对账号、目标对象和内容。目标、窗口或内容不一致时会停止，不会盲目发送。
                </p>
              </div>
              {task.safetyBoundary ? (
                <div className="rounded-[8px] border-small border-warning-200 bg-warning-50 p-3 text-small text-warning-700">
                  <p className="font-semibold">试用/商用边界</p>
                  <p className="mt-1">{task.safetyBoundary.message}</p>
                  <p className="mt-2 text-tiny">
                    当前版本：
                    {task.safetyBoundary.planMode === "commercial"
                      ? "正式商用"
                      : "试用版"}
                    ；正式商用执行权限：
                    {permissionStatusLabel[
                      task.safetyBoundary.permissionStatus
                    ] || task.safetyBoundary.permissionStatus}
                  </p>
                </div>
              ) : null}
              {task.misfireProtection ? (
                <div className="rounded-[8px] border-small border-danger-200 bg-danger-50 p-3 text-small text-danger-700">
                  <p className="font-semibold">误发误删保护</p>
                  <p className="mt-1">{task.misfireProtection.warning}</p>
                  <p className="mt-2 text-tiny">
                    发送保护：
                    {task.misfireProtection.sendProtected ? "开启" : "未开启"}
                    ；删除保护：
                    {task.misfireProtection.deleteProtected ? "开启" : "未开启"}
                  </p>
                </div>
              ) : null}
              {task.riskChecklist?.length ? (
                <div className="grid gap-2 md:grid-cols-2">
                  {task.riskChecklist.map((check) => (
                    <div
                      key={check.key}
                      className="rounded-small border-small border-divider bg-default-50 p-3 text-small text-default-600"
                    >
                      <div className="flex items-center gap-2">
                        <Icon
                          icon={
                            check.blocking
                              ? "solar:shield-warning-linear"
                              : "solar:check-circle-linear"
                          }
                        />
                        <span>{check.label}</span>
                      </div>
                      {check.hint ? (
                        <p className="mt-1 text-tiny text-default-400">
                          {check.hint}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
              {isWechatTask ? (
                <div className="rounded-[8px] border-small border-danger-200 bg-danger-50 p-3 text-small text-danger-700">
                  <p className="font-semibold">微信会话结果确认</p>
                  <p className="mt-1">
                    微信没有网页后台对象锁定，执行前会读取当前会话并核对目标；不一致会停止并留下记录。
                  </p>
                  <Input
                    className="mt-3"
                    label="确认联系人"
                    placeholder="当前微信会话里的客户名称"
                    value={draft.targetContact}
                    onValueChange={(value) =>
                      onDraftChange((current) => ({
                        ...current,
                        targetContact: value,
                      }))
                    }
                  />
                  <Switch
                    className="mt-3"
                    color="danger"
                    isSelected={draft.currentWindowConfirmed}
                    onValueChange={(value) =>
                      onDraftChange((current) => ({
                        ...current,
                        currentWindowConfirmed: value,
                      }))
                    }
                  >
                    我已确认当前微信会话就是目标客户
                  </Switch>
                  <Switch
                    className="mt-3"
                    color="danger"
                    isSelected={draft.contactConfirmed}
                    onValueChange={(value) =>
                      onDraftChange((current) => ({
                        ...current,
                        contactConfirmed: value,
                      }))
                    }
                  >
                    我已核对联系人/当前窗口标题
                  </Switch>
                  <Switch
                    className="mt-3"
                    color="danger"
                    isSelected={draft.draftBeforeFillConfirmed}
                    onValueChange={(value) =>
                      onDraftChange((current) => ({
                        ...current,
                        draftBeforeFillConfirmed: value,
                      }))
                    }
                  >
                    我确认现在可以继续执行微信动作
                  </Switch>
                </div>
              ) : null}
              <div className="grid gap-3 md:grid-cols-2">
                <Switch
                  isSelected={draft.targetConfirmed}
                  onValueChange={(value) =>
                    onDraftChange((current) => ({
                      ...current,
                      targetConfirmed: value,
                    }))
                  }
                >
                  已确认目标对象
                </Switch>
                <Switch
                  isSelected={draft.contentConfirmed}
                  onValueChange={(value) =>
                    onDraftChange((current) => ({
                      ...current,
                      contentConfirmed: value,
                    }))
                  }
                >
                  已确认草稿内容
                </Switch>
                <Switch
                  isSelected={draft.checklistConfirmed}
                  onValueChange={(value) =>
                    onDraftChange((current) => ({
                      ...current,
                      checklistConfirmed: value,
                    }))
                  }
                >
                  已逐项核对检查项
                </Switch>
                <Switch
                  isSelected={draft.misfireProtectionConfirmed}
                  onValueChange={(value) =>
                    onDraftChange((current) => ({
                      ...current,
                      misfireProtectionConfirmed: value,
                    }))
                  }
                >
                  已确认误发误删保护
                </Switch>
                {requiresCommercialPermission ? (
                  <Switch
                    isSelected={draft.commercialPermissionConfirmed}
                    onValueChange={(value) =>
                      onDraftChange((current) => ({
                        ...current,
                        commercialPermissionConfirmed: value,
                      }))
                    }
                  >
                    已确认试用限制/商用执行权限
                  </Switch>
                ) : null}
                {requiresDoubleConfirmation ? (
                  <Switch
                    color="danger"
                    isSelected={draft.doubleConfirmationConfirmed}
                    onValueChange={(value) =>
                      onDraftChange((current) => ({
                        ...current,
                        doubleConfirmationConfirmed: value,
                      }))
                    }
                  >
                    高风险继续执行保护
                  </Switch>
                ) : null}
              </div>
              <Textarea
                label="确认备注"
                minRows={2}
                placeholder="可选，例如：已核对当前窗口和回复内容"
                value={draft.note}
                onValueChange={(value) =>
                  onDraftChange((current) => ({ ...current, note: value }))
                }
              />
              {task.diagnostics ? (
                <div className="rounded-[8px] border-small border-divider bg-default-50 p-3 text-small text-default-700">
                  <p className="font-semibold">当前情况</p>
                  <p className="mt-1">
                    {commercialDisplayText(task.diagnostics.summary)}
                  </p>
                  <p className="mt-1 text-tiny text-default-500">
                    卡点：{task.diagnostics.currentStep || "无"} / 记录：
                    {task.diagnostics.evidenceCount} 条
                  </p>
                </div>
              ) : null}
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-[8px] bg-default-50 p-3">
                  <p className="text-tiny text-default-400">客户内容</p>
                  <p className="mt-2 whitespace-pre-wrap text-small text-default-700">
                    {task.sourceText}
                  </p>
                </div>
                <div className="rounded-[8px] bg-default-50 p-3">
                  <p className="text-tiny text-default-400">将填入的草稿</p>
                  <p className="mt-2 whitespace-pre-wrap text-small font-medium text-default-900">
                    {task.replyText}
                  </p>
                </div>
              </div>
            </div>
          ) : null}
        </ModalBody>
        <ModalFooter>
          <Button isDisabled={isLoading} variant="flat" onPress={onClose}>
            取消
          </Button>
          <Button
            color="primary"
            isDisabled={
              !draft.targetConfirmed ||
              !draft.contentConfirmed ||
              !draft.checklistConfirmed ||
              !draft.misfireProtectionConfirmed ||
              (requiresCommercialPermission &&
                !draft.commercialPermissionConfirmed) ||
              (requiresDoubleConfirmation &&
                !draft.doubleConfirmationConfirmed) ||
              (isWechatTask &&
                (!draft.currentWindowConfirmed ||
                  !draft.contactConfirmed ||
                  !draft.draftBeforeFillConfirmed ||
                  !draft.targetContact.trim()))
            }
            isLoading={isLoading}
            onPress={onConfirm}
          >
            继续执行
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function RecordsPanel({
  tasks,
  loading,
  summary,
  onRefresh,
}: {
  tasks: InteractionTask[];
  loading: boolean;
  summary: InteractionRecordsSummary;
  onRefresh: (filters: {
    status:
      | "all"
      | Extract<
          InteractionTask["status"],
          "completed" | "failed" | "skipped" | "no_target"
        >;
    type: "all" | InteractionTaskType;
  }) => Promise<void>;
}) {
  const [statusFilter, setStatusFilter] = React.useState<
    | "all"
    | Extract<
        InteractionTask["status"],
        "completed" | "failed" | "skipped" | "no_target"
      >
  >("all");
  const [typeFilter, setTypeFilter] = React.useState<
    "all" | InteractionTaskType
  >("all");
  const [selectedTask, setSelectedTask] =
    React.useState<InteractionTask | null>(null);
  const [exporting, setExporting] = React.useState(false);
  const [cleanupPreview, setCleanupPreview] =
    React.useState<InteractionEvidenceCleanupResult | null>(null);
  const [retentionDays, setRetentionDays] = React.useState("7");
  const [cleanupLoading, setCleanupLoading] = React.useState(false);

  const refreshWithCurrentFilters = React.useCallback(
    (
      nextFilters?: Partial<{
        status: typeof statusFilter;
        type: typeof typeFilter;
      }>,
    ) =>
      onRefresh({
        status: nextFilters?.status || statusFilter,
        type: nextFilters?.type || typeFilter,
      }),
    [onRefresh, statusFilter, typeFilter],
  );

  const handleExport = React.useCallback(async () => {
    setExporting(true);
    try {
      const result = await localEngineApi.exportRecords({
        status: statusFilter === "all" ? undefined : statusFilter,
        type: typeFilter === "all" ? undefined : typeFilter,
      });
      const blob = new Blob([result.content], { type: result.mimeType });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      addToast({
        title: "导出完成",
        description: `已导出 ${result.summary.total} 条回复记录`,
        color: "success",
      });
    } catch (e: unknown) {
      addToast({
        title: "导出失败",
        description: shortToastDescription(e),
        color: "danger",
      });
    } finally {
      setExporting(false);
    }
  }, [statusFilter, typeFilter]);

  const previewCleanup = React.useCallback(async () => {
    setCleanupLoading(true);
    try {
      const result = await localEngineApi.previewEvidenceCleanup(
        Number(retentionDays) || 7,
      );
      setCleanupPreview(result);
    } catch (e: unknown) {
      addToast({
        title: "记录清理预览失败",
        description: shortToastDescription(e),
        color: "danger",
      });
    } finally {
      setCleanupLoading(false);
    }
  }, [retentionDays]);

  const runCleanup = React.useCallback(async () => {
    setCleanupLoading(true);
    try {
      const result = await localEngineApi.cleanupEvidence(
        Number(retentionDays) || 7,
        buildLocalEngineRiskConfirmation(
          "local-file-delete",
          "high",
          "用户在本机检查页面确认清理旧记录",
        ),
      );
      setCleanupPreview(result);
      addToast({
        title: "记录清理完成",
        description: `已清理 ${result.deletedCount} 个文件`,
        color: "success",
      });
    } catch (e: unknown) {
      addToast({
        title: "记录清理失败",
        description: shortToastDescription(e),
        color: "danger",
      });
    } finally {
      setCleanupLoading(false);
    }
  }, [retentionDays]);
  return (
    <>
      <Card className="border-small border-divider bg-background shadow-sm">
        <CardBody className="gap-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-medium font-semibold text-default-900">
                回复记录
              </h3>
              <p className="mt-1 text-small text-default-500">
                按任务结果查看每次互动回复，重点看状态、失败原因、结果留存和更新时间。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="flat"
                isLoading={exporting}
                startContent={
                  exporting ? null : (
                    <Icon icon="solar:download-minimalistic-linear" />
                  )
                }
                onPress={handleExport}
              >
                导出 CSV
              </Button>
              <Button
                variant="flat"
                isLoading={loading}
                startContent={
                  loading ? null : <Icon icon="solar:refresh-linear" />
                }
                onPress={() => {
                  refreshWithCurrentFilters().catch(() => {
                    addToast({ title: "刷新失败", color: "danger" });
                  });
                }}
              >
                刷新
              </Button>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-6">
            <StatusItem label="全部记录" value={String(summary.total)} />
            <StatusItem label="已完成" value={String(summary.completed)} />
            <StatusItem label="失败" value={String(summary.failed)} />
            <StatusItem label="已跳过" value={String(summary.skipped)} />
            <StatusItem label="无对象" value={String(summary.noTarget)} />
            <StatusItem label="记录数" value={String(summary.evidenceCount)} />
          </div>
          <div className="grid gap-3 md:grid-cols-[220px_220px_1fr] md:items-end">
            <Select
              label="状态"
              selectedKeys={[statusFilter]}
              size="sm"
              onSelectionChange={(keys) => {
                const value = Array.from(keys)[0] as
                  typeof statusFilter | undefined;
                if (value) {
                  setStatusFilter(value);
                  onRefresh({ status: value, type: typeFilter }).catch(() => {
                    addToast({ title: "筛选失败", color: "danger" });
                  });
                }
              }}
            >
              <SelectItem key="all">全部状态</SelectItem>
              <SelectItem key="completed">已完成</SelectItem>
              <SelectItem key="failed">失败</SelectItem>
              <SelectItem key="skipped">已跳过</SelectItem>
              <SelectItem key="no_target">无对象</SelectItem>
            </Select>
            <Select
              label="类型"
              selectedKeys={[typeFilter]}
              size="sm"
              onSelectionChange={(keys) => {
                const value = Array.from(keys)[0] as
                  typeof typeFilter | undefined;
                if (value) {
                  setTypeFilter(value);
                  onRefresh({ status: statusFilter, type: value }).catch(() => {
                    addToast({ title: "筛选失败", color: "danger" });
                  });
                }
              }}
            >
              <SelectItem key="all">全部类型</SelectItem>
              <SelectItem key="douyin-comment-reply">抖音自动评论</SelectItem>
              <SelectItem key="douyin-direct-message-reply">
                抖音私信回复
              </SelectItem>
              <SelectItem key="wechat-channel-comment-reply">
                视频号评论回复
              </SelectItem>
              <SelectItem key="wechat-channel-direct-message-reply">
                视频号私信回复
              </SelectItem>
              <SelectItem key="customer-follow-up">客户跟进</SelectItem>
            </Select>
            <p className="text-small text-default-500">
              当前显示 {tasks.length} 条，点击“详情”查看步骤记录和截图。
              {summary.lastUpdatedAt
                ? ` 最近更新：${formatDate(summary.lastUpdatedAt)}`
                : ""}
            </p>
          </div>
          <Table
            aria-label="回复记录表"
            classNames={{
              wrapper: "border-small border-divider shadow-none",
              th: "bg-default-50 text-default-500",
            }}
          >
            <TableHeader>
              <TableColumn>状态</TableColumn>
              <TableColumn>类型 / 平台</TableColumn>
              <TableColumn>账号 / 目标</TableColumn>
              <TableColumn>摘要</TableColumn>
              <TableColumn>记录</TableColumn>
              <TableColumn>更新时间</TableColumn>
              <TableColumn>操作</TableColumn>
            </TableHeader>
            <TableBody
              emptyContent={
                loading ? (
                  "正在读取回复记录..."
                ) : (
                  <FunctionalEmptyState
                    actions={[
                      { href: "/engagement", label: "客户互动" },
                    ]}
                    description="还没有互动回复记录。执行评论、私信或微信任务后，这里会显示状态、摘要、记录和更新时间。"
                    examples={["评论回复", "私信回复", "微信互动", "更新时间"]}
                    surface="plain"
                    title="当前没有回复记录"
                  />
                )
              }
              items={tasks}
            >
              {(task) => (
                <TableRow key={task.id}>
                  <TableCell>
                    <StatusChip status={task.status} label={task.statusLabel} />
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <p className="text-small font-medium text-default-800">
                        {task.typeLabel}
                      </p>
                      <p className="text-tiny text-default-400">
                        {task.platformName || "本地互动"}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="max-w-[190px] space-y-1">
                      <p className="truncate text-small text-default-800">
                        {task.accountName}
                      </p>
                      <p className="truncate text-tiny text-default-400">
                        {(task.batchTargets?.length || 0) > 1
                          ? `批量 ${task.batchTargets?.length} 条，首条：${task.targetName}`
                          : task.targetName}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="max-w-[320px] space-y-1">
                      <p className="truncate text-small text-default-700">
                        {interactionDisplayText(
                          task.resultSummary?.headline ||
                            task.nextAction ||
                            task.diagnostics?.summary ||
                            "已记录互动结果",
                        )}
                      </p>
                      <p className="truncate text-tiny text-default-400">
                        {interactionDisplayText(
                          task.resultSummary?.nextAction || task.replyText,
                        )}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Chip size="sm" variant="flat">
                      {task.events.filter((event) => event.evidence).length}条
                    </Chip>
                  </TableCell>
                  <TableCell>
                    <span className="text-tiny text-default-500">
                      {formatDate(task.completedAt || task.updatedAt)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="flat"
                      onPress={() => setSelectedTask(task)}
                    >
                      详情
                    </Button>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardBody>
      </Card>
      <Card className="border-small border-divider bg-background shadow-sm">
        <CardBody className="gap-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h3 className="text-medium font-semibold text-default-900">
                记录文件管理
              </h3>
              <p className="mt-1 text-small text-default-500">
                只清理本机互动记录目录里的旧截图和页面记录，不删除回复记录。
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <Input
                className="w-32"
                label="保留天数"
                min={0}
                size="sm"
                type="number"
                value={retentionDays}
                onValueChange={setRetentionDays}
              />
              <Button
                variant="flat"
                isLoading={cleanupLoading}
                startContent={
                  cleanupLoading ? null : <Icon icon="solar:eye-linear" />
                }
                onPress={previewCleanup}
              >
                预览清理
              </Button>
              <Button
                color="danger"
                variant="flat"
                isDisabled={!cleanupPreview?.candidateCount}
                isLoading={cleanupLoading}
                startContent={
                  cleanupLoading ? null : (
                    <Icon icon="solar:trash-bin-trash-linear" />
                  )
                }
                onPress={runCleanup}
              >
                清理旧记录
              </Button>
            </div>
          </div>
          {cleanupPreview ? (
            <div className="grid gap-3 md:grid-cols-4">
              <StatusItem
                label="记录目录文件"
                value={String(cleanupPreview.status.fileCount)}
              />
              <StatusItem
                label="目录大小"
                value={formatBytes(cleanupPreview.status.totalBytes)}
              />
              <StatusItem
                label={cleanupPreview.execute ? "已清理" : "可清理"}
                value={`${cleanupPreview.execute ? cleanupPreview.deletedCount : cleanupPreview.candidateCount} 个`}
              />
              <StatusItem
                label="预计释放"
                value={formatBytes(cleanupPreview.totalBytes)}
              />
            </div>
          ) : (
            <div className="rounded-small bg-default-50 p-3 text-small text-default-500">
              先点击“预览清理”，确认旧记录数量和大小后再执行清理。
            </div>
          )}
          {cleanupPreview?.directory ? (
            <p className="break-all text-tiny text-default-400">
              目录：{cleanupPreview.directory}
            </p>
          ) : null}
          {cleanupPreview?.files?.length ? (
            <div className="max-h-44 overflow-auto rounded-small border-small border-divider bg-default-50 p-3">
              {cleanupPreview.files.slice(0, 8).map((file) => (
                <div
                  key={file.path}
                  className="flex flex-col gap-1 border-b border-divider py-2 last:border-0 md:flex-row md:items-center md:justify-between"
                >
                  <span className="break-all text-small text-default-700">
                    {file.name}
                  </span>
                  <span className="text-tiny text-default-400">
                    {formatBytes(file.sizeBytes)} /{formatDate(file.updatedAt)}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          {cleanupPreview?.errors?.length ? (
            <div className="rounded-small bg-danger-50 p-3 text-small text-danger-700">
              {cleanupPreview.errors.join("；")}
            </div>
          ) : null}
        </CardBody>
      </Card>
      <Modal
        isOpen={Boolean(selectedTask)}
        size="5xl"
        scrollBehavior="inside"
        onOpenChange={(open) => {
          if (!open) setSelectedTask(null);
        }}
      >
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            <span>回复记录详情</span>
            <span className="text-small font-normal text-default-500">
              查看步骤、原因、原文、草稿和结果留存。
            </span>
          </ModalHeader>
          <ModalBody>
            {selectedTask ? (
              <TaskCard task={selectedTask} onAction={async () => undefined} />
            ) : null}
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={() => setSelectedTask(null)}>
              关闭
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}

function TaskCard({
  task,
  onAction,
}: {
  task: InteractionTask;
  onAction: (
    task: InteractionTask,
    action: "approve" | "skip" | "fail" | "retry",
  ) => Promise<void>;
}) {
  const canDecide = [
    "queued",
    "running",
    "waiting_for_send_confirmation",
  ].includes(task.status);
  const canRetry = ["failed", "skipped"].includes(task.status);
  const diagnostics = task.diagnostics;
  const resultSummary = task.resultSummary;
  const isBatchTask = (task.batchTargets?.length || 0) > 1;
  const failureContext = deriveTaskFailureContext(task);
  const [exportingDiagnostics, setExportingDiagnostics] = React.useState(false);
  const diagnosticTone =
    diagnostics?.status === "blocked"
      ? "border-danger-200 bg-danger-50 text-danger-700"
      : diagnostics?.status === "waiting"
        ? "border-warning-200 bg-warning-50 text-warning-700"
        : diagnostics?.status === "completed"
          ? "border-success-200 bg-success-50 text-success-700"
          : "border-divider bg-background text-default-700";
  return (
    <section className="rounded-[8px] border-small border-divider bg-default-50 p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Chip size="sm" variant="flat">
              {task.typeLabel}
            </Chip>
            <Chip
              color={
                task.executionMode === "browser-assisted"
                  ? "primary"
                  : "default"
              }
              size="sm"
              variant="flat"
            >
              {task.executionMode === "browser-assisted"
                ? "账号后台"
                : "内部记录"}
            </Chip>
            {task.runtimeState ? (
              <RuntimeStateChip state={task.runtimeState} />
            ) : null}
            {task.platformName ? (
              <Chip size="sm" variant="flat">
                {task.platformName}
              </Chip>
            ) : null}
            {resultSummary ? (
              <Chip
                color={resultSummaryChipColor(resultSummary.kind)}
                size="sm"
                variant="flat"
              >
            {interactionDisplayText(resultSummary.headline)}
              </Chip>
            ) : null}
            {isBatchTask ? (
              <Chip color="secondary" size="sm" variant="flat">
                批量 {task.batchTargets?.length} 条
              </Chip>
            ) : null}
            <Chip size="sm" variant="flat">
              {sendModeLabel(task.sendMode)}
            </Chip>
            <StatusChip status={task.status} label={task.statusLabel} />
          </div>
          <h4 className="mt-3 text-medium font-semibold text-default-900">
            {interactionDisplayText(task.accountName)} {"->"}{" "}
            {interactionDisplayText(task.targetName)}
          </h4>
          <p className="mt-1 text-small text-default-500">
            {interactionDisplayText(task.nextAction || "等待下一步动作")}
          </p>
          {task.failureReason ? (
            <p className="mt-2 text-small text-danger">
              {interactionDisplayText(task.failureReason)}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            as={Link}
            href={
              isDesktopInteractionTask(task.type)
                ? "/local-engine?tab=desktop"
                : "/local-engine?tab=browser"
            }
            size="sm"
            variant="flat"
            startContent={
              <Icon
                icon={
                  isDesktopInteractionTask(task.type)
                    ? "solar:monitor-linear"
                    : "solar:window-frame-linear"
                }
              />
            }
          >
            {isDesktopInteractionTask(task.type)
              ? "微信桌面检查"
              : "平台账号检查"}
          </Button>
          <Button
            size="sm"
            variant="flat"
            isLoading={exportingDiagnostics}
            startContent={
              exportingDiagnostics ? null : (
                <Icon icon="solar:download-minimalistic-linear" />
              )
            }
            onPress={() => {
              setExportingDiagnostics(true);
              localEngineApi
                .exportTaskDiagnostics(task.id)
                .then((result) => {
                  downloadTextFile(
                    result.filename,
                    result.content,
                    result.mimeType,
                  );
                  addToast({
                    title: "排查资料已导出",
                    description: result.filename,
                    color: "success",
                  });
                })
                .catch((e: unknown) => {
                  addToast({
                    title: "排查资料导出失败",
                    description: shortToastDescription(e),
                    color: "danger",
                  });
                })
                .finally(() => setExportingDiagnostics(false));
            }}
          >
            排查资料
          </Button>
          {canDecide ? (
            <>
              <Button
                color="primary"
                size="sm"
                variant="flat"
                isDisabled={
                  task.status !== "waiting_for_send_confirmation" ||
                  Boolean(task.blockers?.length)
                }
                onPress={() => onAction(task, "approve")}
              >
                确认
              </Button>
              <Button
                size="sm"
                variant="flat"
                onPress={() => onAction(task, "skip")}
              >
                跳过
              </Button>
              <Button
                color="danger"
                size="sm"
                variant="flat"
                onPress={() => onAction(task, "fail")}
              >
                停止
              </Button>
            </>
          ) : canRetry ? (
            <Button
              color="primary"
              size="sm"
              variant="flat"
              startContent={<Icon icon="solar:restart-linear" />}
              onPress={() => onAction(task, "retry")}
            >
              重试
            </Button>
          ) : null}
        </div>
      </div>
      {task.blockers?.length ? (
        <ActionBlockerList blockers={task.blockers} />
      ) : null}
      {failureContext ? <FailureContextBox context={failureContext} /> : null}
      {diagnostics ? (
        <div
          className={`mt-4 rounded-[8px] border-small p-3 ${diagnosticTone}`}
        >
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-small font-semibold">执行详情</p>
              <p className="mt-1 text-small">
                {commercialDisplayText(diagnostics.summary)}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-tiny md:min-w-[320px]">
              <span>平台：{diagnostics.platform}</span>
              <span>账号：{diagnostics.account}</span>
              <span>卡点：{diagnostics.currentStep || "无"}</span>
              <span>记录：{diagnostics.evidenceCount} 条</span>
            </div>
          </div>
          {diagnostics.failureReason ? (
            <p className="mt-2 text-tiny">
              失败原因：{commercialDisplayText(diagnostics.failureReason)}
            </p>
          ) : null}
          {diagnostics.nextAction ? (
            <p className="mt-1 text-tiny">
              下一步：{commercialDisplayText(diagnostics.nextAction)}
            </p>
          ) : null}
        </div>
      ) : null}
      {resultSummary ? (
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1.4fr_auto] md:items-center">
          <div
            className={`rounded-[8px] border-small p-3 ${resultSummaryTone(resultSummary.kind)}`}
          >
            <p className="text-small font-semibold">{resultSummary.headline}</p>
            <p className="mt-1 text-tiny">{resultSummary.detail}</p>
          </div>
          <div className="rounded-[8px] border-small border-divider bg-background p-3 text-small text-default-700">
            <p className="font-semibold">下一步建议</p>
            <p className="mt-1 text-tiny text-default-500">
              {resultSummary.nextAction}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              as={Link}
              href="/local-engine?tab=tasks"
              size="sm"
              variant="flat"
            >
              本页任务
            </Button>
            <Button
              as={Link}
              href={resultSummary.evidenceHref || "/local-engine?tab=evidence"}
              size="sm"
              variant="flat"
            >
              结果留存
            </Button>
          </div>
        </div>
      ) : null}
      {task.safetyBoundary || task.riskPolicy || task.misfireProtection ? (
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {task.safetyBoundary ? (
            <div className="rounded-[8px] border-small border-warning-200 bg-warning-50 p-3 text-small text-warning-700">
              <p className="font-semibold">试用/商用权限</p>
              <p className="mt-1">{task.safetyBoundary.message}</p>
              <p className="mt-1 text-tiny">
                {task.safetyBoundary.planMode === "commercial"
                  ? "正式商用"
                  : "试用版"}
                ；
                {permissionStatusLabel[task.safetyBoundary.permissionStatus] ||
                  task.safetyBoundary.permissionStatus}
              </p>
            </div>
          ) : null}
          {task.riskPolicy ? (
            <div className="rounded-[8px] border-small border-divider bg-background p-3 text-small text-default-700">
              <p className="font-semibold text-default-900">
                角色/白名单/禁止动作
              </p>
              <p className="mt-1">{task.riskPolicy.message}</p>
              <p className="mt-1 text-tiny text-default-500">
                审批角色：{task.riskPolicy.requiredRole}
                ；白名单：
                {(task.riskPolicy.whitelistTargets || []).join("、") || "-"}
              </p>
              {(task.riskPolicy.forbiddenActions || []).length ? (
                <p className="mt-1 text-tiny text-danger-600">
                  禁止动作：
                  {(task.riskPolicy.forbiddenActions || []).join("、")}
                </p>
              ) : null}
            </div>
          ) : null}
          {task.misfireProtection ? (
            <div className="rounded-[8px] border-small border-danger-200 bg-danger-50 p-3 text-small text-danger-700">
              <p className="font-semibold">误发误删保护</p>
              <p className="mt-1">{task.misfireProtection.warning}</p>
              <p className="mt-1 text-tiny">
                发送：{task.misfireProtection.sendProtected ? "开启" : "关闭"}
                ；删除：
                {task.misfireProtection.deleteProtected ? "开启" : "关闭"}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
      {task.approvalRecord ? (
        <div className="mt-4 rounded-[8px] border-small border-primary-200 bg-primary-50 p-3 text-small text-primary-700">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="font-semibold">人工确认记录</p>
              <p className="mt-1">
                {task.approvalRecord.operator} 于
                {formatDate(task.approvalRecord.confirmedAt)} 确认。
              </p>
              {task.approvalRecord.note ? (
                <p className="mt-1 text-tiny">{task.approvalRecord.note}</p>
              ) : null}
            </div>
            <div className="grid grid-cols-3 gap-2 text-tiny md:min-w-[320px]">
              <span>
                目标：
                {task.approvalRecord.targetConfirmed ? "已确认" : "未确认"}
              </span>
              <span>
                内容：
                {task.approvalRecord.contentConfirmed ? "已确认" : "未确认"}
              </span>
              <span>
                窗口：
                {task.approvalRecord.currentWindowConfirmed
                  ? "已确认"
                  : "未确认"}
              </span>
              {isDesktopInteractionTask(task.type) ? (
                <>
                  <span>
                    联系人：
                    {task.approvalRecord.contactConfirmed ? "已确认" : "未确认"}
                  </span>
                  <span>
                    填入前：
                    {task.approvalRecord.draftBeforeFillConfirmed
                      ? "已确认"
                      : "未确认"}
                  </span>
                  <span>
                    对象：{task.approvalRecord.targetContact || task.targetName}
                  </span>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      <Divider className="my-4" />
      {isBatchTask ? (
        <>
          <div className="rounded-small bg-background p-3">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <p className="text-small font-semibold text-default-800">
                批量对象
              </p>
              <div className="flex flex-wrap gap-2">
                <Chip size="sm" variant="flat">
                  共{task.batchSummary?.total || task.batchTargets?.length || 0}
                  条
                </Chip>
                <Chip color="success" size="sm" variant="flat">
                  完成 {task.batchSummary?.completed || 0}
                </Chip>
                <Chip color="danger" size="sm" variant="flat">
                  失败 {task.batchSummary?.failed || 0}
                </Chip>
                <Chip color="warning" size="sm" variant="flat">
                  跳过 {task.batchSummary?.skipped || 0}
                </Chip>
                <Chip color="default" size="sm" variant="flat">
                  无对象 {task.batchSummary?.noTarget || 0}
                </Chip>
              </div>
            </div>
            {(() => {
              const total =
                task.batchSummary?.total || task.batchTargets?.length || 0;
              const completed = task.batchSummary?.completed || 0;
              const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
              return (
                <div className="mt-3">
                  <div className="flex items-center justify-between text-tiny text-default-500 mb-1">
                    <span>
                      进度 {completed}/{total}
                    </span>
                    <span>{pct}%</span>
                  </div>
                  <Progress
                    aria-label="批量进度"
                    value={pct}
                    color={pct === 100 ? "success" : "primary"}
                    size="sm"
                  />
                </div>
              );
            })()}
            {canDecide ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="flat"
                  color="warning"
                  startContent={<Icon icon="solar:pause-circle-linear" />}
                  onPress={async () => {
                    try {
                      await localEngineApi.pauseTask(task.id);
                      addToast({ title: "任务已暂停", color: "warning" });
                    } catch (e: unknown) {
                      addToast({
                        title: "暂停失败",
                        description: shortToastDescription(e),
                        color: "danger",
                      });
                    }
                  }}
                >
                  暂停
                </Button>
                <Button
                  size="sm"
                  variant="flat"
                  color="primary"
                  startContent={<Icon icon="solar:play-circle-linear" />}
                  onPress={async () => {
                    try {
                      await localEngineApi.resumeTask(task.id, {
                        riskConfirmation: buildLocalEngineRiskConfirmation(
                          "interaction-approval",
                          task.riskLevel || "high",
                          `用户确认恢复互动任务：${task.id}`,
                        ),
                      });
                      addToast({ title: "任务已继续", color: "success" });
                    } catch (e: unknown) {
                      addToast({
                        title: "继续失败",
                        description: shortToastDescription(e),
                        color: "danger",
                      });
                    }
                  }}
                >
                  继续
                </Button>
                <Button
                  size="sm"
                  variant="flat"
                  startContent={<Icon icon="solar:forward-2-linear" />}
                  onPress={() => onAction(task, "skip")}
                >
                  跳过当前
                </Button>
              </div>
            ) : null}
            <div className="mt-3 grid gap-2">
              {task.batchTargets?.slice(0, 10).map((target, index) => (
                <div
                  key={target.id}
                  className="rounded-small border-small border-divider bg-default-50 p-3"
                >
                  <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                    <p className="text-small font-medium text-default-800">
                      {index + 1}. {target.targetName}
                    </p>
                    <div className="flex items-center gap-2">
                      <StatusChip
                        status={targetStatusToTaskStatus(target.status)}
                        label={targetStatusLabel(target.status)}
                      />
                      {target.status === "failed" ? (
                        <Button
                          size="sm"
                          variant="flat"
                          color="primary"
                          startContent={<Icon icon="solar:restart-linear" />}
                          onPress={async () => {
                            try {
                              await localEngineApi.retryTask(task.id);
                              addToast({
                                title: "已提交重试",
                                color: "success",
                              });
                            } catch (e: unknown) {
                              addToast({
                                title: "重试失败",
                                description: shortToastDescription(e),
                                color: "danger",
                              });
                            }
                          }}
                        >
                          重试
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  <p className="mt-2 text-tiny text-default-500">
                    {target.sourceText}
                  </p>
                  <p className="mt-1 text-tiny text-default-700">
                    {target.replyText}
                  </p>
                  {target.failureReason ? (
                    <p className="mt-1 text-tiny text-danger">
                      {interactionDisplayText(target.failureReason)}
                    </p>
                  ) : null}
                </div>
              ))}
              {(task.batchTargets?.length || 0) > 10 ? (
                <p className="text-tiny text-default-400">
                  还有 {(task.batchTargets?.length || 0) - 10} 条，可在 CSV
                  导出中查看完整明细。
                </p>
              ) : null}
            </div>
          </div>
          <Divider className="my-4" />
        </>
      ) : null}
      {task.steps?.length ? (
        <>
          <div className="grid gap-2 md:grid-cols-3">
            {task.steps.map((step) => (
              <div key={step.key} className="rounded-small bg-background p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-tiny font-medium text-default-700">
                    {interactionDisplayText(step.label)}
                  </span>
                  <StepStatusChip status={step.status} />
                </div>
                <p className="mt-2 text-tiny text-default-500">
                  {interactionDisplayText(step.message)}
                </p>
              </div>
            ))}
          </div>
          <Divider className="my-4" />
        </>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-small bg-background p-3">
          <p className="text-tiny text-default-400">消息内容</p>
          <p className="mt-1 text-small text-default-700">{task.sourceText}</p>
        </div>
        <div className="rounded-small bg-background p-3">
          <p className="text-tiny text-default-400">回复内容</p>
          <p className="mt-1 text-small text-default-700">{task.replyText}</p>
        </div>
      </div>
      {["completed", "failed", "skipped", "no_target"].includes(task.status) ? (
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <StatusItem label="完成时间" value={formatDate(task.completedAt)} />
          <StatusItem label="更新时间" value={formatDate(task.updatedAt)} />
          <StatusItem
            label="执行方式"
            value={
              task.executionMode === "browser-assisted"
                ? "本机账号后台"
                : "内部记录"
            }
          />
        </div>
      ) : null}
      <div className="mt-4 space-y-2">
        {task.events.map((event) => (
          <div
            key={event.id}
            className="rounded-small bg-background p-3 text-small"
          >
            <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
              <span
                className={
                  event.level === "error" ? "text-danger" : "text-default-700"
                }
              >
                {interactionDisplayText(event.message)}
              </span>
              <span className="text-tiny text-default-400">
                {new Date(event.createdAt).toLocaleString()}
              </span>
            </div>
            {event.evidence ? (
              <div className="mt-2 rounded-small border-small border-divider bg-default-50 px-3 py-2 text-tiny text-default-500">
                <span className="font-medium text-default-700">
                  {evidenceTypeLabel(event.evidence.type)}
                </span>
                <span className="mx-1">
                  {interactionDisplayText(event.evidence.label)}：
                </span>
                {event.evidence.type === "screenshot" ? (
                  <div className="mt-2 space-y-2">
                    {(() => {
                      const evidenceUrl = localEngineApi.evidenceFileUrl(
                        event.evidence.value,
                      );
                      return (
                        <>
                          <a
                            className="text-primary underline-offset-2 hover:underline"
                            href={evidenceUrl}
                            rel="noreferrer"
                            target="_blank"
                          >
                            打开截图
                          </a>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            alt={interactionDisplayText(event.evidence.label)}
                            className="max-h-48 w-full max-w-xl rounded-small border-small border-divider object-contain"
                            src={evidenceUrl}
                          />
                        </>
                      );
                    })()}
                  </div>
                ) : (
                  <span className="break-all">
                    {interactionDisplayText(event.evidence.value)}
                  </span>
                )}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function RulesPanel({
  loading,
  rule,
  onSaved,
}: {
  loading: boolean;
  rule: InteractionReplyRuleConfig | null;
  onSaved: (rule: InteractionReplyRuleConfig) => void;
}) {
  const [draft, setDraft] = React.useState<InteractionReplyRuleConfig | null>(
    rule,
  );
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    setDraft(rule);
  }, [rule]);

  const updateList = (
    key:
      | "requireApprovalKeywords"
      | "blockedKeywords"
      | "serviceHighlights"
      | "commentWhitelistKeywords"
      | "commentExcludeAuthorKeywords"
      | "commentNoiseKeywords"
      | "commentPriorityKeywords"
      | "fallbackReplies",
    value: string,
  ) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            [key]: value
              .split(/[，,\n]/)
              .map((item) => item.trim())
              .filter(Boolean),
          }
        : current,
    );
  };

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const nextRule = await localEngineApi.updateReplyRule({
        industryName: draft.industryName,
        tone: draft.tone,
        defaultSendMode: draft.defaultSendMode,
        askForContact: draft.askForContact,
        commentParsingMode: draft.commentParsingMode,
        commentRulePreset: draft.commentRulePreset,
        commentRequireActionAndTime: draft.commentRequireActionAndTime,
        commentAllowShortText: draft.commentAllowShortText,
        commentSkipHandled: draft.commentSkipHandled,
        commentQuestionOnly: draft.commentQuestionOnly,
        commentMinLength: draft.commentMinLength,
        commentMaxLength: draft.commentMaxLength,
        commentWhitelistKeywords: draft.commentWhitelistKeywords,
        commentExcludeAuthorKeywords: draft.commentExcludeAuthorKeywords,
        commentNoiseKeywords: draft.commentNoiseKeywords,
        commentPriorityKeywords: draft.commentPriorityKeywords,
        fallbackEnabled: draft.fallbackEnabled,
        fallbackReplies: draft.fallbackReplies,
        allowFallbackAutoSend: draft.allowFallbackAutoSend,
        requireApprovalKeywords: draft.requireApprovalKeywords,
        blockedKeywords: draft.blockedKeywords,
        serviceHighlights: draft.serviceHighlights,
        closingText: draft.closingText,
      });
      onSaved(nextRule);
      addToast({
        title: "规则已保存",
        description: nextRule.industryName,
        color: "success",
      });
    } catch (e: unknown) {
      addToast({
        title: "保存失败",
        description: shortToastDescription(e),
        color: "danger",
      });
    } finally {
      setSaving(false);
    }
  };
  if (loading && !draft) {
    return (
      <Card className="border-small border-divider bg-background shadow-sm">
        <CardBody>
          <Spinner size="sm" />
        </CardBody>
      </Card>
    );
  }
  if (!draft) {
    return (
      <Card className="border-small border-danger-200 bg-danger-50 shadow-sm">
        <CardBody className="text-small text-danger-700">
          自动回复规则暂不可用。
        </CardBody>
      </Card>
    );
  }
  return (
    <Card className="border-small border-divider bg-background shadow-sm">
      <CardBody className="gap-5">
        <div>
          <h3 className="text-medium font-semibold text-default-900">
            自动回复规则
          </h3>
          <p className="mt-1 text-small text-default-500">
            规则会参与新建互动任务的默认话术和发送策略；自动发送会直接执行，确认后发送才停下。
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <StatusItem label="行业话术" value={draft.industryName} />
          <StatusItem
            label="发送防线"
            value={sendModeLabel(draft.defaultSendMode)}
          />
          <StatusItem label="更新时间" value={formatDate(draft.updatedAt)} />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Input
            label="行业名称"
            value={draft.industryName}
            onValueChange={(value) =>
              setDraft((current) =>
                current ? { ...current, industryName: value } : current,
              )
            }
          />
          <Select
            label="默认发送模式"
            selectedKeys={[draft.defaultSendMode]}
            onSelectionChange={(keys) => {
              const value = Array.from(keys)[0] as
                InteractionSendMode | undefined;
              if (value)
                setDraft((current) =>
                  current ? { ...current, defaultSendMode: value } : current,
                );
            }}
          >
            {sendModes.map((mode) => (
              <SelectItem key={mode.key}>{mode.label}</SelectItem>
            ))}
          </Select>
          <Select
            label="回复语气"
            selectedKeys={[draft.tone]}
            onSelectionChange={(keys) => {
              const value = Array.from(keys)[0] as
                InteractionReplyRuleConfig["tone"] | undefined;
              if (value)
                setDraft((current) =>
                  current ? { ...current, tone: value } : current,
                );
            }}
          >
            <SelectItem key="warm">亲切自然</SelectItem>
            <SelectItem key="professional">稳重专业</SelectItem>
            <SelectItem key="concise">简洁直接</SelectItem>
          </Select>
          <div className="flex items-center rounded-[8px] border-small border-divider bg-default-50 px-4">
            <Switch
              isSelected={draft.askForContact}
              onValueChange={(value) =>
                setDraft((current) =>
                  current ? { ...current, askForContact: value } : current,
                )
              }
            >
              引导留联系方式
            </Switch>
          </div>
        </div>
        <Textarea
          label="服务卖点"
          minRows={2}
          value={draft.serviceHighlights.join("，")}
          onValueChange={(value) => updateList("serviceHighlights", value)}
        />
        <Divider />
        <div>
          <h4 className="text-small font-semibold text-default-900">
            评论识别规则
          </h4>
          <p className="mt-1 text-small text-default-500">
            系统内置过滤菜单、按钮、作者本人和平台提示；下面这些规则由后台用户调整。
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Select
            label="识别规则"
            selectedKeys={[draft.commentParsingMode]}
            onSelectionChange={(keys) => {
              const value = Array.from(keys)[0] as
                InteractionReplyRuleConfig["commentParsingMode"] | undefined;
              if (value)
                setDraft((current) =>
                  current ? { ...current, commentParsingMode: value } : current,
                );
            }}
          >
            <SelectItem key="rules">有规则</SelectItem>
            <SelectItem key="none">没有规则</SelectItem>
          </Select>
          <Select
            label="规则强度"
            selectedKeys={[draft.commentRulePreset]}
            onSelectionChange={(keys) => {
              const value = Array.from(keys)[0] as
                InteractionReplyRuleConfig["commentRulePreset"] | undefined;
              if (value)
                setDraft((current) =>
                  current ? { ...current, commentRulePreset: value } : current,
                );
            }}
          >
            <SelectItem key="strict">严格</SelectItem>
            <SelectItem key="loose">宽松</SelectItem>
          </Select>
          <Input
            label="最小字数"
            type="number"
            value={String(draft.commentMinLength)}
            onValueChange={(value) =>
              setDraft((current) =>
                current
                  ? { ...current, commentMinLength: Number(value) || 1 }
                  : current,
              )
            }
          />
          <Input
            label="最长字数"
            type="number"
            value={String(draft.commentMaxLength)}
            onValueChange={(value) =>
              setDraft((current) =>
                current
                  ? { ...current, commentMaxLength: Number(value) || 180 }
                  : current,
              )
            }
          />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Switch
            isSelected={draft.commentRequireActionAndTime}
            onValueChange={(value) =>
              setDraft((current) =>
                current
                  ? { ...current, commentRequireActionAndTime: value }
                  : current,
              )
            }
          >
            必须带评论操作和时间
          </Switch>
          <Switch
            isSelected={draft.commentAllowShortText}
            onValueChange={(value) =>
              setDraft((current) =>
                current
                  ? { ...current, commentAllowShortText: value }
                  : current,
              )
            }
          >
            允许短评论
          </Switch>
          <Switch
            isSelected={draft.commentSkipHandled}
            onValueChange={(value) =>
              setDraft((current) =>
                current ? { ...current, commentSkipHandled: value } : current,
              )
            }
          >
            跳过已回复评论
          </Switch>
          <Switch
            isSelected={draft.commentQuestionOnly}
            onValueChange={(value) =>
              setDraft((current) =>
                current ? { ...current, commentQuestionOnly: value } : current,
              )
            }
          >
            只回复问句
          </Switch>
        </div>
        <Textarea
          label="关键词白名单"
          minRows={2}
          value={draft.commentWhitelistKeywords.join("，")}
          onValueChange={(value) =>
            updateList("commentWhitelistKeywords", value)
          }
        />
        <Textarea
          label="作者/自身过滤词"
          minRows={2}
          value={draft.commentExcludeAuthorKeywords.join("，")}
          onValueChange={(value) =>
            updateList("commentExcludeAuthorKeywords", value)
          }
        />
        <Textarea
          label="噪音过滤词"
          minRows={2}
          value={draft.commentNoiseKeywords.join("，")}
          onValueChange={(value) => updateList("commentNoiseKeywords", value)}
        />
        <Textarea
          label="优先识别关键词"
          minRows={2}
          value={draft.commentPriorityKeywords.join("，")}
          onValueChange={(value) =>
            updateList("commentPriorityKeywords", value)
          }
        />
        <Divider />
        <div>
          <h4 className="text-small font-semibold text-default-900">
            兜底回复
          </h4>
          <p className="mt-1 text-small text-default-500">
            AI 模型不可用或回复质量不达标时使用。是否允许自动发送由这里控制。
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Switch
            isSelected={draft.fallbackEnabled}
            onValueChange={(value) =>
              setDraft((current) =>
                current ? { ...current, fallbackEnabled: value } : current,
              )
            }
          >
            启用兜底回复
          </Switch>
          <Switch
            isSelected={draft.allowFallbackAutoSend}
            onValueChange={(value) =>
              setDraft((current) =>
                current
                  ? { ...current, allowFallbackAutoSend: value }
                  : current,
              )
            }
          >
            允许兜底回复自动发送
          </Switch>
        </div>
        <Textarea
          label="兜底回复话术"
          minRows={3}
          value={draft.fallbackReplies.join("\n")}
          onValueChange={(value) => updateList("fallbackReplies", value)}
        />
        <Textarea
          label="需人工确认关键词"
          minRows={2}
          value={draft.requireApprovalKeywords.join("，")}
          onValueChange={(value) =>
            updateList("requireApprovalKeywords", value)
          }
        />
        <Textarea
          label="禁用词"
          minRows={2}
          value={draft.blockedKeywords.join("，")}
          onValueChange={(value) => updateList("blockedKeywords", value)}
        />
        <Textarea
          label="收尾话术"
          minRows={2}
          value={draft.closingText}
          onValueChange={(value) =>
            setDraft((current) =>
              current ? { ...current, closingText: value } : current,
            )
          }
        />
        <div className="flex justify-end">
          <Button
            color="primary"
            isLoading={saving}
            startContent={saving ? null : <Icon icon="solar:diskette-linear" />}
            onPress={handleSave}
          >
            保存规则
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function CapabilitySummary({
  capability,
  agentSAssessment,
}: {
  capability: LocalEngineCapability;
  agentSAssessment?: AgentSRunCheckAssessment;
}) {
  const isAgentSCapability = capability.key === "agent-s-sidecar";
  return (
    <Card className="border-small border-divider bg-background shadow-sm">
      <CardBody className="gap-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-medium font-semibold text-default-900">
            {commercialDisplayText(capability.name)}
          </h3>
          {isAgentSCapability && agentSAssessment ? (
            <RunCheckToneChip
              status={agentSAssessment.status}
              label={agentSAssessment.statusLabel}
            />
          ) : (
            <CapabilityChip status={capability.status} />
          )}
        </div>
        <p className="text-small text-default-500">
          {isAgentSCapability && agentSAssessment
            ? commercialDisplayText(agentSAssessment.summary)
            : commercialDisplayText(capability.summary)}
        </p>
        {capability.checks?.length ? (
          <div className="space-y-2">
            {capability.checks.slice(0, 2).map((check) => (
              <div key={check.name} className="rounded-small bg-default-50 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-tiny font-medium text-default-700">
                    {commercialDisplayText(check.name)}
                  </span>
                  {isAgentSCapability && agentSAssessment ? (
                    <RunCheckToneChip
                      status={agentSAssessment.status}
                      label={agentSAssessment.statusLabel}
                    />
                  ) : (
                    <CapabilityChip status={check.status} />
                  )}
                </div>
                <p className="mt-1 break-all text-tiny text-default-400">
                  {isAgentSCapability && agentSAssessment
                    ? commercialDisplayText(agentSAssessment.detail)
                    : commercialDisplayText(check.message)}
                </p>
              </div>
            ))}
          </div>
        ) : null}
        {capability.nextAction ? (
          <p className="text-tiny text-default-400">
            {commercialDisplayText(capability.nextAction)}
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}

function CapabilityChip({
  status,
}: {
  status: LocalEngineCapability["status"];
}) {
  const map = {
    ready: { color: "success" as const, label: "正常" },
    warning: { color: "warning" as const, label: "需留意" },
    missing: { color: "danger" as const, label: "需处理" },
    blocked: { color: "danger" as const, label: "需处理" },
    degraded: { color: "warning" as const, label: "需留意" },
    optional: { color: "default" as const, label: "未启用" },
    developing: { color: "default" as const, label: "未启用" },
  };
  const item = map[status] || map.missing;
  return (
    <Chip color={item.color} size="sm" variant="flat">
      {item.label}
    </Chip>
  );
}

function RunCheckToneChip({
  status,
  label,
}: {
  status: RunCheckDetailTone;
  label: string;
}) {
  return (
    <Chip color={runCheckToneColor(status)} size="sm" variant="flat">
      {label}
    </Chip>
  );
}

function ExecutorStatusChip({
  status,
  isAgentSDesktop,
  agentSAssessment,
}: {
  status: LocalEngineExecutorsStatus["executors"][number]["status"];
  isAgentSDesktop?: boolean;
  agentSAssessment?: AgentSRunCheckAssessment;
}) {
  if (
    isAgentSDesktop &&
    agentSAssessment &&
    !agentSAssessment.isRealExecutionReady &&
    status !== "missing"
  ) {
    return (
      <RunCheckToneChip
        status={agentSAssessment.status}
        label={agentSAssessment.statusLabel}
      />
    );
  }
  const map = {
    ready: { color: "success" as const, label: "正常" },
    preflight_only: { color: "warning" as const, label: "待确认" },
    missing: { color: "danger" as const, label: "需处理" },
    optional: { color: "default" as const, label: "未启用" },
  };
  const item = map[status];
  return (
    <Chip color={item.color} size="sm" variant="flat">
      {item.label}
    </Chip>
  );
}

function isAgentSDesktopExecutor(
  executor: LocalEngineExecutorsStatus["executors"][number],
) {
  return [
    "agent-s-legacy-desktop",
    "wechat-reply-draft",
    "wechat-group-broadcast",
    "wechat-contact-add",
    "wechat-moments-publish",
    "wechat-moments-marketing",
  ].includes(executor.key);
}
function ExecutorAbilityChip({
  label,
  ready,
}: {
  label: string;
  ready: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-small border-small border-divider bg-default-50 px-3 py-2">
      <span className="text-tiny text-default-600">{label}</span>
      <Chip color={ready ? "success" : "warning"} size="sm" variant="flat">
        {ready ? "已接" : "待接"}
      </Chip>
    </div>
  );
}

function StatusChip({
  status,
  label,
}: {
  status: InteractionTask["status"];
  label: string;
}) {
  const color =
    status === "completed"
      ? "success"
      : status === "failed"
        ? "danger"
        : status === "waiting_for_send_confirmation"
          ? "warning"
          : status === "no_target"
            ? "default"
            : "default";
  return (
    <Chip color={color} size="sm" variant="flat">
      {label}
    </Chip>
  );
}

function isDesktopInteractionTask(type: InteractionTaskType) {
  return [
    "wechat-reply-draft",
    "wechat-group-broadcast",
    "wechat-contact-add",
    "wechat-moments-publish",
    "wechat-moments-marketing",
  ].includes(type);
}

function resultSummaryChipColor(
  kind: NonNullable<InteractionTask["resultSummary"]>["kind"],
) {
  const colors = {
    success: "success",
    failure: "danger",
    skipped: "warning",
    no_target: "default",
    waiting: "warning",
    running: "primary",
  } as const;
  return colors[kind];
}

function resultSummaryTone(
  kind: NonNullable<InteractionTask["resultSummary"]>["kind"],
) {
  const tones = {
    success: "border-success-200 bg-success-50 text-success-700",
    failure: "border-danger-200 bg-danger-50 text-danger-700",
    skipped: "border-warning-200 bg-warning-50 text-warning-700",
    no_target: "border-default-200 bg-default-100 text-default-700",
    waiting: "border-warning-200 bg-warning-50 text-warning-700",
    running: "border-primary-200 bg-primary-50 text-primary-700",
  };
  return tones[kind];
}

function parseBatchTargets(
  batchText: string,
  defaultTarget: string,
  defaultReply?: string,
) {
  return batchText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const parts = line.split(/[|｜]/);
      const hasTarget = parts.length > 1;
      const targetName = hasTarget
        ? parts[0].trim()
        : `${defaultTarget} ${index + 1}`;
      const sourceText = hasTarget ? parts.slice(1).join("｜").trim() : line;

      return {
        targetName: targetName || `${defaultTarget} ${index + 1}`,
        sourceText,
        replyText: defaultReply,
      };
    })
    .filter((target) => target.sourceText)
    .slice(0, 100);
}

function targetStatusToTaskStatus(
  status: NonNullable<InteractionTask["batchTargets"]>[number]["status"],
): InteractionTask["status"] {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "skipped") return "skipped";
  if (status === "no_target") return "no_target";
  return "queued";
}

function targetStatusLabel(
  status: NonNullable<InteractionTask["batchTargets"]>[number]["status"],
) {
  const map = {
    queued: "排队中",
    running: "执行中",
    waiting_confirmation: "待继续",
    completed: "已完成",
    failed: "失败",
    skipped: "已跳过",
    no_target: "无对象",
  };

  return map[status];
}

function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function RuntimeStateChip({
  state,
}: {
  state: NonNullable<InteractionTask["runtimeState"]>;
}) {
  const map = {
    preflight_only: { color: "warning" as const, label: "待确认" },
    executor_missing: { color: "danger" as const, label: "需处理" },
    live_ready: { color: "success" as const, label: "正常" },
    record_ready: { color: "default" as const, label: "内部记录" },
    running: { color: "primary" as const, label: "执行中" },
    completed: { color: "success" as const, label: "已完成" },
    blocked: { color: "danger" as const, label: "需处理" },
  };
  const item = map[state];
  return (
    <Chip color={item.color} size="sm" variant="flat">
      {item.label}
    </Chip>
  );
}

function executorStatusLabel(
  status: LocalEngineExecutorsStatus["executors"][number]["status"],
) {
  const map = {
    ready: "正常",
    preflight_only: "注意",
    missing: "需处理",
    optional: "未启用",
  };

  return map[status];
}

function formatFailureContext(context: LocalEngineFailureContext) {
  return [
    context.platform ? `平台：${interactionDisplayText(context.platform)}` : null,
    context.account ? `账号：${interactionDisplayText(context.account)}` : null,
    context.target ? `对象：${interactionDisplayText(context.target)}` : null,
    context.stage ? `阶段：${interactionDisplayText(context.stage)}` : null,
    `原因：${interactionDisplayText(context.reason)}`,
    context.nextAction
      ? `下一步：${interactionDisplayText(context.nextAction)}`
      : null,
  ]
    .filter(Boolean)
    .join("；");
}

function deriveTaskFailureContext(
  task: InteractionTask,
): LocalEngineFailureContext | null {
  if (task.failureContext) return task.failureContext;
  if (
    task.status !== "failed" &&
    !task.failureReason &&
    !task.diagnostics?.failureReason
  )
    return null;
  return {
    platform: task.platformName || task.diagnostics?.platform || task.typeLabel,
    account: task.accountName || task.diagnostics?.account,
    target: task.targetName,
    stage:
      task.diagnostics?.currentStep ||
      task.diagnostics?.currentStepMessage ||
      task.statusLabel,
    reason:
      task.failureReason ||
      task.diagnostics?.failureReason ||
      task.diagnostics?.summary ||
      "执行失败",
    nextAction:
      task.diagnostics?.nextAction ||
      task.nextAction ||
      "处理账号、对象或服务问题后重试。",
  };
}
function ActionBlockerList({
  blockers,
}: {
  blockers: LocalEngineActionBlocker[];
}) {
  if (!blockers.length) return null;
  return (
    <div className="grid gap-2">
      {blockers.map((blocker, index) => (
        <div
          key={`${blocker.stage}-${index}`}
          className="rounded-[8px] border-small border-danger-200 bg-danger-50 p-3 text-small text-danger-700"
        >
          <div className="flex flex-wrap items-center gap-2 font-semibold">
            <Icon icon="solar:shield-warning-linear" />
            <span>需处理：{commercialDisplayText(blocker.stage)}</span>
            {blocker.capability ? (
              <Chip color="danger" size="sm" variant="flat">
                {interactionDisplayText(blocker.capability)}
              </Chip>
            ) : null}
          </div>
          <p className="mt-2">
            {[
              blocker.platform ? `平台：${blocker.platform}` : null,
              blocker.account ? `账号：${blocker.account}` : null,
              blocker.target ? `对象：${blocker.target}` : null,
              `原因：${commercialDisplayText(blocker.reason)}`,
            ]
              .filter(Boolean)
              .join("；")}
          </p>
          <p className="mt-1 text-tiny">
            下一步：{commercialDisplayText(blocker.nextAction)}
          </p>
        </div>
      ))}
    </div>
  );
}
function FailureContextBox({
  context,
}: {
  context: LocalEngineFailureContext;
}) {
  return (
    <div className="mt-4">
      <FailureActionPanel
        actions={[
          { href: "/local-engine?tab=browser", label: "平台账号检查" },
          { href: "/local-engine?tab=evidence", label: "结果留存" },
        ]}
        impact="当前互动任务没有完成，可能影响客户回复、私信处理或结果确认。"
        nextAction={context.nextAction || "处理账号、对象或服务问题后重试。"}
        reason="本次互动任务执行失败，需要检查账号、对象或本机处理服务。"
        technicalDetails={formatFailureContext(context)}
        title="互动任务失败"
      />
    </div>
  );
}

function StepStatusChip({
  status,
}: {
  status: NonNullable<InteractionTask["steps"]>[number]["status"];
}) {
  const map = {
    pending: { color: "default" as const, label: "待执行" },
    running: { color: "primary" as const, label: "执行中" },
    completed: { color: "success" as const, label: "完成" },
    blocked: { color: "danger" as const, label: "需要处理" },
    skipped: { color: "warning" as const, label: "跳过" },
  };
  const item = map[status];
  return (
    <Chip color={item.color} size="sm" variant="flat">
      {item.label}
    </Chip>
  );
}
function QueueItem({ label, value }: { label: string; value: number }) {
  return (
    <div className="local-engine-console__metric rounded-[8px] border-small border-divider bg-default-50 p-4">
      <p className="text-tiny text-default-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-default-900">{value}</p>
    </div>
  );
}
function StatusItem({
  label,
  value,
  wide,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "md:col-span-2" : ""}>
      <p className="text-tiny text-default-400">{label}</p>
      <p className="mt-1 break-all text-small font-medium text-default-800">
        {value}
      </p>
    </div>
  );
}

function sendModeLabel(value: InteractionSendMode) {
  const item = sendModes.find((mode) => mode.key === value);
  return item?.label || value;
}

function evidenceTypeLabel(
  type: NonNullable<InteractionTask["events"][number]["evidence"]>["type"],
) {
  const map: Record<
    NonNullable<InteractionTask["events"][number]["evidence"]>["type"],
    string
  > = {
    text: "文本记录",
    snapshot: "页面记录",
    screenshot: "截图",
    page_snapshot: "页面记录",
    desktop_screenshot: "桌面截图",
    stage_log: "步骤记录",
    failure_reason: "失败原因",
    diagnostic_bundle: "排查资料",
    file: "文件记录",
  };

  return map[type];
}

function fileKindLabel(kind: "directory" | "file" | "missing" | "unknown") {
  const map = {
    directory: "目录",
    file: "文件",
    missing: "不存在",
    unknown: "未知",
  };

  return map[kind];
}

function formatBytes(value?: number) {
  if (typeof value !== "number") return "-";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024)
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString();
}
