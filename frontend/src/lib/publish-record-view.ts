import type {
  AutoUploadPublishResult,
  AutoUploadPublishTask,
} from "@/lib/api/auto-upload";
import type { AgentSession } from "@/lib/api/local-engine";
import { commercialDisplayText } from "@/lib/commercial-display-text";

export const DURABLE_PUBLISH_RECORD_SOURCE = "durable_publish_record";

export type PublishRecordResultItem = NonNullable<
  AutoUploadPublishResult["results"]
>[number] & {
  accountName?: string;
  nextAction?: string;
  publishTaskId?: string;
  status?: NonNullable<AutoUploadPublishResult["platforms"]>[number]["status"];
};

export type PublishRecordMetrics = {
  failed: number;
  succeeded: number;
  total: number;
  waiting: number;
};

export type PublishRecordStatusColor =
  | "default"
  | "primary"
  | "success"
  | "warning"
  | "danger";

const publishRecordFailureStatuses = new Set<
  NonNullable<AutoUploadPublishResult["platforms"]>[number]["status"]
>([
  "failed",
  "account_expired",
  "material_error",
  "login_required",
  "blocked",
  "not_integrated",
]);

const publishRecordRetryStatuses = new Set<
  NonNullable<AutoUploadPublishResult["platforms"]>[number]["status"]
>(["failed", "account_expired", "material_error", "login_required", "blocked"]);

export function displayPublishRecordFileName(
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
        /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}[_-]/i,
        "",
      ) || fallback
  );
}

export function displayPublishRecordTitle(value: string | null | undefined) {
  const text = cleanPublishRecordText(value);
  if (!text) return "发布任务";
  return text
    .replace(/\bcommercial-e2e-[\w.-]+/gi, "发布任务")
    .replace(/commercial-acceptance-publish-\d+/gi, "发布任务")
    .replace(/\bpublish-\d{8,}\b/gi, "发布结果");
}

export function cleanPublishRecordText(value: string | null | undefined) {
  return commercialDisplayText(String(value || ""))
    .replace(
      /\bcommercial acceptance injected failure(?:\s+for\s+[^；,，。\n]+)?/gi,
      "发布检查未通过，请重新确认后再试",
    )
    .replace(
      /\b(?:smoke|fixture|acceptance|e2e)[-_ ]?[\w.-]*(?:\s+(?:failed|failure|error))?/gi,
      "发布检查未通过",
    )
    .replace(/3011\s*本地\s*Runtime/g, "本机执行服务")
    .replace(/Chrome\/CDP\s*持久浏览器/g, "本机平台后台")
    .replace(/CDP\s*会话/g, "平台后台连接")
    .replace(/CDP/g, "平台后台")
    .replace(/\bRuntime\b/g, "本机服务")
    .replace(/persistent-cdp-browser/gi, "本机平台后台")
    .replace(/local-browser-engine/gi, "本机浏览器")
    .replace(/\bprofile\b/gi, "登录环境")
    .replace(/engine:\s*/gi, "")
    .replace(
      /(?:\/Users|\/Volumes|\/private|\/tmp|\/var)\/[^；,，。\n\r\t)）]+/g,
      (match) => displayPublishRecordFileName(match, "本机文件"),
    )
    .trim();
}

