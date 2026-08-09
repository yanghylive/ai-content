"use client";

import React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Button,
  Card,
  CardBody,
  Checkbox,
  Chip,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
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
import { Banner } from "@astryxdesign/core/Banner";
import { Button as AstryxButton } from "@astryxdesign/core/Button";
import { Grid } from "@astryxdesign/core/Grid";
import { Heading } from "@astryxdesign/core/Heading";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import {
  MetadataList,
  MetadataListItem,
} from "@astryxdesign/core/MetadataList";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Stack";
import { Selector } from "@astryxdesign/core/Selector";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Text } from "@astryxdesign/core/Text";
import { Toolbar } from "@astryxdesign/core/Toolbar";
import { FunctionalEmptyState } from "../components/functional-empty-state";
import { FailureActionPanel } from "../components/failure-action-panel";
import { ResultSummaryPanel } from "../components/result-summary-panel";
import { ComplianceWorkbench } from "./compliance/compliance-workbench";
import {
  OpsDenseTable,
  OpsDesktopPage,
  OpsMetric,
  OpsPanel,
  OpsStatusPill,
  OpsToolbar,
} from "../components/desktop-ops-ui";
import { Icon } from "@/components/lucide-icon-compat";
import { AgentStatusDrawer } from "@/components/agent-status-drawer";
import { RiskConfirmationDialog } from "@/components/risk-confirmation-dialog";
import { articlesApi, type Article } from "@/lib/api/articles";
import {
  getPublishPreparation,
  type PublishPreparation,
} from "@/lib/api/content-optimization";
import {
  autoUploadApi,
  buildRiskConfirmation,
  type AutoUploadAccount,
  type AutoUploadCdpBrowserSession,
  type AutoUploadEngineHealth,
  type AutoUploadLogFile,
  type AutoUploadMaterial,
  type AutoUploadPublishPayload,
  type AutoUploadPublishPreflightIssue,
  type AutoUploadPublishPreflightResult,
  type AutoUploadPublishResult,
  type AutoUploadPublishTask,
} from "@/lib/api/auto-upload";
import type {
  AgentSession,
  LocalEngineActionBlocker,
  LocalEngineFailureContext,
} from "@/lib/api/local-engine";
import { localEngineApi } from "@/lib/api/local-engine";
import { commercialDisplayText } from "@/lib/commercial-display-text";
import { toPublicError } from "@/lib/public-error";
import { readLatestVideoWorkshopClip } from "@/lib/ops-workbench/video-workshop-latest";
import { parseTrustedWechatChannelLoginUrl } from "@/lib/trusted-platform-login-url";
import {
  canRetryPublishRecord,
  getPublishRecordSourceIdentity,
  hasPublishRecordReadback,
  isDurablePublishRecord,
} from "@/lib/publish-record-view";

type SourceDraft = {
  articleId: string;
  contentType: "article" | "xiaohongshu";
  preparationId?: string;
  source: "article" | "content-workspace";
  title: string;
} | null;

type ReusedPublishDraft = {
  taskId?: string;
  title: string;
  tags: string[];
} | null;

type SourceContent = {
  article: Article;
  caption: string;
  hashtags: string[];
  description: string;
  preparation?: PublishPreparation;
} | null;

type PublishResultItem = NonNullable<
  AutoUploadPublishResult["results"]
>[number] & {
  accountName?: string;
  status?: NonNullable<AutoUploadPublishResult["platforms"]>[number]["status"];
  nextAction?: string;
  publishTaskId?: string;
};

type PublishWorkflowMode = "dry-run" | "real";

type PublishWorkflowPhase =
  | "draft"
  | "blocked"
  | "preflight"
  | "confirmation"
  | "queued"
  | "executing"
  | "evidence"
  | "failed";

type PublishWorkflowStepStatus =
  | "pending"
  | "active"
  | "complete"
  | "blocked"
  | "failed";

type DistributionTabKey =
  | "article"
  | "video"
  | "materials"
  | "accounts"
  | "compliance"
  | "engine"
  | "tasks"
  | "logs";

type PublishTaskQuery = {
  page: number;
  pageSize: number;
  search?: string;
  status?: string;
  platform?: string;
};

const DEFAULT_PUBLISH_TASK_QUERY: PublishTaskQuery = {
  page: 1,
  pageSize: 10,
};

const loginPlatforms = [
  { type: 3, name: "抖音" },
  { type: 1, name: "小红书" },
  { type: 2, name: "视频号" },
  { type: 4, name: "快手" },
  { type: 5, name: "B站" },
];

const publishPlatformOrder: Record<number, number> = {
  3: 0,
  2: 1,
  5: 2,
  1: 3,
  4: 4,
};

const MATERIAL_PAGE_SIZE = 40;
const PUBLISH_RECORD_PAGE_SIZE = 25;

const platformPublishRules: Record<
  number,
  { titleLimit: number; tagLimit: number }
> = {
  1: { titleLimit: 20, tagLimit: 5 },
  2: { titleLimit: 16, tagLimit: 5 },
  3: { titleLimit: 30, tagLimit: 5 },
  4: { titleLimit: 30, tagLimit: 4 },
  5: { titleLimit: 80, tagLimit: 5 },
};

function normalizeTags(tags: string[], limit: number) {
  return Array.from(
    new Set(tags.map((tag) => tag.replace(/^#+/, "").trim()).filter(Boolean)),
  ).slice(0, limit);
}

function trimTitleForPlatform(value: string, type: number) {
  const limit = platformPublishRules[type]?.titleLimit || 80;
  return value.trim().slice(0, limit);
}

function resolvePublishResultColor(ok: boolean | null | undefined) {
  if (ok === true) return "success" as const;
  if (ok === false) return "danger" as const;
  return "warning" as const;
}

function resolvePublishResultLabel(
  item: Pick<PublishResultItem, "ok" | "status">,
) {
  if (item.ok === true) return "平台已确认";
  if (item.ok === false) return "失败";
  if (item.status === "pending_manual") return "待人工确认";
  if (item.status === "not_integrated") return "待平台确认";
  if (item.status === "account_expired") return "账号失效";
  if (item.status === "material_error") return "素材异常";
  if (item.status === "login_required") return "需登录";
  return "未确认";
}

function normalizeCdpPlatform(platform?: string | null) {
  const value = String(platform || "").toLowerCase();
  if (value.includes("douyin") || value.includes("抖音")) return "douyin";
  if (value.includes("kuaishou") || value.includes("快手")) return "kuaishou";
  if (value.includes("xiaohongshu") || value.includes("小红书"))
    return "xiaohongshu";
  if (
    value.includes("wechat-channel") ||
    value.includes("wechat_channel") ||
    value.includes("channels.weixin") ||
    value.includes("视频号")
  ) {
    return "wechat-channel";
  }
  return value;
}

function accountPlatformSlug(account: AutoUploadAccount) {
  const byType: Record<number, string> = {
    1: "xiaohongshu",
    2: "wechat-channel",
    3: "douyin",
    4: "kuaishou",
    5: "bilibili",
  };
  return byType[account.type] || normalizeCdpPlatform(account.platform);
}

function accountIdentityKey(account: AutoUploadAccount) {
  return [
    accountPlatformSlug(account) || `type-${account.type}`,
    account.stableId || account.id,
    account.filePath || account.profileName || account.userName || "",
  ].join(":");
}

function accountRowKey(account: AutoUploadAccount, index: number) {
  return `${accountIdentityKey(account)}:${index}`;
}

function findAccountCdpSession(
  sessions: AutoUploadCdpBrowserSession[],
  account: AutoUploadAccount,
) {
  const expectedPlatform = accountPlatformSlug(account);
  return (
    sessions.find(
      (session) =>
        normalizeCdpPlatform(session.platform) === expectedPlatform &&
        String(session.accountId || "") === String(account.id || ""),
    ) ||
    sessions.find(
      (session) =>
        normalizeCdpPlatform(session.platform) === expectedPlatform &&
        String(session.accountId || "") === String(account.filePath || ""),
    ) ||
    null
  );
}

function cdpSessionChip(session: AutoUploadCdpBrowserSession | null) {
  if (!session) return { label: "未连接", color: "default" as const };
  if (session.status === "ready")
    return { label: "后台已连接", color: "success" as const };
  if (session.status === "needs_login")
    return { label: "需登录", color: "warning" as const };
  if (session.status === "error")
    return { label: "连接异常", color: "danger" as const };
  if (session.status === "unknown") {
    return session.activeProfile
      ? { label: "账号环境已准备", color: "success" as const }
      : { label: "未打开后台", color: "default" as const };
  }
  return { label: "等待反馈", color: "warning" as const };
}

function cleanUserFacingRuntimeText(value: string | null | undefined) {
  return commercialDisplayText(String(value || ""))
    .replace(
      /\bcommercial acceptance injected failure(?:\s+for\s+[^；,，。\n]+)?/gi,
      "发布检查未通过，请重新确认后再试",
    )
    .replace(
      /\b(?:smoke|fixture|acceptance|e2e)[-_ ]?[\w.-]*(?:\s+(?:failed|failure|error))?/gi,
      "发布检查未通过",
    )
    .replace(/3011\s*本地\s*Runtime/g, "本机发布服务")
    .replace(/Chrome\/CDP\s*持久浏览器/g, "本机平台后台")
    .replace(/CDP\s*会话/g, "平台后台连接")
    .replace(/CDP/g, "平台后台")
    .replace(/\bRuntime\b/g, "本机服务")
    .replace(/persistent-cdp-browser/gi, "本机平台后台")
    .replace(/local-browser-engine/gi, "本机浏览器")
    .replace(/\bprofile\b/gi, "登录环境")
    .replace(/engine:\s*/gi, "")
    .replace(/尚未打开\s+本机平台后台/g, "尚未打开平台后台")
    .replace(/本地浏览器\s+本机服务/g, "本机浏览器")
    .replace(/账号\s+登录环境/g, "账号登录环境")
    .replace(/本机浏览器\s+已就绪/g, "本机浏览器已就绪")
    .replace(/账号登录环境\s+已准备/g, "账号登录环境已准备")
    .replace(
      /(?:\/Users|\/Volumes|\/private|\/tmp|\/var)\/[^；,，。\n\r\t)）]+/g,
      (match) => displayFileName(match, "本机文件"),
    )
    .trim();
}

function displayFileName(
  value: string | null | undefined,
  fallback = "本机文件",
) {
  const text = commercialDisplayText(String(value || "").trim());
  if (!text) return fallback;
  const normalized = text.replace(/\\/g, "/");
  return (
    normalized
      .split("/")
      .filter(Boolean)
      .pop()
      ?.replace(
        /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}[_-]/i,
        "",
      ) || fallback
  );
}

function displayPublishTaskTitle(value: string | null | undefined) {
  const text = cleanUserFacingRuntimeText(value);
  if (!text) return "发布任务";
  return text
    .replace(/\bcommercial-e2e-[\w.-]+/gi, "演示发布任务")
    .replace(/commercial-acceptance-publish-\d+/gi, "发布记录")
    .replace(/\bpublish-\d{8,}\b/gi, "发布结果");
}

function displayPublishTaskReference(task: AutoUploadPublishTask) {
  return `#${task.id}`;
}

function inferPublishTabFromTask(task: AutoUploadPublishTask) {
  const hasVideo = (task.file_list || []).some(
    (file) => getMaterialKind(displayFileName(file, file)).label === "视频",
  );
  return hasVideo ? "video" : "article";
}

function buildTaskReuseHref(task: AutoUploadPublishTask) {
  const params = new URLSearchParams();
  const sourceIdentity = getPublishRecordSourceIdentity(task);
  params.set("tab", inferPublishTabFromTask(task));
  params.set("reuseTaskId", String(task.id));
  if (sourceIdentity) {
    params.set("source", "article");
    params.set("articleId", sourceIdentity.articleId);
    params.set("contentType", sourceIdentity.contentType);
  }
  const title = displayPublishTaskTitle(task.title);
  if (title && title !== "发布任务") {
    params.set("reuseTitle", title);
  }
  if (task.tags?.length) {
    params.set("reuseTags", task.tags.join(","));
  }
  return `/distribution?${params.toString()}`;
}

function buildPublishLogsExport(logs: AutoUploadLogFile[]) {
  const exportedAt = new Date().toLocaleString("zh-CN");
  const sections = logs.map((log, index) =>
    [
      `#${index + 1} ${cleanUserFacingRuntimeText(log.platform) || "发布平台"}`,
      `文件：${log.filename}`,
      `更新时间：${new Date(log.updatedAt).toLocaleString("zh-CN")}`,
      `大小：${(log.size / 1024).toFixed(1)} KB`,
      "",
      log.lines.length
        ? log.lines.map(cleanUserFacingRuntimeText).join("\n")
        : "当前没有发布记录",
    ].join("\n"),
  );
  return [
    "JIUZHANG AI 发布结果导出",
    `导出时间：${exportedAt}`,
    `记录数量：${logs.length}`,
    "",
    sections.join("\n\n---\n\n"),
  ].join("\n");
}

function downloadTextFile(filename: string, content: string) {
  if (typeof document === "undefined") return;
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function downloadPublishLogs(logs: AutoUploadLogFile[]) {
  if (!logs.length) {
    addToast({ title: "暂无可导出的发布结果", color: "warning" });
    return;
  }
  const filename = `kaypal-publish-results-${new Date()
    .toISOString()
    .slice(0, 10)}.txt`;
  downloadTextFile(filename, buildPublishLogsExport(logs));
  addToast({ title: "发布结果已导出", color: "success" });
}

function buildPublishResultItemsExport(title: string, items: PublishResultItem[]) {
  const exportedAt = new Date().toLocaleString("zh-CN");
  return [
    "JIUZHANG AI 本次发布结果",
    `导出时间：${exportedAt}`,
    `发布标题：${title || "未填写标题"}`,
    `平台数量：${items.length}`,
    "",
    items
      .map((item, index) =>
        [
          `#${index + 1} ${item.platform || `平台 ${item.type}`}`,
          `账号：${item.accountName || item.account || "-"}`,
          `状态：${resolvePublishResultLabel(item)}`,
          `消息：${item.message || "-"}`,
          item.nextAction ? `下一步：${item.nextAction}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
      )
      .join("\n\n---\n\n"),
  ].join("\n");
}

function downloadPublishResultItems(title: string, items: PublishResultItem[]) {
  if (!items.length) {
    addToast({ title: "暂无可导出的本次结果", color: "warning" });
    return;
  }
  const filename = `kaypal-current-publish-result-${new Date()
    .toISOString()
    .slice(0, 10)}.txt`;
  downloadTextFile(filename, buildPublishResultItemsExport(title, items));
  addToast({ title: "本次发布结果已导出", color: "success" });
}

function publishReceiptValue(
  item: Pick<
    PublishResultItem,
    "publishUrl" | "platformUrl" | "externalId" | "postId" | "articleId"
  >,
) {
  return (
    item.publishUrl ||
    item.platformUrl ||
    item.externalId ||
    item.postId ||
    ""
  );
}

function hasPublishTaskReadback(
  item: Pick<
    PublishResultItem,
    | "evidence"
    | "publishUrl"
    | "platformUrl"
    | "externalId"
    | "postId"
    | "articleId"
  >,
) {
  return hasPublishRecordReadback(item);
}

function hasPublishTaskEvidence(item: PublishResultItem) {
  return hasPublishTaskReadback(item);
}

function getPublishTaskEvidenceCount(task: AutoUploadPublishTask) {
  const summary = summarizeTaskResult(task.result);
  return summary.results.filter(hasPublishTaskEvidence).length;
}

function formatPublishEvidenceValue(value: unknown) {
  if (!value) return "";
  if (typeof value === "string") return cleanUserFacingRuntimeText(value);
  try {
    return cleanUserFacingRuntimeText(JSON.stringify(value));
  } catch {
    return "已留存过程记录";
  }
}

function buildPublishTasksExport(tasks: AutoUploadPublishTask[]) {
  const exportedAt = new Date().toLocaleString("zh-CN");
  const sections = tasks.map((task, index) => {
    const taskMetrics = getPublishTaskMetrics(task);
    const summary = summarizeTaskResult(task.result);
    const accounts = getPublishTaskAccounts(task);
    const failureReason = getPublishTaskFailureReason(task);
    const platformRows = summary.results.length
      ? summary.results
          .map((item, itemIndex) =>
            [
              `平台 ${itemIndex + 1}：${item.platform || `平台 ${item.type}`}`,
              `账号：${displayFileName(item.account || item.accountName, "-")}`,
              `状态：${resolvePublishResultLabel(item)}`,
              `消息：${cleanUserFacingRuntimeText(item.message) || "-"}`,
              item.nextAction
                ? `下一步：${cleanUserFacingRuntimeText(item.nextAction)}`
                : null,
              publishReceiptValue(item)
                ? `反馈：${commercialDisplayText(publishReceiptValue(item))}`
                : null,
              item.evidence
                ? `证据：${formatPublishEvidenceValue(item.evidence)}`
                : null,
            ]
              .filter(Boolean)
              .join("\n"),
          )
          .join("\n\n")
      : "暂无平台明细";

    return [
      `#${index + 1} ${displayPublishTaskTitle(task.title)}`,
      `记录编号：${task.id}`,
      `类型：${getPublishTaskType(task)} · ${getPublishTaskModeLabel(task)}`,
      `状态：${resolveTaskStatus(getPublishTaskDisplayStatus(task))}`,
      `账号：${accounts.join("、") || displayFileName(task.account_file, "-")}`,
      `结果：总数 ${taskMetrics.total}，成功 ${taskMetrics.succeeded}，失败 ${taskMetrics.failed}，待处理 ${taskMetrics.waiting}`,
      `失败原因：${failureReason || "-"}`,
      `证据：${getPublishTaskEvidenceCount(task)} 条`,
      `素材：${(task.file_list || []).map((file) => displayFileName(file)).join("、") || "-"}`,
      `标签：${(task.tags || []).join("、") || "-"}`,
      `创建时间：${new Date(task.created_at).toLocaleString("zh-CN")}`,
      `更新时间：${new Date(task.updated_at).toLocaleString("zh-CN")}`,
      "",
      platformRows,
    ].join("\n");
  });

  return [
    "JIUZHANG AI 发布记录导出",
    `导出时间：${exportedAt}`,
    `记录数量：${tasks.length}`,
    "",
    sections.join("\n\n---\n\n"),
  ].join("\n");
}

function downloadPublishTasks(tasks: AutoUploadPublishTask[]) {
  if (!tasks.length) {
    addToast({ title: "暂无可导出的发布记录", color: "warning" });
    return;
  }
  const filename = `kaypal-publish-records-${new Date()
    .toISOString()
    .slice(0, 10)}.txt`;
  downloadTextFile(filename, buildPublishTasksExport(tasks));
  addToast({
    title: "发布记录已导出",
    description: `已整理 ${tasks.length} 条发布记录。`,
    color: "success",
  });
}

function buildPublishTaskAgentSession(task: AutoUploadPublishTask): AgentSession {
  const taskMetrics = getPublishTaskMetrics(task);
  const summary = summarizeTaskResult(task.result);
  const failureReason = getPublishTaskFailureReason(task);
  const evidenceCount = getPublishTaskEvidenceCount(task);
  const sessionId = `publish-record:${task.id}`;
  const normalizedStatus = task.status.toLowerCase();
  const status: AgentSession["status"] =
    taskMetrics.failed > 0 || normalizedStatus.includes("fail")
      ? "failed"
      : taskMetrics.succeeded > 0 && taskMetrics.waiting === 0
        ? "completed"
        : taskMetrics.waiting > 0
          ? "waiting_for_confirmation"
          : "running";
  const accounts = getPublishTaskAccounts(task);
  const materialText =
    (task.file_list || []).map((file) => displayFileName(file)).join("、") ||
    "未记录素材";
  const events = [
    {
      id: `${sessionId}:created`,
      sessionId,
      level: "info" as const,
      title: "发布记录已创建",
      message: [
        `发布类型：${getPublishTaskModeLabel(task)}`,
        `账号：${accounts.join("、") || displayFileName(task.account_file, "-")}`,
        `素材：${materialText}`,
      ].join("；"),
      createdAt: task.created_at,
      evidence: {
        type: "stage_log" as const,
        label: "记录编号",
        value: String(task.id),
      },
    },
    ...summary.results.slice(0, 6).map((item, index) => {
      const receipt = publishReceiptValue(item);
      const evidenceValue =
        receipt || formatPublishEvidenceValue(item.evidence) || item.message;
      return {
        id: `${sessionId}:platform:${index}`,
        sessionId,
        level:
          item.ok === true
            ? ("success" as const)
            : item.ok === false
              ? ("error" as const)
              : ("warning" as const),
        title: item.platform || `平台 ${item.type}`,
        message:
          cleanUserFacingRuntimeText(
            item.message || item.nextAction || "等待平台反馈或结果确认",
          ) || "等待平台反馈或结果确认",
        createdAt: task.updated_at,
        evidence: evidenceValue
          ? {
              type: receipt ? ("text" as const) : ("stage_log" as const),
              label: receipt ? "平台反馈" : "过程记录",
              value: cleanUserFacingRuntimeText(String(evidenceValue)),
            }
          : undefined,
      };
    }),
    ...(failureReason
      ? [
          {
            id: `${sessionId}:failure`,
            sessionId,
            level: "error" as const,
            title: "待处理原因",
            message: failureReason,
            createdAt: task.updated_at,
            evidence: {
              type: "failure_reason" as const,
              label: "失败原因",
              value: failureReason,
            },
          },
        ]
      : []),
  ];

  return {
    id: sessionId,
    title: `发布状态：${displayPublishTaskTitle(task.title)}`,
    instruction: [
      "查看这条发布记录的结果、证据和下一步处理方式。",
      `结果：总数 ${taskMetrics.total}，成功 ${taskMetrics.succeeded}，失败 ${taskMetrics.failed}，待处理 ${taskMetrics.waiting}。`,
      failureReason
        ? `下一步：${failureReason}`
        : evidenceCount
          ? "下一步：核对平台反馈后可复用为新任务。"
          : "下一步：等待平台反馈或结果确认记录。",
    ].join("\n"),
    status,
    statusLabel: resolveTaskStatus(getPublishTaskDisplayStatus(task)),
    executionScope: "local-files",
    source: "publishing",
    createdAt: task.created_at,
    updatedAt: task.updated_at,
    completedAt: status === "completed" ? task.updated_at : undefined,
    nextAction: failureReason || "核对平台明细、反馈和素材记录。",
    failureReason: failureReason || undefined,
    targetApp: "发布记录",
    riskLevel: failureReason ? "medium" : "low",
    metadata: {
      source: "publish-record-status",
      taskId: task.id,
      evidenceCount,
      metrics: taskMetrics,
    },
    confirmations: [],
    events,
  };
}

function isAuthRuntimeError(value: string | null | undefined) {
  return /授权|登录|未登录|过期|失效|401|unauthorized/i.test(
    String(value || ""),
  );
}

function accountStorageLabel(
  account: AutoUploadAccount,
  session: AutoUploadCdpBrowserSession | null,
) {
  if (session?.status === "ready") return "账号环境已接管";
  if (account.filePath) return "账号文件已保存";
  return "等待同步";
}

function getMaterialKind(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  if (["mp4", "mov", "m4v", "webm"].includes(ext))
    return {
      label: "视频",
      color: "secondary" as const,
      icon: "solar:videocamera-record-linear",
    };
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext))
    return {
      label: "图片",
      color: "primary" as const,
      icon: "solar:gallery-linear",
    };
  return {
    label: ext ? ext.toUpperCase() : "文件",
    color: "default" as const,
    icon: "solar:file-linear",
  };
}

function formatMaterialSize(value: number | null) {
  if (value === null || Number.isNaN(value)) return "大小未知";
  return `${value} MB`;
}

function formatMaterialDisplayPath(material: AutoUploadMaterial) {
  if (!material.filePath) return "-";
  return displayFileName(material.filename || material.filePath);
}

function formatSourceArticleSummary(article: Article) {
  const text =
    article.xiaohongshuData?.caption ||
    article.finalHtml ||
    article.rawHtml ||
    article.content ||
    "";
  return commercialDisplayText(text)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 110);
}

function getSourceArticleBody(article: Article) {
  return article.finalHtml || article.content || "";
}

function formatSourceArticleType(article: Article) {
  return article.contentType === "xiaohongshu" ? "小红书笔记" : "文章";
}