export function normalizePublishRecordResultItems(
  result: AutoUploadPublishResult | null | undefined,
): PublishRecordResultItem[] {
  if (Array.isArray(result?.platforms)) {
    return result.platforms.map((entry, index) => ({
      type: index,
      ok:
        entry.status === "success" && hasPublishRecordReadback(entry)
          ? true
          : publishRecordFailureStatuses.has(entry.status)
            ? false
            : null,
      status: entry.status,
      message:
        entry.failureReason ||
        entry.nextAction ||
        (entry.status === "success" && hasPublishRecordReadback(entry)
          ? "平台结果已核对"
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
    ? (result.results as PublishRecordResultItem[]).map((entry) => ({
        ...entry,
        ok:
          entry.ok === true && hasPublishRecordReadback(entry)
            ? true
            : entry.ok === false
              ? false
              : null,
        message:
          entry.ok === true && !hasPublishRecordReadback(entry)
            ? "等待平台确认"
            : entry.message,
      }))
    : [];
}

export function summarizePublishRecordResult(
  result: Record<string, unknown> | null,
) {
  const results = normalizePublishRecordResultItems(
    result as AutoUploadPublishResult | null,
  );
  return {
    failures: results.filter((item) => item.ok === false),
    pending: results.filter((item) => item.ok !== true && item.ok !== false),
    results,
    succeeded: results.filter((item) => item.ok === true),
  };
}

export function getPublishRecordMetrics(
  task: AutoUploadPublishTask,
): PublishRecordMetrics {
  const summary = summarizePublishRecordResult(task.result);
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

export function getPublishRecordReceipt(item: PublishRecordResultItem) {
  return (
    item.publishUrl ||
    item.platformUrl ||
    item.externalId ||
    item.postId ||
    ""
  );
}

export function getPublishRecordSourceIdentity(task: AutoUploadPublishTask) {
  const payload = (
    task.result as {
      payloads?: Array<{
        articleId?: string;
        sourceIdentity?: {
          sourceType?: string;
          sourceId?: string;
          title?: string;
          contentType?: string;
          contentFormat?: string;
          updatedAt?: string;
        };
      }>;
    } | null
  )?.payloads?.find(
    (item) => item.articleId && item.sourceIdentity?.sourceType === "article",
  );
  if (!payload?.articleId || !payload.sourceIdentity) return null;
  return {
    articleId: payload.articleId,
    title: payload.sourceIdentity.title || task.title,
    contentType: payload.sourceIdentity.contentType || "article",
    updatedAt: payload.sourceIdentity.updatedAt,
  };
}

export function hasPublishRecordReadback(
  item: Pick<
    PublishRecordResultItem,
    | "evidence"
    | "publishUrl"
    | "platformUrl"
    | "externalId"
    | "postId"
    | "articleId"
  >,
) {
  const evidence = asRecord(item.evidence);
  if (!evidence) return false;
  return [evidence, asRecord(evidence.raw)]
    .filter((value): value is Record<string, unknown> => Boolean(value))
    .some((value) => {
      const readback = asRecord(value.readback);
      return value.readbackOk === true || readback?.matched === true;
    });
}

export function isDurablePublishRecord(task: AutoUploadPublishTask) {
  return (
    Number.isSafeInteger(task.id) &&
    task.id > 0 &&
    task.result?.source === DURABLE_PUBLISH_RECORD_SOURCE
  );
}

export function canRetryPublishRecord(task: AutoUploadPublishTask) {
  if (!isDurablePublishRecord(task)) return false;
  const platforms = (task.result as AutoUploadPublishResult | null)?.platforms;
  return Boolean(
    platforms?.some((entry) => publishRecordRetryStatuses.has(entry.status)),
  );
}

export function getPublishRecordEvidenceCount(task: AutoUploadPublishTask) {
  const summary = summarizePublishRecordResult(task.result);
  return summary.results.filter((item) =>
    Boolean(item.evidence || getPublishRecordReceipt(item)),
  ).length;
}

export function getPublishRecordFailureReason(task: AutoUploadPublishTask) {
  const summary = summarizePublishRecordResult(task.result);
  const firstFailure = summary.failures[0];
  const firstPending = summary.pending.find((item) => item.nextAction);
  const reason =
    firstFailure?.message ||
    firstFailure?.nextAction ||
    (task.status.toLowerCase().includes("fail") ? task.message : null) ||
    firstPending?.nextAction ||
    task.message;
  return cleanPublishRecordText(reason || "");
}

export function getPublishRecordModeLabel(task: AutoUploadPublishTask) {
  if (task.dry_run) return "发布前检查";
  const enableTimer = (task.result as { payloads?: Array<{ enableTimer?: number }> })
    ?.payloads?.[0]?.enableTimer;
  return enableTimer === 1 ? "定时发布" : "立即发布";
}

export function resolvePublishRecordStatus(status: string) {
  const labels: Record<string, string> = {
    blocked: "需处理",
    completed: "已完成",
    failed: "失败",
    no_target: "无可处理对象",
    paused: "已暂停",
    pending: "等待中",
    queued: "排队中",
    running: "执行中",
    skipped: "已跳过",
    success: "已完成",
    waiting_for_send_confirmation: "等待继续发送",
  };
  return labels[status] || status;
}

export function getPublishRecordStatusColor(
  status: string,
): PublishRecordStatusColor {
  if (status === "failed" || status === "blocked") return "danger";
  if (status === "running") return "primary";
  if (
    status === "queued" ||
    status === "pending" ||
    status === "waiting_for_send_confirmation"
  ) {
    return "warning";
  }
  if (status === "completed" || status === "success") return "success";
  return "default";
}

export function buildPublishRecordAgentSession(
  task: AutoUploadPublishTask,
): AgentSession {
  const metrics = getPublishRecordMetrics(task);
  const summary = summarizePublishRecordResult(task.result);
  const failureReason = getPublishRecordFailureReason(task);
  const evidenceCount = getPublishRecordEvidenceCount(task);
  const sourceIdentity = getPublishRecordSourceIdentity(task);
  const persistedSessionId =
    task.result && typeof task.result === "object"
      ? typeof task.result.agentSessionId === "string"
        ? task.result.agentSessionId
        : undefined
      : undefined;
  const sessionId =
    persistedSessionId || `publish-record:${task.id}`;
  const normalizedStatus = task.status.toLowerCase();
  const status: AgentSession["status"] =
    metrics.failed > 0 || normalizedStatus.includes("fail")
      ? "failed"
      : metrics.succeeded > 0 ||
          ["success", "done", "completed", "ok"].some((item) =>
            normalizedStatus.includes(item),
          )
        ? "completed"
        : metrics.waiting > 0
          ? "waiting_for_confirmation"
          : "running";
  const materialText =
    (task.file_list || [])
      .map((file) => displayPublishRecordFileName(file))
      .join("、") || "未记录素材";
  const events = [
    {
      createdAt: task.created_at,
      evidence: {
        label: "记录编号",
        type: "stage_log" as const,
        value: String(task.id),
      },
      id: `${sessionId}:created`,
      level: "info" as const,
      message: [
        `发布类型：${getPublishRecordModeLabel(task)}`,
        `账号：${displayPublishRecordFileName(task.account_file, "-")}`,
        `素材：${materialText}`,
      ].join("；"),
      sessionId,
      title: "发布记录已创建",
    },
    ...summary.results.slice(0, 6).map((item, index) => {
      const receipt = getPublishRecordReceipt(item);
      const evidenceValue =
        receipt || formatPublishRecordEvidence(item.evidence) || item.message;
      return {
        createdAt: task.updated_at,
        evidence: evidenceValue
          ? {
              label: receipt ? "平台回执" : "过程记录",
              type: receipt ? ("text" as const) : ("stage_log" as const),
              value: cleanPublishRecordText(String(evidenceValue)),
            }
          : undefined,
        id: `${sessionId}:platform:${index}`,
        level:
          item.ok === true
            ? ("success" as const)
            : item.ok === false
              ? ("error" as const)
              : ("warning" as const),
        message:
          cleanPublishRecordText(
            item.message || item.nextAction || "等待平台确认",
          ) || "等待平台确认",
        sessionId,
        title: item.platform || `平台 ${item.type}`,
      };
    }),
    ...(failureReason
      ? [
          {
            createdAt: task.updated_at,
            evidence: {
              label: "失败原因",
              type: "failure_reason" as const,
              value: failureReason,
            },
            id: `${sessionId}:failure`,
            level: "error" as const,
            message: failureReason,
            sessionId,
            title: "待处理原因",
          },
        ]
      : []),
  ];

  return {
    completedAt: status === "completed" ? task.updated_at : undefined,
    confirmations: [],
    createdAt: task.created_at,
    events,
    executionScope: "local-files",
    failureReason: failureReason || undefined,
    id: sessionId,
    instruction: [
      "查看这条发布记录的结果、证据和下一步处理方式。",
      `结果：总数 ${metrics.total}，成功 ${metrics.succeeded}，失败 ${metrics.failed}，待处理 ${metrics.waiting}。`,
      failureReason
        ? `下一步：${failureReason}`
        : evidenceCount
          ? "下一步：核对平台回执后可复用为新任务。"
          : "下一步：等待平台确认。",
    ].join("\n"),
    metadata: {
      evidenceCount,
      metrics,
      source: "publish-record-status",
      taskId: task.id,
      articleId: sourceIdentity?.articleId,
      sourceTitle: sourceIdentity?.title,
    },
    nextAction: failureReason || "核对平台明细、回执和素材记录。",
    riskLevel: failureReason ? "medium" : "low",
    source: "publishing",
    status,
    statusLabel: resolvePublishRecordStatus(task.status),
    targetApp: "发布记录",
    title: `发布状态：${displayPublishRecordTitle(task.title)}`,
    updatedAt: task.updated_at,
  };
}

function formatPublishRecordEvidence(value: unknown) {
  if (!value) return "";
  if (typeof value === "string") return cleanPublishRecordText(value);
  try {
    return cleanPublishRecordText(JSON.stringify(value));
  } catch {
    return "已留存过程记录";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