function sourceArticleTimestamp(article: Article) {
  const time = new Date(article.updatedAt || article.createdAt).getTime();
  return Number.isFinite(time) ? time : 0;
}

function summarizeTaskResult(result: Record<string, unknown> | null) {
  const results = normalizePublishResultItems(
    result as AutoUploadPublishResult | null,
  );
  return {
    results,
    failures: results.filter((item) => item.ok === false),
    succeeded: results.filter((item) => item.ok === true),
    pending: results.filter((item) => item.ok !== true && item.ok !== false),
  };
}

function normalizePublishResultItems(
  result: AutoUploadPublishResult | null | undefined,
): PublishResultItem[] {
  if (Array.isArray(result?.platforms)) {
    return result.platforms.map((entry, index) => ({
      type: index,
      ok:
        entry.status === "success" && hasPublishTaskReadback(entry)
          ? true
          : [
                "failed",
                "account_expired",
                "material_error",
                "login_required",
                "blocked",
                "not_integrated",
              ].includes(entry.status)
            ? false
            : null,
      status: entry.status,
      message:
        entry.failureReason ||
        entry.nextAction ||
        (entry.status === "success" && hasPublishTaskReadback(entry)
          ? "平台反馈或结果确认记录已核对"
          : "等待平台确认"),
      platform: entry.platform,
      account: entry.accountName || entry.accountId,
      accountName: entry.accountName || entry.accountId,
      articleId: entry.articleId,
      nextAction: entry.nextAction,
      publishTaskId: entry.publishTaskId,
      publishUrl: entry.publishUrl,
      externalId: entry.externalId,
      evidence: entry.evidence,
    }));
  }

  return Array.isArray(result?.results)
    ? (result.results as PublishResultItem[]).map((entry) => ({
        ...entry,
        ok:
          entry.ok === true && hasPublishTaskReadback(entry)
            ? true
            : entry.ok === false
              ? false
              : null,
        message:
          entry.ok === true && !hasPublishTaskReadback(entry)
            ? "等待平台确认"
            : entry.message,
      }))
    : [];
}

function getPublishTaskMetrics(task: AutoUploadPublishTask) {
  const summary = summarizeTaskResult(task.result);
  const rawSummary = (
    task.result as { summary?: Partial<Record<string, number>> } | null
  )?.summary;
  const failedFromSummary =
    (rawSummary?.failed || 0) +
    (rawSummary?.accountExpired || 0) +
    (rawSummary?.materialError || 0) +
    (rawSummary?.loginRequired || 0) +
    (rawSummary?.blocked || 0) +
    (rawSummary?.notIntegrated || 0);
  const total =
    rawSummary?.total ||
    summary.results.length ||
    Math.max(1, (task.file_list || []).length);
  const failed =
    failedFromSummary ||
    summary.failures.length ||
    (task.status.toLowerCase().includes("fail") ? 1 : 0);
  const succeeded = summary.succeeded.length;
  const waiting = Math.max(
    rawSummary?.pendingManual || 0,
    summary.pending.length,
    Math.max(0, total - failed - succeeded),
  );

  return {
    failed,
    succeeded,
    total,
    waiting: Math.max(0, waiting),
  };
}

function getPublishTaskCreateType(task: AutoUploadPublishTask) {
  const source = (task.result as { source?: string } | null)?.source;
  if (source === "auto_upload_batch_results") return "批量发布";
  if (source === "interaction_tasks") return "客户互动";
  if ((task.tags || []).includes("AGGREGATE_PUBLISH")) return "批量发布";
  return "发布中心";
}

function getPublishTaskType(task: AutoUploadPublishTask) {
  const hasVideo = (task.file_list || []).some((file) =>
    /\.(mp4|mov|avi|mkv|webm)$/i.test(file),
  );
  if (hasVideo) return "视频";
  if ((task.file_list || []).length) return "图文";
  return "内容";
}

function getPublishTaskModeLabel(task: AutoUploadPublishTask) {
  if (task.dry_run) return "发布前检查";
  const enableTimer = (task.result as { payloads?: AutoUploadPublishPayload[] })
    ?.payloads?.[0]?.enableTimer;
  return enableTimer === 1 ? "定时发布" : "立即发布";
}

function getPublishTaskScheduledTime(task: AutoUploadPublishTask) {
  const payload = (task.result as { payloads?: AutoUploadPublishPayload[] } | null)
    ?.payloads?.[0];
  if (!payload || payload.enableTimer !== 1) return "-";
  if (payload.scheduleTime) return payload.scheduleTime;
  if (payload.dailyTimes?.length) {
    return `${payload.startDays || 0} 天后 ${payload.dailyTimes.join("、")}`;
  }
  return "已启用定时";
}

function getPublishTaskExecutedTime(task: AutoUploadPublishTask) {
  const metrics = getPublishTaskMetrics(task);
  if (metrics.succeeded > 0 || metrics.failed > 0) {
    return new Date(task.updated_at).toLocaleString();
  }
  return "-";
}

function getPublishTaskDisplayStatus(task: AutoUploadPublishTask) {
  const metrics = getPublishTaskMetrics(task);
  if (metrics.failed > 0) return "failed";
  if (metrics.waiting > 0) return "waiting_platform_confirmation";
  if (metrics.succeeded > 0 && metrics.succeeded >= metrics.total) {
    return "completed";
  }
  return task.status.toLowerCase();
}

function getPublishTaskAccounts(task: AutoUploadPublishTask) {
  const summary = summarizeTaskResult(task.result);
  const accounts = [
    ...summary.results.map((item) => item.account || item.accountName),
    task.account_file,
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => displayFileName(value));
  return Array.from(new Set(accounts)).filter(Boolean);
}

function getPublishTaskFailureReason(task: AutoUploadPublishTask) {
  const summary = summarizeTaskResult(task.result);
  const firstFailure = summary.failures[0];
  const firstPending = summary.pending.find((item) => item.nextAction);
  const reason =
    firstFailure?.message ||
    firstFailure?.nextAction ||
    (task.status.toLowerCase().includes("fail") ? task.message : null) ||
    firstPending?.nextAction;
  return cleanUserFacingRuntimeText(reason || "");
}

function getAgentSessionStatusColor(status: AgentSession["status"]) {
  if (status === "failed") return "danger" as const;
  if (status === "running") return "primary" as const;
  if (status === "waiting_for_confirmation") return "warning" as const;
  if (status === "completed") return "success" as const;
  return "default" as const;
}

function createRequestId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatFailureContext(context: LocalEngineFailureContext) {
  return [
    context.platform ? `平台：${context.platform}` : null,
    context.account ? `账号：${context.account}` : null,
    context.target
      ? `对象：${cleanUserFacingRuntimeText(context.target)}`
      : null,
    context.stage ? `阶段：${cleanUserFacingRuntimeText(context.stage)}` : null,
    `原因：${cleanUserFacingRuntimeText(context.reason)}`,
    context.nextAction
      ? `下一步：${cleanUserFacingRuntimeText(context.nextAction)}`
      : null,
  ]
    .filter(Boolean)
    .join("；");
}

function formatPreflightIssue(issue: AutoUploadPublishPreflightIssue) {
  return [
    issue.platform ? `平台：${issue.platform}` : null,
    issue.account
      ? `账号：${issue.account}`
      : issue.accountFile
        ? `账号：${issue.accountFile}`
        : null,
    issue.filePath
      ? `${issue.scope === "cover" ? "封面" : "素材"}：${displayFileName(issue.filePath)}`
      : null,
    issue.stage ? `阶段：${cleanUserFacingRuntimeText(issue.stage)}` : null,
    issue.expected ? `期望：${cleanUserFacingRuntimeText(issue.expected)}` : null,
    issue.actual ? `实际：${cleanUserFacingRuntimeText(issue.actual)}` : null,
    `原因：${cleanUserFacingRuntimeText(issue.message)}`,
    `下一步：${cleanUserFacingRuntimeText(issue.nextAction)}`,
  ]
    .filter(Boolean)
    .join("；");
}
export default function DistributionPage() {
  return (
    <React.Suspense
      fallback={
        <div className="flex min-h-[360px] items-center justify-center">
          <Spinner size="sm" />
        </div>
      }
    >
      <DistributionContent />
    </React.Suspense>
  );
}

function DistributionContent() {
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const selectedTab = React.useMemo<DistributionTabKey>(() => {
    if (sourceTabKeys.includes(requestedTab || "")) {
      return requestedTab as DistributionTabKey;
    }
    if (searchParams.get("source") === "article") {
      return "article";
    }
    return "tasks";
  }, [requestedTab, searchParams]);
  const [health, setHealth] = React.useState<AutoUploadEngineHealth | null>(
    null,
  );
  const [accounts, setAccounts] = React.useState<AutoUploadAccount[]>([]);
  const [materials, setMaterials] = React.useState<AutoUploadMaterial[]>([]);
  const [error, setError] = React.useState("");
  const [accountsError, setAccountsError] = React.useState("");
  const [materialsError, setMaterialsError] = React.useState("");
  const [logsError, setLogsError] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [accountsLoading, setAccountsLoading] = React.useState(true);
  const [materialsLoading, setMaterialsLoading] = React.useState(true);
  const [logsLoading, setLogsLoading] = React.useState(true);
  const [logs, setLogs] = React.useState<AutoUploadLogFile[]>([]);
  const [tasks, setTasks] = React.useState<AutoUploadPublishTask[]>([]);
  const [taskPageInfo, setTaskPageInfo] = React.useState({
    total: 0,
    page: 1,
    pageSize: DEFAULT_PUBLISH_TASK_QUERY.pageSize,
    totalPages: 1,
  });
  const taskQueryRef = React.useRef<PublishTaskQuery>(
    DEFAULT_PUBLISH_TASK_QUERY,
  );
  const [tasksLoading, setTasksLoading] = React.useState(true);
  const [tasksError, setTasksError] = React.useState("");
  const [sourceContent, setSourceContent] = React.useState<SourceContent>(null);
  const [sourceContentLoading, setSourceContentLoading] = React.useState(false);
  const [sourceContentError, setSourceContentError] = React.useState("");
  const [sourceLoadAttempt, setSourceLoadAttempt] = React.useState(0);

  const fetchHealth = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await autoUploadApi.health();
      setHealth(result);
    } catch (e: unknown) {
      setHealth(null);
      setError(
        e instanceof Error
          ? cleanUserFacingRuntimeText(e.message)
          : "本机发布服务未启动",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAccounts = React.useCallback(async () => {
    setAccountsLoading(true);
    setAccountsError("");
    try {
      const collected: AutoUploadAccount[] = [];
      let page = 1;
      let totalPages = 1;
      do {
        const result = await autoUploadApi.accountPage({
          page,
          pageSize: 100,
        });
        collected.push(...result.items);
        totalPages = result.totalPages;
        page += 1;
      } while (page <= totalPages);
      setAccounts(collected);
    } catch (e: unknown) {
      setAccounts([]);
      setAccountsError(toPublicError(e, "平台账号暂时无法读取，请重新加载。"));
    } finally {
      setAccountsLoading(false);
    }
  }, []);

  const fetchMaterials = React.useCallback(async () => {
    setMaterialsLoading(true);
    setMaterialsError("");
    try {
      const result = await autoUploadApi.materials();
      setMaterials(result);
    } catch (e: unknown) {
      setMaterials([]);
      setMaterialsError(toPublicError(e, "发布素材暂时无法读取，请重新加载。"));
    } finally {
      setMaterialsLoading(false);
    }
  }, []);

  const fetchLogs = React.useCallback(async () => {
    setLogsLoading(true);
    setLogsError("");
    try {
      const result = await autoUploadApi.logs();
      setLogs(result);
    } catch (e: unknown) {
      setLogs([]);
      setLogsError(toPublicError(e, "发布结果暂时无法读取，请重新加载。"));
    } finally {
      setLogsLoading(false);
    }
  }, []);

  const fetchTasks = React.useCallback(async (query?: PublishTaskQuery) => {
    const nextQuery = query || taskQueryRef.current;
    taskQueryRef.current = nextQuery;
    setTasksLoading(true);
    setTasksError("");
    try {
      const result = await autoUploadApi.taskPage(nextQuery);
      setTasks(result.items.filter(isDurablePublishRecord));
      setTaskPageInfo({
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        totalPages: result.totalPages,
      });
    } catch (e: unknown) {
      setTasks([]);
      setTaskPageInfo((current) => ({ ...current, total: 0 }));
      setTasksError(toPublicError(e, "发布任务暂时无法读取，请重新加载。"));
    } finally {
      setTasksLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchHealth();
    fetchAccounts();
    fetchMaterials();
    fetchLogs();
    fetchTasks();
  }, [fetchAccounts, fetchHealth, fetchLogs, fetchMaterials, fetchTasks]);

  const statusColor = health?.online ? "success" : "danger";
  const sourceDraft = React.useMemo<SourceDraft>(() => {
    const source = searchParams.get("source");
    if (source !== "article" && source !== "content-workspace") {
      return null;
    }

    const articleId = searchParams.get("articleId") || "";
    const preparationId = searchParams.get("preparationId") || "";
    const title = searchParams.get("title") || "";
    const contentType =
      searchParams.get("contentType") === "xiaohongshu"
        ? "xiaohongshu"
        : "article";
    if (!articleId) {
      return null;
    }
    return {
      articleId,
      contentType,
      preparationId: preparationId || undefined,
      source,
      title,
    };
  }, [searchParams]);
  const reusedDraft = React.useMemo<ReusedPublishDraft>(() => {
    const taskId = searchParams.get("reuseTaskId") || "";
    const title = searchParams.get("reuseTitle") || "";
    const tagsText = searchParams.get("reuseTags") || "";
    if (!taskId && !title && !tagsText) {
      return null;
    }
    return {
      taskId: taskId || undefined,
      title,
      tags: normalizeTags(tagsText.split(/[,，#\s]+/), 8),
    };
  }, [searchParams]);

  React.useEffect(() => {
    if (!sourceDraft?.articleId || sourceDraft.articleId === "test") {
      setSourceContent(null);
      setSourceContentError("");
      setSourceContentLoading(false);
      return;
    }
    if (
      sourceDraft.source === "content-workspace" &&
      !sourceDraft.preparationId
    ) {
      setSourceContent(null);
      setSourceContentLoading(false);
      setSourceContentError(
        "内容工作室交接缺少 preparationId，请返回工作区重新创建发布准备。",
      );
      return;
    }

    let cancelled = false;
    setSourceContentLoading(true);
    setSourceContentError("");
    Promise.all([
      articlesApi.getById(sourceDraft.articleId),
      sourceDraft.preparationId
        ? getPublishPreparation(sourceDraft.preparationId)
        : Promise.resolve(null),
    ])
      .then(([article, preparation]) => {
        if (cancelled) return;
        const preparedArticle = preparation
          ? {
              ...article,
              title: preparation.title,
              content: preparation.content,
              rawHtml: null,
              finalHtml: null,
            }
          : article;
        const caption =
          preparation?.content ||
          article.xiaohongshuData?.caption ||
          article.content ||
          "";
        const hashtags =
          article.xiaohongshuData?.hashtags || article.topic?.keywords || [];
        const description = preparation
          ? preparation.content
          : article.finalHtml || article.rawHtml || article.content || caption;
        setSourceContent({
          article: preparedArticle,
          caption,
          hashtags,
          description,
          preparation: preparation || undefined,
        });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setSourceContent(null);
          setSourceContentError(
            toPublicError(
              error,
              sourceDraft.preparationId
                ? "发布准备快照无法读取，请返回内容工作室重新创建。"
                : "来源文章无法读取，请返回内容库重新选择。",
            ),
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSourceContentLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    sourceDraft?.articleId,
    sourceDraft?.preparationId,
    sourceDraft?.source,
    sourceLoadAttempt,
  ]);

  const failedTaskCount = tasks.filter((task) =>
    task.status.toLowerCase().includes("fail"),
  ).length;
  const activeTaskCount = tasks.filter((task) =>
    ["pending", "queued", "running", "executing", "processing"].some(
      (status) => task.status.toLowerCase().includes(status),
    ),
  ).length;
  const completedTaskCount = tasks.filter((task) =>
    ["success", "done", "completed", "ok"].some((status) =>
      task.status.toLowerCase().includes(status),
    ),
  ).length;
  const hasPublishBlocker =
    Boolean(tasksError) || Boolean(error) || health?.online === false;
  const isPublishRecordView = selectedTab === "tasks";

  return (
    <Layout height="fill">
      <LayoutContent padding={6}>
          <VStack gap={3}>
            <HStack gap={3} hAlign="between" vAlign="start" wrap="wrap">
              <VStack gap={2}>
                <HStack gap={2} vAlign="center">
                  <Text color="secondary" type="supporting">
                    商业增长 · 发布运营
                  </Text>
                </HStack>
                <Heading level={1}>
                  {isPublishRecordView ? "发布记录" : "发布管理"}
                </Heading>
                <Text color="secondary">
                  {isPublishRecordView
                    ? "发布记录、账号明细、平台状态、失败原因、批量重新发布和删除统一在这里处理。"
                    : "创建发布任务、管理账号素材，并查看发布记录和平台反馈。"}
                </Text>
              </VStack>
              <div className="flex flex-wrap items-center gap-1.5">
                <Chip color={statusColor} size="sm" variant="flat">
                  {loading ? "检查中" : health?.online ? "本机服务可用" : "本机服务不可用"}
                </Chip>
                <Button
                  as={Link}
                  color="primary"
                  href="/distribution?tab=article"
                  size="sm"
                  variant="flat"
                >
                  新建发布任务
                </Button>
                <Button
                  as={Link}
                  href="/distribution?tab=accounts"
                  size="sm"
                  variant="flat"
                >
                  平台账号
                </Button>
                <Button
                  isLoading={loading}
                  size="sm"
                  startContent={loading ? null : <Icon icon="solar:refresh-linear" />}
                  variant="flat"
                  onPress={() => {
                    fetchHealth().catch(() => {
                      addToast({ title: "刷新失败", color: "danger" });
                    });
                  }}
                >
                  刷新
                </Button>
              </div>
            </HStack>
          </VStack>
        </LayoutContent>
      <OpsDesktopPage>
      <OpsToolbar>
        <OpsMetric label="发布记录" tone="brand" value={tasks.length} />
        <OpsMetric label="执行中" tone="warning" value={activeTaskCount} />
        <OpsMetric label="已完成" tone="success" value={completedTaskCount} />
        <OpsMetric label="失败" tone="danger" value={failedTaskCount} />
        <OpsStatusPill tone={accounts.length ? "success" : "warning"}>
          账号 {accounts.length}
        </OpsStatusPill>
        <OpsStatusPill tone={logs.length ? "brand" : "default"}>
          结果 {logs.length}
        </OpsStatusPill>
      </OpsToolbar>
      {tasksError ? (
        <FailureActionPanel
          actions={
            isAuthRuntimeError(tasksError)
              ? [
                  {
                    href: "/login?next=%2Fdistribution%3Ftab%3Dvideo",
                    label: "重新登录",
                  },
                ]
              : [
                  {
                    label: "重试读取",
                    onPress: () => {
                      fetchTasks().catch(() => {
                        addToast({ title: "刷新失败", color: "danger" });
                      });
                    },
                  },
                ]
          }
          impact="发布结果、失败原因和重试入口暂时无法回查；新发布任务仍应先确认记录服务恢复。"
          nextAction={
            isAuthRuntimeError(tasksError)
              ? "重新登录 Kaypal 账号后返回发布中心。"
              : "先重试读取任务记录；仍失败时查看设备状态或结果留存。"
          }
          reason={
            isAuthRuntimeError(tasksError)
              ? "登录状态已过期，需要重新登录后再查看发布任务记录。"
              : "发布任务记录读取失败，可能是记录服务或本机服务暂时不可用。"
          }
          technicalDetails={tasksError}
          title="发布任务记录需要处理"
        />
      ) : null}
      {hasPublishBlocker && !tasksError ? (
        <FailureActionPanel
          actions={[
            {
              label: "刷新状态",
              onPress: () => {
                fetchHealth().catch(() => {
                  addToast({ title: "刷新失败", color: "danger" });
                });
              },
            },
	            { href: "/distribution?tab=engine", label: "本机服务" },
	            { href: "/distribution?tab=accounts", label: "平台账号" },
	          ]}
          impact="发布前检查、正式发布和平台反馈可能暂停。"
          nextAction="先确认本机服务和平台账号可用，再创建发布任务。"
          reason="发布服务当前不可用，可能是本机服务、平台账号或发布前检查没有准备好。"
          technicalDetails={error}
          title="发布服务需要处理"
        />
      ) : null}
      {sourceContentError ? (
        <FailureActionPanel
          actions={[
            {
              label: "重试读取",
              onPress: () => setSourceLoadAttempt((current) => current + 1),
            },
            {
              href: sourceDraft?.articleId
                ? `/content/workspace?articleId=${encodeURIComponent(sourceDraft.articleId)}`
                : "/content/workspace",
              label: "返回内容工作室",
            },
          ]}
          impact="发布表单不会使用旧文章或不完整快照；在来源恢复前不能继续创建发布任务。"
          nextAction="先重试读取；仍失败时返回内容工作室重新保存正式版本并创建发布准备。"
          reason="内容工作室的发布准备快照或来源文章读取失败。"
          technicalDetails={sourceContentError}
          title="内容工作室交接需要处理"
        />
      ) : null}
      {sourceContent?.preparation ? (
        <OpsToolbar>
          <OpsStatusPill tone="success">内容工作室准备已载入</OpsStatusPill>
          <span className="text-[12px] text-default-500">
            准备记录 {sourceContent.preparation.id} · 发布前仍需确认账号、素材和平台
          </span>
        </OpsToolbar>
      ) : null}
      {selectedTab === "article" && !sourceContentError ? (
        <PublishPanel
          accounts={accounts}
          accountsLoading={accountsLoading}
          health={health}
          materials={materials}
          materialsLoading={materialsLoading}
          onMaterialsRefresh={fetchMaterials}
          onTasksRefresh={fetchTasks}
          sourceContent={sourceContent}
          sourceContentLoading={sourceContentLoading}
          sourceDraft={sourceDraft}
          reusedDraft={reusedDraft}
          tasksError={tasksError}
          variant="article"
        />
      ) : null}
      {selectedTab === "video" && !sourceContentError ? (
        <PublishPanel
          accounts={accounts}
          accountsLoading={accountsLoading}
          health={health}
          materials={materials}
          materialsLoading={materialsLoading}
          onMaterialsRefresh={fetchMaterials}
          onTasksRefresh={fetchTasks}
          sourceContent={sourceContent}
          sourceContentLoading={sourceContentLoading}
          sourceDraft={sourceDraft}
          reusedDraft={reusedDraft}
          tasksError={tasksError}
          variant="video"
        />
      ) : null}
      {selectedTab === "accounts" ? (
        <AccountsPanel
          accounts={accounts}
          error={accountsError}
          loading={accountsLoading}
          onRefresh={fetchAccounts}
          onSetAccounts={setAccounts}
        />
      ) : null}
      {selectedTab === "materials" ? (
        <MaterialsPanel
          error={materialsError}
          loading={materialsLoading}
          materials={materials}
          onRefresh={fetchMaterials}
        />
      ) : null}
      {selectedTab === "compliance" ? <ComplianceWorkbench /> : null}
      {selectedTab === "tasks" ? (
        <TasksPanel
          error={tasksError}
          loading={tasksLoading}
          onRefresh={fetchTasks}
          onQueryChange={fetchTasks}
          pagination={taskPageInfo}
          tasks={tasks}
        />
      ) : null}
      {selectedTab === "engine" ? (
        <EnginePanel
          error={error}
          health={health}
          loading={loading}
          onRefresh={fetchHealth}
        />
      ) : null}
      {selectedTab === "logs" ? (
        <LogsPanel
          error={logsError}
          loading={logsLoading}
          logs={logs}
          onRefresh={fetchLogs}
        />
      ) : null}
    </OpsDesktopPage>
    </Layout>
  );
}

const sourceTabKeys = [
  "article",
  "video",
  "materials",
  "accounts",
  "compliance",
  "engine",
  "tasks",
  "logs",
];
function MaterialPathSelect({
  label,
  materials,
  value,
  onChange,
}: {
  label: string;
  materials: AutoUploadMaterial[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-tiny font-medium text-default-600">{label}</span>
      <select
        className="h-10 rounded-[8px] border-small border-divider bg-background px-3 text-small text-default-800 outline-none transition-colors focus:border-primary"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">不指定</option>
        {materials
          .filter((material) => material.filePath)
          .map((material) => (
            <option
              key={`${label}-${material.id}`}
              value={material.filePath || ""}
            >
              {displayFileName(material.filename)}
            </option>
          ))}
      </select>
    </label>
  );
}

function PublishPanel({
  accounts,
  accountsLoading,
  health,
  materials,
  materialsLoading,
  onMaterialsRefresh,
  onTasksRefresh,
  reusedDraft,
  sourceContent,
  sourceContentLoading,
  sourceDraft,
  tasksError,
  variant,
}: {
  accounts: AutoUploadAccount[];
  accountsLoading: boolean;
  health: AutoUploadEngineHealth | null;
  materials: AutoUploadMaterial[];
  materialsLoading: boolean;
  onMaterialsRefresh: () => Promise<void>;
  onTasksRefresh: () => Promise<void>;
  reusedDraft: ReusedPublishDraft;
  sourceContent: SourceContent;
  sourceContentLoading: boolean;
  sourceDraft: SourceDraft;
  tasksError?: string;
  variant: "article" | "video";
}) {
  const normalAccounts = React.useMemo(
    () => accounts.filter((account) => account.status === 1),
    [accounts],
  );
  const invalidAccounts = React.useMemo(
    () => accounts.filter((account) => account.status !== 1),
    [accounts],
  );
  const [selectedAccountKeys, setSelectedAccountKeys] = React.useState<
    string[]
  >([]);
  const [selectedMaterialPaths, setSelectedMaterialPaths] = React.useState<
    string[]
  >([]);
  const [materialQuery, setMaterialQuery] = React.useState("");
  const [visibleMaterialCount, setVisibleMaterialCount] =
    React.useState(MATERIAL_PAGE_SIZE);
  const [title, setTitle] = React.useState("");
  const [tagsText, setTagsText] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [timerEnabled, setTimerEnabled] = React.useState(false);
  const [videosPerDay, setVideosPerDay] = React.useState("1");
  const [dailyTimesText, setDailyTimesText] = React.useState("10:00");
  const [startDays, setStartDays] = React.useState("0");
  const [timeJitterMinutes, setTimeJitterMinutes] = React.useState("0");
  const [scheduleTime, setScheduleTime] = React.useState("");
  const [coverPath, setCoverPath] = React.useState("");
  const [coverPath34, setCoverPath34] = React.useState("");
  const [coverPath43, setCoverPath43] = React.useState("");
  const [coverPath169, setCoverPath169] = React.useState("");
  const [biliTitle, setBiliTitle] = React.useState("");
  const [biliType, setBiliType] = React.useState("自制");
  const [biliPartition, setBiliPartition] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [importingSource, setImportingSource] = React.useState(false);
  const [realPublishEnabled, setRealPublishEnabled] = React.useState(false);
  const [publishWorkflowPhase, setPublishWorkflowPhase] =
    React.useState<PublishWorkflowPhase>("draft");
  const filteredMaterials = React.useMemo(() => {
    const query = materialQuery.trim().toLocaleLowerCase("zh-CN");
    if (!query) return materials;

    return materials.filter((material) =>
      [material.filename, material.filePath]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLocaleLowerCase("zh-CN").includes(query)),
    );
  }, [materialQuery, materials]);
  const visibleMaterials = React.useMemo(
    () => filteredMaterials.slice(0, visibleMaterialCount),
    [filteredMaterials, visibleMaterialCount],
  );
  const [latestPublishSession, setLatestPublishSession] =
    React.useState<AgentSession | null>(null);
  const [activePublishSession, setActivePublishSession] =
    React.useState<AgentSession | null>(null);
  const [confirmPublishOpen, setConfirmPublishOpen] = React.useState(false);
  const [statusMessage, setStatusMessage] = React.useState("");
  const [publishResults, setPublishResults] = React.useState<
    PublishResultItem[]
  >([]);
  const [preflightResult, setPreflightResult] =
    React.useState<AutoUploadPublishPreflightResult | null>(null);
  const [sourceArticles, setSourceArticles] = React.useState<Article[]>([]);
  const [sourceArticlesLoading, setSourceArticlesLoading] =
    React.useState(false);
  const [sourceArticlesError, setSourceArticlesError] = React.useState("");
  const [selectedSourceArticleId, setSelectedSourceArticleId] = React.useState(
    sourceDraft?.articleId || "",
  );
  const latestVideoClipAppliedRef = React.useRef("");
  const latestVideoClip =
    variant === "video" ? readLatestVideoWorkshopClip() : null;

  const fetchSourceArticles = React.useCallback(async () => {
    if (variant !== "article") {
      return;
    }

    setSourceArticlesLoading(true);
    setSourceArticlesError("");
    try {
      const [articleResult, noteResult] = await Promise.all([
        articlesApi.list({ page: 1, limit: 12, contentType: "article" }),
        articlesApi
          .list({ page: 1, limit: 12, contentType: "xiaohongshu" })
          .catch(() => null),
      ]);
      const byId = new Map<string, Article>();
      for (const article of [
        ...articleResult.items,
        ...(noteResult?.items || []),
      ]) {
        byId.set(article.id, article);
      }
      setSourceArticles(
        Array.from(byId.values())
          .sort(
            (left, right) =>
              sourceArticleTimestamp(right) - sourceArticleTimestamp(left),
          )
          .slice(0, 12),
      );
    } catch (error: unknown) {
      setSourceArticles([]);
      setSourceArticlesError(
        toPublicError(error, "内容来源暂时无法读取，请重新加载。"),
      );
    } finally {
      setSourceArticlesLoading(false);
    }
  }, [variant]);

  React.useEffect(() => {
    void fetchSourceArticles();
  }, [fetchSourceArticles]);

  React.useEffect(() => {
    setSelectedSourceArticleId(sourceDraft?.articleId || "");
  }, [sourceDraft?.articleId]);

  const reusedDraftTaskId = reusedDraft?.taskId || "";
  const reusedDraftTitle = reusedDraft?.title || "";
  const reusedDraftTagsText = reusedDraft?.tags.join(" ") || "";

  React.useEffect(() => {
    if (!reusedDraftTaskId && !reusedDraftTitle && !reusedDraftTagsText) {
      return;
    }
    if (reusedDraftTitle) {
      setTitle(reusedDraftTitle);
      setBiliTitle((current) => current || reusedDraftTitle);
    }
    if (reusedDraftTagsText) {
      setTagsText(reusedDraftTagsText);
    }
    setPublishWorkflowPhase("draft");
    setStatusMessage(
      reusedDraftTaskId
        ? `已载入发布任务 #${reusedDraftTaskId} 的标题和标签，请重新确认账号、素材和发布方式。`
        : "已载入复用草稿，请重新确认账号、素材和发布方式。",
    );
  }, [reusedDraftTagsText, reusedDraftTaskId, reusedDraftTitle]);

  const selectedSourceArticle = React.useMemo(() => {
    if (sourceContent?.article.id === selectedSourceArticleId) {
      return sourceContent.article;
    }
    return (
      sourceArticles.find(
        (article) => article.id === selectedSourceArticleId,
      ) || null
    );
  }, [selectedSourceArticleId, sourceArticles, sourceContent]);

  React.useEffect(() => {
    if (!sourceDraft?.title) {
      return;
    }

    setTitle((current) => current || sourceDraft.title);
  }, [sourceDraft?.articleId, sourceDraft?.title]);

  React.useEffect(() => {
    if (!sourceContent) {
      return;
    }

    setTitle((current) => current || sourceContent.article.title);
    setBiliTitle((current) => current || sourceContent.article.title);
    setTagsText((current) => current || sourceContent.hashtags.join(" "));
    setDescription(
      (current) =>
        current || sourceContent.caption || sourceContent.description,
    );
    setSelectedSourceArticleId(sourceContent.article.id);
  }, [sourceContent]);

  React.useEffect(() => {
    setSelectedAccountKeys((current) =>
      current.filter((key) =>
        normalAccounts.some((account) => accountIdentityKey(account) === key),
      ),
    );
  }, [normalAccounts]);

  React.useEffect(() => {
    const latestClipPath = latestVideoClip?.outputPath || "";
    setSelectedMaterialPaths((current) =>
      current.filter(
        (path) =>
          path === latestClipPath ||
          materials.some((material) => material.filePath === path),
      ),
    );
  }, [latestVideoClip?.outputPath, materials]);

  React.useEffect(() => {
    if (variant !== "video") return;
    const latestClip = latestVideoClip;
    if (
      !latestClip?.outputPath ||
      latestVideoClipAppliedRef.current === latestClip.outputPath
    ) {
      return;
    }

    latestVideoClipAppliedRef.current = latestClip.outputPath;
    setSelectedMaterialPaths((current) =>
      current.includes(latestClip.outputPath)
        ? current
        : [latestClip.outputPath, ...current],
    );
    const latestClipTitle = displayFileName(
      latestClip.outputName,
      "视频工坊成片",
    ).replace(/\.mp4$/i, "");
    setTitle(
      (current) => current || latestClipTitle,
    );
    setBiliTitle(
      (current) => current || latestClipTitle,
    );
    setDescription(
      (current) =>
        current || latestClip.message || "视频工坊成片已生成，可直接发布。",
    );
    setStatusMessage(`已带入视频工坊成片：${latestClipTitle}`);
  }, [latestVideoClip, variant]);

  React.useEffect(() => {
    const existingPaths = new Set(
      materials.map((material) => material.filePath).filter(Boolean),
    );
    if (coverPath && !existingPaths.has(coverPath)) setCoverPath("");
    if (coverPath34 && !existingPaths.has(coverPath34)) setCoverPath34("");
    if (coverPath43 && !existingPaths.has(coverPath43)) setCoverPath43("");
    if (coverPath169 && !existingPaths.has(coverPath169)) setCoverPath169("");
  }, [coverPath, coverPath169, coverPath34, coverPath43, materials]);

  const selectedAccounts = React.useMemo(
    () =>
      normalAccounts
        .filter((account) =>
          selectedAccountKeys.includes(accountIdentityKey(account)),
        )
        .sort(
          (a, b) =>
            (publishPlatformOrder[a.type] ?? 99) -
            (publishPlatformOrder[b.type] ?? 99),
        ),
    [normalAccounts, selectedAccountKeys],
  );
  const publishBlockers = React.useMemo<LocalEngineActionBlocker[]>(() => {
    const items: LocalEngineActionBlocker[] = [];
    const target = title.trim() || "未填写标题";
    if (!health?.online) {
      items.push({
        platform: "本机发布服务",
        account: "自动化服务",
        target,
        stage: "发布提交",
        reason: "本机发布服务离线，无法提交发布前检查或正式发布。",
        nextAction: "先到运行检查确认本机服务和浏览器权限状态。",
        capability: "auto-upload-engine",
      });
    }
    if (tasksError) {
      const authError = isAuthRuntimeError(tasksError);
      items.push({
        platform: "Kaypal 工作台",
        account: authError ? "授权已失效" : "发布任务记录",
        target,
        stage: "结果回查",
        reason: `发布任务记录不可用：${cleanUserFacingRuntimeText(tasksError)}`,
        nextAction: authError
          ? "重新登录 Kaypal 账号后再提交发布，确保发布结果可回查。"
          : "先恢复发布任务记录读取，再提交发布，确保发布结果可回查。",
        capability: "evidence",
      });
    }
    if (!normalAccounts.length) {
      items.push({
        platform: "发布平台",
        account: "无可用平台账号",
        target,
        stage: "账号选择",
        reason: "没有已登录且可用的平台账号。",
        nextAction: "到平台账号页完成登录、重登或账号校验。",
        capability: "account",
      });
    }
    if (!selectedAccounts.length) {
      items.push({
        platform: "发布平台",
        account: "未选择账号",
        target,
        stage: "账号选择",
        reason: "发布任务必须绑定至少一个可用账号。",
        nextAction: "勾选一个可用平台账号。",
        capability: "account",
      });
    }
    if (!selectedMaterialPaths.length) {
      items.push({
        platform:
          selectedAccounts.map((account) => account.platform).join("、") ||
          "发布平台",
        account:
          selectedAccounts
            .map((account) => account.profileName || account.userName)
            .join("、") || "未选择账号",
        target,
        stage: "素材选择",
        reason: "没有选择可发布素材。",
        nextAction: "选择已上传的素材；缺少素材时先上传或从内容库导入。",
        capability: "materials",
      });
    }
    return items;
  }, [
    health?.online,
    normalAccounts.length,
    selectedAccounts,
    selectedMaterialPaths.length,
    tasksError,
    title,
  ]);
  const canSubmitPublish = publishBlockers.length === 0;
  const publishWorkflowMode: PublishWorkflowMode = realPublishEnabled
    ? "real"
    : "dry-run";
  const effectivePublishWorkflowPhase: PublishWorkflowPhase =
    publishBlockers.length && !submitting ? "blocked" : publishWorkflowPhase;
  const draftTags = React.useMemo(
    () => normalizeTags(tagsText.split(/[,，#\s]+/), 8),
    [tagsText],
  );

  const handleRealPublishModeChange = (value: boolean) => {
    setRealPublishEnabled(value);
    setPublishWorkflowPhase("draft");
    setLatestPublishSession(null);
    setActivePublishSession(null);
    setPreflightResult(null);
    setPublishResults([]);
    setStatusMessage("");
  };

  const toggleAccount = (account: AutoUploadAccount, checked: boolean) => {
    const key = accountIdentityKey(account);
    setSelectedAccountKeys((current) => {
      if (checked) {
        return current.includes(key) ? current : [...current, key];
      }
      return current.filter((item) => item !== key);
    });
  };

  const toggleMaterial = (filePath: string | null, checked: boolean) => {
    if (!filePath) return;
    setSelectedMaterialPaths((current) => {
      if (checked) {
        return current.includes(filePath) ? current : [...current, filePath];
      }
      return current.filter((path) => path !== filePath);
    });
  };

  const applySourceArticle = React.useCallback((article: Article) => {
    const caption = article.xiaohongshuData?.caption || "";
    const hashtags = article.xiaohongshuData?.hashtags?.length
      ? article.xiaohongshuData.hashtags
      : article.topic?.keywords || [];
    const nextDescription =
      caption || article.finalHtml || article.rawHtml || article.content || "";

    setSelectedSourceArticleId(article.id);
    setTitle(article.title);
    setBiliTitle(article.title);
    setTagsText(hashtags.join(" "));
    setDescription(nextDescription);
    setStatusMessage(`已载入内容来源：${article.title}`);
  }, []);

  const importSourceMaterials = async () => {
    const sourceArticleId =
      selectedSourceArticleId || sourceDraft?.articleId || "";
    if (!sourceArticleId) {
      return;
    }

    setImportingSource(true);
    setStatusMessage("正在把来源内容的卡图导入本地素材库...");
    try {
      const result =
        await autoUploadApi.importArticleMaterials(sourceArticleId);
      const importedPaths = result.imported
        .map((material) => material.filePath)
        .filter((path): path is string => Boolean(path));
      setSelectedMaterialPaths((current) =>
        Array.from(new Set([...current, ...importedPaths])),
      );
      await onMaterialsRefresh();
      setStatusMessage(`已导入 ${importedPaths.length} 个素材到本地素材库。`);
      addToast({
        title: "卡图已导入",
        description: result.failures.length
          ? `有 ${result.failures.length} 张卡图导入失败`
          : undefined,
        color: result.failures.length ? "warning" : "success",
      });
    } catch (e: unknown) {
      const message = toPublicError(e, "素材未导入，请检查后重试。");
      setStatusMessage(message);
      addToast({
        title: "素材导入失败",
        description: message,
        color: "danger",
      });
    } finally {
      setImportingSource(false);
    }
  };

  const validatePublishForm = () => {
    const finalTitle = title.trim();
    if (!finalTitle) {
      addToast({ title: "请填写发布标题", color: "warning" });
      return null;
    }
    if (!selectedAccounts.length) {
      addToast({ title: "请选择发布账号", color: "warning" });
      return null;
    }
    if (!selectedMaterialPaths.length) {
      addToast({ title: "请选择发布素材", color: "warning" });
      return null;
    }
    if (variant === "article" && !selectedSourceArticle) {
      addToast({ title: "请选择来源文章", color: "warning" });
      return null;
    }

    const tags = tagsText
      .split(/[,，#\s]+/)
      .map((tag) => tag.trim())
      .filter(Boolean);
    const dailyTimes = dailyTimesText
      .split(/[,，\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);

    return { finalTitle, tags, dailyTimes };
  };

  const buildPublishPayloads = (
    formData: NonNullable<ReturnType<typeof validatePublishForm>>,
    dryRun: boolean,
  ): AutoUploadPublishPayload[] => {
    const ratioCoverPaths = {
      ...(coverPath34 ? { "3:4": coverPath34 } : {}),
      ...(coverPath43 ? { "4:3": coverPath43 } : {}),
      ...(coverPath169 ? { "16:9": coverPath169 } : {}),
    };

    return selectedAccounts.map((account) => {
      const rules = platformPublishRules[account.type] || {
        titleLimit: 80,
        tagLimit: 5,
      };
      const finalBiliTitle = biliTitle.trim() || formData.finalTitle;
      const platformTitle =
        account.type === 5 ? finalBiliTitle : formData.finalTitle;

      return {
        type: account.type,
        accountIds: [account.id],
        contentKind: variant,
        articleId:
          variant === "article" ? selectedSourceArticle?.id : undefined,
        body:
          variant === "article" && selectedSourceArticle
            ? getSourceArticleBody(selectedSourceArticle)
            : undefined,
        sourceIdentity:
          variant === "article" && selectedSourceArticle
            ? {
                sourceType: "article" as const,
                sourceId: selectedSourceArticle.id,
                title: selectedSourceArticle.title,
                contentType: selectedSourceArticle.contentType,
                contentFormat: selectedSourceArticle.contentFormat,
                updatedAt: selectedSourceArticle.updatedAt,
              }
            : undefined,
        accountIdentity: {
          id: account.stableId || String(account.id),
          name:
            account.accountName ||
            account.profileName ||
            account.userName ||
            `账号 ${account.id}`,
          platform: account.platformKey || accountPlatformSlug(account),
          status:
            account.statusCode ||
            (account.status === 1 ? "ready" : "expired"),
        },
        title: trimTitleForPlatform(platformTitle, account.type),
        tags: normalizeTags(formData.tags, rules.tagLimit),
        fileList: selectedMaterialPaths,
        accountList: [account.filePath],
        enableTimer: timerEnabled ? (1 as const) : (0 as const),
        videosPerDay: Number(videosPerDay) || 1,
        dailyTimes: formData.dailyTimes.length
          ? formData.dailyTimes
          : ["10:00"],
        startDays: Number(startDays) || 0,
        timeJitterMinutes: Number(timeJitterMinutes) || 0,
        scheduleTime: scheduleTime.trim() || undefined,
        debugDryRun: dryRun,
        debugDryRunHoldBrowser: dryRun,
        category: 0,
        coverPath: coverPath || undefined,
        coverPaths: Object.keys(ratioCoverPaths).length
          ? ratioCoverPaths
          : undefined,
        biliDesc: description.trim() || undefined,
        biliTitle: trimTitleForPlatform(finalBiliTitle, 5),
        biliType: biliType.trim() || undefined,
        biliPartition: biliPartition.trim() || undefined,
      };
    });
  };

  const runPublishPreflight = async (payloads: AutoUploadPublishPayload[]) => {
    const result = await autoUploadApi.preflight(payloads);
    setPreflightResult(result);
    if (!result.ok) {
      const details = result.issues.map(formatPreflightIssue).join("\n");
      setStatusMessage(details);
      addToast({
        title: "发布前检查未通过",
        description: result.issues[0]
          ? formatPreflightIssue(result.issues[0])
          : result.summary,
        color: "danger",
      });
      return result;
    }
    return result;
  };

  const buildPublishStatusSession = (
    formData: NonNullable<ReturnType<typeof validatePublishForm>>,
    options: {
      dryRun: boolean;
      message?: string;
      payloadCount: number;
      preflight?: AutoUploadPublishPreflightResult | null;
      resultItems?: PublishResultItem[];
      sessionId?: string;
      status: AgentSession["status"];
      statusLabel: string;
    },
  ): AgentSession => {
    const now = new Date().toISOString();
    const sessionId = options.sessionId || `interaction-task:publish-submit:${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`;
    const results = options.resultItems || [];
    const failures = results.filter((item) => item.ok === false);
    const pending = results.filter(
      (item) => item.ok !== true && item.ok !== false,
    );
    const succeeded = results.filter((item) => item.ok === true);
    const preflightIssues = options.preflight?.issues || [];
    const resultEvidenceCount = results.filter(hasPublishTaskEvidence).length;
    const planSummary = [
      `标题：${formData.finalTitle}`,
      `平台账号：${selectedAccounts.length} 个`,
      `素材：${selectedMaterialPaths.length} 个`,
      `标签：${formData.tags.join("、") || "未填写"}`,
      timerEnabled
        ? `定时：${formData.dailyTimes.join("、") || dailyTimesText}`
        : "不启用定时发布",
    ].join("；");
    const failureMessage =
      failures[0]?.message ||
      failures[0]?.nextAction ||
      preflightIssues[0]?.nextAction ||
      preflightIssues[0]?.message ||
      options.message ||
      "";
    const events = [
      {
        createdAt: now,
        evidence: {
          label: "发布计划",
          type: "stage_log" as const,
          value: planSummary,
        },
        id: `${sessionId}:plan`,
        level: "info" as const,
        message: planSummary,
        sessionId,
        title: "发布计划已创建",
      },
      ...(options.preflight
        ? [
            {
              createdAt: now,
              evidence: {
                label: "发布前检查",
                type: options.preflight.ok
                  ? ("stage_log" as const)
                  : ("failure_reason" as const),
                value: options.preflight.ok
                  ? options.preflight.summary
                  : preflightIssues.map(formatPreflightIssue).join("；") ||
                    options.preflight.summary,
              },
              id: `${sessionId}:preflight`,
              level: options.preflight.ok
                ? ("success" as const)
                : ("error" as const),
              message: options.preflight.ok
                ? "账号、素材和发布参数已完成检查。"
                : preflightIssues[0]
                  ? formatPreflightIssue(preflightIssues[0])
                  : options.preflight.summary,
              sessionId,
              title: options.preflight.ok ? "发布前检查通过" : "发布前检查未通过",
            },
          ]
        : []),
      ...results.slice(0, 6).map((item, index) => {
        const receipt = publishReceiptValue(item);
        const evidenceValue =
          receipt || formatPublishEvidenceValue(item.evidence) || item.message;
        return {
          createdAt: now,
          evidence: evidenceValue
            ? {
                label: receipt ? "平台反馈" : "过程记录",
                type: receipt ? ("text" as const) : ("stage_log" as const),
                value: cleanUserFacingRuntimeText(String(evidenceValue)),
              }
            : undefined,
          id: `${sessionId}:result:${index}`,
          level:
            item.ok === true
              ? ("success" as const)
              : item.ok === false
                ? ("error" as const)
                : ("warning" as const),
          message:
            cleanUserFacingRuntimeText(
              item.message || item.nextAction || "等待平台反馈或结果确认",
            ) || "等待平台反馈或结果确认",
          sessionId,
          title: item.platform || `平台 ${item.type}`,
        };
      }),
    ];

    return {
      completedAt: options.status === "completed" ? now : undefined,
      confirmations: [],
      createdAt: now,
      events,
      executionScope: "browser",
      failureReason: failureMessage || undefined,
      id: sessionId,
      instruction: [
        options.dryRun
          ? "查看本次发布前检查的过程、结果和下一步处理方式。"
          : "查看本次正式发布的确认、执行和结果留存。",
        `结果：成功 ${succeeded.length}，失败 ${failures.length}，待处理 ${pending.length}。`,
        failureMessage
          ? `下一步：${cleanUserFacingRuntimeText(failureMessage)}`
          : resultEvidenceCount
            ? "下一步：核对平台反馈，并在发布记录中查看明细。"
            : "下一步：等待平台反馈或结果确认记录。",
      ].join("\n"),
      metadata: {
        evidenceCount: resultEvidenceCount + (options.preflight ? 1 : 0),
        payloadCount: options.payloadCount,
        source: "publish-submit-status",
        agentSessionId: options.sessionId,
      },
      nextAction: failureMessage
        ? cleanUserFacingRuntimeText(failureMessage)
        : "查看发布记录和结果留存。",
      riskLevel: options.dryRun ? "low" : "medium",
      source: "publishing",
      status: options.status,
      statusLabel: options.statusLabel,
      targetApp: "发布中心",
      title: `${options.dryRun ? "发布前检查" : "发布任务"}：${formData.finalTitle}`,
      updatedAt: now,
    };
  };

  const submitPublish = async (dryRun: boolean) => {
    const formData = validatePublishForm();
    if (!formData) {
      return;
    }
    if (publishBlockers.length) {
      addToast({
        title: "发布需处理",
        description: publishBlockers[0].nextAction,
        color: "warning",
      });
      return;
    }

    const payloads = buildPublishPayloads(formData, dryRun);

    setSubmitting(true);
    setPublishResults([]);
    setLatestPublishSession(null);
    setActivePublishSession(null);
    setPreflightResult(null);
    setPublishWorkflowPhase("preflight");
    setStatusMessage(
      "正在检查 发布服务 在线、账号登录态、素材/封面可读和平台参数...",
    );
    try {
      const preflight = await runPublishPreflight(payloads);
      if (!preflight.ok) {
        const session = buildPublishStatusSession(formData, {
          dryRun,
          message: preflight.issues[0]
            ? formatPreflightIssue(preflight.issues[0])
            : preflight.summary,
          payloadCount: payloads.length,
          preflight,
          status: "failed",
          statusLabel: "发布前检查未通过",
        });
        setLatestPublishSession(session);
        setActivePublishSession(session);
        setPublishWorkflowPhase("failed");
        return;
      }
      setPublishWorkflowPhase("executing");
      setStatusMessage(
        dryRun
          ? "发布前检查通过，正在提交发布前检查..."
          : "发布前检查通过，正在提交正式发布任务...",
      );
      const publishConfirmation = dryRun
        ? null
        : await autoUploadApi.createPublishConfirmation(payloads);
      const result = await autoUploadApi.publish(
        payloads,
        publishConfirmation?.confirmationId,
      );
      const accountByType = new Map(
        selectedAccounts.map((account) => [account.type, account]),
      );
      const resultItems = normalizePublishResultItems(result).map((item) => {
        const account = accountByType.get(item.type);
        return {
          ...item,
          platform: item.platform || account?.platform || `平台 ${item.type}`,
          accountName:
            item.account ||
            account?.profileName ||
            account?.userName ||
            account?.filePath,
        };
      });
      setPublishResults(resultItems);
      const failures = resultItems.filter((item) => item.ok === false);
      const succeeded = resultItems.filter((item) => item.ok === true);
      const pending = resultItems.filter(
        (item) => item.ok !== true && item.ok !== false,
      );
      const agentSessionId = result?.agentSessionId;
      const attemptSession = buildPublishStatusSession(formData, {
        dryRun,
        message:
          failures[0]?.message ||
          failures[0]?.nextAction ||
          pending[0]?.nextAction ||
          pending[0]?.message ||
          "",
        payloadCount: payloads.length,
        preflight,
        resultItems,
        sessionId: agentSessionId,
        status: failures.length
          ? "failed"
          : pending.length
            ? "running"
            : "completed",
        statusLabel: failures.length
          ? dryRun
            ? "发布前检查失败"
            : "发布失败"
          : pending.length
            ? "等待平台反馈"
            : dryRun
              ? "发布前检查完成"
              : "已完成",
      });
      let resolvedAttemptSession = attemptSession;
      if (agentSessionId) {
        try {
          resolvedAttemptSession = await localEngineApi.agentSession(
            agentSessionId,
          );
        } catch {
          // 兼容旧执行器：发布结果已经返回时，保留当前页的结果会话。
        }
      }
      setLatestPublishSession(resolvedAttemptSession);
      setActivePublishSession(resolvedAttemptSession);
      if (failures.length) {
        setPublishWorkflowPhase("failed");
        setStatusMessage(
          failures
            .map((item) =>
              formatFailureContext({
                platform: item.platform || `平台 ${item.type}`,
                account: item.accountName || item.account || "未识别账号",
                target: formData.finalTitle,
                stage: dryRun ? "发布前检查" : "正式发布",
                reason: item.message || "发布失败",
                nextAction: "检查平台登录态、素材和页面权限后重试。",
              }),
            )
            .join("\n"),
        );
        addToast({
          title: dryRun ? "发布前检查失败" : "正式发布失败",
          color: "danger",
        });
        return;
      }

      setStatusMessage(
        resultItems.length
          ? `已提交 ${payloads.length} 个平台的${dryRun ? "发布前检查" : "正式发布任务"}：平台已反馈 ${succeeded.length}，等待反馈 ${pending.length}。`
          : `已提交 ${payloads.length} 个平台的${dryRun ? "发布前检查" : "正式发布任务"}。`,
      );
      setPublishWorkflowPhase("evidence");
      addToast({
        title: dryRun ? "已提交发布前检查" : "正式发布任务已提交，等待平台记录",
        color: pending.length ? "warning" : "success",
      });
      await onTasksRefresh();
    } catch (e: unknown) {
      const message = toPublicError(e, "发布任务未提交，请检查后重试。");
      const failure = formatFailureContext({
        platform:
          selectedAccounts.map((account) => account.platform).join("、") ||
          "发布平台",
        account:
          selectedAccounts
            .map((account) => account.profileName || account.userName)
            .join("、") || "未选择账号",
        target: formData.finalTitle,
        stage: dryRun ? "发布前检查提交" : "正式发布提交",
        reason: message,
        nextAction: "确认发布服务在线、账号可用、素材已上传后重试。",
      });
      setPublishWorkflowPhase("failed");
      setStatusMessage(failure);
      addToast({ title: "提交失败", description: failure, color: "danger" });
    } finally {
      setSubmitting(false);
      setConfirmPublishOpen(false);
    }
  };

  const submitPublishConfirmation = async () => {
    const formData = validatePublishForm();
    if (!formData) {
      return;
    }
    if (publishBlockers.length) {
      addToast({
        title: "正式发布需处理",
        description: publishBlockers[0].nextAction,
        color: "warning",
      });
      return;
    }

    setSubmitting(true);
    setPublishWorkflowPhase("confirmation");
    setLatestPublishSession(null);
    setActivePublishSession(null);
    setStatusMessage("正在创建统一发布确认，会进入“待我确认”后继续。");
    try {
      const payloads = buildPublishPayloads(formData, false);
      const platformNames = selectedAccounts
        .map(
          (account) =>
            account.platform ||
            account.profileName ||
            account.userName ||
            account.filePath,
        )
        .join("、");
      const session = await localEngineApi.createAgentSession({
        source: "publishing",
        executionScope: "browser",
        targetApp: "本机发布服务",
        dryRun: true,
        commercialExecutionRequested: true,
        title: `正式发布确认：${formData.finalTitle}`,
        resumeAction: {
          kind: "auto-upload-publish",
          label: `正式发布《${formData.finalTitle}》`,
          payloads,
        },
        instruction: [
          `准备正式发布内容《${formData.finalTitle}》。`,
          `平台账号：${platformNames || `${selectedAccounts.length} 个账号`}。`,
          `素材数量：${selectedMaterialPaths.length}。`,
          `标签：${formData.tags.join("、") || "未填写"}。`,
          timerEnabled
            ? `定时发布：${formData.dailyTimes.join("、") || dailyTimesText}`
            : "不启用定时发布。",
          "请先进入待我确认；确认后再由本机发布服务继续执行正式发布。",
        ].join("\n"),
      });
      setStatusMessage(
        `已创建发布确认：${session.title}。请到“待我确认”继续。`,
      );
      setLatestPublishSession(session);
      setActivePublishSession(session);
      setPublishWorkflowPhase("queued");
      addToast({
        title: "已进入待我确认",
        description: "正式发布不会直接提交，确认后才继续原会话。",
        color: "success",
      });
    } catch (e: unknown) {
      const message = toPublicError(e, "发布确认未创建，请稍后重试。");
      const failure = formatFailureContext({
        platform:
          selectedAccounts.map((account) => account.platform).join("、") ||
          "发布平台",
        account:
          selectedAccounts
            .map((account) => account.profileName || account.userName)
            .join("、") || "未选择账号",
        target: formData.finalTitle,
        stage: "创建正式发布确认",
        reason: message,
        nextAction:
          "确认本机发布服务可用后重试；正式发布仍需要再次确认。",
      });
      setPublishWorkflowPhase("failed");
      setStatusMessage(failure);
      addToast({
        title: "确认创建失败",
        description: failure,
        color: "danger",
      });
    } finally {
      setSubmitting(false);
      setConfirmPublishOpen(false);
    }
  };

  const handleSubmit = async () => {
    if (!realPublishEnabled) {
      await submitPublish(true);
      return;
    }

    const formData = validatePublishForm();
    if (!formData) {
      return;
    }
    if (publishBlockers.length) {
      addToast({
        title: "发布需处理",
        description: publishBlockers[0].nextAction,
        color: "warning",
      });
      return;
    }

    const payloads = buildPublishPayloads(formData, false);
    setSubmitting(true);
    setPublishResults([]);
    setLatestPublishSession(null);
    setActivePublishSession(null);
    setPreflightResult(null);
    setPublishWorkflowPhase("preflight");
    setStatusMessage(
      "正在检查 发布服务 在线、账号登录态、素材/封面可读和平台参数...",
    );
    try {
      const preflight = await runPublishPreflight(payloads);
      if (!preflight.ok) {
        const session = buildPublishStatusSession(formData, {
          dryRun: false,
          message: preflight.issues[0]
            ? formatPreflightIssue(preflight.issues[0])
            : preflight.summary,
          payloadCount: payloads.length,
          preflight,
          status: "failed",
          statusLabel: "发布前检查未通过",
        });
        setLatestPublishSession(session);
        setActivePublishSession(session);
        setPublishWorkflowPhase("failed");
        return;
      }
      const session = buildPublishStatusSession(formData, {
        dryRun: false,
        message: "发布前检查通过，请完成正式发布确认。",
        payloadCount: payloads.length,
        preflight,
        status: "waiting_for_confirmation",
        statusLabel: "待我确认",
      });
      setLatestPublishSession(session);
      setActivePublishSession(session);
      setPublishWorkflowPhase("confirmation");
      setStatusMessage("发布前检查通过，请完成正式发布确认。");
      setConfirmPublishOpen(true);
    } catch (e: unknown) {
      const message = toPublicError(e, "发布检查未完成，请稍后重试。");
      const failure = formatFailureContext({
        platform:
          selectedAccounts.map((account) => account.platform).join("、") ||
          "发布平台",
        account:
          selectedAccounts
            .map((account) => account.profileName || account.userName)
            .join("、") || "未选择账号",
        target: formData.finalTitle,
        stage: "发布前检查",
        reason: message,
        nextAction: "确认发布服务在线、账号可用、素材已上传后重试。",
      });
      setPublishWorkflowPhase("failed");
      setStatusMessage(failure);
      addToast({ title: "发布前检查失败", description: failure, color: "danger" });
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <>
    <Card className="border-small border-divider bg-background shadow-sm">
      <CardBody className="gap-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-medium font-semibold text-default-900">
            {variant === "article" ? "图文发布" : "视频发布"}
          </h2>
          <p className="text-small text-default-500">
            {variant === "article"
              ? "适合发布文章、小红书笔记和带图内容；从内容库进入时会自动带入标题、文案和标签。"
              : "适合发布本地视频文件；先选择视频素材，再补标题、简介、封面和平台参数。"}
          </p>
          <p className="text-tiny font-semibold text-default-500">
            正式发布前会先进入“待我确认”，确认后才由本机发布服务继续。
          </p>
        </div>
        {variant === "article" ? (
          <section className="rounded-[8px] border-small border-divider bg-default-50 p-4">
            <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-small font-semibold text-default-900">
                  内容来源
                </h3>
                <p className="mt-1 text-tiny text-default-500">
                  从文章库或小红书笔记选择一条内容，系统会带入标题、文案和标签；素材仍在下方选择或导入。
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  as={Link}
                  href="/content/articles"
                  size="sm"
                  startContent={<Icon icon="solar:document-text-linear" />}
                  variant="flat"
                >
                  文章库
                </Button>
                <Button
                  as={Link}
                  href="/content/xiaohongshu"
                  size="sm"
                  startContent={<Icon icon="solar:chat-round-dots-linear" />}
                  variant="flat"
                >
                  小红书笔记
                </Button>
                <Button
                  isLoading={sourceArticlesLoading || sourceContentLoading}
                  size="sm"
                  startContent={
                    sourceArticlesLoading ? null : (
                      <Icon icon="solar:refresh-linear" />
                    )
                  }
                  variant="flat"
                  onPress={() => void fetchSourceArticles()}
                >
                  刷新
                </Button>
              </div>
            </div>
            {sourceArticlesError ? (
              <div className="mb-3 rounded-[8px] border-small border-danger-200 bg-danger-50 p-3 text-small text-danger-700">
                {sourceArticlesError}
              </div>
            ) : null}
            {sourceArticlesLoading ? (
              <div className="flex items-center gap-2 py-3 text-small text-default-500">
                <Spinner size="sm" /> 正在加载内容来源...
              </div>
            ) : sourceArticles.length ? (
              <div className="grid gap-2 md:grid-cols-2">
                {sourceArticles.map((article) => {
                  const isSelected = selectedSourceArticleId === article.id;
                  return (
                    <button
                      key={article.id}
                      type="button"
                      className={[
                        "flex min-h-[92px] flex-col gap-2 rounded-[8px] border-small p-3 text-left transition-colors",
                        isSelected
                          ? "border-primary-300 bg-primary-50 text-primary-800"
                          : "border-divider bg-background hover:border-primary-200 hover:bg-primary-50/50",
                      ].join(" ")}
                      onClick={() => applySourceArticle(article)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p
                            className="truncate text-small font-semibold text-default-900"
                            title={commercialDisplayText(article.title)}
                          >
                            {commercialDisplayText(article.title)}
                          </p>
                          <p className="mt-1 line-clamp-2 text-tiny text-default-500">
                            {formatSourceArticleSummary(article) || "暂无摘要"}
                          </p>
                        </div>
                        <Chip
                          color={
                            article.contentType === "xiaohongshu"
                              ? "secondary"
                              : "primary"
                          }
                          size="sm"
                          variant="flat"
                        >
                          {formatSourceArticleType(article)}
                        </Chip>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-tiny text-default-400">
                        <span>
                          {new Date(
                            article.updatedAt || article.createdAt,
                          ).toLocaleString("zh-CN")}
                        </span>
                        {isSelected ? (
                          <span className="font-medium text-primary">
                            已载入
                          </span>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="py-3 text-small text-default-500">
                暂未找到可分发内容。
              </p>
            )}
            {selectedSourceArticle?.contentType === "xiaohongshu" ? (
              <div className="mt-3 flex flex-col gap-3 rounded-[8px] border-small border-primary-200 bg-primary-50 p-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <p className="text-small font-semibold text-primary-700">
                    小红书卡图可导入素材库
                  </p>
                  <p className="mt-1 text-tiny text-default-500">
                    当前内容包含
                    {selectedSourceArticle.xiaohongshuData?.slides?.length || 0}
                    张卡图，导入后可在下方素材区勾选。
                  </p>
                </div>
                <Button
                  color="primary"
                  isLoading={importingSource}
                  size="sm"
                  startContent={
                    importingSource ? null : (
                      <Icon icon="solar:download-minimalistic-linear" />
                    )
                  }
                  onPress={importSourceMaterials}
                >
                  导入卡图
                </Button>
              </div>
            ) : null}
          </section>
        ) : null}
        {invalidAccounts.length ? (
          <div className="flex flex-col gap-3 rounded-[8px] border-small border-warning-200 bg-warning-50 p-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-small font-semibold text-warning-700">
                有 {invalidAccounts.length} 个平台账号已失效或不可用
              </p>
              <p className="mt-1 text-tiny text-warning-700">
                失效账号不会出现在可选列表。请先在平台账号中重新登录或刷新校验，避免提交后才失败。
              </p>
            </div>
	            <Button
	              as={Link}
	              color="warning"
	              href="/distribution?tab=accounts"
	              size="sm"
	              startContent={
	                <Icon icon="solar:key-minimalistic-square-linear" />
	              }
	              variant="flat"
	            >
	              登录/处理账号
	            </Button>
          </div>
        ) : null}
        {publishBlockers.length ? (
          <ActionBlockerList blockers={publishBlockers} />
        ) : null}
        <PublishWorkflowStepper
          accountCount={selectedAccounts.length}
          blockerCount={publishBlockers.length}
          latestSessionTitle={latestPublishSession?.title}
          materialCount={selectedMaterialPaths.length}
          mode={publishWorkflowMode}
          phase={effectivePublishWorkflowPhase}
          preflightResult={preflightResult}
          resultCount={publishResults.length}
          resultFailureCount={
            publishResults.filter((item) => item.ok === false).length
          }
          statusMessage={statusMessage}
          timerLabel={timerEnabled ? dailyTimesText || "已启用" : "未启用"}
          title={title.trim()}
        />
        <PublishPreviewStrip
          accountCount={selectedAccounts.length}
          materialCount={selectedMaterialPaths.length}
          mode={publishWorkflowMode}
          tags={draftTags}
          timerLabel={timerEnabled ? dailyTimesText || scheduleTime || "已启用" : "立即检查"}
          title={title.trim()}
          variant={variant}
        />
        <section className="flex flex-col gap-3 rounded-[8px] border-small border-divider bg-default-50 p-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Chip color="primary" size="sm" variant="flat">
                操作台
              </Chip>
              <p className="text-small font-semibold text-default-900">
                发布任务反馈
              </p>
              {latestPublishSession ? (
                <Chip
                  color={getAgentSessionStatusColor(latestPublishSession.status)}
                  size="sm"
                  variant="flat"
                >
                  {commercialDisplayText(
                    latestPublishSession.statusLabel ||
                      latestPublishSession.status,
                  )}
                </Chip>
              ) : null}
            </div>
            <p className="mt-1 text-tiny leading-5 text-default-500">
              提交后会在这里查看状态、确认项、发布记录和结果留存；失败时先看下一步提示，再回发布记录重发。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              isDisabled={!latestPublishSession}
              size="sm"
              startContent={<Icon icon="solar:radio-linear" />}
              variant="flat"
              onPress={() => {
                if (latestPublishSession) {
                  setActivePublishSession(latestPublishSession);
                }
              }}
            >
              AI专家状态
            </Button>
            <Button as={Link} href="/tasks/confirmations" size="sm" variant="flat">
              待我确认
            </Button>
            <Button as={Link} href="/distribution?tab=tasks" size="sm" variant="flat">
              发布记录
            </Button>
            <Button as={Link} href="/tasks/evidence" size="sm" variant="flat">
              结果留存
            </Button>
          </div>
        </section>
        <section className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-[8px] border-small border-primary-200 bg-primary-50 p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-background text-primary">
                <Icon icon="solar:magic-stick-3-linear" width={20} />
              </span>
              <div className="min-w-0">
                <h3 className="text-small font-semibold text-primary-800">
                  AI 辅助填写
                </h3>
                <p className="mt-1 text-tiny leading-5 text-primary-700">
                  可生成标题、文案和标签候选；确认后自动填入发布表单。
                </p>
              </div>
            </div>
          </div>
          <div className="rounded-[8px] border-small border-warning-200 bg-warning-50 p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-background text-warning-700">
                <Icon icon="solar:shield-warning-linear" width={20} />
              </span>
              <div className="min-w-0">
                <h3 className="text-small font-semibold text-warning-800">
                  失败处理规则
                </h3>
                <p className="mt-1 text-tiny leading-5 text-warning-700">
                  如果账号、素材、权限或平台页面异常，页面会显示失败原因、影响范围和下一步动作。处理后可回到发布任务重试或查看结果留存。
                </p>
              </div>
            </div>
          </div>
        </section>
        <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
          <section className="rounded-[8px] border-small border-divider bg-default-50 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-small font-semibold text-default-900">
                选择账号
              </h3>
              <Chip size="sm" variant="flat">
                已选 {selectedAccountKeys.length}
              </Chip>
            </div>
            <p className="mb-3 text-tiny text-default-500">
              提交时按抖音、视频号、B站、小红书、快手的发布顺序执行。
            </p>
            <div className="flex max-h-72 flex-col gap-2 overflow-auto pr-1">
              {accountsLoading ? (
                <div className="flex items-center gap-2 text-small text-default-500">
                  <Spinner size="sm" /> 正在加载账号...
                </div>
              ) : normalAccounts.length ? (
                normalAccounts.map((account) => {
                  const accountKey = accountIdentityKey(account);
                  return (
                    <Checkbox
                      key={accountKey}
                      isSelected={selectedAccountKeys.includes(accountKey)}
                      onValueChange={(checked) =>
                        toggleAccount(account, checked)
                      }
                    >
                      <span className="flex flex-wrap items-center gap-2 text-small">
                        <Chip size="sm" variant="flat">
                          {account.platform}
                        </Chip>
                        <span className="font-medium text-default-900">
                          {account.profileName ||
                            account.userName ||
                            `账号 ${account.id}`}
                        </span>
                      </span>
                    </Checkbox>
                  );
                })
	              ) : (
	                <div className="flex flex-col items-start gap-3 rounded-[8px] border-small border-danger-200 bg-danger-50 p-3">
	                  <p className="text-small font-medium text-danger-700">
	                    暂无可用账号，先登录或校验视频平台账号。
	                  </p>
	                  <Button
	                    as={Link}
	                    color="primary"
	                    href="/distribution?tab=accounts"
	                    size="sm"
	                    startContent={
	                      <Icon icon="solar:key-minimalistic-square-linear" />
	                    }
	                    variant="solid"
	                  >
	                    去登录平台账号
	                  </Button>
	                </div>
	              )}
            </div>
          </section>
          <section className="rounded-[8px] border-small border-divider bg-default-50 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-small font-semibold text-default-900">
                选择素材
              </h3>
              <Chip size="sm" variant="flat">
                已选 {selectedMaterialPaths.length}
              </Chip>
            </div>
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <Input
                isClearable
                aria-label="搜索发布素材"
                className="w-full sm:max-w-[360px]"
                placeholder="按文件名或路径搜索素材"
                size="sm"
                startContent={
                  <Icon icon="solar:magnifer-linear" className="text-default-400" />
                }
                value={materialQuery}
                onClear={() => {
                  setMaterialQuery("");
                  setVisibleMaterialCount(MATERIAL_PAGE_SIZE);
                }}
                onValueChange={(value) => {
                  setMaterialQuery(value);
                  setVisibleMaterialCount(MATERIAL_PAGE_SIZE);
                }}
              />
              <span className="shrink-0 text-tiny text-default-600">
                显示 {Math.min(visibleMaterialCount, filteredMaterials.length)} / {filteredMaterials.length}
              </span>
            </div>
            <div className="flex max-h-72 flex-col gap-2 overflow-auto pr-1">
              {materialsLoading ? (
                <div className="flex items-center gap-2 text-small text-default-500">
                  <Spinner size="sm" />
                  正在加载素材...
                </div>
              ) : filteredMaterials.length || latestVideoClip?.outputPath ? (
                <>
                  {latestVideoClip?.outputPath ? (
                    <Checkbox
                      key="video-workshop-latest-clip"
                      isSelected={selectedMaterialPaths.includes(
                        latestVideoClip.outputPath,
                      )}
                      onValueChange={(checked) =>
                        toggleMaterial(latestVideoClip.outputPath, checked)
                      }
                    >
                      <span className="flex flex-col text-small">
                        <span className="flex flex-wrap items-center gap-2 font-medium text-default-900">
                          <Chip color="secondary" size="sm" variant="flat">
                            视频工坊
                          </Chip>
                          {displayFileName(
                            latestVideoClip.outputName,
                            "视频成片",
                          )}
                        </span>
                        <span className="break-all text-tiny text-default-500">
                          最近成片 ·
                          {displayFileName(
                            latestVideoClip.outputPath,
                            latestVideoClip.outputName,
                          )}
                        </span>
                      </span>
                    </Checkbox>
                  ) : null}
                  {visibleMaterials.map((material) => (
                    <Checkbox
                      key={material.id}
                      isDisabled={!material.filePath}
                      isSelected={Boolean(
                        material.filePath &&
                        selectedMaterialPaths.includes(material.filePath),
                      )}
                      onValueChange={(checked) =>
                        toggleMaterial(material.filePath, checked)
                      }
                    >
                      <span className="flex flex-col text-small">
                        <span className="flex flex-wrap items-center gap-2 font-medium text-default-900">
                          <Chip
                            color={getMaterialKind(material.filename).color}
                            size="sm"
                            variant="flat"
                          >
                            {getMaterialKind(material.filename).label}
                          </Chip>
                          {displayFileName(material.filename)}
                          {!material.filePath ? (
                            <Chip color="danger" size="sm" variant="flat">
                              缺少素材
                            </Chip>
                          ) : null}
                        </span>
                        <span className="break-all text-tiny text-default-500">
                          {formatMaterialSize(material.filesizeMb)} ·
                          {material.filePath
                            ? formatMaterialDisplayPath(material)
                            : "不可发布"}
                        </span>
                      </span>
                    </Checkbox>
                  ))}
                  {visibleMaterialCount < filteredMaterials.length ? (
                    <Button
                      className="mt-1 min-h-11 shrink-0"
                      size="sm"
                      variant="flat"
                      onPress={() =>
                        setVisibleMaterialCount((count) =>
                          Math.min(
                            count + MATERIAL_PAGE_SIZE,
                            filteredMaterials.length,
                          ),
                        )
                      }
                    >
                      再显示 {Math.min(
                        MATERIAL_PAGE_SIZE,
                        filteredMaterials.length - visibleMaterialCount,
                      )} 项
                    </Button>
                  ) : null}
                </>
	              ) : materialQuery.trim() ? (
	                <div className="rounded-[8px] border-small border-divider bg-background p-3 text-small text-default-600">
	                  没有找到匹配“{materialQuery.trim()}”的素材，请调整关键词。
	                </div>
	              ) : (
	                <div className="flex flex-col items-start gap-3 rounded-[8px] border-small border-warning-200 bg-warning-50 p-3">
	                  <p className="text-small font-medium text-warning-700">
	                    暂无可用素材，先上传视频、图片或封面后再发布。
	                  </p>
	                  <Button
	                    as={Link}
	                    color="warning"
	                    href="/distribution?tab=materials"
	                    size="sm"
	                    startContent={<Icon icon="solar:upload-linear" />}
	                    variant="flat"
	                  >
	                    去准备发布素材
	                  </Button>
	                </div>
	              )}
            </div>
          </section>
        </div>
        <div className="grid gap-4 md:grid-cols-[1.2fr_1fr]">
          <Input
            isRequired
            label="发布标题"
            labelPlacement="outside"
            placeholder="输入各平台共用标题"
            value={title}
            onValueChange={setTitle}
          />
          <Input
            label="标签"
            labelPlacement="outside"
            placeholder="用逗号、空格或 # 分隔"
            value={tagsText}
            onValueChange={setTagsText}
          />
        </div>
        <Textarea
          label="发布文案 / B站简介"
          labelPlacement="outside"
          minRows={4}
          placeholder="小红书笔记会从来源 caption 预填；B站发布会把这里作为简介传给 发布服务。"
          value={description}
          onValueChange={setDescription}
        />
        <section className="rounded-[8px] border-small border-divider bg-default-50 p-4">
          <div className="mb-4 flex flex-col gap-1">
            <h3 className="text-small font-semibold text-default-900">
              封面策略
            </h3>
            <p className="text-tiny text-default-500">
              从素材库选择封面；快手优先 3:4/4:3，B站优先
              16:9/4:3，其他平台使用默认封面。
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <MaterialPathSelect
              label="默认封面"
              materials={materials}
              value={coverPath}
              onChange={setCoverPath}
            />
            <MaterialPathSelect
              label="3:4 封面"
              materials={materials}
              value={coverPath34}
              onChange={setCoverPath34}
            />
            <MaterialPathSelect
              label="4:3 封面"
              materials={materials}
              value={coverPath43}
              onChange={setCoverPath43}
            />
            <MaterialPathSelect
              label="16:9 封面"
              materials={materials}
              value={coverPath169}
              onChange={setCoverPath169}
            />
          </div>
        </section>
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-[8px] border-small border-divider bg-default-50 p-4">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-small font-semibold text-default-900">
                  定时发布
                </h3>
                <p className="mt-1 text-tiny text-default-500">
                  设置每天发布时间；关闭时直接进入发布前检查。
                </p>
              </div>
              <Switch isSelected={timerEnabled} onValueChange={setTimerEnabled}>
                启用
              </Switch>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                isDisabled={!timerEnabled}
                label="每天条数"
                labelPlacement="outside"
                min={1}
                type="number"
                value={videosPerDay}
                onValueChange={setVideosPerDay}
              />
              <Input
                isDisabled={!timerEnabled}
                label="起始天数"
                labelPlacement="outside"
                min={0}
                type="number"
                value={startDays}
                onValueChange={setStartDays}
              />
              <Input
                isDisabled={!timerEnabled}
                label="每日时间"
                labelPlacement="outside"
                placeholder="10:00, 18:30"
                value={dailyTimesText}
                onValueChange={setDailyTimesText}
              />
              <Input
                isDisabled={!timerEnabled}
                label="随机浮动分钟"
                labelPlacement="outside"
                min={0}
                type="number"
                value={timeJitterMinutes}
                onValueChange={setTimeJitterMinutes}
              />
              <Input
                className="md:col-span-2"
                isDisabled={!timerEnabled}
                label="固定发布时间"
                labelPlacement="outside"
                placeholder="可选，例如 2026-05-29 10:00"
                value={scheduleTime}
                onValueChange={setScheduleTime}
              />
            </div>
          </section>
          <section className="rounded-[8px] border-small border-divider bg-default-50 p-4">
            <div className="mb-4">
              <h3 className="text-small font-semibold text-default-900">
                B站参数
              </h3>
              <p className="mt-1 text-tiny text-default-500">
                仅 B站账号使用；其他平台会忽略这些字段。
              </p>
            </div>
            <div className="grid gap-3">
              <Input
                label="B站标题"
                labelPlacement="outside"
                placeholder="不填则使用发布标题"
                value={biliTitle}
                onValueChange={setBiliTitle}
              />
              <div className="grid gap-3 md:grid-cols-2">
                <Input
                  label="类型"
                  labelPlacement="outside"
                  placeholder="自制 / 转载"
                  value={biliType}
                  onValueChange={setBiliType}
                />
                <Input
                  label="分区"
                  labelPlacement="outside"
                  placeholder="例如 生活 / 科技"
                  value={biliPartition}
                  onValueChange={setBiliPartition}
                />
              </div>
            </div>
          </section>
        </div>
        <div className="rounded-[8px] border-small border-divider bg-default-50 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-small font-semibold text-default-900">
                执行方式
              </p>
              <p className="mt-1 text-small text-default-500">
                {realPublishEnabled
                  ? "正式发布会由本机浏览器实际提交到平台；账号、素材、页面或风控异常会停止并留下记录。"
                  : "发布前检查会打开平台页面核对账号、素材和页面流程，不执行最终发布。"}
              </p>
            </div>
            <Switch
              color="danger"
              isSelected={realPublishEnabled}
              onValueChange={handleRealPublishModeChange}
            >
              正式发布
            </Switch>
          </div>
        </div>
        {preflightResult && !preflightResult.ok ? (
          <PreflightIssueList result={preflightResult} />
        ) : null}
        {publishResults.length ? (
          <div className="rounded-[8px] border-small border-divider bg-default-50 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-small font-semibold text-default-900">
                本次发布结果
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Chip size="sm" variant="flat">
                  {publishResults.length} 个平台
                </Chip>
                <Button
                  size="sm"
                  startContent={
                    <Icon icon="solar:download-minimalistic-linear" />
                  }
                  variant="flat"
                  onPress={() =>
                    downloadPublishResultItems(title.trim(), publishResults)
                  }
                >
                  导出结果
                </Button>
              </div>
            </div>
            <div className="grid gap-2">
              {publishResults.map((item, index) => (
                <div
                  key={`${item.type}-${item.platform || "platform"}-${item.accountName || item.account || "account"}-${item.publishTaskId || item.status || index}-${index}`}
                  className="flex flex-col gap-2 rounded-[8px] border-small border-divider bg-background p-3 md:flex-row md:items-start md:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip
                        color={resolvePublishResultColor(item.ok)}
                        size="sm"
                        variant="flat"
                      >
                        {resolvePublishResultLabel(item)}
                      </Chip>
                      <span className="text-small font-semibold text-default-900">
                        {item.platform || `平台 ${item.type}`}
                      </span>
                      <span className="text-small text-default-500">
                        {item.accountName || item.account || "-"}
                      </span>
                    </div>
                    <p className="mt-1 break-words text-small text-default-600">
                      {item.message || (item.ok ? "已提交" : "暂无详情")}
                    </p>
                    {item.nextAction ? (
                      <p className="mt-1 break-words text-tiny text-default-500">
                        下一步：{item.nextAction}
                      </p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <div className="flex justify-end">
          <Button
            color={realPublishEnabled ? "danger" : "primary"}
            isDisabled={!canSubmitPublish}
            isLoading={submitting}
            startContent={
              submitting ? null : <Icon icon="solar:send-square-linear" />
            }
            onPress={handleSubmit}
          >
            {canSubmitPublish
              ? realPublishEnabled
                ? "提交正式发布"
                : "提交发布前检查"
              : "需处理，先补齐条件"}
          </Button>
        </div>
      </CardBody>
      <RiskConfirmationDialog
        checklist={[
          "确认平台账号、素材、封面和发布时间无误。",
          "确认内容已经完成发布前检查，适合进入正式发布流程。",
          "确认后不会直接发布，会先进入任务中心的待我确认列表。",
        ]}
        confirmLabel="进入待我确认"
        description="正式发布会由本机发布服务打开平台并提交内容；确认后会创建待审批任务，审批通过后继续执行并留下记录。"
        impactItems={[
          { label: "标题", value: title.trim() || "-" },
          { label: "平台账号", value: `${selectedAccounts.length} 个` },
          { label: "素材", value: `${selectedMaterialPaths.length} 个` },
          {
            label: "封面",
            value:
              [
                coverPath ? "默认" : "",
                coverPath34 ? "3:4" : "",
                coverPath43 ? "4:3" : "",
                coverPath169 ? "16:9" : "",
              ]
                .filter(Boolean)
                .join("、") || "-",
          },
          { label: "标签", value: tagsText.trim() || "-" },
          { label: "定时", value: timerEnabled ? `启用，${dailyTimesText}` : "关闭" },
          {
            label: "文案",
            value: description.trim()
              ? `${description.trim().slice(0, 80)}${description.trim().length > 80 ? "..." : ""}`
              : "-",
          },
        ]}
        isLoading={submitting}
        isOpen={confirmPublishOpen}
        riskLevel="high"
        title="确认正式发布"
        onCancel={() => setConfirmPublishOpen(false)}
        onConfirm={() => {
          void submitPublishConfirmation();
        }}
      />
    </Card>
    <AgentStatusDrawer
      recordHref={() => "/distribution?tab=tasks"}
      session={activePublishSession}
      onClose={() => setActivePublishSession(null)}
      onUpdated={(session) => {
        setLatestPublishSession(session);
        setActivePublishSession(session);
      }}
    />
    </>
  );
}

function AccountsPanel({
  accounts,
  error,
  loading,
  onRefresh,
  onSetAccounts,
}: {
  accounts: AutoUploadAccount[];
  error: string;
  loading: boolean;
  onRefresh: () => Promise<void>;
  onSetAccounts: (accounts: AutoUploadAccount[]) => void;
}) {
  const [checking, setChecking] = React.useState(false);
  const [openingId, setOpeningId] = React.useState<number | null>(null);
  const [refreshingAvatarId, setRefreshingAvatarId] = React.useState<
    number | null
  >(null);
  const [cdpSessions, setCdpSessions] = React.useState<
    AutoUploadCdpBrowserSession[]
  >([]);
  const [cdpMessage, setCdpMessage] = React.useState<string>("");
  const [cdpLoading, setCdpLoading] = React.useState(false);
  const [accountToDelete, setAccountToDelete] =
    React.useState<AutoUploadAccount | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [loginOpen, setLoginOpen] = React.useState(false);
  const [loginProfileName, setLoginProfileName] = React.useState("");
  const [loginPlatformType, setLoginPlatformType] = React.useState(3);
  const [loginRecord, setLoginRecord] =
    React.useState<AutoUploadAccount | null>(null);
  const [loginRequestId, setLoginRequestId] = React.useState("");
  const [loginQrCode, setLoginQrCode] = React.useState("");
  const [loginStatus, setLoginStatus] = React.useState("");
  const [loginError, setLoginError] = React.useState("");
  const [loginConnecting, setLoginConnecting] = React.useState(false);
  const eventSourceRef = React.useRef<EventSource | null>(null);
  const loginTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const displayAccounts = React.useMemo(() => {
    const seen = new Set<string>();
    return accounts.filter((account) => {
      const key = accountIdentityKey(account);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [accounts]);

  const closeLoginStream = React.useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    if (loginTimerRef.current) {
      clearTimeout(loginTimerRef.current);
      loginTimerRef.current = null;
    }
  }, []);

  React.useEffect(() => {
    return () => {
      closeLoginStream();
    };
  }, [closeLoginStream]);

  const refreshCdpSessions = React.useCallback(async () => {
    setCdpLoading(true);
    try {
      const result = await autoUploadApi.cdpSessions();
      setCdpSessions(result.sessions || []);
      setCdpMessage(cleanUserFacingRuntimeText(result.message));
      return result.sessions || [];
    } catch (error) {
      const message = toPublicError(
        error,
        "平台后台状态暂时无法读取，请重试。",
      );
      setCdpSessions([]);
      setCdpMessage(cleanUserFacingRuntimeText(message));
      return [];
    } finally {
      setCdpLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refreshCdpSessions();
    const timer = window.setInterval(() => {
      void refreshCdpSessions();
    }, 6000);
    return () => window.clearInterval(timer);
  }, [refreshCdpSessions]);

  const openLoginModal = (account?: AutoUploadAccount) => {
    closeLoginStream();
    setLoginRecord(account || null);
    setLoginProfileName(account?.profileName || account?.userName || "");
    setLoginPlatformType(account?.type || 3);
    setLoginRequestId("");
    setLoginQrCode("");
    setLoginStatus("");
    setLoginError("");
    setLoginConnecting(false);
    setLoginOpen(true);
  };

  const cancelLogin = async (closeModal = true) => {
    const requestId = loginRequestId;
    closeLoginStream();
    if (loginConnecting && requestId) {
      try {
        await autoUploadApi.cancelLogin(requestId);
      } catch {
        addToast({ title: "已关闭登录窗口", color: "warning" });
      }
    }
    setLoginConnecting(false);
    setLoginQrCode("");
    setLoginStatus("");
    setLoginError("");
    setLoginRequestId("");
    if (closeModal) {
      setLoginOpen(false);
    }
  };

  const startLogin = () => {
    const profileName = loginProfileName.trim();
    if (!profileName) {
      addToast({ title: "请填写账号主体名称", color: "warning" });
      return;
    }

    closeLoginStream();
    const requestId = createRequestId();
    setLoginRequestId(requestId);
    setLoginQrCode("");
    setLoginStatus("");
    setLoginError("");
    setLoginConnecting(true);

    let hasLoginPrompt = false;
    let completed = false;
    let lastStreamError = "";
    const source = new EventSource(
      autoUploadApi.loginUrl({
        type: loginPlatformType,
        profileName,
        requestId,
        update: Boolean(loginRecord),
        recordId: loginRecord?.id,
      }),
      { withCredentials: true },
    );
    eventSourceRef.current = source;
    loginTimerRef.current = setTimeout(() => {
      if (!hasLoginPrompt && !completed) {
        setLoginStatus("500");
        setLoginError("登录页面加载超时，暂未获取到二维码。");
        closeLoginStream();
        setLoginConnecting(false);
      }
    }, 65000);

    source.onmessage = (event) => {
      const data = event.data;
      if (data.startsWith("ERROR:")) {
        const message =
          data.replace(/^ERROR:\s*/, "") || "绑定失败，请稍后再试";
        lastStreamError = message;
        completed = true;
        setLoginStatus("500");
        setLoginError(message);
        closeLoginStream();
        setLoginConnecting(false);
        addToast({ title: "登录失败", description: message, color: "danger" });
        return;
      }

      if (data === "CANCELLED") {
        completed = true;
        closeLoginStream();
        setLoginConnecting(false);
        setLoginOpen(false);
        return;
      }

      if (data.startsWith("ACCOUNT_ID:")) {
        return;
      }

      if (data.startsWith("LOGIN_URL:")) {
        const trustedUrl = parseTrustedWechatChannelLoginUrl(
          data.slice("LOGIN_URL:".length),
        );
        if (loginPlatformType !== 2 || !trustedUrl) {
          completed = true;
          const message = "登录页地址未通过安全校验，请关闭窗口后重试。";
          setLoginStatus("500");
          setLoginError(message);
          closeLoginStream();
          setLoginConnecting(false);
          addToast({
            title: "登录流程异常",
            description: message,
            color: "danger",
          });
          return;
        }
        hasLoginPrompt = true;
        if (loginTimerRef.current) {
          clearTimeout(loginTimerRef.current);
          loginTimerRef.current = null;
        }
        setLoginQrCode("");
        setLoginStatus("manual");
        setLoginError("");
        return;
      }

      if (!hasLoginPrompt && data.length > 100) {
        hasLoginPrompt = true;
        const isImageUrl =
          data.startsWith("data:image") ||
          data.startsWith("http://") ||
          data.startsWith("https://") ||
          data.startsWith("//") ||
          data.startsWith("blob:");
        setLoginQrCode(isImageUrl ? data : `data:image/png;base64,${data}`);
        return;
      }

      if (data === "200" || data === "500") {
        completed = true;
        setLoginStatus(data);
        closeLoginStream();
        setLoginConnecting(false);
        if (data === "200") {
          addToast({
            title: loginRecord ? "重新登录成功" : "绑定成功",
            color: "success",
          });
          onRefresh().catch(() => undefined);
          setTimeout(() => setLoginOpen(false), 900);
        } else {
          setLoginError(
            lastStreamError ||
              "绑定失败：平台登录未完成或登录态校验失败。请确认新打开的平台窗口已经完成登录，再点击刷新账号状态。",
          );
        }
      }
    };

    source.onerror = () => {
      completed = true;
      closeLoginStream();
      setLoginConnecting(false);
      setLoginStatus("500");
      setLoginError("登录连接中断，请确认本地服务仍在运行。");
      addToast({ title: "登录连接中断", color: "danger" });
    };
  };

  const handleCheckAccounts = async () => {
    setChecking(true);
    try {
      const result = await autoUploadApi.accounts({
        validate: true,
        force: true,
      });
      onSetAccounts(result);
      await refreshCdpSessions();
      addToast({ title: "账号状态校验完成", color: "success" });
    } catch (e: unknown) {
      addToast({
        title: "账号校验失败",
        description: toPublicError(e, "账号状态未更新，请稍后重试。"),
        color: "danger",
      });
    } finally {
      setChecking(false);
    }
  };

  const handleOpenAccount = async (account: AutoUploadAccount) => {
    setOpeningId(account.id);
    try {
      const result = await autoUploadApi.openAccounts([account.id]);
      const sessions = await refreshCdpSessions();
      const session = findAccountCdpSession(sessions, account);
      const skipped = result.skipped?.find(
        (item) => String(item.id) === String(account.id),
      );
      if (skipped) {
        addToast({
          title: "打开平台后台失败",
          description: skipped.reason,
          color: "danger",
        });
      } else {
        addToast({
          title:
            session?.status === "ready"
              ? "平台后台已就绪"
              : "已请求打开平台后台",
          description:
            cleanUserFacingRuntimeText(session?.lastError) ||
            (session?.currentUrl
              ? "平台页面已打开，稍后会自动同步登录状态。"
              : "") ||
            "稍后会自动刷新账号页会话状态。",
          color: session?.status === "ready" ? "success" : "warning",
        });
      }
    } catch (e: unknown) {
      addToast({
        title: "打开失败",
        description: toPublicError(e, "平台后台暂时无法打开，请稍后重试。"),
        color: "danger",
      });
    } finally {
      setOpeningId(null);
    }
  };

  const handleRefreshAvatar = async (account: AutoUploadAccount) => {
    setRefreshingAvatarId(account.id);
    try {
      await autoUploadApi.refreshAccountAvatar(account.id);
      await onRefresh();
      addToast({ title: "账号头像已刷新", color: "success" });
    } catch (e: unknown) {
      addToast({
        title: "头像刷新失败",
        description: toPublicError(e, "账号头像未刷新，请稍后重试。"),
        color: "danger",
      });
    } finally {
      setRefreshingAvatarId(null);
    }
  };

  const handleDeleteAccount = async () => {
    if (!accountToDelete) return;

    setDeleting(true);
    try {
      await autoUploadApi.deleteAccount(
        accountToDelete.id,
        buildRiskConfirmation("platform-account-delete"),
      );
      addToast({ title: "账号已删除", color: "success" });
      setAccountToDelete(null);
      await onRefresh();
    } catch (e: unknown) {
      addToast({
        title: "删除失败",
        description: toPublicError(e, "平台账号未删除，请稍后重试。"),
        color: "danger",
      });
    } finally {
      setDeleting(false);
    }
  };
  return (
    <>
      <Card className="border-small border-divider bg-background shadow-sm">
        <CardBody className="gap-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-medium font-semibold text-default-900">
                平台账号
              </h3>
              <p className="text-small text-default-500">
                账号、登录状态和平台后台统一在这里管理。
              </p>
              <p className="mt-1 text-tiny text-default-400">
                打开平台后会自动校验登录态，并同步到评论、私信和发布工作台。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                color="primary"
                startContent={<Icon icon="solar:add-circle-linear" />}
                variant="flat"
                onPress={() => openLoginModal()}
              >
                绑定平台
              </Button>
              <Button
                color="primary"
                isLoading={loading}
                startContent={
                  loading ? null : <Icon icon="solar:refresh-linear" />
                }
                variant="flat"
                onPress={() => {
                  onRefresh().catch(() => {
                    addToast({ title: "账号刷新失败", color: "danger" });
                  });
                }}
              >
                刷新账号
              </Button>
              <Button
                color="primary"
                isLoading={checking || cdpLoading}
                startContent={
                  checking ? null : <Icon icon="solar:shield-check-linear" />
                }
                variant="solid"
                onPress={handleCheckAccounts}
              >
                校验状态
              </Button>
            </div>
          </div>
          {error ? (
            <FailureActionPanel
              actions={[
                {
                  label: "刷新账号",
                  onPress: () => {
                    onRefresh().catch(() => {
                      addToast({ title: "账号刷新失败", color: "danger" });
                    });
                  },
                },
	                { href: "/distribution?tab=accounts", label: "平台账号" },
              ]}
              impact="发布前检查、正式发布和客户互动可能无法选择或校验账号。"
              nextAction="先刷新账号；如果仍不可用，到平台账号页重新登录或绑定。"
              reason="平台账号读取失败，可能是账号登录、授权配置或服务连接暂时不可用。"
              technicalDetails={error}
              title="平台账号需要处理"
            />
          ) : null}
          {cdpMessage ? (
            <div className="rounded-[8px] border-small border-warning-200 bg-warning-50 p-3 text-small text-warning-700">
              {cdpMessage}
            </div>
          ) : null}
          <Table
            aria-label="平台账号列表"
            className="border-small border-divider rounded-[8px]"
            removeWrapper
          >
            <TableHeader>
              <TableColumn>平台</TableColumn>
              <TableColumn>账号</TableColumn>
              <TableColumn>状态</TableColumn>
              <TableColumn>账号环境</TableColumn>
              <TableColumn>更新时间</TableColumn>
              <TableColumn>操作</TableColumn>
            </TableHeader>
            <TableBody
              emptyContent={
                loading ? (
                  "正在加载账号..."
                ) : (
	                  <FunctionalEmptyState
	                    actions={[
	                      { label: "绑定平台", onPress: () => openLoginModal() },
	                      { href: "/distribution?tab=accounts", label: "平台账号" },
	                    ]}
                    description="绑定平台账号后，发布、互动和账号健康检查都会使用同一套登录状态。"
                    examples={["抖音", "小红书", "视频号", "快手", "B站"]}
                    title="暂无平台账号"
                  />
                )
              }
              isLoading={loading}
              loadingContent={<Spinner size="sm" />}
            >
              {displayAccounts.map((account, index) => {
                const session = findAccountCdpSession(cdpSessions, account);
                const sessionChip = cdpSessionChip(session);
                return (
                  <TableRow key={accountRowKey(account, index)}>
                    <TableCell>
                      <Chip size="sm" variant="flat">
                        {account.platform}
                      </Chip>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="text-small font-medium text-default-900">
                          {account.profileName ||
                            account.accountName ||
                            account.userName ||
                            `账号 ${account.id}`}
                        </span>
                        <span className="text-tiny text-default-400">
                          ID {account.id}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <div className="flex flex-wrap gap-1">
                          {account.sessionStatus &&
                          account.sessionStatus !== "unknown" ? (
                            <Chip
                              color={
                                account.sessionStatus === "logged_in"
                                  ? "success"
                                  : account.sessionStatus === "needs_login"
                                    ? "warning"
                                    : "danger"
                              }
                              size="sm"
                              variant="flat"
                              title={
                                account.lastDispatchAt
                                  ? `最近检查：${account.lastDispatchAt}`
                                  : "等待账号状态检查"
                              }
                            >
                              {account.sessionStatus === "logged_in"
                                ? "已登录"
                                : account.sessionStatus === "needs_login"
                                  ? "未登录"
                                  : "异常"}
                            </Chip>
                          ) : (
                            <Chip
                              color="default"
                              size="sm"
                              variant="flat"
                              title="尚无账号文件登录态判定"
                            >
                              待验证
                            </Chip>
                          )}
                          <Chip
                            color={sessionChip.color}
                            size="sm"
                            variant="flat"
                          >
                            {sessionChip.label}
                          </Chip>
                        </div>
                        {session?.lastError && !session.activeProfile ? (
                          <span className="text-tiny text-danger">
                            {cleanUserFacingRuntimeText(session.lastError)}
                          </span>
                        ) : null}
                        {session?.currentUrl ? (
                          <span
                            className="max-w-[260px] truncate text-tiny text-default-400"
                            title={session.currentUrl}
                          >
                            平台页面已打开
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <span className="text-tiny text-default-500">
                          {accountStorageLabel(account, session)}
                        </span>
                        {session?.profileDir ? (
                          <span className="text-tiny text-default-400">
                            独立登录环境已准备
                          </span>
                        ) : null}
                        {session?.runtimeMode || session?.debuggingPort ? (
                          <span className="text-tiny text-default-400">
                            本机浏览器已接管
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-small text-default-500">
                        {account.avatarUpdatedAt || "-"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          startContent={
                            <Icon icon="solar:external-link-linear" />
                          }
                          variant="flat"
                          isLoading={openingId === account.id}
                          onPress={() => handleOpenAccount(account)}
                        >
                          打开
                        </Button>
                        <Button
                          size="sm"
                          startContent={<Icon icon="solar:user-check-linear" />}
                          variant="flat"
                          isLoading={refreshingAvatarId === account.id}
                          onPress={() => handleRefreshAvatar(account)}
                        >
                          刷新头像
                        </Button>
                        <Button
                          color="danger"
                          size="sm"
                          startContent={
                            <Icon icon="solar:trash-bin-minimalistic-linear" />
                          }
                          variant="flat"
                          onPress={() => setAccountToDelete(account)}
                        >
                          删除
                        </Button>
                        <Button
                          color="warning"
                          size="sm"
                          startContent={
                            <Icon icon="solar:restart-circle-linear" />
                          }
                          variant="flat"
                          onPress={() => openLoginModal(account)}
                        >
                          重登
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
      <RiskConfirmationDialog
        checklist={[
          "确认该账号不在发布任务、互动任务或自动化任务中使用。",
          "删除后会移除本机账号记录和登录文件，需要重新绑定才能恢复。",
        ]}
        confirmLabel="确认删除"
        description="删除平台账号会影响发布、互动和登录态检查。"
        impactItems={[
          {
            label: "平台",
            value: accountToDelete?.platform || "-",
          },
          {
            label: "账号",
            value:
              accountToDelete?.profileName ||
              accountToDelete?.userName ||
              (accountToDelete ? `账号 ${accountToDelete.id}` : "-"),
          },
          {
            label: "操作结果",
            value: "移除本机账号记录和登录文件",
          },
        ]}
        isLoading={deleting}
        isOpen={Boolean(accountToDelete)}
        riskLevel="high"
        title="确认删除账号"
        onCancel={() => setAccountToDelete(null)}
        onConfirm={handleDeleteAccount}
      />
      <Modal
        isOpen={loginOpen}
        onOpenChange={(open) => {
          if (!open) {
            cancelLogin(true).catch(() => undefined);
          }
        }}
      >
        <ModalContent>
          <ModalHeader>
            {loginRecord ? "重新登录平台账号" : "绑定平台账号"}
          </ModalHeader>
          <ModalBody>
            <Input
              isDisabled={loginConnecting}
              isRequired
              label="账号主体"
              labelPlacement="outside"
              placeholder="例如：矩阵账号01"
              value={loginProfileName}
              onValueChange={setLoginProfileName}
            />
            <div>
              <p className="mb-2 text-tiny font-medium text-default-500">
                绑定平台
              </p>
              <div className="flex flex-wrap gap-2">
                {loginPlatforms.map((platform) => (
                  <Button
                    key={platform.type}
                    color={
                      loginPlatformType === platform.type
                        ? "primary"
                        : "default"
                    }
                    isDisabled={loginConnecting}
                    size="sm"
                    variant={
                      loginPlatformType === platform.type ? "solid" : "flat"
                    }
                    onPress={() => setLoginPlatformType(platform.type)}
                  >
                    {platform.name}
                  </Button>
                ))}
              </div>
            </div>
            {loginConnecting || loginQrCode || loginStatus ? (
              <div className="rounded-[8px] border-small border-divider bg-default-50 p-4 text-center">
                {loginQrCode && !loginStatus ? (
                  <div className="flex flex-col items-center gap-3">
                    <p className="text-small text-default-600">
                      请使用对应平台 APP 扫码登录
                    </p>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      alt="登录二维码"
                      className="h-52 w-52 rounded-[8px] bg-white object-contain p-2"
                      src={loginQrCode}
                    />
                  </div>
                ) : null}
                {!loginQrCode && !loginStatus ? (
                  <div className="flex items-center justify-center gap-2 text-small text-default-500">
                    <Spinner size="sm" />
                    正在打开平台登录页...
                  </div>
                ) : null}
                {loginStatus === "manual" ? (
                  <div className="space-y-3 text-left">
                    <p className="text-small font-medium text-default-900">
                      视频号登录页已打开
                    </p>
                    <p className="text-small text-default-600">
                      请切换到已打开的受控浏览器窗口完成网页登录。检测到登录后会自动继续绑定，请保持本窗口打开。
                    </p>
                  </div>
                ) : null}
                {loginStatus === "200" ? (
                  <p className="text-small font-medium text-success">
                    绑定成功
                  </p>
                ) : null}
                {loginStatus === "500" ? (
                  <p className="text-small font-medium text-danger">
                    {loginError ||
                      "绑定失败：平台登录未完成或登录态校验失败。请确认新打开的平台窗口已经完成登录，再点击刷新账号状态。"}
                  </p>
                ) : null}
              </div>
            ) : null}
          </ModalBody>
          <ModalFooter>
            <Button
              variant="light"
              onPress={() => {
                cancelLogin(true).catch(() => undefined);
              }}
            >
              取消
            </Button>
            <Button
              color="primary"
              isDisabled={loginConnecting}
              isLoading={loginConnecting}
              onPress={startLogin}
            >
              {loginStatus === "manual"
                ? "等待登录完成"
                : loginConnecting
                  ? "请求中"
                  : "开始绑定"}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}

function MaterialsPanel({
  error,
  loading,
  materials,
  onRefresh,
}: {
  error: string;
  loading: boolean;
  materials: AutoUploadMaterial[];
  onRefresh: () => Promise<void>;
}) {
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null);
  const [customFilename, setCustomFilename] = React.useState("");
  const [uploading, setUploading] = React.useState(false);
  const [previewMaterial, setPreviewMaterial] =
    React.useState<AutoUploadMaterial | null>(null);
  const [materialToDelete, setMaterialToDelete] =
    React.useState<AutoUploadMaterial | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  const handleUpload = async () => {
    if (!selectedFile) {
      addToast({ title: "请选择要上传的文件", color: "warning" });
      return;
    }

    const formData = new FormData();
    formData.append("file", selectedFile);
    if (customFilename.trim()) {
      formData.append("filename", customFilename.trim());
    }

    setUploading(true);
    try {
      await autoUploadApi.uploadMaterial(formData);
      addToast({ title: "上传成功", color: "success" });
      setSelectedFile(null);
      setCustomFilename("");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      await onRefresh();
    } catch (e: unknown) {
      addToast({
        title: "上传失败",
        description: toPublicError(e, "素材未上传，请检查文件后重试。"),
        color: "danger",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async () => {
    if (!materialToDelete) return;

    setDeleting(true);
    try {
      await autoUploadApi.deleteMaterial(
        materialToDelete.id,
        buildRiskConfirmation("local-file-delete"),
      );
      addToast({ title: "素材已删除", color: "success" });
      if (previewMaterial?.id === materialToDelete.id) {
        setPreviewMaterial(null);
      }
      setMaterialToDelete(null);
      await onRefresh();
    } catch (e: unknown) {
      addToast({
        title: "删除失败",
        description: toPublicError(e, "素材未删除，请稍后重试。"),
        color: "danger",
      });
    } finally {
      setDeleting(false);
    }
  };
  return (
    <>
      <Card className="border-small border-divider bg-background shadow-sm">
        <CardBody className="gap-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-medium font-semibold text-default-900">
                发布素材
              </h3>
              <p className="text-small text-default-500">
                素材来自 本地文件库，可直接用于图文发布、视频发布和任务重试。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                as={Link}
                href="/distribution?tab=article"
                size="sm"
                variant="flat"
              >
                图文发布
              </Button>
              <Button
                as={Link}
                href="/distribution?tab=video"
                size="sm"
                variant="flat"
              >
                视频发布
              </Button>
              <Button
                color="primary"
                isLoading={loading}
                size="sm"
                startContent={
                  loading ? null : <Icon icon="solar:refresh-linear" />
                }
                variant="flat"
                onPress={() => {
                  onRefresh().catch(() => {
                    addToast({ title: "素材刷新失败", color: "danger" });
                  });
                }}
              >
                刷新素材
              </Button>
            </div>
          </div>
          {error ? (
            <FailureActionPanel
              actions={[
                {
                  label: "刷新素材",
                  onPress: () => {
                    onRefresh().catch(() => {
                      addToast({ title: "素材刷新失败", color: "danger" });
                    });
                  },
                },
	                { href: "/content", label: "素材库" },
              ]}
              impact="图文发布、视频发布和失败重试可能无法选择可用素材。"
              nextAction="先刷新素材；如果仍失败，到素材库确认文件是否存在。"
              reason="发布素材读取失败，可能是素材服务、文件状态或采集来源暂时不可用。"
              technicalDetails={error}
              title="发布素材需要处理"
            />
          ) : null}
          <div className="grid gap-3 rounded-[8px] border-small border-divider bg-default-50 p-4 md:grid-cols-[1.4fr_1fr_auto] md:items-end">
            <div>
              <p className="mb-2 text-tiny font-medium text-default-500">
                选择文件
              </p>
              <input
                ref={fileInputRef}
                className="block w-full text-small text-default-600 file:mr-3 file:rounded-[8px] file:border-0 file:bg-primary/10 file:px-3 file:py-2 file:text-small file:font-medium file:text-primary"
                type="file"
                onChange={(event) => {
                  setSelectedFile(event.target.files?.[0] || null);
                }}
              />
            </div>
            <Input
              label="自定义文件名"
              labelPlacement="outside"
              placeholder="选填，不含扩展名"
              value={customFilename}
              onValueChange={setCustomFilename}
            />
            <Button
              color="primary"
              isDisabled={!selectedFile}
              isLoading={uploading}
              startContent={
                uploading ? null : <Icon icon="solar:upload-linear" />
              }
              onPress={handleUpload}
            >
              上传素材
            </Button>
          </div>
          <Table
            aria-label="发布素材列表"
            className="border-small border-divider rounded-[8px]"
            removeWrapper
          >
            <TableHeader>
              <TableColumn>文件名</TableColumn>
              <TableColumn>大小</TableColumn>
              <TableColumn>上传时间</TableColumn>
              <TableColumn>本地文件</TableColumn>
              <TableColumn>操作</TableColumn>
            </TableHeader>
            <TableBody
              emptyContent={
                loading ? (
                  "正在加载素材..."
                ) : (
                  <FunctionalEmptyState
                    actions={[
	                      { href: "/content", label: "素材库" },
                      { href: "/distribution?tab=article", label: "图文发布" },
                      { href: "/distribution?tab=video", label: "视频发布" },
                    ]}
                    description="上传或导入素材后，这里会显示可用于图文发布、视频发布和任务重试的本地文件。"
                    examples={["图片素材", "视频素材", "封面", "任务重试"]}
                    title="暂无发布素材"
                  />
                )
              }
              isLoading={loading}
              loadingContent={<Spinner size="sm" />}
            >
              {materials.map((material) => (
                <TableRow key={material.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Icon
                        className="text-primary"
                        icon={getMaterialKind(material.filename).icon}
                        width={18}
                      />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Chip
                            color={getMaterialKind(material.filename).color}
                            size="sm"
                            variant="flat"
                          >
                            {getMaterialKind(material.filename).label}
                          </Chip>
                          {!material.filePath ? (
                            <Chip color="danger" size="sm" variant="flat">
                              不可发布
                            </Chip>
                          ) : null}
                        </div>
                        <span className="break-all text-small font-medium text-default-900">
                          {displayFileName(material.filename)}
                        </span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-small text-default-500">
                      {formatMaterialSize(material.filesizeMb)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-small text-default-500">
                      {material.uploadTime || "-"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="break-all text-tiny text-default-500">
                      {formatMaterialDisplayPath(material)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Button
                        isDisabled={!material.filePath}
                        size="sm"
                        startContent={<Icon icon="solar:eye-linear" />}
                        variant="flat"
                        onPress={() => setPreviewMaterial(material)}
                      >
                        预览
                      </Button>
                      <Button
                        color="danger"
                        size="sm"
                        startContent={
                          <Icon icon="solar:trash-bin-minimalistic-linear" />
                        }
                        variant="flat"
                        onPress={() => setMaterialToDelete(material)}
                      >
                        删除
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {previewMaterial ? (
            <div className="rounded-[8px] border-small border-divider bg-default-50 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-small font-semibold text-default-900">
                    素材预览
                  </h4>
                  <p className="break-all text-tiny text-default-500">
                    {displayFileName(previewMaterial.filename)}
                  </p>
                </div>
                <Button
                  isIconOnly
                  size="sm"
                  variant="light"
                  onPress={() => setPreviewMaterial(null)}
                >
                  <Icon icon="solar:close-circle-linear" width={18} />
                </Button>
              </div>
              <MaterialPreview material={previewMaterial} />
            </div>
          ) : null}
        </CardBody>
      </Card>
      <RiskConfirmationDialog
        checklist={[
          "确认该素材没有被当前发布表单、定时任务或重试任务引用。",
          "删除后会同时移除本地数据库记录和本地文件。",
        ]}
        confirmLabel="确认删除"
        description="删除发布素材会影响图文、视频发布和任务重试。"
        impactItems={[
          {
            label: "文件名",
            value: displayFileName(materialToDelete?.filename, "-"),
          },
          {
            label: "操作结果",
            value: "移除本地数据库记录和本机文件",
          },
        ]}
        isLoading={deleting}
        isOpen={Boolean(materialToDelete)}
        riskLevel="high"
        title="确认删除素材"
        onCancel={() => setMaterialToDelete(null)}
        onConfirm={handleDelete}
      />
    </>
  );
}

function TasksPanel({
  error,
  loading,
  onQueryChange,
  onRefresh,
  pagination,
  tasks,
}: {
  error: string;
  loading: boolean;
  onQueryChange: (query: PublishTaskQuery) => Promise<void>;
  onRefresh: () => Promise<void>;
  pagination: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
  tasks: AutoUploadPublishTask[];
}) {
  const [selectedTask, setSelectedTask] =
    React.useState<AutoUploadPublishTask | null>(null);
  const [taskToDelete, setTaskToDelete] =
    React.useState<AutoUploadPublishTask | null>(null);
  const [statusSession, setStatusSession] =
    React.useState<AgentSession | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = React.useState<Set<number>>(
    () => new Set(),
  );
  const [expandedTaskIds, setExpandedTaskIds] = React.useState<Set<number>>(
    () => new Set(),
  );
  const [retryingTaskId, setRetryingTaskId] = React.useState<number | null>(
    null,
  );
  const [batchRetrying, setBatchRetrying] = React.useState(false);
  const [batchDeleting, setBatchDeleting] = React.useState(false);
  const [batchAction, setBatchAction] = React.useState<
    "retry" | "delete" | null
  >(null);
  const [deletingTaskId, setDeletingTaskId] = React.useState<number | null>(
    null,
  );
  const [recordSearch, setRecordSearch] = React.useState("");
  const [recordStatus, setRecordStatus] = React.useState("all");
  const [recordPlatform, setRecordPlatform] = React.useState("all");
  const [recordPage, setRecordPage] = React.useState(1);

  React.useEffect(() => {
    const visibleIds = new Set(tasks.map((task) => task.id));
    setSelectedTaskIds((current) => {
      const next = new Set(
        Array.from(current).filter((taskId) => visibleIds.has(taskId)),
      );
      return next.size === current.size ? current : next;
    });
    setExpandedTaskIds((current) => {
      const next = new Set(
        Array.from(current).filter((taskId) => visibleIds.has(taskId)),
      );
      return next.size === current.size ? current : next;
    });
  }, [tasks]);

  const platforms = React.useMemo(
    () =>
      Array.from(
        new Set(tasks.map((task) => task.platform).filter(Boolean)),
      ).sort((left, right) => left.localeCompare(right, "zh-CN")),
    [tasks],
  );
  const recordStatusOptions = React.useMemo(
    () => [
      { value: "all", label: "全部状态" },
      { value: "confirmed", label: "平台已确认" },
      { value: "waiting", label: "等待平台确认" },
      { value: "failed", label: "需要处理" },
    ],
    [],
  );
  const recordPlatformOptions = React.useMemo(
    () => [
      { value: "all", label: "全部平台" },
      ...platforms.map((platform) => ({ value: platform, label: platform })),
    ],
    [platforms],
  );
  const filteredTasks = tasks;
  const pageCount = Math.max(1, pagination.totalPages);
  const pageTasks = tasks;

  React.useEffect(() => {
    setRecordPage(1);
  }, [recordPlatform, recordSearch, recordStatus]);

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      void onQueryChange({
        page: recordPage,
        pageSize: PUBLISH_RECORD_PAGE_SIZE,
        search: recordSearch.trim() || undefined,
        status: recordStatus,
        platform: recordPlatform,
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [
    onQueryChange,
    recordPage,
    recordPlatform,
    recordSearch,
    recordStatus,
  ]);

  React.useEffect(() => {
    if (recordPage > pageCount) {
      setRecordPage(pageCount);
    }
  }, [pageCount, recordPage]);

  const emptyStateDescription = loading
    ? "正在读取发布任务记录。"
    : error
      ? "当前任务记录暂时不可用，先重试读取或检查本机服务。"
      : "先创建图文或视频发布任务，提交后这里会显示检查、待确认、执行、失败和结果留存状态。";

  const metrics = filteredTasks.reduce(
    (acc, task) => {
      const item = getPublishTaskMetrics(task);
      acc.failed += item.failed > 0 ? 1 : 0;
      acc.succeeded += item.succeeded > 0 && item.failed === 0 ? 1 : 0;
      acc.waiting += item.waiting > 0 ? 1 : 0;
      return acc;
    },
    { failed: 0, succeeded: 0, waiting: 0 },
  );
  const selectedTasks = filteredTasks.filter((task) => selectedTaskIds.has(task.id));
  const retryableTasks = filteredTasks.filter(canRetryPublishRecord);
  const batchRetryTargets = selectedTasks.length
    ? selectedTasks.filter(canRetryPublishRecord)
    : retryableTasks;
  const allSelected =
    pageTasks.length > 0 && pageTasks.every((task) => selectedTaskIds.has(task.id));
  const allExpanded =
    pageTasks.length > 0 && pageTasks.every((task) => expandedTaskIds.has(task.id));
  const exportTargets = selectedTasks.length ? selectedTasks : filteredTasks;

  const toggleSelectAll = (checked: boolean) => {
    setSelectedTaskIds(
      checked
        ? new Set([...selectedTaskIds, ...pageTasks.map((task) => task.id)])
        : new Set(
            Array.from(selectedTaskIds).filter(
              (taskId) => !pageTasks.some((task) => task.id === taskId),
            ),
          ),
    );
  };

  const toggleTaskSelection = (taskId: number, checked: boolean) => {
    setSelectedTaskIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(taskId);
      } else {
        next.delete(taskId);
      }
      return next;
    });
  };

  const toggleTaskExpanded = (taskId: number) => {
    setExpandedTaskIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  const toggleAllExpanded = () => {
    setExpandedTaskIds(
      allExpanded
        ? new Set(
            Array.from(expandedTaskIds).filter(
              (taskId) => !pageTasks.some((task) => task.id === taskId),
            ),
          )
        : new Set([...expandedTaskIds, ...pageTasks.map((task) => task.id)]),
    );
  };

  const openTaskStatus = (task: AutoUploadPublishTask) => {
    setStatusSession(buildPublishTaskAgentSession(task));
  };

  const retryPublishTask = async (
    task: AutoUploadPublishTask,
    options: { quiet?: boolean } = {},
  ) => {
    if (!canRetryPublishRecord(task)) {
      if (!options.quiet) {
        addToast({
          title: "这条记录不能重发",
          description: "仅包含失败平台的有效发布记录可以重新提交。",
          color: "warning",
        });
      }
      return { ok: false, message: "记录不可重发" };
    }
    const approval = await autoUploadApi.createRetryTaskConfirmation(task.id);
    const retry = await autoUploadApi.retryTask(
      task.id,
      approval.confirmationId,
    );
    const results = retry.result?.results || [];
    const failures = results.filter((item) => item.ok === false);
    const pending = results.filter(
      (item) => item.ok !== true && item.ok !== false,
    );
    const missingFields = retry.missingFields || [];
    const restoredText = retry.restoredFields?.length
      ? `已恢复：${retry.restoredFields.join("、")}`
      : retry.payloadSource === "reconstructed"
        ? "未找到原始参数，已按任务记录重建基础参数"
        : undefined;
    const missingText = missingFields.length
      ? `缺少字段：${missingFields.join("、")}`
      : undefined;
    const description =
      [
        failures.length
          ? failures
              .map(
                (item) =>
                  `${item.platform || item.type}：${item.message || "失败"}`,
              )
              .join("；")
          : null,
        pending.length
          ? pending
              .map(
                (item) =>
                  `${item.platform || item.type}：${item.message || "待平台反馈或结果确认"}`,
              )
              .join("；")
          : null,
        restoredText,
        missingText,
      ]
        .filter(Boolean)
        .join("；") || undefined;

    if (!options.quiet) {
      addToast({
        title: missingFields.length
          ? "重试参数不完整"
          : failures.length
            ? "重试已提交但仍有失败"
            : pending.length
              ? "重试已提交，等待平台记录"
              : "重试任务已确认",
        description,
        color:
          missingFields.length || failures.length || pending.length
            ? "warning"
            : "success",
      });
    }
    return {
      ok: missingFields.length === 0 && failures.length === 0,
      message: description || "已重新提交",
    };
  };

  const handleRetry = async (task: AutoUploadPublishTask) => {
    setRetryingTaskId(task.id);
    try {
      await retryPublishTask(task);
      await onRefresh();
    } catch (e: unknown) {
      addToast({
        title: "重试失败",
        description: toPublicError(e, "发布任务未重试，请稍后再试。"),
        color: "danger",
      });
    } finally {
      setRetryingTaskId(null);
    }
  };

  const handleBatchRetry = async () => {
    if (!batchRetryTargets.length) {
      addToast({
        title: "没有可重发记录",
        description: "请选择失败记录，或先展开查看失败原因。",
        color: "warning",
      });
      return;
    }
    setBatchRetrying(true);
    try {
      const results = [];
      for (const task of batchRetryTargets) {
        try {
          results.push(await retryPublishTask(task, { quiet: true }));
        } catch (e: unknown) {
          results.push({
            ok: false,
            message: toPublicError(e, "发布任务未重试，请稍后再试。"),
          });
        }
      }
      const failed = results.filter((item) => !item.ok);
      addToast({
        title: failed.length ? "批量重发已处理" : "批量重发已提交",
        description: failed.length
          ? `已处理 ${results.length} 条，其中 ${failed.length} 条需要继续查看失败原因。`
          : `已提交 ${results.length} 条发布记录。`,
        color: failed.length ? "warning" : "success",
      });
      await onRefresh();
    } finally {
      setBatchRetrying(false);
    }
  };

  const handleDeleteTask = async () => {
    if (!taskToDelete) return;
    setDeletingTaskId(taskToDelete.id);
    try {
      await autoUploadApi.deleteTask(
        taskToDelete.id,
        buildRiskConfirmation("local-file-delete"),
      );
      addToast({ title: "发布记录已删除", color: "success" });
      setSelectedTaskIds((current) => {
        const next = new Set(current);
        next.delete(taskToDelete.id);
        return next;
      });
      setExpandedTaskIds((current) => {
        const next = new Set(current);
        next.delete(taskToDelete.id);
        return next;
      });
      setTaskToDelete(null);
      await onRefresh();
    } catch (e: unknown) {
      addToast({
        title: "删除失败",
        description: toPublicError(e, "发布记录未删除，请稍后重试。"),
        color: "danger",
      });
    } finally {
      setDeletingTaskId(null);
    }
  };

  const handleBatchDelete = async () => {
    if (!selectedTasks.length) {
      addToast({
        title: "没有可删除记录",
        description: "请先勾选需要删除的发布记录。",
        color: "warning",
      });
      return;
    }
    setBatchDeleting(true);
    try {
      const failed: string[] = [];
      for (const task of selectedTasks) {
        try {
          await autoUploadApi.deleteTask(
            task.id,
            buildRiskConfirmation("local-file-delete"),
          );
        } catch (e: unknown) {
          failed.push(
            `${displayPublishTaskTitle(task.title)}：${
              toPublicError(e, "删除未完成，请稍后重试。")
            }`,
          );
        }
      }
      addToast({
        title: failed.length ? "批量删除已处理" : "批量删除完成",
        description: failed.length
          ? `已处理 ${selectedTasks.length} 条，其中 ${failed.length} 条需要单独查看。`
          : `已删除 ${selectedTasks.length} 条发布记录。`,
        color: failed.length ? "warning" : "success",
      });
      setSelectedTaskIds(new Set());
      setExpandedTaskIds((current) => {
        const deletedIds = new Set(selectedTasks.map((task) => task.id));
        return new Set(Array.from(current).filter((taskId) => !deletedIds.has(taskId)));
      });
      await onRefresh();
    } finally {
      setBatchDeleting(false);
    }
  };
  return (
    <>
      <VStack gap={4}>
        <Banner
          container="section"
          description={
            error
              ? "任务列表读取异常时，先看本机服务、平台账号和登录状态，再继续重发或删除。"
              : loading
                ? "正在同步发布任务、失败原因和结果留存。"
                : `当前共有 ${pagination.total} 条发布记录，失败 ${metrics.failed} 条，待确认 ${metrics.waiting} 条。`
          }
          status={error ? "warning" : loading ? "info" : "success"}
          title="发布任务工作台"
        />
        <MetadataList columns="single" label={{ position: "start", width: 96 }}>
          <MetadataListItem label="当前记录">
            {pagination.total}
          </MetadataListItem>
          <MetadataListItem label="可重发">
            {retryableTasks.length}
          </MetadataListItem>
          <MetadataListItem label="批量动作">
            重发、删除、导出都保留确认
          </MetadataListItem>
        </MetadataList>
      </VStack>
      <OpsPanel
        extra={
          <HStack align="center" gap={1.5} justify="end" wrap="wrap">
            <Button
              color="warning"
              isDisabled={!batchRetryTargets.length}
              isLoading={batchRetrying}
              size="sm"
              startContent={
                batchRetrying ? null : (
                  <Icon icon="solar:restart-circle-linear" />
                )
              }
              variant="flat"
              onPress={() => setBatchAction("retry")}
            >
              批量重新发布
            </Button>
            <Button
              color="danger"
              isDisabled={!selectedTasks.length}
              isLoading={batchDeleting}
              size="sm"
              startContent={
                batchDeleting ? null : (
                  <Icon icon="solar:trash-bin-minimalistic-linear" />
                )
              }
              variant="flat"
              onPress={() => setBatchAction("delete")}
            >
              批量删除
            </Button>
            <MoreMenu
              isDisabled={!tasks.length}
              label="更多操作"
              items={[
                {
                  label: allExpanded ? "收起全部" : "展开全部",
                  onClick: toggleAllExpanded,
                },
                {
                  label: selectedTasks.length
                    ? "导出已选"
                    : "导出当前记录",
                  onClick: () => downloadPublishTasks(exportTargets),
                },
                {
                  type: "divider",
                },
                {
                  label: "清除选择",
                  isDisabled: !selectedTaskIds.size,
                  onClick: () => setSelectedTaskIds(new Set()),
                },
              ]}
              size="sm"
            />
            <Button
              color="primary"
              isLoading={loading}
              size="sm"
              startContent={loading ? null : <Icon icon="solar:refresh-linear" />}
              variant="flat"
              onPress={() => {
                onRefresh().catch(() => {
                  addToast({ title: "发布记录刷新失败", color: "danger" });
                });
              }}
              >
              刷新
            </Button>
          </HStack>
        }
        title="发布记录"
      >
          <OpsToolbar className="mb-3">
            <OpsMetric label="当前记录" tone="brand" value={pagination.total} />
            <OpsMetric label="成功任务数" tone="success" value={metrics.succeeded} />
            <OpsMetric label="失败任务数" tone="danger" value={metrics.failed} />
            <OpsMetric label="待确认" tone="warning" value={metrics.waiting} />
            <OpsStatusPill tone={selectedTaskIds.size ? "brand" : "default"}>
              已选 {selectedTaskIds.size}
            </OpsStatusPill>
            <OpsStatusPill tone={retryableTasks.length ? "danger" : "default"}>
              可重发 {retryableTasks.length}
            </OpsStatusPill>
          </OpsToolbar>
          <Toolbar
            label="发布记录筛选"
            size="sm"
            startContent={
              <HStack align="center" gap={2} wrap="wrap" width="100%">
                <StackItem size="fill">
                  <TextInput
                    hasClear
                    isLabelHidden
                    label="搜索发布记录"
                    placeholder="搜索标题、平台或账号"
                    size="sm"
                    value={recordSearch}
                    onChange={(value) => setRecordSearch(value)}
                  />
                </StackItem>
                <Selector
                  isLabelHidden
                  label="按状态筛选发布记录"
                  options={recordStatusOptions}
                  placeholder="全部状态"
                  size="sm"
                  value={recordStatus}
                  onChange={(value) => setRecordStatus(value)}
                />
                <Selector
                  isLabelHidden
                  label="按平台筛选发布记录"
                  options={recordPlatformOptions}
                  placeholder="全部平台"
                  size="sm"
                  value={recordPlatform}
                  onChange={(value) => setRecordPlatform(value)}
                />
              </HStack>
            }
            endContent={
              <Text as="p" color="secondary" type="supporting">
                每页 {PUBLISH_RECORD_PAGE_SIZE} 条
              </Text>
            }
          />
          {error ? (
            <FailureActionPanel
              actions={[
                {
                  label: "重试读取",
                  onPress: () => {
                    onRefresh().catch(() => {
                      addToast({ title: "任务刷新失败", color: "danger" });
                    });
                  },
                },
              ]}
              impact="无法查看发布任务状态、失败原因和重试入口。"
              nextAction="先重试读取任务；仍失败时查看设备状态或重新登录。"
              reason="发布任务列表读取失败，可能是记录服务或登录状态暂时不可用。"
              technicalDetails={error}
              title="发布任务列表需要处理"
            />
          ) : null}
          <OpsDenseTable>
          <Table aria-label="发布记录明细表" removeWrapper>
            <TableHeader>
              <TableColumn>
                <Checkbox
                  aria-label="选择全部发布记录"
                  isSelected={allSelected}
                  size="sm"
                  onValueChange={toggleSelectAll}
                />
              </TableColumn>
              <TableColumn>任务标题</TableColumn>
              <TableColumn>任务类型</TableColumn>
              <TableColumn>任务总数</TableColumn>
              <TableColumn>成功任务数</TableColumn>
              <TableColumn>失败任务数</TableColumn>
              <TableColumn>失败原因</TableColumn>
              <TableColumn>发布类型</TableColumn>
              <TableColumn>创建时间</TableColumn>
              <TableColumn>任务状态</TableColumn>
              <TableColumn>操作</TableColumn>
            </TableHeader>
          <TableBody
              emptyContent={
                loading ? (
                  "正在加载发布任务..."
                ) : (
                  <VStack gap={4}>
                    <Banner
                      container="section"
                      description={emptyStateDescription}
                      status={error ? "warning" : "info"}
                      title="当前没有发布任务"
                    />
                    <Heading level={3}>先从图文或视频发布开始</Heading>
                    <Text as="p" color="secondary" type="supporting">
                      先创建一个明确的平台任务，再逐步看检查、待确认、执行和结果留存。
                    </Text>
                    <MetadataList
                      columns="single"
                      label={{ position: "start", width: 96 }}
                    >
                      <MetadataListItem label="发布前检查">
                        确认账号、素材和平台参数
                      </MetadataListItem>
                      <MetadataListItem label="待我确认">
                        需要人工确认的发布会先停在这里
                      </MetadataListItem>
                      <MetadataListItem label="结果留存">
                        成功、失败和跳过项都会回到这里
                      </MetadataListItem>
                    </MetadataList>
                    <Grid columns={{ minWidth: 160, max: 2 }} gap={3}>
                      <AstryxButton
                        label="图文发布"
                        onClick={() => {
                          window.location.href = "/distribution?tab=article";
                        }}
                        variant="primary"
                        width="100%"
                      />
                      <AstryxButton
                        label="视频发布"
                        onClick={() => {
                          window.location.href = "/distribution?tab=video";
                        }}
                        variant="secondary"
                        width="100%"
                      />
                    </Grid>
                    <Text as="p" color="secondary" type="supporting">
                      先从一个明确的平台任务开始，后续再批量重发或导出记录。
                    </Text>
                  </VStack>
                )
              }
              isLoading={loading}
              loadingContent={<Spinner size="sm" />}
            >
              {pageTasks.flatMap((task, index) => {
                const taskMetrics = getPublishTaskMetrics(task);
                const failureReason = getPublishTaskFailureReason(task);
                const isExpanded = expandedTaskIds.has(task.id);
                const rowKey = `${task.id}-${task.platform || "platform"}-${task.updated_at || index}-${index}`;
                const rows = [
                  <TableRow key={rowKey}>
                    <TableCell>
                      <Checkbox
                        aria-label={`选择发布记录 ${displayPublishTaskTitle(task.title)}`}
                        isSelected={selectedTaskIds.has(task.id)}
                        size="sm"
                        onValueChange={(checked) =>
                          toggleTaskSelection(task.id, checked)
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex min-w-[180px] flex-col gap-1">
                        <span className="line-clamp-2 text-small font-medium text-default-900">
                          {displayPublishTaskTitle(task.title)}
                        </span>
                        <div className="flex flex-wrap gap-1">
                          <Chip size="sm" variant="flat">
                            {getPublishTaskCreateType(task)}
                          </Chip>
                          <Chip size="sm" variant="flat">
                            {getPublishTaskType(task)}
                          </Chip>
                          <Chip size="sm" variant="flat">
                            {displayPublishTaskReference(task)}
                          </Chip>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Chip size="sm" variant="flat">
                        {getPublishTaskType(task)}
                      </Chip>
                    </TableCell>
                    <TableCell>
                      <span className="font-semibold text-default-900">
                        {taskMetrics.total}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="font-semibold text-success">
                        {taskMetrics.succeeded}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="font-semibold text-danger">
                        {taskMetrics.failed}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span
                        className="line-clamp-3 max-w-[220px] text-tiny text-default-600"
                        title={failureReason || "暂无失败原因"}
                      >
                        {failureReason || "-"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Chip
                        color={task.dry_run ? "warning" : "success"}
                        size="sm"
                        variant="flat"
                      >
                        {getPublishTaskModeLabel(task)}
                      </Chip>
                    </TableCell>
                    <TableCell>
                      <div className="flex min-w-[132px] flex-col gap-1 text-tiny text-default-500">
                        <span>
                          {new Date(task.created_at).toLocaleString()}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Chip
                        color={getTaskStatusColor(getPublishTaskDisplayStatus(task))}
                        size="sm"
                        variant="flat"
                      >
                        {resolveTaskStatus(getPublishTaskDisplayStatus(task))}
                      </Chip>
                    </TableCell>
                    <TableCell>
                      <div className="flex min-w-[230px] flex-wrap items-center gap-1">
                        <Button
                          size="sm"
                          startContent={
                            <Icon
                              icon={
                                isExpanded
                                  ? "solar:alt-arrow-up-linear"
                                  : "solar:alt-arrow-down-linear"
                              }
                            />
                          }
                          variant="flat"
                          onPress={() => toggleTaskExpanded(task.id)}
                        >
                          {isExpanded ? "收起" : "展开"}
                        </Button>
                        <Button
                          size="sm"
                          startContent={<Icon icon="solar:radio-linear" />}
                          variant="flat"
                          onPress={() => openTaskStatus(task)}
                        >
                          状态
                        </Button>
                        <Button
                          size="sm"
                          startContent={<Icon icon="solar:eye-linear" />}
                          variant="flat"
                          onPress={() => setSelectedTask(task)}
                        >
                          详情
                        </Button>
                        <Button
                          color={taskMetrics.failed > 0 ? "danger" : "default"}
                          isDisabled={!canRetryPublishRecord(task)}
                          isLoading={retryingTaskId === task.id}
                          size="sm"
                          startContent={
                            retryingTaskId === task.id ? null : (
                              <Icon icon="solar:restart-linear" />
                            )
                          }
                          variant="flat"
                          onPress={() => {
                            void handleRetry(task);
                          }}
                          >
                          重发
                        </Button>
                        <MoreMenu
                          label="更多"
                          items={[
                            {
                              label: "查看状态",
                              onClick: () => openTaskStatus(task),
                            },
                            {
                              label: "查看详情",
                              onClick: () => setSelectedTask(task),
                            },
                            {
                              type: "divider",
                            },
                            {
                              label: "删除记录",
                              onClick: () => setTaskToDelete(task),
                            },
                          ]}
                          size="sm"
                        />
                      </div>
                    </TableCell>
                  </TableRow>,
                ];
                if (isExpanded) {
                  rows.push(
                    <TableRow key={`${rowKey}-expanded`}>
                      <TableCell colSpan={11}>
                        <PublishTaskExpandedRecord task={task} />
                      </TableCell>
                    </TableRow>,
                  );
                }
                return rows;
              })}
            </TableBody>
          </Table>
          </OpsDenseTable>
          {pagination.total ? (
            <div className="mt-3 flex items-center justify-between gap-3 text-tiny text-default-500">
              <span>
                显示 {(recordPage - 1) * PUBLISH_RECORD_PAGE_SIZE + 1}-
                {Math.min(recordPage * PUBLISH_RECORD_PAGE_SIZE, pagination.total)}
                ，共 {pagination.total} 条
              </span>
              <div className="flex items-center gap-1">
                <Button
                  isIconOnly
                  aria-label="上一页"
                  isDisabled={recordPage <= 1}
                  size="sm"
                  variant="flat"
                  onPress={() => setRecordPage((page) => Math.max(1, page - 1))}
                >
                  <Icon icon="solar:alt-arrow-left-linear" />
                </Button>
                <span className="min-w-14 text-center">
                  {recordPage} / {pageCount}
                </span>
                <Button
                  isIconOnly
                  aria-label="下一页"
                  isDisabled={recordPage >= pageCount}
                  size="sm"
                  variant="flat"
                  onPress={() =>
                    setRecordPage((page) => Math.min(pageCount, page + 1))
                  }
                >
                  <Icon icon="solar:alt-arrow-right-linear" />
                </Button>
              </div>
            </div>
          ) : null}
      </OpsPanel>
      <Modal
        isOpen={Boolean(selectedTask)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedTask(null);
          }
        }}
        scrollBehavior="inside"
        size="3xl"
      >
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            <span>任务详情</span>
            <span className="text-small font-normal text-default-500">
              {selectedTask
                ? `${displayPublishTaskReference(selectedTask)} · ${selectedTask.platform}`
                : ""}
            </span>
          </ModalHeader>
          <ModalBody>
            {selectedTask ? <TaskDetail task={selectedTask} /> : null}
          </ModalBody>
          <ModalFooter>
            {selectedTask ? (
              <>
                <Button
                  as={Link}
                  href={buildTaskReuseHref(selectedTask)}
                  startContent={<Icon icon="solar:copy-linear" />}
                  variant="flat"
                >
                  复用为新任务
                </Button>
                <Button
                  startContent={<Icon icon="solar:radio-linear" />}
                  variant="flat"
                  onPress={() => openTaskStatus(selectedTask)}
                >
                  查看状态
                </Button>
                <Button
                  color={
                    selectedTask.status === "failed" ? "danger" : "default"
                  }
                  isDisabled={!canRetryPublishRecord(selectedTask)}
                  isLoading={retryingTaskId === selectedTask.id}
                  startContent={
                    retryingTaskId === selectedTask.id ? null : (
                      <Icon icon="solar:restart-linear" />
                    )
                  }
                  variant="flat"
                  onPress={() => {
                    void handleRetry(selectedTask);
                  }}
                >
                  重试任务
                </Button>
              </>
            ) : null}
            <Button
              color="primary"
              variant="flat"
              onPress={() => setSelectedTask(null)}
            >
              关闭
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      <AgentStatusDrawer
        recordHref={() => "/distribution?tab=tasks"}
        session={statusSession}
        onClose={() => setStatusSession(null)}
      />
      <RiskConfirmationDialog
        checklist={
          batchAction === "retry"
            ? [
                "确认已处理账号登录、素材或平台限制。",
                "确认这些失败记录可以再次提交到对应平台。",
              ]
            : [
                "确认已查看需要保留的平台结果和失败原因。",
                "确认删除后不再需要从发布记录中回查这些条目。",
              ]
        }
        confirmLabel={batchAction === "retry" ? "确认重新发布" : "确认删除"}
        description={
          batchAction === "retry"
            ? "将重新提交所选失败记录，请核对账号和内容后继续。"
            : "将删除所选发布记录，此操作不会撤回平台上已经发布的内容。"
        }
        impactItems={[
          {
            label: "记录数量",
            value:
              batchAction === "retry"
                ? batchRetryTargets.length
                : selectedTasks.length,
          },
          {
            label: "操作",
            value: batchAction === "retry" ? "重新发布" : "删除记录",
          },
        ]}
        isLoading={batchRetrying || batchDeleting}
        isOpen={Boolean(batchAction)}
        riskLevel="high"
        title={batchAction === "retry" ? "确认批量重新发布" : "确认批量删除"}
        onCancel={() => setBatchAction(null)}
        onConfirm={() => {
          const action = batchAction;
          void (async () => {
            try {
              if (action === "retry") await handleBatchRetry();
              if (action === "delete") await handleBatchDelete();
            } finally {
              setBatchAction(null);
            }
          })();
        }}
      />
      <Modal
        isOpen={Boolean(taskToDelete)}
        onOpenChange={(open) => {
          if (!open) {
            setTaskToDelete(null);
          }
        }}
      >
        <ModalContent>
          <ModalHeader>删除发布记录</ModalHeader>
          <ModalBody>
            <p className="text-small text-default-600">
              将删除本机保存的发布记录。已经发生的平台操作不会撤回。
            </p>
            {taskToDelete ? (
              <div className="rounded-[8px] border-small border-divider bg-default-50 p-3">
                <p className="text-small font-semibold text-default-900">
                  {displayPublishTaskTitle(taskToDelete.title)}
                </p>
                <p className="mt-1 text-tiny text-default-500">
                  {displayPublishTaskReference(taskToDelete)} · {taskToDelete.platform || "发布记录"}
                </p>
              </div>
            ) : null}
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={() => setTaskToDelete(null)}>
              取消
            </Button>
            <Button
              color="danger"
              isLoading={deletingTaskId === taskToDelete?.id}
              onPress={() => {
                void handleDeleteTask();
              }}
            >
              删除
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}

function PublishTaskExpandedRecord({ task }: { task: AutoUploadPublishTask }) {
  const summary = summarizeTaskResult(task.result);
  const rows = summary.results.length
    ? summary.results
    : [
        {
          type: task.platform_type,
          ok: task.status.toLowerCase().includes("fail") ? false : null,
          platform: task.platform,
          account: task.account_file,
          message:
            getPublishTaskDisplayStatus(task) === "waiting_platform_confirmation"
              ? "等待平台确认"
              : task.message || "暂无平台明细",
          status: getPublishTaskDisplayStatus(task),
        } as PublishResultItem,
      ];
  return (
    <div className="border border-divider bg-default-50 p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <OpsStatusPill>
          账号 {getPublishTaskAccounts(task).length || 1}
        </OpsStatusPill>
        <OpsStatusPill>
          素材 {(task.file_list || []).length}
        </OpsStatusPill>
        <OpsStatusPill>
          标签 {(task.tags || []).length}
        </OpsStatusPill>
        <OpsStatusPill tone={getPublishTaskEvidenceCount(task) ? "success" : "default"}>
          证据 {getPublishTaskEvidenceCount(task)}
        </OpsStatusPill>
      </div>
      <OpsDenseTable>
        <table>
          <thead>
            <tr>
              <th>账号</th>
              <th>平台</th>
              <th>发布状态</th>
              <th>定时发布时间</th>
              <th>执行发布时间</th>
              <th>失败原因</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item, index) => {
              const receipt = publishReceiptValue(item);
              const receiptHref = item.publishUrl || item.platformUrl || "";
              return (
                <tr
                  key={`${task.id}-${item.platform || item.type}-${item.account || index}-${index}`}
                >
                  <td>
                    {displayFileName(
                      item.account || task.account_file || "未记录账号",
                    )}
                  </td>
                  <td>{item.platform || task.platform || "平台"}</td>
                  <td>
                    <Chip
                      color={resolvePublishResultColor(item.ok)}
                      size="sm"
                      variant="flat"
                    >
                      {resolvePublishResultLabel(item)}
                    </Chip>
                  </td>
                  <td>{getPublishTaskScheduledTime(task)}</td>
                  <td>{getPublishTaskExecutedTime(task)}</td>
                  <td>
                    {cleanUserFacingRuntimeText(
                      item.message || item.nextAction || "",
                    ) || "-"}
                  </td>
                  <td>
                    {receiptHref ? (
                      <a
                        className="text-[#f759ab] underline-offset-4 hover:underline"
                        href={receiptHref}
                        rel="noreferrer"
                        target="_blank"
                      >
                        查看发布页
                      </a>
                    ) : (
                      commercialDisplayText(receipt || "暂无反馈")
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </OpsDenseTable>
      {(task.file_list || []).length || (task.tags || []).length ? (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <div className="rounded-small bg-background p-3">
            <p className="text-tiny font-semibold text-default-500">素材</p>
            <p className="mt-1 line-clamp-3 break-all text-small text-default-700">
              {(task.file_list || [])
                .map((file) => displayFileName(file))
                .join("、") || "-"}
            </p>
          </div>
          <div className="rounded-small bg-background p-3">
            <p className="text-tiny font-semibold text-default-500">标签</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {(task.tags || []).length ? (
                task.tags?.map((tag) => (
                  <Chip key={`${task.id}-${tag}`} size="sm" variant="flat">
                    {tag}
                  </Chip>
                ))
              ) : (
                <span className="text-small text-default-500">无</span>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TaskDetail({ task }: { task: AutoUploadPublishTask }) {
  const summary = summarizeTaskResult(task.result);
  const sourceIdentity = getPublishRecordSourceIdentity(task);
  const failureContext: LocalEngineFailureContext | null =
    task.status === "failed" || summary.failures.length
      ? {
          platform:
            summary.failures[0]?.platform ||
            task.platform ||
            String(task.platform_type),
          account:
            summary.failures[0]?.account || task.account_file || "未识别账号",
          target: displayPublishTaskTitle(task.title),
          stage: task.dry_run ? "发布前检查" : "正式发布",
          reason:
            summary.failures[0]?.message || task.message || "发布任务失败",
          nextAction: "处理账号登录状态、素材或平台页面权限后重试。",
        }
      : null;
  return (
    <div className="flex flex-col gap-4">
      <ResultSummaryPanel
        actions={[
          ...(sourceIdentity
            ? [
                {
                  href: `/content/articles?articleId=${encodeURIComponent(sourceIdentity.articleId)}`,
                  label: "查看来源文章",
                },
              ]
            : []),
          {
            href: buildTaskReuseHref(task),
            label: "复用为新任务",
            tone: "primary",
          },
          { href: "/distribution?tab=logs", label: "查看发布结果" },
        ]}
        failed={summary.failures.length}
        skipped={summary.pending.length}
        succeeded={summary.succeeded.length}
        subtitle="复用会带入标题和标签，账号、素材和发布方式需要重新确认。"
        title="任务结果摘要"
        total={summary.results.length || 1}
      />
      <div className="grid gap-3 md:grid-cols-2">
        <StatusItem label="标题" value={displayPublishTaskTitle(task.title)} />
        {sourceIdentity ? (
          <StatusItem label="来源文章" value={sourceIdentity.title} />
        ) : null}
        <StatusItem
          label="平台"
          value={task.platform || String(task.platform_type)}
        />
        <StatusItem
          label="模式"
          value={task.dry_run ? "发布前检查" : "正式发布"}
        />
        <StatusItem
          label="状态"
          value={resolveTaskStatus(getPublishTaskDisplayStatus(task))}
        />
        <StatusItem
          label="账号"
          value={displayFileName(task.account_file, "-")}
          wide
        />
        <StatusItem
          label="创建时间"
          value={new Date(task.created_at).toLocaleString()}
        />
        <StatusItem
          label="更新时间"
          value={new Date(task.updated_at).toLocaleString()}
        />
      </div>
      {task.message ? (
        <div className="rounded-[8px] border-small border-divider bg-default-50 p-3">
          <p className="text-tiny font-semibold text-default-500">任务消息</p>
          <p className="mt-1 whitespace-pre-wrap text-small text-default-700">
            {cleanUserFacingRuntimeText(task.message)}
          </p>
        </div>
      ) : null}
      {failureContext ? <FailureContextBox context={failureContext} /> : null}
      <div className="rounded-[8px] border-small border-divider bg-default-50 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-tiny font-semibold text-default-500">
            平台结果明细
          </p>
          <Chip color="success" size="sm" variant="flat">
            已确认 {summary.succeeded.length}
          </Chip>
          <Chip color="danger" size="sm" variant="flat">
            失败 {summary.failures.length}
          </Chip>
          <Chip color="warning" size="sm" variant="flat">
            未执行 {summary.pending.length}
          </Chip>
        </div>
        <div className="mt-3 grid gap-2">
          {summary.results.length ? (
            summary.results.map((item, index) => (
              <div
                key={`${item.type}-${item.platform || "platform"}-${item.account || "account"}-${item.publishTaskId || item.status || index}-${index}`}
                className="rounded-small border-small border-divider bg-background p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Chip
                    color={resolvePublishResultColor(item.ok)}
                    size="sm"
                    variant="flat"
                  >
                    {resolvePublishResultLabel(item)}
                  </Chip>
                  <span className="text-small font-semibold text-default-900">
                    {item.platform || `平台 ${item.type}`}
                  </span>
                  <span className="text-tiny text-default-500">
                    {displayFileName(item.account || task.account_file, "-")}
                  </span>
                </div>
                <p className="mt-1 break-words text-small text-default-600">
                  {cleanUserFacingRuntimeText(item.message) ||
                    (item.ok ? "已提交" : "暂无详情")}
                </p>
                {item.nextAction ? (
                  <p className="mt-1 break-words text-tiny text-default-500">
                    下一步：{cleanUserFacingRuntimeText(item.nextAction)}
                  </p>
                ) : null}
                {publishReceiptValue(item) ? (
                  <p className="mt-1 break-all text-tiny text-default-500">
                    反馈：{commercialDisplayText(publishReceiptValue(item))}
                  </p>
                ) : null}
              </div>
            ))
          ) : (
            <p className="text-small text-default-500">
              当前任务还没有详细结果，稍后可在结果留存里查看排查记录。
            </p>
          )}
        </div>
      </div>
      <div className="rounded-[8px] border-small border-divider bg-default-50 p-3">
        <p className="text-tiny font-semibold text-default-500">素材文件</p>
        <div className="mt-2 flex flex-col gap-1">
          {(task.file_list || []).length ? (
            task.file_list?.map((file) => (
              <code
                key={file}
                className="break-all rounded-small bg-background px-2 py-1 text-tiny text-default-700"
              >
                {displayFileName(file)}
              </code>
            ))
          ) : (
            <span className="text-small text-default-500">无</span>
          )}
        </div>
      </div>
      <div className="rounded-[8px] border-small border-divider bg-default-50 p-3">
        <p className="text-tiny font-semibold text-default-500">标签</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {(task.tags || []).length ? (
            task.tags?.map((tag) => (
              <Chip key={tag} size="sm" variant="flat">
                {tag}
              </Chip>
            ))
          ) : (
            <span className="text-small text-default-500">无</span>
          )}
        </div>
      </div>
      <div className="rounded-[8px] border-small border-divider bg-default-50 p-3">
        <p className="text-tiny font-semibold text-default-500">执行结果</p>
        <p className="mt-1 text-small text-default-700">
          {task.result
            ? "已生成执行结果，平台明细见上方。"
            : "当前任务还没有执行结果。"}
        </p>
        {task.result ? (
          <p className="mt-2 text-tiny text-default-500">
            平台反馈已保存，可在发布记录中继续查看。
          </p>
        ) : null}
      </div>
    </div>
  );
}
function ActionBlockerList({
  blockers,
}: {
  blockers: LocalEngineActionBlocker[];
}) {
  if (!blockers.length) return null;

  return (
    <div className="grid gap-2">
      {blockers.map((blocker, index) => {
        const isAccountBlocker = [
          blocker.stage,
          blocker.capability,
          blocker.account,
          blocker.reason,
          blocker.nextAction,
        ]
          .filter(Boolean)
          .some((text) => /账号|account|登录/.test(String(text)));

        return (
          <div
            key={`${blocker.stage}-${index}`}
            className="rounded-[8px] border-small border-danger-200 bg-danger-50 p-3 text-small text-danger-700"
          >
            <div className="flex flex-wrap items-center gap-2 font-semibold">
              <Icon icon="solar:shield-warning-linear" />
              <span>需处理：{cleanUserFacingRuntimeText(blocker.stage)}</span>
              {blocker.capability ? (
                <Chip color="danger" size="sm" variant="flat">
                  {cleanUserFacingRuntimeText(blocker.capability)}
                </Chip>
              ) : null}
            </div>
            <p className="mt-2">
              {[
                blocker.platform ? `平台：${blocker.platform}` : null,
                blocker.account
                  ? `账号：${cleanUserFacingRuntimeText(blocker.account)}`
                  : null,
                blocker.target
                  ? `对象：${cleanUserFacingRuntimeText(blocker.target)}`
                  : null,
                `原因：${cleanUserFacingRuntimeText(blocker.reason)}`,
              ]
                .filter(Boolean)
                .join("；")}
            </p>
            <p className="mt-1 text-tiny">
              下一步：{cleanUserFacingRuntimeText(blocker.nextAction)}
            </p>
            {isAccountBlocker ? (
              <Button
                as={Link}
                className="mt-3"
                color="danger"
                href="/distribution?tab=accounts"
                size="sm"
                startContent={
                  <Icon icon="solar:key-minimalistic-square-linear" />
                }
                variant="flat"
              >
                去登录平台账号
              </Button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function PublishWorkflowStepper({
  accountCount,
  blockerCount,
  latestSessionTitle,
  materialCount,
  mode,
  phase,
  preflightResult,
  resultCount,
  resultFailureCount,
  statusMessage,
  timerLabel,
  title,
}: {
  accountCount: number;
  blockerCount: number;
  latestSessionTitle?: string;
  materialCount: number;
  mode: PublishWorkflowMode;
  phase: PublishWorkflowPhase;
  preflightResult: AutoUploadPublishPreflightResult | null;
  resultCount: number;
  resultFailureCount: number;
  statusMessage: string;
  timerLabel: string;
  title: string;
}) {
  const failedIndex =
    preflightResult && !preflightResult.ok ? 1 : resultFailureCount ? 4 : 3;
  const phaseIndex: Record<Exclude<PublishWorkflowPhase, "failed">, number> = {
    draft: 0,
    blocked: 0,
    preflight: 1,
    confirmation: 2,
    queued: 2,
    executing: 3,
    evidence: 4,
  };
  const activeIndex = phase === "failed" ? failedIndex : phaseIndex[phase];
  const steps = [
    {
      label: "发布计划",
      detail: title
        ? `${accountCount} 个账号，${materialCount} 个素材`
        : "等待标题、账号和素材",
    },
    {
      label: "发布前检查",
      detail: preflightResult
        ? preflightResult.ok
          ? `${preflightResult.accountCount} 个账号、${preflightResult.materialCount} 个素材已检查`
          : `${preflightResult.issues.length} 项未通过`
        : blockerCount
          ? `${blockerCount} 项需处理`
          : "等待提交",
    },
    {
      label: mode === "real" ? "待我确认" : "检查任务",
      detail:
        mode === "real"
          ? latestSessionTitle || "高风险发布需要人工审批"
          : "发布前检查无需人工审批",
    },
    {
      label: mode === "real" ? "执行发布" : "平台反馈",
      detail:
        mode === "real"
          ? "审批通过后由本机发布服务继续"
          : "读取平台检查结果",
    },
    {
      label: "结果留存",
      detail: resultCount
        ? resultFailureCount
          ? `${resultFailureCount} 个失败项`
          : `${resultCount} 个平台结果`
        : "等待任务和结果回查",
    },
  ];

  const statusForIndex = (index: number): PublishWorkflowStepStatus => {
    if (phase === "blocked") return index === 0 ? "blocked" : "pending";
    if (phase === "failed") {
      if (index < failedIndex) return "complete";
      if (index === failedIndex) return "failed";
      return "pending";
    }
    if (phase === "evidence") {
      if (index < 4) return "complete";
      return resultFailureCount ? "failed" : "complete";
    }
    if (index < activeIndex) return "complete";
    if (index === activeIndex) return "active";
    return "pending";
  };

  const modeChip =
    mode === "real"
      ? { label: "正式发布", color: "danger" as const }
      : { label: "发布前检查", color: "primary" as const };

  return (
    <section
      aria-label="发布任务导览"
      className="rounded-[8px] border-small border-divider bg-default-50 px-3 py-2"
    >
      <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Chip color="primary" size="sm" variant="flat">
            流程
          </Chip>
          <h4
            className="shrink-0 text-small font-semibold text-default-900"
            title={`${title || "未填写标题"} · ${accountCount} 个账号 · ${materialCount} 个素材 · 定时 ${timerLabel}`}
          >
            发布流程
          </h4>
          <Chip color={modeChip.color} size="sm" variant="flat">
            {modeChip.label}
          </Chip>
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pb-0.5">
        {steps.map((step, index) => {
          const status = statusForIndex(index);
          const tone =
            status === "complete"
              ? "bg-success-50 text-success-700"
              : status === "active"
                ? "bg-primary-50 text-primary-700"
                : status === "blocked" || status === "failed"
                  ? "bg-danger-50 text-danger-700"
                  : "bg-default-100 text-default-600";
          const icon =
            status === "complete"
              ? "solar:check-circle-linear"
              : status === "active"
                ? "solar:play-circle-linear"
                : status === "blocked" || status === "failed"
                  ? "solar:shield-warning-linear"
                  : "solar:clock-circle-linear";
          return (
            <span
              key={step.label}
              className={`inline-flex shrink-0 items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-tiny ${tone}`}
              title={step.detail}
            >
              <Icon icon={icon} width={14} />
              <span className="font-semibold">{index + 1}</span>
              {step.label}
            </span>
          );
        })}
          </div>
        </div>
      </div>
      {statusMessage ? (
        <div className="mt-3 rounded-[8px] border-small border-divider bg-background p-3 text-small text-default-600">
          <span className="whitespace-pre-wrap">{statusMessage}</span>
        </div>
      ) : null}
    </section>
  );
}

function PublishPreviewStrip({
  accountCount,
  materialCount,
  mode,
  tags,
  timerLabel,
  title,
  variant,
}: {
  accountCount: number;
  materialCount: number;
  mode: PublishWorkflowMode;
  tags: string[];
  timerLabel: string;
  title: string;
  variant: "article" | "video";
}) {
  const items = [
    { label: "内容", value: variant === "article" ? "图文" : "视频" },
    { label: "标题", value: title || "未填写" },
    { label: "账号", value: `${accountCount} 个` },
    { label: "素材", value: `${materialCount} 个` },
    { label: "标签", value: tags.length ? tags.join("、") : "未填写" },
    { label: "方式", value: mode === "real" ? "正式发布" : "发布前检查" },
    { label: "时间", value: timerLabel },
  ];
  return (
    <section
      aria-label="发布前预览"
      className="rounded-[8px] border-small border-divider bg-default-50 px-3 py-2"
    >
      <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
        <div className="flex shrink-0 items-center gap-2">
          <Chip color="secondary" size="sm" variant="flat">
            预览
          </Chip>
          <h4 className="text-small font-semibold text-default-900">
            发布前确认
          </h4>
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pb-0.5">
          {items.map((item) => (
            <span
              key={item.label}
              className="inline-flex max-w-[260px] shrink-0 items-center gap-1 rounded-[6px] bg-background px-2 py-1 text-tiny text-default-600"
              title={`${item.label}：${item.value}`}
            >
              <span className="text-default-400">{item.label}</span>
              <span className="truncate font-semibold text-default-800">
                {item.value}
              </span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function PreflightIssueList({
  result,
}: {
  result: AutoUploadPublishPreflightResult;
}) {
  const groups = [
    {
      key: "engine",
      label: "发布服务",
      issues: result.issues.filter((issue) => issue.scope === "engine"),
    },
    {
      key: "account",
      label: "账号",
      issues: result.issues.filter((issue) => issue.scope === "account"),
    },
    {
      key: "material",
      label: "素材",
      issues: result.issues.filter((issue) => issue.scope === "material"),
    },
    {
      key: "cover",
      label: "封面",
      issues: result.issues.filter((issue) => issue.scope === "cover"),
    },
    {
      key: "payload",
      label: "参数",
      issues: result.issues.filter((issue) => issue.scope === "payload"),
    },
  ].filter((group) => group.issues.length);
  return (
    <div className="rounded-[8px] border-small border-danger-200 bg-danger-50 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Icon className="text-danger-600" icon="solar:shield-warning-linear" />
        <p className="text-small font-semibold text-danger-700">
          发布前检查未通过
        </p>
        <Chip color="danger" size="sm" variant="flat">
          {result.issues.length} 项
        </Chip>
      </div>
      <div className="grid gap-3">
        {groups.map((group) => (
          <div
            key={group.key}
            className="rounded-small border-small border-danger-200 bg-background p-3"
          >
            <div className="mb-2 flex items-center gap-2">
              <Chip color="danger" size="sm" variant="flat">
                {group.label}
              </Chip>
              <span className="text-tiny font-semibold text-default-500">
                {group.issues.length} 项
              </span>
            </div>
            <div className="grid gap-2">
              {group.issues.map((issue, index) => (
                <div
                  key={`${issue.code}-${issue.filePath || issue.accountFile || ""}-${index}`}
                  className="text-small text-default-700"
                >
                  <p className="break-words">{formatPreflightIssue(issue)}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
function FailureContextBox({
  context,
}: {
  context: LocalEngineFailureContext;
}) {
  return (
    <div className="rounded-[8px] border-small border-danger-200 bg-danger-50 p-3 text-small text-danger-700">
      <div className="flex items-center gap-2 font-semibold">
        <Icon icon="solar:close-circle-linear" /> <span>失败提示</span>
      </div>
      <p className="mt-2">{formatFailureContext(context)}</p>
    </div>
  );
}

function getTaskStatusColor(
  status: string,
): "default" | "primary" | "secondary" | "success" | "warning" | "danger" {
  if (status === "failed") return "danger";
  if (status === "blocked") return "danger";
  if (status === "running") return "primary";
  if (status === "queued") return "warning";
  if (status === "pending") return "warning";
  if (status === "waiting_for_send_confirmation") return "warning";
  if (status === "waiting_platform_confirmation") return "warning";
  if (status === "completed") return "success";
  if (status === "success") return "success";
  if (status === "skipped" || status === "no_target" || status === "paused")
    return "default";
  return "default";
}

function resolveTaskStatus(status: string) {
  const names: Record<string, string> = {
    queued: "排队中",
    pending: "等待中",
    running: "执行中",
    waiting_for_send_confirmation: "等待继续发送",
    waiting_platform_confirmation: "等待平台确认",
    completed: "已完成",
    success: "已完成",
    failed: "失败",
    blocked: "需处理",
    skipped: "已跳过",
    no_target: "无可处理对象",
    paused: "已暂停",
  };
  return names[status] || status;
}
function LogsPanel({
  error,
  loading,
  logs,
  onRefresh,
}: {
  error: string;
  loading: boolean;
  logs: AutoUploadLogFile[];
  onRefresh: () => Promise<void>;
}) {
  const failedCount = logs.filter((log) =>
    log.lines.some((line) => /失败|fail|error|异常/i.test(line)),
  ).length;
  const succeededCount = logs.length ? Math.max(logs.length - failedCount, 0) : 0;

  return (
    <Card className="border-small border-divider bg-background shadow-sm">
      <CardBody className="gap-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-medium font-semibold text-default-900">
              发布结果
            </h3>
            <p className="text-small text-default-500">
              汇总本机发布结果和互动任务执行结果。
            </p>
          </div>
          <Button
            color="primary"
            isLoading={loading}
            startContent={loading ? null : <Icon icon="solar:refresh-linear" />}
            variant="flat"
            onPress={() => {
              onRefresh().catch(() => {
                addToast({ title: "发布结果刷新失败", color: "danger" });
              });
            }}
          >
            刷新记录
          </Button>
        </div>
        <ResultSummaryPanel
          actions={[
            { label: "导出记录", onPress: () => downloadPublishLogs(logs) },
            { href: "/distribution?tab=article", label: "创建发布任务" },
            { href: "/distribution?tab=tasks", label: "查看发布任务" },
          ]}
          failed={failedCount}
          skipped={0}
          succeeded={succeededCount}
          subtitle="发布结果用于回看平台反馈、失败原因和下一步处理；失败项优先回到发布任务重试。"
          title="发布结果留存"
          total={logs.length}
        />
        {error ? (
          <FailureActionPanel
            actions={[
              {
                label: "刷新记录",
                onPress: () => {
                  onRefresh().catch(() => {
                    addToast({ title: "发布结果刷新失败", color: "danger" });
                  });
                },
              },
              { href: "/distribution?tab=tasks", label: "发布任务" },
            ]}
            impact="暂时无法查看平台反馈、失败原因和结果留存。"
            nextAction="先刷新记录；如果仍失败，回到发布任务查看任务状态。"
            reason="发布结果读取失败，可能是结果记录或平台反馈暂时不可用。"
            technicalDetails={error}
            title="发布结果需要处理"
          />
        ) : null}
        {loading ? (
          <div className="flex items-center gap-2 text-small text-default-500">
            <Spinner size="sm" /> 正在加载记录...
          </div>
        ) : null}
        <div className="grid gap-4">
          {logs.map((log) => (
            <section
              key={log.key}
              className="rounded-[8px] border-small border-divider bg-default-50 p-4"
            >
              <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-2">
                  <Chip size="sm" variant="flat">
                    {cleanUserFacingRuntimeText(log.platform)}
                  </Chip>
                  <span className="text-small font-medium text-default-900">
                    {displayFileName(log.filename)}
                  </span>
                </div>
                <span className="text-tiny text-default-500">
                  {new Date(log.updatedAt).toLocaleString()} ·
                  {(log.size / 1024).toFixed(1)} KB
                </span>
              </div>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-small bg-content1 p-3 text-tiny leading-5 text-default-700">
                {log.lines.length
                  ? log.lines.map(cleanUserFacingRuntimeText).join("\n")
                  : "当前没有发布记录"}
              </pre>
            </section>
          ))}
          {!loading && !logs.length ? (
            <FunctionalEmptyState
              actions={[
                { href: "/distribution?tab=article", label: "创建发布任务" },
                { href: "/distribution?tab=tasks", label: "查看发布任务" },
              ]}
              description="发布任务完成后，这里会显示平台反馈、失败原因、跳过项和下一步处理入口。"
              examples={["平台反馈", "失败原因", "重试入口", "复用任务"]}
              title="暂无发布结果"
            />
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}
function EnginePanel({
  error,
  health,
  loading,
  onRefresh,
}: {
  error: string;
  health: AutoUploadEngineHealth | null;
  loading: boolean;
  onRefresh: () => Promise<void>;
}) {
  return (
    <Card className="border-small border-divider bg-background shadow-sm">
      <CardBody className="gap-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-medium font-semibold text-default-900">
              发布服务
            </h3>
            <p className="text-small text-default-500">
              查看本机发布服务和运行状态。
            </p>
          </div>
          <Button
            color="primary"
            isLoading={loading}
            startContent={loading ? null : <Icon icon="solar:refresh-linear" />}
            variant="flat"
            onPress={() => {
              onRefresh().catch(() => {
                addToast({ title: "发布服务状态刷新失败", color: "danger" });
              });
            }}
          >
            刷新状态
          </Button>
        </div>
        {health ? (
          <div className="grid gap-4 rounded-[8px] border-small border-divider bg-default-50 p-4 md:grid-cols-3">
            <StatusItem label="服务状态" value={health.online ? "可用" : "需处理"} />
            <StatusItem
              label="检查时间"
              value={new Date(health.checkedAt).toLocaleString()}
            />
            <StatusItem
              label="发布数据"
              value={health.database?.exists ? "可用" : "需处理"}
            />
          </div>
        ) : (
          <div className="rounded-[8px] border-small border-danger-200 bg-danger-50 p-4 text-small text-danger-700">
            {error || "发布服务暂不可用。请打开运行检查完成设置后刷新。"}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
function MaterialPreview({ material }: { material: AutoUploadMaterial }) {
  if (!material.filePath) {
    return (
      <p className="text-small text-default-500">没有可预览的素材。</p>
    );
  }

  const previewUrl = autoUploadApi.materialPreviewUrl(material.filePath);
  const filename = material.filename.toLowerCase();
  const isVideo = [".mp4", ".mov", ".avi", ".mkv", ".webm"].some((ext) =>
    filename.endsWith(ext),
  );
  const isImage = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"].some(
    (ext) => filename.endsWith(ext),
  );
  if (isVideo) {
    return (
      <video className="max-h-[420px] w-full rounded-[8px] bg-black" controls>
        <source src={previewUrl} />
      </video>
    );
  }
  if (isImage) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt={displayFileName(material.filename)}
        className="max-h-[420px] max-w-full rounded-[8px] object-contain"
        src={previewUrl}
      />
    );
  }
  return (
    <div className="flex flex-col gap-2 text-small text-default-500">
      <p>该文件类型暂不支持内嵌预览。</p>
      <a
        className="text-primary hover:underline"
        href={previewUrl}
        rel="noreferrer"
        target="_blank"
      >
        在新窗口打开
      </a>
    </div>
  );
}
function StatusItem({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "md:col-span-3" : ""}>
      <p className="text-tiny text-default-400">{label}</p>
      <p className="mt-1 break-all text-small font-medium text-default-800">
        {value}
      </p>
    </div>
  );
}
