"use client";

import React from "react";
import {
  Button,
  Card,
  CardBody,
  Chip,
  Input,
  Textarea,
  addToast,
} from "@heroui/react";
import {
  AlertTriangle,
  BookOpen,
  Database,
  Download,
  KeyRound,
  Monitor,
  Plus,
  RefreshCcw,
  ScanSearch,
  ShieldCheck,
  Trash2,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useAgentSState } from "@/lib/ops-workbench/hooks";
import {
  wechatContactAddSkill,
  wechatFriendAcceptSkill,
  wechatGroupBroadcastSkill,
  wechatMomentsMarketingSkill,
  wechatMomentsPublishSkill,
  type InteractionSkillRunRequest,
} from "@/lib/ops-workbench/interaction-skills";
import type { WechatExecutionMode } from "@/lib/ops-workbench/runtime";
import {
  appendKaypalKnowledgeContext,
  resolveKaypalKnowledgeContext,
} from "@/lib/kaypal-knowledge-context";
import {
  buildLocalEngineRiskConfirmation,
  localEngineApi,
  type CreateInteractionTaskInput,
  type InteractionBatchTarget,
  type InteractionBusinessRouteKey,
  type InteractionTask,
  type InteractionTaskStatus,
  type InteractionTaskType,
  type WechatContact,
  type WechatChatHistoryResult,
  type WechatChatHistoryStatus,
  type WechatChatMessage,
  type WechatChatSessionsResult,
  type WechatContactsResult,
  type WechatContactsReadinessResult,
  type WechatContactsSyncMode,
  type WechatContactsSyncDiagnostics,
} from "@/lib/api/local-engine";
import { commercialDisplayText } from "@/lib/commercial-display-text";
import { toPublicError } from "@/lib/public-error";
import { RiskConfirmationDialog } from "@/components/risk-confirmation-dialog";

type WechatMode =
  Exclude<
    WechatExecutionMode,
    "draft"
  >;
type MarketingMode =

    | "random"
    | "targeted";
type CommentMode =

    | "ai"
    | "fixed";
type WechatModule =

    | "mass-send"
    | "contact-add"
    | "friend-accept"
    | "moments-publish"
    | "moments-marketing"
    | "contacts"
    | "chat-history";
type WechatPlanFilter =

    | "all"
    | "groups"
    | "contact-add"
    | "friend-accept"
    | "moments-publish"
    | "moments-marketing";
type WechatPlanAction =

    | "continue"
    | "pause"
    | "resume"
    | "retry"
    | "delete";
type ConfirmedWechatPlanAction = Extract<
  WechatPlanAction,
  "continue" | "retry" | "delete"
>;
type PendingWechatPlanAction = {
  task: InteractionTask;
  action: ConfirmedWechatPlanAction;
};

const WECHAT_MODE_OPTIONS = [
  "auto-send",
  "controlled-send",
  "read-only-analyze",
] as const satisfies readonly WechatMode[];

const WECHAT_PLAN_TYPES: InteractionTaskType[] =
  [
    "wechat-group-broadcast",
    "wechat-contact-add",
    "wechat-friend-accept",
    "wechat-moments-publish",
    "wechat-moments-marketing",
  ];

const WECHAT_PLAN_FILTERS: Array<{
  key: WechatPlanFilter;
  label: string;
}> =
  [
    {
      key: "all",
      label:
        "全部计划",
    },
    {
      key: "groups",
      label:
        "群发",
    },
    {
      key: "contact-add",
      label:
        "加好友",
    },
    {
      key: "friend-accept",
      label:
        "通过好友",
    },
    {
      key: "moments-publish",
      label:
        "朋友圈发布",
    },
    {
      key: "moments-marketing",
      label:
        "朋友圈营销",
    },
  ];

const WECHAT_MODULES: Array<{
  key: WechatModule;
  label: string;
  desc: string;
  planFilter?: WechatPlanFilter;
}> =
  [
    {
      key: "mass-send",
      label:
        "普通群发",
      desc: "联系人/群聊、内容、文件、定时与分段发送",
      planFilter:
        "groups",
    },
    {
      key: "contact-add",
      label:
        "添加好友",
      desc: "号码导入、验证消息、备注策略、风控限制",
      planFilter:
        "contact-add",
    },
    {
      key: "friend-accept",
      label:
        "通过好友",
      desc: "处理好友申请、备注和欢迎语",
      planFilter:
        "friend-accept",
    },
    {
      key: "moments-publish",
      label:
        "朋友圈批量发布",
      desc: "四步发布计划、媒体、追加评论、时间线",
      planFilter:
        "moments-publish",
    },
    {
      key: "moments-marketing",
      label:
        "朋友圈营销",
      desc: "随机/定向营销、点赞评论、AI 评论",
      planFilter:
        "moments-marketing",
    },
    {
      key: "contacts",
      label:
        "联系人管理",
      desc: "同步、导出、编辑本机微信联系人",
    },
    {
      key: "chat-history",
      label:
        "会话历史",
      desc: "同步微信会话与消息历史",
    },
  ];

const CONTACT_SYNC_MODE_OPTIONS: Array<{
  key: WechatContactsSyncMode;
  label: string;
  title: string;
  desc: string;
  badge: string;
}> =
  [
    {
      key: "random",
      label:
        "随机",
      title:
        "随机抽样同步",
      desc: "快速读取当前可见联系人，用来确认微信窗口、权限和识别功能是否可用。",
      badge:
        "低耗时",
    },
    {
      key: "all",
      label:
        "全部",
      title:
        "全部好友同步",
      desc: "从通讯录顶部持续滚动扫描到底，联系人越多耗时越长，适合正式导入前执行。",
      badge:
        "完整扫描",
    },
  ];

type ContactDiagnosticStatus =

    | "ready"
    | "warning"
    | "blocked"
    | "unknown";

type ContactDiagnosticLayer =
  {
    key:
      | "database"
      | "permission"
      | "window"
      | "recognition"
      | "helper";
    title: string;
    icon: LucideIcon;
    status: ContactDiagnosticStatus;
    summary: string;
    evidence: string[];
    action: string;
  };

type MomentsPublishDetailDraft = {
  id: string;
  content: string;
  additionalComment: string;
  assetPath: string;
  visibility: string;
  scheduledPublishTime: string;
};

function toLocalDateTimeInput(value: Date) {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60 * 1000)
    .toISOString()
    .slice(0, 16);
}

function splitLines(
  value: string,
) {
  return value
    .split(
      /\r?\n|[,，]/,
    )
    .map(
      (
        item,
      ) =>
        item.trim(),
    )
    .filter(
      Boolean,
    );
}

function parsePersonalizedMessages(
  value: string,
) {
  return value
    .split(/\r?\n/)
    .map((line) => {
      const separatorIndex = line.search(/[｜|\t]/);
      if (separatorIndex < 1) return null;
      const target = line.slice(0, separatorIndex).trim();
      const message = line.slice(separatorIndex + 1).trim();
      return target && message ? { target, message } : null;
    })
    .filter(
      (item): item is { target: string; message: string } => Boolean(item),
    )
    .slice(0, 200);
}

function numberFrom(
  value: string,
  fallback: number,
) {
  const number =
    Number(
      value,
    );
  if (
    !Number.isFinite(
      number,
    ) ||
    number <=
      0
  )
    return fallback;
  return Math.floor(
    number,
  );
}

function nonNegativeNumberFrom(
  value: string,
  fallback: number,
) {
  const number =
    Number(
      value,
    );
  if (
    !Number.isFinite(
      number,
    ) ||
    number <
      0
  )
    return fallback;
  return Math.floor(
    number,
  );
}

function uniqueList(
  items: string[],
) {
  const seen =
    new Set<string>();
  const result: string[] =
    [];
  for (const item of items) {
    const value =
      item.trim();
    if (
      !value ||
      seen.has(
        value,
      )
    )
      continue;
    seen.add(
      value,
    );
    result.push(
      value,
    );
  }
  return result;
}

function handleRovingChoiceKeyDown<T extends string>(
  event: React.KeyboardEvent<HTMLElement>,
  keys: readonly T[],
  currentKey: T,
  onChange: (key: T) => void,
) {
  const currentIndex = keys.indexOf(currentKey);
  if (currentIndex < 0 || !keys.length) return;
  let nextIndex = currentIndex;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") {
    nextIndex = (currentIndex + 1) % keys.length;
  } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
    nextIndex = (currentIndex - 1 + keys.length) % keys.length;
  } else if (event.key === "Home") {
    nextIndex = 0;
  } else if (event.key === "End") {
    nextIndex = keys.length - 1;
  } else {
    return;
  }

  const nextKey = keys[nextIndex];
  if (!nextKey) return;
  event.preventDefault();
  onChange(nextKey);
  const choices = event.currentTarget.parentElement?.querySelectorAll<HTMLElement>(
    '[role="tab"],[role="radio"]',
  );
  choices?.[nextIndex]?.focus();
}

function retryableTargetsForPlan(task: InteractionTask) {
  return (task.batchTargets || []).filter(
    (target) => target.status === "failed" || target.status === "queued",
  );
}

function retryableTargetCountForPlan(task: InteractionTask) {
  if (
    !["failed", "blocked", "skipped", "paused", "completed"].includes(
      task.status,
    )
  ) {
    return 0;
  }
  if (task.batchTargets?.length) return retryableTargetsForPlan(task).length;
  return task.status === "failed" ? 1 : 0;
}

function planActionConfirmationMeta({
  task,
  action,
}: PendingWechatPlanAction) {
  const targetCount =
    action === "retry"
      ? retryableTargetCountForPlan(task)
      : countTargets(task);
  const impactItems = [
    { label: "计划", value: planName(task) },
    { label: "微信号", value: planWechatAccountLabel(task) },
    { label: "对象范围", value: `${targetCount} 个对象` },
    { label: "执行方式", value: planExecutionModeMeta(task).label },
  ];

  if (action === "continue") {
    return {
      title: "确认启动计划",
      description:
        "启动后会提交执行；提交成功不代表发送成功，请按对象逐一查看结果。",
      riskLevel: "high" as const,
      confirmLabel: "确认启动",
      impactItems,
      checklist: [
        "确认关联微信号、对象范围和内容均正确。",
        "确认本机微信处于可用状态，并已完成所需授权。",
        "执行后逐对象核验成功、失败、跳过和待处理结果。",
      ],
    };
  }

  if (action === "retry") {
    return {
      title: "确认只重发失败/未发送对象",
      description:
        "只会重新处理失败或明确排队未发送的对象；已完成、执行中、等待确认和已跳过对象不会重复发送。",
      riskLevel: "high" as const,
      confirmLabel: "确认重发",
      impactItems,
      checklist: [
        "核对失败原因已经处理，避免重复失败。",
        "核对待重发对象数量和关联微信号。",
        "重发后以逐对象结果和证据确认实际执行状态。",
      ],
    };
  }

  return {
    title: "确认删除计划",
    description:
      "删除会停止计划后续执行；历史明细和已有证据继续保留，便于审计。",
    riskLevel: "medium" as const,
    confirmLabel: "确认删除",
    impactItems,
    checklist: [
      "确认该计划不再需要继续执行。",
      "删除不会清除已经产生的历史结果和证据。",
    ],
  };
}

function compactText(
  items: Array<
    | string
    | number
    | boolean
    | null
    | undefined
  >,
) {
  return items
    .map(
      (
        item,
      ) =>
        item ===
          null ||
        item ===
          undefined
          ? ""
          : String(
              item,
            ).trim(),
    )
    .filter(
      Boolean,
    );
}

function mergeListText(
  current: string,
  incoming: string[],
) {
  return uniqueList(
    [
      ...splitLines(
        current,
      ),
      ...incoming,
    ],
  ).join(
    "\n",
  );
}

function downloadTextFile(
  filename: string,
  content: string,
  mimeType: string,
) {
  const blob =
    new Blob(
      [
        content,
      ],
      {
        type:
          mimeType,
      },
    );
  const url =
    URL.createObjectURL(
      blob,
    );
  const link =
    document.createElement(
      "a",
    );
  link.href =
    url;
  link.download =
    filename;
  document.body.appendChild(
    link,
  );
  link.click();
  link.remove();
  URL.revokeObjectURL(
    url,
  );
}

function structuredContactLabel(
  contact: WechatContact,
) {
  return (
    contact.remark ||
    contact.nickname ||
    contact.wxid
  );
}

function contactNamesFromResult(
  result: WechatContactsResult,
) {
  const legacyNames =
    uniqueList(
      result.contacts ||
        [],
    );
  if (
    legacyNames.length
  )
    return legacyNames;
  return uniqueList(
    (
      result.items ||
      []
    ).map(
      structuredContactLabel,
    ),
  );
}

function contactSyncModeOption(
  mode: WechatContactsSyncMode,
) {
  return (
    CONTACT_SYNC_MODE_OPTIONS.find(
      (
        item,
      ) =>
        item.key ===
        mode,
    ) ||
    CONTACT_SYNC_MODE_OPTIONS[0]
  );
}

function sourceLabel(
  source?: string,
) {
  if (!source || source === "unknown") return "未识别来源";
  if (
    [
      "windows-wechat-engine-db",
      "windows-wechat-db-decrypted",
      "windows-wechat-db-helper",
      "windows-wechat-db",
    ].includes(
      source,
    )
  )
    return "微信联系人读取";
  if (
    [
      "windows-wechat-ocr",
      "windows-wechat-hybrid",
      "windows-wechat-vision",
      "windows-wechat-uia",
      "macos-wechat-ocr",
    ].includes(
      source,
    )
  )
    return "微信窗口识别";
  if (
    source ===
    "wechat-contact-cache-fallback"
  )
    return "本地联系人缓存";
  return (
    source ||
    "本机微信控制器"
  );
}

function wechatBusinessText(value?: string | null) {
  return commercialDisplayText(String(value || ""))
    .replace(/Windows 微信联系人(?:全量)?同步失败[:：]?\s*/g, "微信联系人同步未完成：")
    .replace(/数据库\/(?:helper|辅助服务) 主链路没有拿到联系人[，, ]*已跳过 (?:UIA\/OCR|桌面识别) 屏幕采集。?/gi, "本机没有读到可用联系人")
    .replace(/DB\/helper did not return contacts;.*$/gi, "本机没有读到可用联系人")
    .replace(/UIA\/OCR screen collection was skipped;.*$/gi, "已使用安全读取策略")
    .replace(/native-db-helper-blocked|联系人读取需处理/gi, "联系人读取未完成")
    .replace(/skipped-db-helper-required/gi, "已使用安全读取策略")
    .replace(/failed-contract|失败-连接方案/gi, "连接异常")
    .replace(/chat-sessions|chat-history|sync API/gi, "微信会话历史")
    .replace(/DB\/RPA/gi, "微信资料读取和自动化处理")
    .replace(/\bDB\b/gi, "微信资料")
    .replace(/\bRPA\b/gi, "自动化处理")
    .replace(/native runtime/gi, "本机微信组件")
    .replace(/helper/gi, "辅助组件")
    .replace(/dbKey|db key/gi, "数据授权")
    .replace(/blocked/gi, "需处理")
    .replace(/empty/gi, "空状态")
    .replace(/unknown/gi, "未知状态")
    .replace(/not-found/gi, "未找到")
    .replace(/failed|error/gi, "失败");
}

function contactSyncDiagnosticsSummary(
  diagnostics?: WechatContactsSyncDiagnostics | null,
) {
  if (
    !diagnostics
  )
    return "";
  return [
    diagnostics.stage
      ? `阶段 ${diagnostics.stage}`
      : "",
    diagnostics.source
      ? `来源 ${sourceLabel(diagnostics.source)}`
      : "",
    diagnostics.engine
      ? `处理服务 ${diagnostics.engine}${diagnostics.engineVersion ? ` ${diagnostics.engineVersion}` : ""}`
      : "",
    diagnostics.dbContactCount !==
    undefined
      ? `数据联系人 ${diagnostics.dbContactCount} 个`
      : "",
    diagnostics.dbTotalContactCount !==
    undefined
      ? `数据总数 ${diagnostics.dbTotalContactCount} 个`
      : "",
    diagnostics.selectedDbAccountFolder
      ? `账号 ${diagnostics.selectedDbAccountFolder}`
      : "",
    diagnostics.pagesScanned
      ? `扫描 ${diagnostics.pagesScanned} 页`
      : "",
	    diagnostics.uiaContactCount !==
	    undefined
	      ? `窗口识别 ${diagnostics.uiaContactCount} 个`
	      : "",
	    diagnostics.ocrContactCount !==
	    undefined
	      ? `文字识别 ${diagnostics.ocrContactCount} 个`
	      : "",
    diagnostics.rawTextCount !==
    undefined
      ? `识别文本 ${diagnostics.rawTextCount} 条`
      : "",
    diagnostics.fallbackReason
      ? `备用读取 ${wechatBusinessText(diagnostics.fallbackReason)}`
      : "",
    diagnostics.dbError
      ? `数据读取错误 ${diagnostics.dbError}`
      : "",
	    diagnostics.externalKeyToolIncompatible
	      ? "外部授权工具不匹配"
	      : "",
	    diagnostics.externalKeyToolUnsupported
	      ? "外部授权工具不支持当前微信"
	      : "",
  ]
    .filter(
      Boolean,
    )
    .join(
      " · ",
    );
}

function contactDiagnosticDetail(
  value?: string | number | boolean | null,
  fallback = "暂未返回状态",
) {
  const text =
    value === null ||
    value === undefined
      ? ""
      : wechatBusinessText(
          String(value),
        );
  if (!text)
    return fallback;
  return text.length >
    80
    ? `${text.slice(0, 80)}...`
    : text;
}

function contactSyncErrorText(
  error?: string,
  diagnostics?: WechatContactsSyncDiagnostics | null,
) {
  return compactText(
    [
      error,
      diagnostics?.failureReason,
      diagnostics?.fallbackReason,
      diagnostics?.dbError,
      diagnostics?.windowTitle,
      ...(diagnostics?.warnings ||
        []),
      ...(diagnostics?.rawPreview ||
        []),
      ...(diagnostics?.ocrPreview ||
        []),
    ],
  ).join(
    "\n",
  );
}

function isDbHelperRequiredContactSync(
  diagnostics?: WechatContactsSyncDiagnostics | null,
  error?: string,
) {
  const text =
    contactSyncErrorText(
      error,
      diagnostics,
    );
  return Boolean(
    diagnostics?.stage ===
      "native-db-helper-blocked" ||
      diagnostics?.uiaStatus ===
        "skipped-db-helper-required" ||
      errorMatches(
        text,
        /native-db-helper-blocked|skipped-db-helper-required|db-helper-required|数据库\/helper|DB helper|helper 主链路|key tool|DbKey|architecture-mismatch|tool-incompatible|unsupported-wechat|profile-layout|已跳过 UIA\/OCR|UIA\/OCR screen collection was skipped/i,
      ),
  );
}

function shortToastDescription(
  value: unknown,
  fallback = "请查看页面排查卡片，必要时导出排查资料。",
) {
  return toPublicError(
    value,
    fallback,
  );
}

function contactSyncUserMessage(
  reason?: unknown,
  diagnostics?: WechatContactsSyncDiagnostics | null,
  options: {
    contactPageMismatch?: boolean;
    dbHelperRequired?: boolean;
    keptExistingList?: boolean;
  } = {},
) {
  const raw =
    reason instanceof Error
      ? reason.message
      : typeof reason === "string"
        ? reason
        : "";
  const dbHelperRequired =
    options.dbHelperRequired ??
    isDbHelperRequiredContactSync(
      diagnostics,
      raw,
    );
  if (options.contactPageMismatch) {
    return "当前没有停在微信通讯录页，已拒绝覆盖本地名单。请打开微信通讯录页后重新同步。";
  }
  if (dbHelperRequired) {
    return options.keptExistingList
      ? "本次没有读到新的可用联系人，已继续使用本地名单。请确认电脑微信已登录并保持当前账号在线，然后重新同步；需要排查时可导出资料。"
      : "本次没有读到可用联系人，已拒绝覆盖本地名单。请确认电脑微信已登录并保持当前账号在线，然后重新同步；需要排查时可导出资料。";
  }
  const fallback =
    "本次没有读到可用联系人。请确认电脑微信已登录并重新同步；需要排查时可导出资料。";
  return fallback;
}

function errorMatches(
  text: string,
  pattern: RegExp,
) {
  return pattern.test(
    text,
  );
}

function diagnosticStatusColor(
  status: ContactDiagnosticStatus,
):
  | "default"
  | "success"
  | "warning"
  | "danger" {
  if (
    status ===
    "ready"
  )
    return "success";
  if (
    status ===
    "warning"
  )
    return "warning";
  if (
    status ===
    "blocked"
  )
    return "danger";
  return "default";
}

function diagnosticStatusLabel(
  status: ContactDiagnosticStatus,
) {
  if (
    status ===
    "ready"
  )
    return "正常";
  if (
    status ===
    "warning"
  )
    return "注意";
  if (
    status ===
    "blocked"
  )
    return "需处理";
  return "待检测";
}

function statusValueLooksBlocked(
  value?: string,
) {
  return /blocked|failed|error|unsupported|not-found|not-logged-in|not-wechat/i.test(
    value ||
      "",
  );
}

function statusValueLooksWarning(
  value?: string,
) {
  return /warning|missing|unknown|empty|low-confidence|encrypted-or-locked|detected-not-runnable|starting|not-applicable/i.test(
    value ||
      "",
  );
}

function contactStatusFromValue(
  value?: string,
): ContactDiagnosticStatus {
  if (
    !value
  )
    return "unknown";
  if (
    statusValueLooksBlocked(
      value,
    )
  )
    return "blocked";
  if (
    statusValueLooksWarning(
      value,
    )
  )
    return "warning";
  return "ready";
}

function hasLowConfidenceContactDiagnostics(
  diagnostics?: WechatContactsSyncDiagnostics | null,
) {
  if (
    !diagnostics
  )
    return false;
  return (
    diagnostics.uiaStatus ===
      "low-confidence" ||
    diagnostics.failureLayer ===
      "quality-gate" ||
    /low-confidence|低置信|置信度|quality-gate/i.test(
      contactSyncErrorText(
        undefined,
        diagnostics,
      ),
    )
  );
}

function hasBlockedContactDiagnostics(
  diagnostics?: WechatContactsSyncDiagnostics | null,
) {
  if (
    !diagnostics
  )
    return false;
  return Boolean(
    diagnostics.failureLayer &&
      diagnostics.failureLayer !==
        "quality-gate",
  ) ||
    statusValueLooksBlocked(
      diagnostics.platformStatus,
    ) ||
    statusValueLooksBlocked(
      diagnostics.windowStatus,
    ) ||
    statusValueLooksBlocked(
      diagnostics.dbStatus,
    ) ||
    statusValueLooksBlocked(
      diagnostics.helperStatus,
    ) ||
    statusValueLooksBlocked(
      diagnostics.keyHelperStatus,
    ) ||
    statusValueLooksBlocked(
      diagnostics.decryptionStatus,
    ) ||
    Boolean(
      diagnostics.externalKeyToolIncompatible ||
      diagnostics.externalKeyToolUnsupported,
    ) ||
    statusValueLooksBlocked(
      diagnostics.uiaStatus,
    );
}

function contactDiagnosticsRiskText(
  diagnostics?: WechatContactsSyncDiagnostics | null,
) {
  if (
    !diagnostics
  )
    return "";
  if (
    hasLowConfidenceContactDiagnostics(
      diagnostics,
    )
  )
    return diagnostics.failureReason ||
      "识别结果置信度不足，未按成功同步处理。";
  if (
    hasBlockedContactDiagnostics(
      diagnostics,
    )
  )
    return diagnostics.failureReason ||
      diagnostics.fallbackReason ||
      "排查信息显示存在需处理项，未按成功同步处理。";
  return "";
}

function compactDiagnosticRecord(
  value?: Record<string, unknown>,
  keys: string[] = [],
) {
  if (
    !value
  )
    return "";
  const parts =
    keys
      .map(
        (
          key,
        ) => {
          const item =
            value[key];
          if (
            item ===
              undefined ||
            item ===
              null ||
            item ===
              ""
          )
            return "";
          return `${key}:${String(item)}`;
        },
      )
      .filter(
        Boolean,
      );
  return parts.join(
    " ",
  );
}

function buildContactSignalItems(
  diagnostics?: WechatContactsSyncDiagnostics | null,
) {
  if (
    !diagnostics
  )
    return [];
  const runtimeStatus =
    diagnostics.nativeRuntimePath
      ? "ready"
      : diagnostics.enginePath ||
          diagnostics.engine
        ? "warning"
        : contactStatusFromValue(
            diagnostics.platformStatus,
          );
  const helperStatus =
    contactStatusFromValue(
      diagnostics.helperStatus,
    );
  const uiaStatus =
    contactStatusFromValue(
      diagnostics.uiaStatus,
    );
  const ocrStatus: ContactDiagnosticStatus =
    diagnostics.ocrContactCount &&
    diagnostics.ocrContactCount >
      0
      ? "ready"
      : diagnostics.ocrPreview?.length
        ? "warning"
        : diagnostics.runtimeCapabilities?.some(
              (
                item,
              ) =>
                /ocr|vision/i.test(
                  item,
                ),
            )
          ? "warning"
          : "unknown";
  return [
    {
      key: "runtime",
      label: "微信状态",
      status: runtimeStatus,
      detail:
        contactDiagnosticDetail(
          diagnostics.nativeRuntimeVersion ||
            diagnostics.engine ||
            diagnostics.platformStatus,
          diagnostics.nativeRuntimePath
            ? "已检测到本机微信组件"
            : "暂未读取到微信状态",
        ),
    },
    {
      key: "helper",
      label: "联系人读取",
      status:
        helperStatus,
      detail:
        contactDiagnosticDetail(
          diagnostics.helperStatus,
          diagnostics.decryptionHelperPath
            ? "已检测到联系人读取服务"
            : "暂未返回联系人读取状态",
        ),
    },
    {
      key: "uia",
      label: "窗口识别",
      status:
        uiaStatus,
      detail:
        diagnostics.uiaContactCount !==
        undefined
          ? `${diagnostics.uiaContactCount} 个联系人`
          : contactDiagnosticDetail(
              diagnostics.uiaStatus,
              "未返回窗口识别状态",
            ),
    },
    {
      key: "ocr",
      label: "文字识别",
      status:
        ocrStatus,
      detail:
        diagnostics.ocrContactCount !==
        undefined
          ? `${diagnostics.ocrContactCount} 个联系人`
        : diagnostics.ocrPreview?.length
            ? "有文字识别结果"
            : "未返回文字识别结果",
    },
  ];
}

function buildContactSyncDiagnosticLayers(
  diagnostics?: WechatContactsSyncDiagnostics | null,
  error?: string,
): ContactDiagnosticLayer[] {
  const text =
    contactSyncErrorText(
      error,
      diagnostics,
    );
  const dbHelperRequired =
    isDbHelperRequiredContactSync(
      diagnostics,
      error,
    );
  const hasFailure =
    Boolean(
      error ||
      diagnostics?.failureReason ||
      diagnostics?.dbError,
    );
  const databaseBlocked =
    diagnostics?.failureLayer ===
      "db" ||
    [
      "sqlite-missing",
      "query-failed",
      "encrypted-or-locked",
    ].includes(
      diagnostics?.dbStatus ||
        "",
    ) ||
    Boolean(
      diagnostics?.dbError,
    ) ||
    errorMatches(
      text,
      /数据库|DB|sqlite|db file|SQLITE|locked|no such table|decrypt/i,
    );
  const permissionBlocked =
    errorMatches(
      text,
      /权限|授权|辅助功能|屏幕录制|Accessibility|permission|TCC|管理员|elevated/i,
    );
  const windowBlocked =
    diagnostics?.failureLayer ===
      "window" ||
    [
      "not-found",
      "wechat-not-running",
      "not-logged-in",
    ].includes(
      diagnostics?.windowStatus ||
        "",
    ) ||
    errorMatches(
      text,
      /微信窗口|通讯录窗口|未登录|焦点|窗口|非微信|不是微信|WeChat window|window/i,
    );
  const recognitionBlocked =
    diagnostics?.failureLayer ===
      "uia" ||
    [
      "failed",
      "window-not-found",
      "not-wechat-contacts-page",
      "completed-empty",
    ].includes(
      diagnostics?.uiaStatus ||
        "",
    ) ||
    errorMatches(
      text,
      /UIA|OCR|识别|扫描|截图|screen|文字|节点|raw text/i,
    );
  const helperBlocked =
    diagnostics?.failureLayer ===
      "helper" ||
    String(
      diagnostics?.helperStatus ||
        "",
    ).startsWith(
      "failed",
    ) ||
    errorMatches(
      text,
      /helper|decrypt|解密|dbkey|db key|Keychain|密钥|native runtime|decryption/i,
    );

	  const databaseEvidence =
	    compactText(
	      [
	        diagnostics?.dbStatus
	          ? `读取状态：${contactDiagnosticDetail(diagnostics.dbStatus)}`
	          : undefined,
	        diagnostics?.dbContactCount !==
	        undefined
	          ? `联系人：${diagnostics.dbContactCount} 个`
	          : undefined,
	        diagnostics?.dbTotalContactCount !==
	        undefined
	          ? `联系人总数：${diagnostics.dbTotalContactCount} 个`
	          : undefined,
        diagnostics?.selectedDbAccountFolder
          ? `当前账号目录：${diagnostics.selectedDbAccountFolder}`
          : undefined,
        diagnostics?.selectedDbBaseWxid
          ? `账号标识：${diagnostics.selectedDbBaseWxid}`
          : undefined,
	        diagnostics?.selectedDbPath
	          ? "联系人库：已检测"
	          : undefined,
	        diagnostics?.sqlitePath
	          ? "联系人文件：已检测"
	          : undefined,
	        diagnostics?.dbHelper
	          ? `联系人读取：${contactDiagnosticDetail(diagnostics.dbHelper)}`
	          : undefined,
        diagnostics
          ?.dbPaths
          ?.length
          ? `候选数据：${diagnostics.dbPaths.length} 个`
          : undefined,
	        diagnostics?.dbError
	          ? `错误：${toPublicError(
	              diagnostics.dbError,
	              "联系人数据暂时无法读取。",
	            )}`
	          : undefined,
	        diagnostics
	          ?.blockedReasons
	          ?.length
	          ? `原因：${diagnostics.blockedReasons
	              .map((item) =>
	                toPublicError(item, "联系人数据读取受阻。"),
	              )
	              .join(" / ")}`
	          : undefined,
	      ],
	    );
  const permissionEvidence =
    compactText(
      [
	        diagnostics?.platformStatus
	          ? `平台状态：${contactDiagnosticDetail(diagnostics.platformStatus)}`
	          : undefined,
        diagnostics?.os
          ? `系统：${diagnostics.os}`
          : undefined,
        diagnostics?.isCurrentProcessElevated !==
        undefined
          ? `管理员权限：${diagnostics.isCurrentProcessElevated ? "是" : "否"}`
          : undefined,
        ...(
          diagnostics?.warnings ||
          []
        ).filter(
          (
            item,
          ) =>
            /权限|授权|辅助功能|屏幕录制|TCC|管理员|permission/i.test(
              item,
            ),
        ).map((item) =>
          toPublicError(item, "请检查微信与系统权限设置。"),
        ),
      ],
    );
  const windowEvidence =
    compactText(
      [
	        diagnostics?.windowStatus
	          ? `窗口状态：${contactDiagnosticDetail(diagnostics.windowStatus)}`
	          : undefined,
        diagnostics?.processName
          ? `进程：${diagnostics.processName}${diagnostics.processId ? ` #${diagnostics.processId}` : ""}`
          : undefined,
        diagnostics?.windowTitle
          ? `窗口：${diagnostics.windowTitle}`
          : undefined,
        diagnostics?.windowRect
          ? `窗口区域：${diagnostics.windowRect.width}x${diagnostics.windowRect.height}`
          : undefined,
        diagnostics?.screen
          ? `屏幕：${diagnostics.screen.width}x${diagnostics.screen.height}`
          : undefined,
      ],
    );
	  const recognitionEvidence =
	    compactText(
	      [
	        diagnostics?.uiaStatus
	          ? `窗口识别状态：${contactDiagnosticDetail(diagnostics.uiaStatus)}`
	          : undefined,
	        diagnostics?.uiaStopReason
	          ? `停止原因：${toPublicError(
	              diagnostics.uiaStopReason,
	              "窗口识别未能完成。",
	            )}`
	          : undefined,
        diagnostics?.pagesScanned !==
        undefined
          ? `扫描页数：${diagnostics.pagesScanned}`
          : undefined,
	        diagnostics?.uiaContactCount !==
	        undefined
	          ? `窗口识别联系人：${diagnostics.uiaContactCount}`
	          : undefined,
	        diagnostics?.uiaNodeCount !==
	        undefined
	          ? `窗口对象：${diagnostics.uiaNodeCount}`
	          : undefined,
	        diagnostics?.ocrContactCount !==
	        undefined
	          ? `文字识别联系人：${diagnostics.ocrContactCount}`
	          : undefined,
        diagnostics?.rawTextCount !==
        undefined
          ? `识别文本：${diagnostics.rawTextCount}`
          : undefined,
	        diagnostics
	          ?.ocrPreview
	          ?.length
	          ? `识别预览：${diagnostics.ocrPreview.slice(0, 3).map((item) => contactDiagnosticDetail(item)).join(" / ")}`
	          : undefined,
	        diagnostics
	          ?.rawPreview
	          ?.length
	          ? `窗口文字预览：${diagnostics.rawPreview.slice(0, 3).map((item) => contactDiagnosticDetail(item)).join(" / ")}`
	          : undefined,
	        diagnostics?.screenshotPath
          ? `排查截图：${diagnostics.screenshotPath}`
          : undefined,
      ],
    );
  const helperEvidence =
    compactText(
      [
	        diagnostics?.helperStatus
	          ? `联系人读取状态：${contactDiagnosticDetail(diagnostics.helperStatus)}`
	          : undefined,
	        diagnostics?.engine
	          ? `处理服务：${contactDiagnosticDetail(`${diagnostics.engine}${diagnostics.engineVersion ? ` ${diagnostics.engineVersion}` : ""}`)}`
	          : undefined,
        diagnostics?.enginePath
          ? "处理服务：已安装"
          : undefined,
        diagnostics?.nativeRuntimePath
          ? "本机微信组件：已检测"
          : undefined,
        diagnostics?.nativeRuntimeVersion
          ? `组件版本：${wechatBusinessText(diagnostics.nativeRuntimeVersion)}`
          : undefined,
        diagnostics?.decryptionHelperPath
          ? "辅助组件：已检测"
          : undefined,
	        diagnostics?.dbKeyStatus
	          ? `数据授权：${contactDiagnosticDetail(diagnostics.dbKeyStatus)}`
	          : undefined,
	        diagnostics?.keyHelperStatus
	          ? `授权读取：${contactDiagnosticDetail(diagnostics.keyHelperStatus)}`
	          : undefined,
	        diagnostics?.decryptionStatus
	          ? `联系人库状态：${contactDiagnosticDetail(diagnostics.decryptionStatus)}`
	          : undefined,
	        diagnostics?.externalKeyToolStatus
	          ? `外部授权工具：${contactDiagnosticDetail(diagnostics.externalKeyToolStatus)}`
	          : undefined,
	        diagnostics?.externalRawKeyToolStatus
	          ? `外部读取工具：${contactDiagnosticDetail(diagnostics.externalRawKeyToolStatus)}`
	          : undefined,
	        diagnostics?.externalKeyToolIncompatible
	          ? "外部授权工具与当前微信不匹配"
	          : undefined,
	        diagnostics?.externalKeyToolUnsupported
	          ? "外部授权工具不支持当前微信版本或资料结构"
	          : undefined,
        diagnostics
          ?.wechatProcessArchitectures
          ?.length
          ? `微信进程：${diagnostics.wechatProcessArchitectures
              .slice(0, 3)
              .map((item) =>
                compactDiagnosticRecord(item, [
                  "processName",
                  "processId",
                  "architecture",
                ]),
              )
              .filter(Boolean)
              .join(" / ")}`
          : undefined,
        diagnostics
          ?.externalKeyToolCompatibility
          ?.length
	          ? `工具兼容：${diagnostics.externalKeyToolCompatibility
	              .slice(0, 3)
	              .map((item) =>
	                contactDiagnosticDetail(compactDiagnosticRecord(item, [
	                  "toolArchitecture",
	                  "status",
	                  "reason",
	                ])),
	              )
	              .filter(Boolean)
	              .join(" / ")}`
	          : undefined,
        diagnostics
          ?.externalDumpRsPidAttempts
          ?.length
	          ? `读取尝试：${diagnostics.externalDumpRsPidAttempts
	              .slice(0, 3)
	              .map((item) =>
	                contactDiagnosticDetail(compactDiagnosticRecord(item, [
	                  "label",
	                  "processName",
	                  "processArchitecture",
	                  "status",
	                ])),
	              )
	              .filter(Boolean)
	              .join(" / ")}`
	          : undefined,
        diagnostics
          ?.externalDbKeyAttempts
          ?.length
	          ? `授权尝试：${diagnostics.externalDbKeyAttempts
	              .slice(0, 3)
	              .map((item) =>
	                contactDiagnosticDetail(compactDiagnosticRecord(item, [
	                  "toolArchitecture",
	                  "status",
	                  "reason",
	                ])),
	              )
	              .filter(Boolean)
	              .join(" / ")}`
	          : undefined,
	        diagnostics?.keyScanDiagnostics
	          ? `授权扫描：${contactDiagnosticDetail(diagnostics.keyScanDiagnostics)}`
	          : undefined,
	        diagnostics?.memoryScanStatus
	          ? `授权扫描状态：${contactDiagnosticDetail(diagnostics.memoryScanStatus)}`
	          : undefined,
        diagnostics
          ?.attemptedSources
          ?.length
	          ? `尝试通道：${diagnostics.attemptedSources.map((item) => contactDiagnosticDetail(item)).join(" / ")}`
	          : undefined,
        diagnostics
          ?.runtimeCapabilities
          ?.length
	          ? `能力：${diagnostics.runtimeCapabilities.map((item) => contactDiagnosticDetail(item)).join(" / ")}`
	          : undefined,
      ],
    );

  return [
    {
      key: "database",
      title:
        "联系人读取",
      icon: Database,
      status:
        databaseBlocked
          ? "blocked"
          : diagnostics?.dbContactCount !==
                undefined ||
              diagnostics
                ?.dbPaths
                ?.length
            ? "ready"
            : hasFailure
              ? "unknown"
              : "unknown",
      summary:
        databaseBlocked
          ? "本机微信联系人读取异常。"
          : diagnostics?.dbContactCount !==
              undefined
            ? `已读取到 ${diagnostics.dbContactCount} 个联系人。`
            : dbHelperRequired
              ? "本机没有读到可用联系人，已使用安全读取策略。"
              : "暂未读到可用联系人。",
      evidence:
        databaseEvidence,
      action:
        dbHelperRequired
          ? "确认电脑微信已登录并保持当前账号在线，然后重新同步。"
          : "确认微信已登录，必要时重启微信后再同步。",
    },
    {
      key: "permission",
      title:
        "权限",
      icon: ShieldCheck,
      status:
        permissionBlocked
          ? "blocked"
          : permissionEvidence.length
            ? "warning"
            : "unknown",
      summary:
        dbHelperRequired
          ? "本次没有使用窗口识别兜底。"
          : permissionBlocked
          ? "系统权限可能阻止读取窗口或截图。"
          : "未发现明确权限错误。",
      evidence:
        permissionEvidence,
      action:
        dbHelperRequired
          ? "优先确认微信登录状态和本机联系人读取状态。"
          : "检查辅助功能、屏幕录制、自动化控制权限；Windows 下确认助手与微信权限等级一致。",
    },
    {
      key: "window",
      title:
        "微信窗口",
      icon: Monitor,
      status:
        windowBlocked
          ? "blocked"
          : diagnostics?.windowTitle ||
              diagnostics?.processName
            ? "ready"
            : "unknown",
      summary:
        dbHelperRequired
          ? "本次没有依赖通讯录窗口识别。"
          : windowBlocked
          ? "当前焦点或扫描对象不像微信通讯录窗口。"
          : diagnostics?.windowTitle
            ? "已捕获微信相关窗口信息。"
            : "未拿到窗口信息。",
      evidence:
        windowEvidence,
      action:
        dbHelperRequired
          ? "保持电脑微信在线后重新同步。"
          : "打开桌面微信，切到通讯录页并保持窗口无遮挡，再重新同步。",
    },
    {
      key: "recognition",
      title:
        "窗口识别",
      icon: ScanSearch,
      status:
        recognitionBlocked &&
        !diagnostics?.uiaContactCount &&
        !diagnostics?.ocrContactCount
          ? "blocked"
          : diagnostics?.uiaContactCount ||
              diagnostics?.ocrContactCount ||
              diagnostics?.rawTextCount
            ? "ready"
            : diagnostics?.fallbackReason
              ? "warning"
              : "unknown",
      summary:
        dbHelperRequired
          ? "已使用安全读取策略，没有用窗口截图覆盖联系人。"
          : diagnostics?.uiaContactCount ||
        diagnostics?.ocrContactCount
          ? `窗口识别返回 ${diagnostics.uiaContactCount || 0} / 文字识别返回 ${diagnostics.ocrContactCount || 0} 个联系人。`
          : recognitionBlocked
            ? "窗口识别没能稳定识别联系人文本。"
            : "未看到窗口识别结果。",
      evidence:
        recognitionEvidence,
      action:
        dbHelperRequired
          ? "请确认电脑微信已登录并重新同步；需要排查时导出资料。"
          : "把微信窗口放大到可读状态，先刷新通讯录列表；若仍失败，导出排查资料查看截图和识别文本。",
    },
    {
      key: "helper",
      title:
        "本机读取服务",
      icon: KeyRound,
      status:
        helperBlocked
          ? "blocked"
          : diagnostics?.decryptionHelperPath ||
              diagnostics?.dbKeyStatus ||
              diagnostics?.nativeRuntimePath
            ? "warning"
            : "unknown",
      summary:
        helperBlocked
          ? dbHelperRequired
            ? "本机读取服务没有拿到当前账号联系人。"
            : "微信资料读取失败，请重新连接微信或检查授权。"
          : diagnostics?.decryptionHelperPath ||
              diagnostics?.dbKeyStatus
            ? "已检测到本机读取服务，请确认状态是否可用。"
            : "未返回本机读取服务状态。",
      evidence:
        helperEvidence,
      action:
        "确认电脑微信已登录，必要时重启微信后再同步。",
    },
  ];
}

function contactSyncDiagnosticsFromError(
  error: unknown,
) {
  const diagnostics =
    error &&
    typeof error ===
      "object"
      ? (
          error as {
            diagnostics?: WechatContactsSyncDiagnostics;
          }
        )
          .diagnostics
      : undefined;
  return (
    diagnostics ||
    null
  );
}

function readStringArray(
  value: unknown,
) {
  if (
    Array.isArray(
      value,
    )
  ) {
    return value
      .map(
        (
          item,
        ) =>
          String(
            item ||
              "",
          ).trim(),
      )
      .filter(
        Boolean,
      );
  }
  if (
    typeof value ===
    "string"
  ) {
    return splitLines(
      value,
    );
  }
  return [];
}

function runModeLabel(
  mode: WechatMode,
) {
  if (
    mode ===
    "auto-send"
  )
    return "自动发送";
  if (
    mode ===
    "controlled-send"
  )
    return "确认后发送";
  return "只看不发";
}

function runModeMeta(
  mode: WechatMode,
) {
  if (mode === "auto-send") {
    return {
      color: "warning" as const,
      label: "自动操作",
      description:
        "将调用本机微信执行外部动作。账号、目标、内容或权限检查不通过时会停止；只有收到逐对象结果后才计为完成。",
    };
  }
  if (mode === "controlled-send") {
    return {
      color: "primary" as const,
      label: "确认后执行",
      description:
        "先创建并检查计划，未完成发送确认前不会对外发送。确认后仍以逐对象结果作为完成依据。",
    };
  }
  return {
    color: "default" as const,
    label: "只读分析",
    description:
      "只读取和分析当前信息，不发送消息、不添加好友，也不发布朋友圈。",
  };
}

function planExecutionModeMeta(
  task: InteractionTask,
) {
  if (
    task.safetyBoundary?.planMode === "trial" ||
    task.safetyBoundary?.trialLimited
  ) {
    return {
      color: "default" as const,
      label: "试用模式",
      description: "当前计划处于试用模式，不计为已经发送。",
    };
  }
  if (task.sendMode === "draft-only") {
    return {
      color: "default" as const,
      label: "只看不发",
      description: "当前计划不会执行外部发送动作。",
    };
  }
  if (task.executionMode === "internal-record") {
    return {
      color: "default" as const,
      label: "仅记录",
      description: "当前记录没有外部执行结果，不能视为已经发送。",
    };
  }
  if (task.sendMode === "auto-send") {
    return {
      color: "warning" as const,
      label: "自动操作",
      description: "本机微信执行外部动作，并以逐对象结果和证据核验完成。",
    };
  }
  return {
    color: "primary" as const,
    label: "确认后执行",
    description: "确认前不会对外发送，确认后以逐对象结果核验完成。",
  };
}

function taskTitle(
  request: InteractionSkillRunRequest,
) {
  const titleMap: Record<
    string,
    string
  > =
    {
      "wechat.live.auto_reply":
        "当前微信会话",
      "wechat.session.auto_reply":
        "微信会话回复",
      "wechat.group.broadcast":
        "微信群发",
      "wechat.contact.add":
        "自动加好友",
      "wechat.friend.accept":
        "自动通过好友",
      "wechat.moments.publish":
        "朋友圈发布",
      "wechat.moments.marketing":
        "朋友圈营销",
    };
  return (
    titleMap[
      request
        .skillId
    ] ||
    "微信任务"
  );
}

function typeLabel(
  type: InteractionTaskType,
) {
  const labels: Record<
    InteractionTaskType,
    string
  > =
    {
      "douyin-comment-reply":
        "抖音自动评论",
      "douyin-direct-message-reply":
        "抖音私信回复",
      "wechat-channel-comment-reply":
        "视频号评论回复",
      "wechat-channel-direct-message-reply":
        "视频号私信回复",
      "wechat-reply-draft":
        "微信会话回复",
      "wechat-group-broadcast":
        "微信群发",
      "wechat-contact-add":
        "自动加好友",
      "wechat-friend-accept":
        "自动通过好友",
      "wechat-moments-publish":
        "朋友圈发布",
      "wechat-moments-marketing":
        "朋友圈营销",
      "customer-follow-up":
        "客户跟进",
    };
  return (
    labels[
      type
    ] ||
    type
  );
}

function statusColor(
  status: InteractionTaskStatus,
):
  | "default"
  | "primary"
  | "success"
  | "warning"
  | "danger" {
  if (
    status ===
    "completed"
  )
    return "success";
  if (
    status ===
    "running"
  )
    return "primary";
  if (
    status ===
      "paused" ||
    status ===
      "waiting_for_send_confirmation" ||
    status ===
      "queued"
  )
    return "warning";
  if (
    status ===
      "failed" ||
    status ===
      "blocked" ||
    status ===
      "no_target"
  )
    return "danger";
  return "default";
}

function chatHistoryStatusColor(
  status?: WechatChatHistoryStatus,
):
  | "default"
  | "primary"
  | "success"
  | "warning"
  | "danger" {
  if (
    status ===
    "ready"
  )
    return "success";
  if (
    status ===
    "empty"
  )
    return "warning";
  if (
    status ===
      "blocked" ||
    status ===
      "error"
  )
    return "danger";
  return "default";
}

function chatHistoryStatusLabel(status?: WechatChatHistoryStatus) {
  if (status === "ready") return "已读取";
  if (status === "empty") return "暂无消息";
  if (status === "blocked") return "需处理";
  if (status === "error") return "读取失败";
  return status ? wechatBusinessText(status) : "未加载";
}

function chatDirectionLabel(
  direction: WechatChatMessage["direction"],
) {
  if (
    direction ===
    "incoming"
  )
    return "对方";
  if (
    direction ===
    "outgoing"
  )
    return "我方";
  if (
    direction ===
    "system"
  )
    return "系统";
  return "未知";
}

function formatTime(
  value?: string,
) {
  if (
    !value
  )
    return "-";
  const date =
    new Date(
      value,
    );
  if (
    Number.isNaN(
      date.getTime(),
    )
  )
    return value;
  return date.toLocaleString(
    "zh-CN",
    {
      hour12: false,
    },
  );
}

function planName(
  task: InteractionTask,
) {
  const metadata =
    task.metadata ||
    {};
  const candidate =
    task.planName ||
    metadataText(
      metadata,
      "wechat_plan_name",
    ) ||
    metadataText(
      metadata,
      "planName",
    ) ||
    task.videoTitle ||
    task.targetName ||
    typeLabel(
      task.type,
    );
  return candidate;
}

function countTargets(
  task: InteractionTask,
) {
  return (
    task
      .batchSummary
      ?.total ||
    task
      .batchTargets
      ?.length ||
    (task.targetName
      ? 1
      : 0)
  );
}

function taskMatchesFilter(
  task: InteractionTask,
  filter: WechatPlanFilter,
) {
  if (
    filter ===
    "all"
  )
    return WECHAT_PLAN_TYPES.includes(
      task.type,
    );
  if (
    filter ===
    "groups"
  )
    return (
      task.type ===
      "wechat-group-broadcast"
    );
  if (
    filter ===
    "contact-add"
  )
    return (
      task.type ===
      "wechat-contact-add"
    );
  if (
    filter ===
    "friend-accept"
  )
    return (
      task.type ===
      "wechat-friend-accept"
    );
  if (
    filter ===
    "moments-publish"
  )
    return (
      task.type ===
      "wechat-moments-publish"
    );
  return (
    task.type ===
    "wechat-moments-marketing"
  );
}

function routeForWechatSkill(
  skillId: string,
): InteractionBusinessRouteKey {
  if (
    skillId ===
      "wechat.group.broadcast" ||
    skillId ===
      "wechat-group-broadcast"
  )
    return "groups";
  if (
    skillId ===
      "wechat.contact.add" ||
    skillId ===
      "wechat-contact-add"
  )
    return "customers";
  if (
    skillId ===
      "wechat.friend.accept" ||
    skillId ===
      "wechat-friend-accept"
  )
    return "customers";
  if (
    skillId ===
      "wechat.moments.publish" ||
    skillId ===
      "wechat-moments-publish" ||
    skillId ===
      "wechat.moments.marketing" ||
    skillId ===
      "wechat-moments-marketing"
  ) {
    return "moments";
  }
  return "wechat";
}

function typeForWechatSkill(
  skillId: string,
): InteractionTaskType {
  if (
    skillId ===
      "wechat.group.broadcast" ||
    skillId ===
      "wechat-group-broadcast"
  )
    return "wechat-group-broadcast";
  if (
    skillId ===
      "wechat.contact.add" ||
    skillId ===
      "wechat-contact-add"
  )
    return "wechat-contact-add";
  if (
    skillId ===
      "wechat.friend.accept" ||
    skillId ===
      "wechat-friend-accept"
  )
    return "wechat-friend-accept";
  if (
    skillId ===
      "wechat.moments.publish" ||
    skillId ===
      "wechat-moments-publish"
  )
    return "wechat-moments-publish";
  if (
    skillId ===
      "wechat.moments.marketing" ||
    skillId ===
      "wechat-moments-marketing"
  )
    return "wechat-moments-marketing";
  return "wechat-reply-draft";
}

function metadataText(
  metadata:
    | Record<
        string,
        unknown
      >
    | undefined,
  key: string,
) {
  const value =
    metadata?.[
      key
    ];
  return typeof value ===
    "string"
    ? value.trim()
    : "";
}

function metadataNumber(
  metadata:
    | Record<
        string,
        unknown
      >
    | undefined,
  key: string,
) {
  const value =
    metadata?.[
      key
    ];
  const number =
    typeof value ===
    "number"
      ? value
      : typeof value ===
          "string"
        ? Number(
            value,
          )
        : Number.NaN;
  return Number.isFinite(
    number,
  )
    ? number
    : undefined;
}

function metadataBoolean(
  metadata:
    | Record<
        string,
        unknown
      >
    | undefined,
  key: string,
) {
  const value =
    metadata?.[
      key
    ];
  if (
    typeof value ===
    "boolean"
  )
    return value;
  if (
    typeof value ===
    "string"
  ) {
    if (
      value ===
      "true"
    )
      return true;
    if (
      value ===
      "false"
    )
      return false;
  }
  return undefined;
}

function metadataList(
  metadata:
    | Record<
        string,
        unknown
      >
    | undefined,
  key: string,
) {
  return readStringArray(
    metadata?.[
      key
    ],
  );
}

function metadataPrompts(
  metadata:
    | Record<
        string,
        unknown
      >
    | undefined,
) {
  const value =
    metadata?.prompts ||
    metadata?.wechat_moments_prompts;
  if (
    !Array.isArray(
      value,
    )
  )
    return undefined;
  const prompts: Array<{
    key?: string;
    title?: string;
    prompt: string;
    enabled: boolean;
  }> =
    [];
  for (const item of value) {
    if (
      item &&
      typeof item ===
        "object"
    ) {
      const record =
        item as Record<
          string,
          unknown
        >;
      const prompt =
        typeof record.prompt ===
        "string"
          ? record.prompt.trim()
          : "";
      if (
        !prompt
      )
        continue;
      prompts.push(
        {
          key:
            typeof record.key ===
              "string" &&
            record.key.trim()
              ? record.key.trim()
              : undefined,
          title:
            typeof record.title ===
              "string" &&
            record.title.trim()
              ? record.title.trim()
              : undefined,
          prompt,
          enabled:
            record.enabled !==
            false,
        },
      );
    }
  }
  return prompts.length
    ? prompts
    : undefined;
}

function parseMomentPrompts(
  value: string,
) {
  return splitLines(
    value,
  )
    .map(
      (
        line,
        index,
      ) =>{
        const [
          title,
          ...rest
        ] =
          line.split(
            /[|｜]/,
          );
        const prompt =
          rest.length
            ? rest
                .join(
                  "|",
                )
                .trim()
            : title.trim();
        return {
          key: `prompt-${index + 1}`,
          title:
            rest.length
              ? title.trim()
              : undefined,
          prompt,
          enabled: true,
        };
      },
    )
    .filter(
      (
        item,
      ) =>
        item.prompt,
    );
}

function firstMetadataText(
  metadata:
    | Record<
        string,
        unknown
      >
    | undefined,
  keys: string[],
) {
  for (const key of keys) {
    const value =
      metadataText(
        metadata,
        key,
      );
    if (
      value
    )
      return value;
  }
  return "";
}

function firstMetadataNumber(
  metadata:
    | Record<
        string,
        unknown
      >
    | undefined,
  keys: string[],
) {
  for (const key of keys) {
    const value =
      metadataNumber(
        metadata,
        key,
      );
    if (
      value !==
      undefined
    )
      return value;
  }
  return undefined;
}

function validateMomentsAssets(
  value: string,
) {
  const assets =
    splitLines(
      value,
    );
  const imagePattern =
    /\.(jpe?g|png|gif|heic|webp|bmp|tiff?)$/i;
  const videoPattern =
    /\.(mp4|mov|m4v)$/i;
  const imageCount =
    assets.filter(
      (
        item,
      ) =>
        imagePattern.test(
          item,
        ),
    ).length;
  const videoCount =
    assets.filter(
      (
        item,
      ) =>
        videoPattern.test(
          item,
        ),
    ).length;
  const unknown =
    assets.filter(
      (
        item,
      ) =>
        !imagePattern.test(
          item,
        ) &&
        !videoPattern.test(
          item,
        ),
    );
  if (
    !assets.length
  )
    return "请提供图片或视频素材。";
  if (
    unknown.length
  )
    return `不支持的素材类型：${unknown[0]}`;
  if (
    imageCount >
      0 &&
    videoCount >
      0
  )
    return "朋友圈素材不能同时混选图片和视频。";
  if (
    videoCount >
    1
  )
    return "朋友圈视频最多支持 1 个素材。";
  if (
    imageCount >
    9
  )
    return "朋友圈图片最多支持 9 个素材。";
  return "";
}

function planScheduleLabel(
  task: InteractionTask,
) {
  const metadata =
    task.metadata ||
    {};
  const value =
    firstMetadataText(
      metadata,
      [
        "wechat_plan_time",
        "wechat_schedule_time",
        "wechat_scheduled_at",
        "planTime",
        "scheduleTime",
        "scheduledAt",
        "scheduled_at",
        "executeAt",
      ],
    );
  return formatTime(
    task.planTime ||
      value ||
      task.commentTime ||
      task.createdAt,
  );
}

function planDailyLimitLabel(
  task: InteractionTask,
) {
  if (
    task.dailyLimit !==
    undefined
  )
    return `${Math.floor(task.dailyLimit)} / 天`;
  const metadata =
    task.metadata ||
    {};
  const value =
    firstMetadataNumber(
      metadata,
      [
        "wechat_daily_limit",
        "wechat_group_daily_limit",
        "wechat_contact_add_daily_limit",
        "wechat_moments_marketing_daily_limit",
        "dailyLimit",
        "daily_limit",
        "dailyViewLimit",
      ],
    );
  return value ===
    undefined
    ? "-"
    : `${Math.floor(value)} / 天`;
}

function planWechatAccountLabel(
  task: InteractionTask,
) {
  const metadata =
    task.metadata ||
    {};
  return (
    task.associatedWeChat ||
    firstMetadataText(
      metadata,
      [
        "wechat_account_name",
        "wechat_account",
        "wechat_id",
        "wechatNo",
        "wechatAccount",
        "accountName",
      ],
    ) ||
    task.accountName ||
    "本机微信"
  );
}

function planStatusLabel(
  task: InteractionTask,
) {
  const labels: Record<
    string,
    string
  > =
    {
      draft:
        "草稿",
      scheduled:
        "已排期",
      sending:
        "发送中",
      paused:
        "已暂停",
      completed:
        "已完成",
      failed:
        "失败",
      removed:
        "已移除",
    };
  return task.planStatus
    ? labels[
        task
          .planStatus
      ] ||
        task.planStatus
    : "";
}

function planExecutionLabel(
  task: InteractionTask,
) {
  const evidenceCount = evidenceCountForPlan(task);
  if (task.status === "completed") {
    return evidenceCount ? "已结束" : "已结束，待核验";
  }
  if (task.status === "running") return "执行中";
  if (task.status === "paused") return "已暂停";
  if (task.status === "waiting_for_send_confirmation") return "等待确认";
  if (task.status === "blocked") return "无法执行";
  if (task.status === "failed") return "执行失败";
  if (task.status === "no_target") return "未找到对象";
  if (task.status === "skipped") return "已跳过";
  if (task.planStatus === "scheduled") return "等待执行";
  return "待开始";
}

function mergePlans(
  primary: InteractionTask[],
  fallback: InteractionTask[],
) {
  const seen =
    new Set<string>();
  const result: InteractionTask[] =
    [];
  for (const task of [
    ...primary,
    ...fallback,
  ]) {
    if (
      seen.has(
        task.id,
      )
    )
      continue;
    seen.add(
      task.id,
    );
    result.push(
      task,
    );
  }
  return result;
}

async function loadGroupBroadcastPlans() {
  try {
    const groupPlans =
      await localEngineApi.groupBroadcastPlans(
        100,
      );
    return await Promise.all(
      groupPlans.map(
        async (
          task,
        ) =>{
          if (
            task.batchSummary &&
            task
              .batchTargets
              ?.length
          )
            return task;
          try {
            const details =
              await localEngineApi.groupBroadcastPlanDetails(
                task.id,
              );
            return {
              ...task,
              planName:
                task.planName ||
                details.planName,
              planStatus:
                task.planStatus ||
                details.planStatus,
              batchSummary:
                task.batchSummary ||
                details.summary,
              batchTargets:
                task
                  .batchTargets
                  ?.length
                  ? task.batchTargets
                  : details.items,
            };
          } catch {
            return task;
          }
        },
      ),
    );
  } catch {
    return localEngineApi
      .businessTasks(
        "groups",
        100,
      )
      .catch(
        () => [],
      );
  }
}

function planTargetLabel(
  task: InteractionTask,
) {
  const metadata =
    task.metadata ||
    {};
  const targets =
    [
      ...metadataList(
        metadata,
        "wechat_group_targets",
      ),
      ...metadataList(
        metadata,
        "wechat_contact_add_targets",
      ),
      ...metadataList(
        metadata,
        "wechat_moments_marketing_contacts",
      ),
    ];
  if (
    targets.length
  )
    return (
      targets
        .slice(
          0,
          3,
        )
        .join(
          "、",
        ) +
      (targets.length >
      3
        ? ` 等 ${targets.length} 个`
        : "")
    );
  return (
    task.targetName ||
    "-"
  );
}

function evidenceCountForPlan(
  task: InteractionTask,
) {
  const eventEvidenceCount =
    task.events.filter(
      (
        event,
      ) =>
        event.evidence,
    ).length;
  return Math.max(
    eventEvidenceCount,
    task
      .diagnostics
      ?.evidenceCount ||
      0,
    task
      .resultSummary
      ?.evidenceCount ||
      0,
  );
}

function evidenceHrefForPlan(
  task: InteractionTask,
) {
  const metadata =
    task.metadata ||
    {};
  return (
    task
      .resultSummary
      ?.evidenceHref ||
    firstMetadataText(
      metadata,
      [
        "evidenceHref",
        "evidence_href",
        "wechat_evidence_href",
      ],
    ) ||
    "/local-engine?tab=evidence"
  );
}

function failureReasonForPlan(
  task: InteractionTask,
) {
  const failureEvidence =
    task.events.find(
      (
        event,
      ) =>
        event
          .evidence
          ?.type ===
        "failure_reason",
    )
      ?.evidence
      ?.value;
  return (
    task.failureReason ||
    task
      .diagnostics
      ?.failureReason ||
    firstMetadataText(
      task.metadata,
      [
        "failureReason",
        "failure_reason",
        "wechat_failure_reason",
      ],
    ) ||
    (typeof failureEvidence ===
    "string"
      ? failureEvidence
      : "")
  );
}

function planStatsLabel(
  task: InteractionTask,
  total: number,
  pending: number,
  done: number,
  failed: number,
) {
  const skipped =
    task
      .batchSummary
      ?.skipped ||
    0;
  const noTarget =
    task
      .batchSummary
      ?.noTarget ||
    0;
  return `目标 ${total} · 待执行 ${pending} · 成功 ${done} · 失败 ${failed} · 跳过 ${skipped} · 无目标 ${noTarget}`;
}

function targetListForRequest(
  request: InteractionSkillRunRequest,
) {
  const metadata =
    request.metadata ||
    {};
  if (
    request.skillId ===
    "wechat.group.broadcast"
  )
    return metadataList(
      metadata,
      "wechat_group_targets",
    );
  if (
    request.skillId ===
    "wechat.contact.add"
  )
    return metadataList(
      metadata,
      "wechat_contact_add_targets",
    );
  if (
    request.skillId ===
    "wechat.friend.accept"
  )
    return [
      "新的好友申请",
    ];
  if (
    request.skillId ===
    "wechat.moments.marketing"
  ) {
    const contacts =
      metadataList(
        metadata,
        "wechat_moments_marketing_contacts",
      );
    if (
      contacts.length
    )
      return contacts;
    const marketingMode =
      metadataText(
        metadata,
        "wechat_moments_marketing_mode",
      );
    if (
      marketingMode ===
      "targeted"
    )
      return [];
    const browseCount =
      Number(
        metadata.wechat_moments_marketing_random_browse_count ||
          1,
      );
    return Array.from(
      {
        length:
          Math.max(
            1,
            Math.min(
              Math.floor(
                browseCount ||
                  1,
              ),
              100,
            ),
          ),
      },
      (
        _,
        index,
      ) =>
        `朋友圈第 ${index + 1} 条`,
    );
  }
  if (
    request.skillId ===
    "wechat.moments.publish"
  )
    return [
      "朋友圈发布",
    ];
  return [
    metadataText(
      metadata,
      "wechat_contact_name",
    ),
  ].filter(
    Boolean,
  );
}

function targetRequirementMessageForRequest(
  request: InteractionSkillRunRequest,
  targets: string[],
) {
  if (
    targets.length
  )
    return "";
  const metadata =
    request.metadata ||
    {};
  if (
    request.skillId ===
    "wechat.group.broadcast"
  )
    return "普通群发需要至少一个联系人或群聊。";
  if (
    request.skillId ===
    "wechat.contact.add"
  )
    return "自动加好友需要至少一个手机号或微信号。";
  if (
    request.skillId ===
      "wechat.moments.marketing" &&
    metadataText(
      metadata,
      "wechat_moments_marketing_mode",
    ) ===
      "targeted"
  )
    return "定向朋友圈营销需要至少一个目标联系人。";
  return "";
}

type WechatWorkbenchClientProps =
  {
    initialModule?: WechatModule;
  };

export function WechatWorkbenchClient({
  initialModule = "mass-send",
}: WechatWorkbenchClientProps) {
  const agentS =
    useAgentSState();
  const [
    mode,
    setMode,
  ] =
    React.useState<WechatMode>(
      "auto-send",
    );
  const [
    runningSkill,
    setRunningSkill,
  ] =
    React.useState(
      "",
    );
  const [
    activeModule,
    setActiveModule,
  ] =
    React.useState<WechatModule>(
      initialModule,
    );
  const [
    riskModal,
    setRiskModal,
  ] =
    React.useState<
      | ""
      | "contact-sync"
      | "contact-add"
    >(
      "",
    );

  const [
    groupPlanName,
    setGroupPlanName,
  ] =
    React.useState(
      `普通群发 ${new Date().toLocaleDateString("zh-CN")}`,
    );
  const [
    groupPlanType,
    setGroupPlanType,
  ] =
    React.useState<
      | "immediate"
      | "scheduled"
    >(
      "immediate",
    );
  const [
    groupPlanTime,
    setGroupPlanTime,
  ] =
    React.useState(
      "",
    );
  const [
    groupTargets,
    setGroupTargets,
  ] =
    React.useState(
      "",
    );
  const [
    groupMessage,
    setGroupMessage,
  ] =
    React.useState(
      "",
    );
  const [
    groupMessageMode,
    setGroupMessageMode,
  ] = React.useState<"ordinary" | "personalized">("ordinary");
  const [
    groupPersonalizedMessages,
    setGroupPersonalizedMessages,
  ] = React.useState("");
  const [
    groupTags,
    setGroupTags,
  ] =
    React.useState(
      "老客户、意向客户",
    );
  const [
    groupDailyLimit,
    setGroupDailyLimit,
  ] =
    React.useState(
      "20",
    );
  const [
    groupIntervalSeconds,
    setGroupIntervalSeconds,
  ] =
    React.useState(
      "30",
    );
  const [
    groupChunkedSending,
    setGroupChunkedSending,
  ] =
    React.useState(
      false,
    );
  const [
    groupFilePaths,
    setGroupFilePaths,
  ] =
    React.useState(
      "",
    );
  const [
    groupContext,
    setGroupContext,
  ] =
    React.useState(
      "",
    );

  const [
    contactPlanName,
    setContactPlanName,
  ] =
    React.useState(
      `添加好友 ${new Date().toLocaleDateString("zh-CN")}`,
    );
  const [
    contactTargets,
    setContactTargets,
  ] =
    React.useState(
      "",
    );
  const [
    contactVerifyMessage,
    setContactVerifyMessage,
  ] =
    React.useState(
      "你好，我想了解一下你的需求。",
    );
  const [
    contactDailyLimit,
    setContactDailyLimit,
  ] =
    React.useState(
      "10",
    );
  const [
    contactMinIntervalSeconds,
    setContactMinIntervalSeconds,
  ] =
    React.useState(
      "180",
    );
  const [
    contactMaxIntervalSeconds,
    setContactMaxIntervalSeconds,
  ] =
    React.useState(
      "36000",
    );
  const [
    contactRemarkStrategy,
    setContactRemarkStrategy,
  ] =
    React.useState<
      | "manual"
      | "phone_wechat"
      | "none"
    >(
      "none",
    );
  const [
    contactRemarkContent,
    setContactRemarkContent,
  ] =
    React.useState(
      "",
    );
  const [
    contactBlacklist,
    setContactBlacklist,
  ] =
    React.useState(
      "",
    );
  const [
    contactContext,
    setContactContext,
  ] =
    React.useState(
      "",
    );

  const [
    friendAcceptPlanName,
    setFriendAcceptPlanName,
  ] = React.useState(
    `通过好友 ${new Date().toLocaleDateString("zh-CN")}`,
  );
  const [
    friendAcceptRemarkStrategy,
    setFriendAcceptRemarkStrategy,
  ] = React.useState<"request_name" | "phone_wechat" | "manual">(
    "request_name",
  );
  const [
    friendAcceptRemarkContent,
    setFriendAcceptRemarkContent,
  ] = React.useState("");
  const [
    friendAcceptWelcomeMessage,
    setFriendAcceptWelcomeMessage,
  ] = React.useState("");
  const [
    friendAcceptKeywords,
    setFriendAcceptKeywords,
  ] = React.useState("");
  const [
    friendAcceptDailyLimit,
    setFriendAcceptDailyLimit,
  ] = React.useState("20");
  const [
    friendAcceptContext,
    setFriendAcceptContext,
  ] = React.useState("");

  const [
    momentsPlanName,
    setMomentsPlanName,
  ] =
    React.useState(
      `朋友圈发布 ${new Date().toLocaleDateString("zh-CN")}`,
    );
  const [
    momentsPlanDescription,
    setMomentsPlanDescription,
  ] =
    React.useState(
      "",
    );
  const [
    momentsContent,
    setMomentsContent,
  ] =
    React.useState(
      "",
    );
  const [
    momentsAdditionalComment,
    setMomentsAdditionalComment,
  ] =
    React.useState(
      "",
    );
  const [
    momentsAssetPath,
    setMomentsAssetPath,
  ] =
    React.useState(
      "",
    );
  const [
    momentsVisibility,
    setMomentsVisibility,
  ] =
    React.useState(
      "默认可见范围",
    );
  const [
    momentsPublishIntervalMinutes,
    setMomentsPublishIntervalMinutes,
  ] =
    React.useState(
      "0",
    );
  const [
    momentsDailyPublished,
    setMomentsDailyPublished,
  ] =
    React.useState(
      "0",
    );
  const [
    momentsDailyQuota,
    setMomentsDailyQuota,
  ] =
    React.useState(
      "1",
    );
  const [
    momentsScheduleStartTime,
    setMomentsScheduleStartTime,
  ] =
    React.useState(
      "",
    );
  const [
    momentsContext,
    setMomentsContext,
  ] =
    React.useState(
      "",
    );

  const [
    marketingMode,
    setMarketingMode,
  ] =
    React.useState<MarketingMode>(
      "random",
    );
  const [
    marketingPlanName,
    setMarketingPlanName,
  ] =
    React.useState(
      `朋友圈营销 ${new Date().toLocaleDateString("zh-CN")}`,
    );
  const [
    marketingContacts,
    setMarketingContacts,
  ] =
    React.useState(
      "",
    );
  const [
    marketingCheckIntervalMinutes,
    setMarketingCheckIntervalMinutes,
  ] =
    React.useState(
      "30",
    );
  const [
    marketingDailyLimit,
    setMarketingDailyLimit,
  ] =
    React.useState(
      "20",
    );
  const [
    marketingBrowseCount,
    setMarketingBrowseCount,
  ] =
    React.useState(
      "10",
    );
  const [
    marketingScheduleStartTime,
    setMarketingScheduleStartTime,
  ] =
    React.useState(
      "",
    );
  const [
    marketingPrompts,
    setMarketingPrompts,
  ] =
    React.useState(
      "",
    );
  const [
    marketingCommentMode,
    setMarketingCommentMode,
  ] =
    React.useState<CommentMode>(
      "ai",
    );
  const [
    marketingFixedComment,
    setMarketingFixedComment,
  ] =
    React.useState(
      "",
    );
  const [
    marketingContent,
    setMarketingContent,
  ] =
    React.useState(
      "",
    );
  const [
    marketingContext,
    setMarketingContext,
  ] =
    React.useState(
      "",
    );
  const [
    marketingLike,
    setMarketingLike,
  ] =
    React.useState(
      true,
    );
  const [
    marketingComment,
    setMarketingComment,
  ] =
    React.useState(
      true,
    );
  const [
    syncedContacts,
    setSyncedContacts,
  ] =
    React.useState<
      string[]
    >(
      [],
    );
  const [
    structuredContacts,
    setStructuredContacts,
  ] =
    React.useState<
      WechatContact[]
    >(
      [],
    );
  const [
    contactsLoading,
    setContactsLoading,
  ] =
    React.useState(
      false,
    );
  const [
    contactSaving,
    setContactSaving,
  ] =
    React.useState(
      false,
    );
  const [
    contactSyncMode,
    setContactSyncMode,
  ] =
    React.useState<WechatContactsSyncMode>(
      "random",
    );
  const [
    contactSyncDiagnostics,
    setContactSyncDiagnostics,
  ] =
    React.useState<WechatContactsSyncDiagnostics | null>(
      null,
    );
  const [
    contactReadiness,
    setContactReadiness,
  ] =
    React.useState<WechatContactsReadinessResult | null>(
      null,
    );
  const [
    contactSyncError,
    setContactSyncError,
  ] =
    React.useState(
      "",
    );
  const [
    contactEditingWxid,
    setContactEditingWxid,
  ] =
    React.useState(
      "",
    );
  const [
    contactWxid,
    setContactWxid,
  ] =
    React.useState(
      "",
    );
  const [
    contactNickname,
    setContactNickname,
  ] =
    React.useState(
      "",
    );
  const [
    contactRemark,
    setContactRemark,
  ] =
    React.useState(
      "",
    );
  const [
    contactTags,
    setContactTags,
  ] =
    React.useState(
      "",
    );
  const [
    plans,
    setPlans,
  ] =
    React.useState<
      InteractionTask[]
    >(
      [],
    );
  const [
    plansLoading,
    setPlansLoading,
  ] =
    React.useState(
      false,
    );
  const [
    planFilter,
    setPlanFilter,
  ] =
    React.useState<WechatPlanFilter>(
      "all",
    );
  const [
    planActionId,
    setPlanActionId,
  ] =
    React.useState(
      "",
    );
  const [pendingPlanAction, setPendingPlanAction] =
    React.useState<PendingWechatPlanAction | null>(null);
  const [
    chatSessionsResult,
    setChatSessionsResult,
  ] =
    React.useState<WechatChatSessionsResult | null>(
      null,
    );
  const [
    chatHistoryResult,
    setChatHistoryResult,
  ] =
    React.useState<WechatChatHistoryResult | null>(
      null,
    );
  const [
    selectedChatSessionId,
    setSelectedChatSessionId,
  ] =
    React.useState(
      "",
    );
  const [
    chatSessionsLoading,
    setChatSessionsLoading,
  ] =
    React.useState(
      false,
    );
  const [
    chatHistoryLoading,
    setChatHistoryLoading,
  ] =
    React.useState(
      false,
    );
  const [
    chatSyncLoading,
    setChatSyncLoading,
  ] =
    React.useState(
      false,
    );

  const refreshAgentSStatus =
    agentS.refreshAgentSStatus;

  const loadSyncedContacts =
    React.useCallback(async () =>{
      setContactsLoading(
        true,
      );
      try {
        const [
          result,
          readiness,
        ] =
          await Promise.all(
            [
              localEngineApi.wechatContacts(),
              localEngineApi.wechatContactsReadiness(),
            ],
          );
        const names =
          contactNamesFromResult(
            result,
          );
        setContactReadiness(
          readiness,
        );
        setSyncedContacts(
          names,
        );
        setStructuredContacts(
          result.items ||
            [],
        );
        setContactSyncDiagnostics(
          result.diagnostics ||
            null,
        );
        return names;
      } catch (error) {
        const message =
          toPublicError(
            error,
            "本机通讯录暂时无法读取，请稍后重试。",
          );
        setContactSyncError(
          message,
        );
        setContactSyncDiagnostics(
          null,
        );
        return [];
      } finally {
        setContactsLoading(
          false,
        );
      }
    }, []);

  const loadPlans =
    React.useCallback(async () =>{
      setPlansLoading(
        true,
      );
      try {
        const [
          groupTasks,
          customerTasks,
          momentTasks,
        ] =
          await Promise.all(
            [
              loadGroupBroadcastPlans(),
              localEngineApi
                .businessTasks(
                  "customers",
                  100,
                )
                .catch(
                  () => [],
                ),
              localEngineApi
                .businessTasks(
                  "moments",
                  100,
                )
                .catch(
                  () => [],
                ),
            ],
          );
        const items =
          mergePlans(
            groupTasks,
            [
              ...customerTasks,
              ...momentTasks,
            ],
          )
            .filter(
              (
                task,
              ) =>
                WECHAT_PLAN_TYPES.includes(
                  task.type,
                ),
            )
            .sort(
              (
                a,
                b,
              ) =>
                new Date(
                  b.updatedAt,
                ).getTime() -
                new Date(
                  a.updatedAt,
                ).getTime(),
            );
        setPlans(
          items,
        );
        return items;
      } finally {
        setPlansLoading(
          false,
        );
      }
    }, []);

  const syncWechatContacts =
    React.useCallback(
      async (
        mode: WechatContactsSyncMode = contactSyncMode,
      ) =>{
        setContactsLoading(
          true,
        );
        setContactSyncError(
          "",
        );
        try {
          const readiness =
            await localEngineApi.wechatContactsReadiness();
          setContactReadiness(
            readiness,
          );
          const modeUnsupported =
            mode ===
              "all" &&
            !readiness
              .modeSupport
              .all;
          if (
            readiness.status ===
              "blocked" ||
            modeUnsupported
          ) {
            const blocker =
              readiness
                .blockers[0] ||
              readiness
                .warnings[0];
            const unsupportedModeMessage =
              "当前电脑只支持随机抽样同步，全部好友同步需要在 Windows 桌面微信环境中执行。";
            const message =
              modeUnsupported
                ? unsupportedModeMessage
                : toPublicError(
                    blocker?.message ||
                      readiness.nextAction,
                    "当前环境未通过微信通讯录同步检查，请完成页面提示后重试。",
                  );
            setContactSyncError(
              message,
            );
            setContactSyncDiagnostics(
              readiness.diagnostics ||
                null,
            );
            addToast(
              {
                title:
                  "微信通讯录同步未开始",
                description:
                  modeUnsupported
                    ? "请切换到“随机抽样同步”，或在 Windows 电脑上使用“全部好友同步”。"
                    : message,
                color:
                  "warning",
              },
            );
            return syncedContacts;
          }
          const result =
            await localEngineApi.syncWechatContacts(
              {
                force: true,
                mode,
              },
            );
          const names =
            contactNamesFromResult(
              result,
            );
          setSyncedContacts(
            names,
          );
          setStructuredContacts(
            result.items ||
              [],
          );
          setContactSyncDiagnostics(
            result.diagnostics ||
              null,
          );
          setContactSyncError(
            "",
          );
          const diagnosticHint =
            result
              .diagnostics
              ?.pagesScanned
              ? `，扫描 ${result.diagnostics.pagesScanned} 页`
              : result
                    .diagnostics
                    ?.dbContactCount !==
                  undefined
                ? `，数据联系人 ${result.diagnostics.dbContactCount} 个`
                : "";
          const usedCacheFallback =
            Boolean(
              result.cached &&
                result.syncFallbackReason,
            );
          const diagnosticRisk =
            contactDiagnosticsRiskText(
              result.diagnostics,
            );
          const resultDbHelperRequired =
            isDbHelperRequiredContactSync(
              result.diagnostics,
              result.syncFallbackReason,
            );
          const fallbackNeedsContactPage =
            Boolean(
              result.syncFallbackReason &&
                !resultDbHelperRequired &&
                /没有停在微信通讯录页|不是微信通讯录|not-wechat-contacts-page|只识别到\s*\d+\s*个联系人|no-scrollable-container/i.test(
                  contactSyncErrorText(
                    result.syncFallbackReason,
                    result.diagnostics ||
                      null,
                  ),
                ),
            );
          const needsReview =
            Boolean(
              usedCacheFallback ||
              diagnosticRisk,
            );
          addToast(
            {
              title:
                names.length
                  ? usedCacheFallback
                    ? "已保留本地联系人"
                    : needsReview
                      ? mode ===
                        "all"
                        ? "全部好友同步需确认"
                        : "通讯录同步需确认"
                    : mode ===
                    "all"
                    ? "微信全部好友已同步"
                    : "微信通讯录已同步"
	                  : result.syncFallbackReason
	                    ? fallbackNeedsContactPage
	                      ? "需要打开微信通讯录页"
	                      : resultDbHelperRequired
	                        ? "微信通讯录暂未同步"
	                      : "微信通讯录同步失败"
	                    : "未读取到联系人",
              description:
                names.length
	                  ? usedCacheFallback
	                    ? contactSyncUserMessage(
	                        result.syncFallbackReason,
	                        result.diagnostics || null,
	                        {
	                          dbHelperRequired: resultDbHelperRequired,
	                          keptExistingList: true,
	                        },
	                      )
                    : diagnosticRisk
                      ? `读取到 ${names.length} 个联系人，但部分结果需要确认。`
                    : `通过${sourceLabel(result.source)}读取到 ${names.length} 个对象${diagnosticHint}。`
	                  : result.syncFallbackReason
	                    ? contactSyncUserMessage(
	                        result.syncFallbackReason,
	                        result.diagnostics || null,
	                        {
	                          contactPageMismatch: fallbackNeedsContactPage,
	                          dbHelperRequired: resultDbHelperRequired,
	                        },
	                      )
	                    : "请先在微信客户端刷新通讯录、切到通讯录页，再导出排查资料。",
              color:
                names.length
                  ? needsReview
                    ? "warning"
                    : "success"
                  : "warning",
            },
          );
          return names;
        } catch (error) {
          const rawMessage =
            error instanceof
            Error
              ? error.message
              : "";
          const diagnostics =
            contactSyncDiagnosticsFromError(
              error,
            );
          const errorDbHelperRequired =
            isDbHelperRequiredContactSync(
              diagnostics,
              rawMessage,
            );
          const contactPageMismatch =
            !errorDbHelperRequired &&
            /没有停在微信通讯录页|不是微信通讯录|not-wechat-contacts-page|只识别到\s*\d+\s*个联系人|no-scrollable-container/i.test(
              contactSyncErrorText(
                rawMessage,
                diagnostics,
              ),
            );
          const publicMessage =
            contactSyncUserMessage(
              error,
              diagnostics,
              {
                contactPageMismatch,
                dbHelperRequired: errorDbHelperRequired,
              },
            );
          setContactSyncError(
            publicMessage,
          );
          setContactSyncDiagnostics(
            diagnostics,
          );
          setSyncedContacts(
            [],
          );
          setStructuredContacts(
            [],
          );
          addToast(
            {
              title:
                contactPageMismatch
                  ? "需要打开微信通讯录页"
	                  : errorDbHelperRequired
	                    ? "微信通讯录暂未同步"
	                  : /数据库|DB helper|helper|解密|contact\.db|MicroMsg\.db/i.test(
	                        contactSyncErrorText(
	                          rawMessage,
                          diagnostics,
                        ),
	                      )
	                    ? "微信通讯录同步失败"
	                    : "微信通讯录同步失败",
	              description:
	                contactPageMismatch
	                  ? publicMessage
	                  : `${publicMessage}完整排查资料可以在页面里导出。`,
              color:
                contactPageMismatch
                  ? "warning"
                  : "danger",
            },
          );
          return [];
        } finally {
          setContactsLoading(
            false,
          );
        }
      },
      [
        contactSyncMode,
        syncedContacts,
      ],
    );

  const resetContactForm =
    React.useCallback(() =>{
      setContactEditingWxid(
        "",
      );
      setContactWxid(
        "",
      );
      setContactNickname(
        "",
      );
      setContactRemark(
        "",
      );
      setContactTags(
        "",
      );
    }, []);

  const editStructuredContact =
    React.useCallback(
      (
        contact: WechatContact,
      ) =>{
        setContactEditingWxid(
          contact.wxid,
        );
        setContactWxid(
          contact.wxid,
        );
        setContactNickname(
          contact.nickname ||
            "",
        );
        setContactRemark(
          contact.remark ||
            "",
        );
        setContactTags(
          (
            contact.tags ||
            []
          ).join(
            "、",
          ),
        );
      },
      [],
    );

  const saveStructuredContact =
    React.useCallback(async () =>{
      const wxid =
        contactWxid.trim();
      if (
        !wxid
      ) {
        addToast(
          {
            title:
              "请填写 wxid",
            description:
              "wxid 是联系人库去重和编辑的主键。",
            color:
              "warning",
          },
        );
        return;
      }
      setContactSaving(
        true,
      );
      try {
        const result =
          await localEngineApi.upsertWechatContact(
            {
              wxid,
              nickname:
                contactNickname.trim() ||
                undefined,
              remark:
                contactRemark.trim() ||
                undefined,
              tags: splitLines(
                contactTags,
              ),
            },
          );
        const names =
          contactNamesFromResult(
            result,
          );
        setSyncedContacts(
          names,
        );
        setStructuredContacts(
          result.items ||
            [],
        );
        resetContactForm();
        addToast(
          {
            title:
              contactEditingWxid
                ? "联系人已更新"
                : "联系人已新增",
            description: `联系人库当前 ${result.count ?? names.length} 个对象。`,
            color:
              "success",
          },
        );
      } catch (error) {
        addToast(
          {
            title:
              "联系人保存失败",
            description:
              shortToastDescription(
                error,
                "联系人未能保存，请稍后重试。",
              ),
            color:
              "danger",
          },
        );
      } finally {
        setContactSaving(
          false,
        );
      }
    }, [
      contactEditingWxid,
      contactNickname,
      contactRemark,
      contactTags,
      contactWxid,
      resetContactForm,
    ]);

  const removeStructuredContact =
    React.useCallback(
      async (
        wxid: string,
      ) =>{
        setContactSaving(
          true,
        );
        try {
          const result =
            await localEngineApi.removeWechatContact(
              wxid,
            );
          const names =
            contactNamesFromResult(
              result,
            );
          setSyncedContacts(
            names,
          );
          setStructuredContacts(
            result.items ||
              [],
          );
          if (
            contactEditingWxid ===
            wxid
          )
            resetContactForm();
          addToast(
            {
              title:
                "联系人已删除",
              description: `联系人库当前 ${result.count ?? names.length} 个对象。`,
              color:
                "success",
            },
          );
        } catch (error) {
          addToast(
            {
              title:
                "联系人删除失败",
              description:
                shortToastDescription(
                  error,
                  "联系人未能删除，请稍后重试。",
                ),
              color:
                "danger",
            },
          );
        } finally {
          setContactSaving(
            false,
          );
        }
      },
      [
        contactEditingWxid,
        resetContactForm,
      ],
    );

  const clearStructuredContacts =
    React.useCallback(async () =>{
      setContactSaving(
        true,
      );
      try {
        const result =
          await localEngineApi.clearWechatContacts();
        const names =
          contactNamesFromResult(
            result,
          );
        setSyncedContacts(
          names,
        );
        setStructuredContacts(
          result.items ||
            [],
        );
        resetContactForm();
        addToast(
          {
            title:
              "联系人库已清空",
            description:
              "本地结构化联系人已清空。",
            color:
              "success",
          },
        );
      } catch (error) {
        addToast(
          {
            title:
              "联系人清空失败",
            description:
              shortToastDescription(
                error,
                "联系人列表未能清空，请稍后重试。",
              ),
            color:
              "danger",
          },
        );
      } finally {
        setContactSaving(
          false,
        );
      }
    }, [
      resetContactForm,
    ]);

  const exportStructuredContacts =
    React.useCallback(async () =>{
      setContactSaving(
        true,
      );
      try {
        const result =
          await localEngineApi.exportWechatContacts();
        const blob =
          new Blob(
            [
              result.content,
            ],
            {
              type:
                result.mimeType ||
                "text/csv;charset=utf-8",
            },
          );
        const url =
          URL.createObjectURL(
            blob,
          );
        const link =
          document.createElement(
            "a",
          );
        link.href =
          url;
        link.download =
          result.filename ||
          "wechat-contacts.csv";
        document.body.appendChild(
          link,
        );
        link.click();
        link.remove();
        URL.revokeObjectURL(
          url,
        );
        addToast(
          {
            title:
              "联系人已导出",
            description: `已导出 ${result.count} 个对象。`,
            color:
              "success",
          },
        );
      } catch (error) {
        addToast(
          {
            title:
              "联系人导出失败",
            description:
              shortToastDescription(
                error,
                "联系人未能导出，请稍后重试。",
              ),
            color:
              "danger",
          },
        );
      } finally {
        setContactSaving(
          false,
        );
      }
    }, []);

  const exportContactSyncDiagnostics =
    React.useCallback(async () =>{
      setContactSaving(
        true,
      );
      try {
        const result =
          await localEngineApi.exportWechatContactSyncDiagnostics();
        const blob =
          new Blob(
            [
              result.content ||
                "{}",
            ],
            {
              type:
                result.mimeType ||
                "application/json",
            },
          );
        const url =
          URL.createObjectURL(
            blob,
          );
        const link =
          document.createElement(
            "a",
          );
        link.href =
          url;
        link.download =
          result.filename ||
          "wechat-contact-sync-diagnostics.json";
        link.click();
        URL.revokeObjectURL(
          url,
        );
        addToast(
          {
            title:
              result.exists
                ? "排查资料已导出"
                : "暂无失败排查资料",
            description:
              result.exists
                ? "已导出最近一次微信通讯录同步失败排查资料。"
                : "当前还没有同步失败排查记录。",
            color:
              result.exists
                ? "success"
                : "warning",
          },
        );
      } catch (error) {
        addToast(
          {
            title:
              "排查资料导出失败",
            description:
              shortToastDescription(
                error,
                "排查资料未能导出，请稍后重试。",
              ),
            color:
              "danger",
          },
        );
      } finally {
        setContactSaving(
          false,
        );
      }
    }, []);

  const loadChatHistory =
    React.useCallback(
      async (
        sessionId: string,
      ) =>{
        if (
          !sessionId
        ) {
          setChatHistoryResult(
            null,
          );
          return null;
        }
        setChatHistoryLoading(
          true,
        );
        try {
          const result =
            await localEngineApi.wechatChatHistory(
              sessionId,
              100,
            );
          setChatHistoryResult(
            result,
          );
          return result;
        } catch (error) {
          setChatHistoryResult(
            null,
          );
          addToast(
            {
              title:
                "会话历史读取失败",
              description:
                toPublicError(
                  error,
                  "会话历史暂时无法读取，请稍后重试。",
                ),
              color:
                "danger",
            },
          );
          return null;
        } finally {
          setChatHistoryLoading(
            false,
          );
        }
      },
      [],
    );

  const loadChatSessions =
    React.useCallback(async () =>{
      setChatSessionsLoading(
        true,
      );
      try {
        const result =
          await localEngineApi.wechatChatSessions();
        setChatSessionsResult(
          result,
        );
        setSelectedChatSessionId(
          (
            current,
          ) =>{
            const nextSessionId =
              result.sessions.some(
                (
                  session,
                ) =>
                  session.id ===
                  current,
              )
                ? current
                : result
                    .sessions[0]
                    ?.id ||
                  "";
            if (
              !nextSessionId
            )
              setChatHistoryResult(
                null,
              );
            return nextSessionId;
          },
        );
        return result;
      } catch (error) {
        setChatSessionsResult(
          null,
        );
        setSelectedChatSessionId(
          "",
        );
        setChatHistoryResult(
          null,
        );
        addToast(
          {
            title:
              "会话列表读取失败",
            description:
              toPublicError(
                error,
                "微信会话列表暂时无法读取，请稍后重试。",
              ),
            color:
              "danger",
          },
        );
        return null;
      } finally {
        setChatSessionsLoading(
          false,
        );
      }
    }, []);

  const syncChatHistory =
    React.useCallback(async () =>{
      setChatSyncLoading(
        true,
      );
      try {
        const result =
          await localEngineApi.syncWechatChatHistory(
            {
              force: true,
              sessionId:
                selectedChatSessionId ||
                undefined,
              limit: 100,
              operator:
                "wechat-workbench",
              note: "workbench manual sync",
            },
          );
        setChatSessionsResult(
          result,
        );
        const nextSessionId =
          result.sessions.some(
            (
              session,
            ) =>
              session.id ===
              selectedChatSessionId,
          )
            ? selectedChatSessionId
            : result
                .sessions[0]
                ?.id ||
              "";
        setSelectedChatSessionId(
          nextSessionId,
        );
        if (
          !nextSessionId
        )
          setChatHistoryResult(
            null,
          );
        addToast(
          {
            title:
              result.ok
                ? "会话历史同步完成"
                : "会话历史同步受阻",
            description:
              result.ok
                ? "微信会话历史已刷新。"
                : toPublicError(
                    result.message || result.blockers[0],
                    "会话历史暂未同步，请检查微信状态后重试。",
                  ),
            color:
              result.ok
                ? "success"
                : "warning",
          },
        );
        return result;
      } catch (error) {
        addToast(
          {
            title:
              "会话历史同步失败",
            description:
              toPublicError(
                error,
                "会话历史未能同步，请检查微信状态后重试。",
              ),
            color:
              "danger",
          },
        );
        return null;
      } finally {
        setChatSyncLoading(
          false,
        );
      }
    }, [
      selectedChatSessionId,
    ]);

  React.useEffect(() =>{
    void refreshAgentSStatus();
  }, [
    refreshAgentSStatus,
  ]);

  React.useEffect(() =>{
    void loadSyncedContacts();
  }, [
    loadSyncedContacts,
  ]);

  React.useEffect(() =>{
    void loadPlans();
  }, [
    loadPlans,
  ]);

  React.useEffect(() =>{
    void loadChatSessions();
  }, [
    loadChatSessions,
  ]);

  React.useEffect(() =>{
    if (
      selectedChatSessionId
    )
      void loadChatHistory(
        selectedChatSessionId,
      );
  }, [
    loadChatHistory,
    selectedChatSessionId,
  ]);

  const runPlanAction =
    React.useCallback(
      async (
        task: InteractionTask,
        action: WechatPlanAction,
      ) =>{
        setPlanActionId(
          `${task.id}:${action}`,
        );
        try {
          if (
            task.type ===
            "wechat-group-broadcast"
          ) {
            if (
              action ===
              "continue"
            ) {
              if (task.status === "waiting_for_send_confirmation") {
                await localEngineApi.approveTask(task.id, {
                  operator: "当前登录用户",
                  currentWindowConfirmed: true,
                  contactConfirmed: true,
                  draftBeforeFillConfirmed: true,
                  targetContact: task.targetName,
                  targetConfirmed: true,
                  contentConfirmed: true,
                  checklistConfirmed: true,
                  commercialPermissionConfirmed:
                    task.safetyBoundary?.permissionStatus === "allowed",
                  misfireProtectionConfirmed: true,
                  doubleConfirmationConfirmed: true,
                  riskConfirmation: buildLocalEngineRiskConfirmation(
                    "interaction-approval",
                    task.riskLevel || "high",
                    `用户确认启动微信群发计划：${task.planName || task.id}`,
                  ),
                });
              } else {
                await localEngineApi.continueTask(task.id);
              }
            }
            if (
              action ===
              "pause"
            )
              await localEngineApi.pauseGroupBroadcastPlan(
                task.id,
              );
            if (action === "resume") {
              const approval =
                await localEngineApi.createGroupBroadcastResumeConfirmation(
                  task.id,
                );
              await localEngineApi.resumeGroupBroadcastPlan(task.id, {
                riskConfirmation: {
                  ...buildLocalEngineRiskConfirmation(
                    "interaction-resume",
                    "high",
                    `用户确认恢复微信群发计划：${task.planName || task.id}`,
                  ),
                  confirmationId: approval.confirmationId,
                },
              });
            }
            if (
              action ===
              "retry"
            ) {
              const retryableTargets = retryableTargetsForPlan(task);
              await localEngineApi.resendGroupBroadcastPlan(
                task.id,
                {
                  targetIds: retryableTargets.map((target) => target.id),
                  onlyFailed:
                    !retryableTargets.length && task.status === "failed",
                  riskConfirmation:
                    buildLocalEngineRiskConfirmation(
                      "interaction-approval",
                      task.riskLevel ||
                        "high",
                      `用户确认仅重发失败或未发送对象：${task.planName || task.id}`,
                    ),
                },
              );
            }
            if (
              action ===
              "delete"
            )
              await localEngineApi.removeGroupBroadcastPlan(
                task.id,
              );
          } else {
            if (
              action ===
              "continue"
            ) {
              if (task.status === "waiting_for_send_confirmation") {
                await localEngineApi.approveTask(task.id, {
                  operator: "当前登录用户",
                  currentWindowConfirmed: true,
                  contactConfirmed: true,
                  draftBeforeFillConfirmed: true,
                  targetContact: task.targetName,
                  targetConfirmed: true,
                  contentConfirmed: true,
                  checklistConfirmed: true,
                  commercialPermissionConfirmed:
                    task.safetyBoundary?.permissionStatus === "allowed",
                  misfireProtectionConfirmed: true,
                  doubleConfirmationConfirmed: true,
                  riskConfirmation: buildLocalEngineRiskConfirmation(
                    "interaction-approval",
                    task.riskLevel || "high",
                    `用户确认启动微信任务：${task.planName || task.id}`,
                  ),
                });
              } else {
                await localEngineApi.continueTask(task.id);
              }
            }
            if (
              action ===
              "pause"
            )
              await localEngineApi.pauseTask(
                task.id,
              );
            if (action === "resume") {
              const approval =
                await localEngineApi.createTaskResumeConfirmation(task.id);
              await localEngineApi.resumeTask(task.id, {
                riskConfirmation: {
                  ...buildLocalEngineRiskConfirmation(
                    "interaction-resume",
                    "high",
                    `用户确认恢复微信任务：${task.planName || task.id}`,
                  ),
                  confirmationId: approval.confirmationId,
                },
              });
            }
            if (
              action ===
              "retry"
            ) {
              const retryableTargets = retryableTargetsForPlan(task);
              await localEngineApi.retryTask(
                task.id,
                retryableTargets.length
                  ? { targetIds: retryableTargets.map((target) => target.id) }
                  : { onlyFailed: task.status === "failed" },
              );
            }
            if (
              action ===
              "delete"
            )
              await localEngineApi.skipTask(
                task.id,
              );
          }
          const actionMessage: Record<WechatPlanAction, { title: string; description: string }> = {
            continue: {
              title: "已请求开始执行",
              description: "本机微信正在处理，看到发送结果前不计为已发送。",
            },
            pause: {
              title: "计划已暂停",
              description: "后续未开始的对象不会继续处理。",
            },
            resume: {
              title: "已请求恢复",
              description: "本机微信重新开始前会先检查当前状态。",
            },
            retry: {
              title: "已请求重新执行",
              description: "只重试失败或明确排队未发送的对象，已完成对象不会重复发送。",
            },
            delete: {
              title: "计划已移除",
              description: "已移除尚未执行的计划内容。",
            },
          };
          addToast({
            ...actionMessage[action],
            color: "success",
          });
          await loadPlans();
        } catch (error) {
          addToast(
            {
              title:
                "计划操作失败",
              description:
                toPublicError(
                  error,
                  "计划操作未完成，请稍后重试。",
                ),
              color:
                "danger",
            },
          );
        } finally {
          setPlanActionId(
            "",
          );
        }
      },
      [
        loadPlans,
      ],
    );

  const requestPlanAction = React.useCallback(
    (task: InteractionTask, action: WechatPlanAction) => {
      if (action === "continue" || action === "retry" || action === "delete") {
        setPendingPlanAction({ task, action });
        return;
      }
      void runPlanAction(task, action);
    },
    [runPlanAction],
  );

  const confirmPlanAction = React.useCallback(async () => {
    if (!pendingPlanAction || planActionId) return;
    await runPlanAction(pendingPlanAction.task, pendingPlanAction.action);
    setPendingPlanAction(null);
  }, [pendingPlanAction, planActionId, runPlanAction]);

  const pendingPlanActionMeta = pendingPlanAction
    ? planActionConfirmationMeta(pendingPlanAction)
    : null;

  const runWechatTask =
    React.useCallback(
      async (
        request: InteractionSkillRunRequest,
      ) =>{
        setRunningSkill(
          request.skillId,
        );
        try {
          const knowledgeContext =
            await resolveKaypalKnowledgeContext(
              {
                query:
                  [
                    request.sessionName,
                    request.instruction,
                    JSON.stringify(
                      request.metadata ||
                        {},
                    ),
                  ]
                    .filter(
                      Boolean,
                    )
                    .join(
                      "\n",
                    ),
                limit: 3,
              },
            ).catch(
              () =>
                "",
            );
          const instruction =
            appendKaypalKnowledgeContext(
              request.instruction,
              knowledgeContext,
            );
          const planTitle =
            taskTitle(
              request,
            );
          const metadata: Record<string, unknown> =
            {
              ...(request.metadata ||
                {}),
              agent_s_instruction:
                instruction,
              agent_s_labels:
                request.labels,
              local_controller_permission_mode:
                request.localControllerPermissionMode,
              wechat_plan_name: `${planTitle} ${new Date().toLocaleString("zh-CN", { hour12: false })}`,
            };
          const targets =
            targetListForRequest(
              request,
            );
          const targetRequirementMessage =
            targetRequirementMessageForRequest(
              request,
              targets,
            );
          if (
            targetRequirementMessage
          ) {
            addToast(
              {
                title:
                  "缺少任务目标",
                description:
                  targetRequirementMessage,
                color:
                  "warning",
              },
            );
            return;
          }
          const route =
            routeForWechatSkill(
              request.skillId,
            );
          const type =
            typeForWechatSkill(
              request.skillId,
            );
          const replyText =
            metadataText(
              metadata,
              "wechat_reply_draft",
            ) ||
            metadataText(
              metadata,
              "wechat_moments_content",
            ) ||
            metadataText(
              metadata,
              "wechat_moments_marketing_content",
            ) ||
            metadataText(
              metadata,
              "wechat_contact_add_verify_message",
            ) ||
            metadataText(
              metadata,
              "wechat_friend_accept_welcome_message",
            );
          const targetName =
            targets[0] ||
            planTitle;
          const dailyPublished =
            firstMetadataNumber(
              metadata,
              [
                "dailyPublished",
                "wechat_moments_daily_published",
              ],
            );
          const dailyQuota =
            firstMetadataNumber(
              metadata,
              [
                "dailyQuota",
                "wechat_moments_daily_quota",
              ],
            );
          const scheduleStartTime =
            firstMetadataText(
              metadata,
              [
                "scheduleStartTime",
                "wechat_moments_schedule_start_time",
              ],
            );
          const autoLike =
            metadataBoolean(
              metadata,
              "autoLike",
            ) ??
            metadataBoolean(
              metadata,
              "wechat_moments_auto_like",
            );
          const autoComment =
            metadataBoolean(
              metadata,
              "autoComment",
            ) ??
            metadataBoolean(
              metadata,
              "wechat_moments_auto_comment",
            );
          const prompts =
            metadataPrompts(
              metadata,
            );
          const requestedPlanType =
            firstMetadataText(
              metadata,
              [
                "planType",
                "wechat_mass_send_plan_type",
              ],
            );
          const requestedPlanTime =
            firstMetadataText(
              metadata,
              [
                "planTime",
                "wechat_plan_time",
                "scheduledAt",
                "scheduleStartTime",
              ],
            );
          const isScheduledRequest =
            requestedPlanType ===
            "scheduled";
          const massSendContents = Array.isArray(
            metadata.wechat_mass_send_contents,
          )
            ? metadata.wechat_mass_send_contents
                .map((item) => {
                  if (!item || typeof item !== "object") return null;
                  const record = item as Record<string, unknown>;
                  const itemTarget =
                    typeof record.targetName === "string"
                      ? record.targetName.trim()
                      : "";
                  const itemMessage =
                    typeof record.sendContent === "string"
                      ? record.sendContent.trim()
                      : "";
                  return itemTarget && itemMessage
                    ? { target: itemTarget, message: itemMessage }
                    : null;
                })
                .filter(
                  (
                    item,
                  ): item is { target: string; message: string } =>
                    Boolean(item),
                )
            : [];
          const createInput: CreateInteractionTaskInput =
            {
              type,
              accountId:
                "local-wechat-desktop",
              accountName:
                "本机微信",
              platformName:
                "微信桌面",
              targetName,
              sourceText:
                instruction,
              replyText,
              metadata,
              planName:
                metadataText(
                  metadata,
                  "wechat_plan_name",
                ),
              planTime:
                requestedPlanTime ||
                undefined,
              planStatus:
                isScheduledRequest
                  ? "scheduled"
                  : undefined,
              dailyLimit:
                firstMetadataNumber(
                  metadata,
                  [
                    "wechat_daily_limit",
                    "wechat_group_daily_limit",
                    "wechat_contact_add_daily_limit",
                    "wechat_moments_marketing_daily_limit",
                    "dailyLimit",
                    "daily_limit",
                    "dailyViewLimit",
                  ],
                ),
              associatedWeChat:
                firstMetadataText(
                  metadata,
                  [
                    "associatedWeChat",
                    "associated_wechat",
                    "wechat_plan_associated_wechat_id",
                    "plannedWechatId",
                    "planned_wechat_id",
                  ],
                ) ||
                undefined,
              dailyPublished,
              dailyQuota,
              scheduleStartTime:
                scheduleStartTime ||
                undefined,
              autoLike,
              autoComment,
              prompts,
              sendMode:
                request.commercialExecutionRequested
                  ? "auto-send"
                  : "approval-send",
              commercialExecutionRequested:
                request.commercialExecutionRequested,
              batchTargets:
                targets.map(
                  (
                    target,
                  ) => {
                    const personalized = massSendContents.find(
                      (item) => item.target === target,
                    );
                    return {
                      targetName:
                        target,
                      sourceText:
                        instruction,
                      replyText:
                        personalized?.message || replyText,
                    };
                  },
                ),
            };
          let createdTask: InteractionTask;
          if (
            type ===
            "wechat-group-broadcast"
          ) {
            createdTask = await localEngineApi
              .createGroupBroadcastPlan(
                createInput,
              )
              .catch(
                () =>
                  localEngineApi.createBusinessTask(
                    route,
                    createInput,
                  ),
              );
          } else {
            createdTask = await localEngineApi.createBusinessTask(
              route,
              createInput,
            );
          }
          const isScheduled =
            createdTask.planStatus === "scheduled" ||
            isScheduledRequest;
          if (isScheduled) {
            addToast({
              title: `${taskTitle(request)}计划已保存`,
              description: "等待计划时间；此刻还没有发送。",
              color: "success",
            });
            await loadPlans();
            return;
          }

          addToast({
            title: `${taskTitle(request)}已进入统一执行链`,
            description:
              "任务已交给 AI 员工处理；只有看到逐对象结果后才计为完成。",
            color: "success",
          });
          await loadPlans();
        } catch (error) {
          addToast(
            {
              title: `${taskTitle(request)}计划创建失败`,
              description:
                toPublicError(
                  error,
                  "微信计划未能创建，请稍后重试。",
                ),
              color:
                "danger",
            },
          );
        } finally {
          setRunningSkill(
            "",
          );
        }
      },
      [loadPlans],
    );

  const busy =
    agentS.agentSBusy ||
    Boolean(
      runningSkill,
    );
  const selectedContactSyncUnsupported =
    contactSyncMode ===
      "all" &&
    contactReadiness?.modeSupport.all ===
      false;
  const contactSyncUnavailableReason =
    selectedContactSyncUnsupported
      ? "当前环境不支持全部好友同步，请切换随机同步或在 Windows 桌面微信环境执行。"
      : "";
  const canStartContactSync =
    !contactsLoading &&
    !selectedContactSyncUnsupported;
  const groupBroadcastTargets =
    groupMessageMode === "personalized"
      ? parsePersonalizedMessages(groupPersonalizedMessages).map(
          (item) => item.target,
        )
      : splitLines(
          groupTargets,
        );
  const personalizedMessages = parsePersonalizedMessages(
    groupPersonalizedMessages,
  );
  const canCreateGroupBroadcast =
    groupBroadcastTargets.length >
      0 &&
    (groupMessageMode === "personalized"
      ? personalizedMessages.length === groupBroadcastTargets.length
      : Boolean(
          groupMessage.trim(),
        )) &&
    !busy;
  const momentsAssetValidationError =
    momentsAssetPath.trim()
      ? validateMomentsAssets(
          momentsAssetPath,
        )
      : "";
  const canStartMomentsPublish =
    Boolean(
      momentsContent.trim() &&
      momentsAssetPath.trim() &&
      !momentsAssetValidationError,
    ) &&
    !busy;
  const contactAddTargets =
    splitLines(
      contactTargets,
    );
  const canCreateContactAdd =
    contactAddTargets.length >
      0 &&
    Boolean(
      contactVerifyMessage.trim(),
    ) &&
    !busy;
  const marketingTargetContacts =
    splitLines(
      marketingContacts,
    );
  const hasMarketingAction =
    marketingLike ||
    marketingComment;
  const hasRequiredMarketingTargets =
    marketingMode !==
      "targeted" ||
    marketingTargetContacts.length >
      0;
  const hasRequiredMarketingComment =
    !marketingComment ||
    marketingCommentMode !==
      "fixed" ||
    Boolean(
      marketingFixedComment.trim(),
    );
  const canCreateMarketingPlan =
    hasMarketingAction &&
    hasRequiredMarketingTargets &&
    hasRequiredMarketingComment &&
    !busy;
  const filteredPlans =
    plans.filter(
      (
        task,
      ) =>
        taskMatchesFilter(
          task,
          planFilter,
        ),
    );
  const activeModuleInfo =
    WECHAT_MODULES.find(
      (
        item,
      ) =>
        item.key ===
        activeModule,
    ) ||
    WECHAT_MODULES[0];
  const activePlans =
    activeModuleInfo.planFilter
      ? filteredPlans
      : filteredPlans;
  const safelyRunWechatTask =
    React.useCallback(
      (
        buildRequest: () => InteractionSkillRunRequest,
        title = "创建任务失败",
      ) =>{
        try {
          void runWechatTask(
            buildRequest(),
          );
        } catch (error) {
          addToast(
            {
              title,
              description:
                toPublicError(
                  error,
                  "任务配置未通过检查，请核对填写内容。",
                ),
              color:
                "warning",
            },
          );
        }
      },
      [
        runWechatTask,
      ],
    );
  const startContactSyncAfterRisk =
    () =>{
      setRiskModal(
        "",
      );
      if (
        !canStartContactSync
      ) {
        addToast(
          {
            title:
              "当前同步方式不可用",
            description:
              contactSyncUnavailableReason ||
              "通讯录正在同步，请稍后再试。",
            color:
              "warning",
          },
        );
        return;
      }
      void syncWechatContacts(
        contactSyncMode,
      );
    };
  const openContactsModule =
    React.useCallback(() =>{
      setActiveModule(
        "contacts",
      );
      setPlanFilter(
        "all",
      );
      window.setTimeout(
        () =>{
          document
            .getElementById(
              "wechat-contacts-manager",
            )
            ?.scrollIntoView(
              {
                behavior:
                  "smooth",
                block:
                  "start",
              },
            );
        },
        0,
      );
    }, []);
  const createContactAddAfterRisk =
    () =>{
      const targets =
        contactAddTargets;
      if (
        !targets.length
      ) {
        addToast(
          {
            title:
              "缺少加好友目标",
            description:
              "请先在号码列表里输入手机号或微信号，再创建任务。",
            color:
              "warning",
          },
        );
        setRiskModal(
          "",
        );
        return;
      }
      try {
        const request =
          wechatContactAddSkill.buildRunRequest(
            {
              mode,
              planName:
                contactPlanName,
              targets,
              verifyMessage:
                contactVerifyMessage,
              dailyLimit:
                numberFrom(
                  contactDailyLimit,
                  10,
                ),
              minIntervalSeconds:
                numberFrom(
                  contactMinIntervalSeconds,
                  180,
                ),
              maxIntervalSeconds:
                numberFrom(
                  contactMaxIntervalSeconds,
                  36000,
                ),
              remarkStrategy:
                contactRemarkStrategy,
              remarkContent:
                contactRemarkContent,
              blacklist:
                splitLines(
                  contactBlacklist,
                ),
              context:
                contactContext,
            },
          );
        setRiskModal(
          "",
        );
        void runWechatTask(
          request,
        );
      } catch (error) {
        addToast(
          {
            title:
              "创建任务失败",
            description:
              toPublicError(
                error,
                "加好友任务未能创建，请检查当前配置。",
              ),
            color:
              "danger",
          },
        );
        setRiskModal(
          "",
        );
      }
    };
  return (
    <div className="flex flex-col gap-4">
      
      <div className="flex flex-wrap items-start justify-between gap-3">
        
        <div>
          
          <h1 className="text-[22px] font-bold leading-[30px]">
            微信任务
          </h1><p className="text-sm text-default-500">
            群发、加好友、朋友圈和联系人统一在这里处理。
          </p>
        </div><div className="flex flex-wrap gap-2">
          <Chip
            color={
              agentS
                .agentSStatus
                ?.connected
                ? "success"
                : "default"
            }
            variant="flat"
          >
            本机助手：
            {agentS
              .agentSStatus
              ?.connected
              ? "已连接"
              : "未连接"}</Chip><Button
            as={
              Link
            }
            href="/local-engine?tab=desktop"
            variant="flat"
          >
            桌面权限
          </Button><Button
            as={
              Link
            }
            href="/local-engine?tab=tasks"
            variant="flat"
          >
            任务记录
          </Button><Button
            color={
              agentS
                .agentSStatus
                ?.connected
                ? "danger"
                : "primary"
            }
            variant="flat"
            isLoading={
              agentS.agentSBusy &&
              !runningSkill
            }
            onPress={() =>
              agentS
                .agentSStatus
                ?.connected
                ? void agentS.stopAgentS()
                : void agentS.startAgentS()
            }
          >{agentS
              .agentSStatus
              ?.connected
              ? "停止助手"
              : "启动助手"}</Button>
        </div>
      </div>{agentS.agentSError ? (
        <Card className="border border-danger-200 bg-danger-50">
          
          <CardBody className="text-sm text-danger-700">{
              agentS.agentSError
            }</CardBody>
        </Card>
      ) : null}<div className="grid gap-4 xl:grid-cols-[280px_1fr]">
        
        <Card>
          
          <CardBody className="gap-3">
            
            <div
              aria-label="微信任务模块"
              className="grid gap-2"
              role="tablist"
            >
              {WECHAT_MODULES.map(
                (
                  item,
                ) => (
                  <button
                    key={
                      item.key
                    }
                    id={`wechat-module-tab-${item.key}`}
                    aria-controls="wechat-module-panel"
                    aria-selected={activeModule === item.key}
                    role="tab"
                    tabIndex={activeModule === item.key ? 0 : -1}
                    type="button"
                    className={[
                      "flex min-h-[64px] flex-col justify-center rounded-[8px] border px-3 py-3 text-left transition",
                      activeModule ===
                      item.key
                        ? "border-primary-300 bg-primary-50 text-primary-800"
                        : "border-default-200 bg-background hover:bg-default-50",
                    ].join(
                      " ",
                    )}
                    onClick={() =>{
                      setActiveModule(
                        item.key,
                      );
                      if (
                        item.planFilter
                      )
                        setPlanFilter(
                          item.planFilter,
                        );
                    }}
                    onKeyDown={(event) =>
                      handleRovingChoiceKeyDown(
                        event,
                        WECHAT_MODULES.map((module) => module.key),
                        item.key,
                        (nextKey) => {
                          setActiveModule(nextKey);
                          const nextModule = WECHAT_MODULES.find(
                            (module) => module.key === nextKey,
                          );
                          if (nextModule?.planFilter) {
                            setPlanFilter(nextModule.planFilter);
                          }
                        },
                      )
                    }
                  >
                    
                    <p className="text-sm font-semibold">{
                        item.label
                      }</p><p className="mt-1 text-xs leading-5 text-default-500">{
                        item.desc
                      }</p>
                  </button>
                ),
              )}</div><div className="rounded-[8px] border border-default-200 bg-default-50 p-3">
              
              <p id="wechat-send-mode-label" className="text-sm font-semibold">
                发送方式
              </p><div
                aria-labelledby="wechat-send-mode-label"
                className="mt-2 grid gap-2"
                role="radiogroup"
              >
                {WECHAT_MODE_OPTIONS.map(
                  (
                    item,
                  ) => (
                    <Button
                      key={
                        item
                      }
                      aria-checked={mode === item}
                      role="radio"
                      tabIndex={mode === item ? 0 : -1}
                      size="sm"
                      color={
                        mode ===
                        item
                          ? "primary"
                          : "default"
                      }
                      variant={
                        mode ===
                        item
                          ? "solid"
                          : "flat"
                      }
                      onPress={() =>
                        setMode(
                          item,
                        )
                      }
                      onKeyDown={(event) =>
                        handleRovingChoiceKeyDown(
                          event,
                          WECHAT_MODE_OPTIONS,
                          item,
                          setMode,
                        )
                      }
                    >{runModeLabel(
                        item,
                      )}</Button>
                  ),
                )}</div><div className="mt-3 rounded-[8px] border border-default-200 bg-background p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <ShieldCheck aria-hidden="true" className="h-4 w-4 text-default-500" />
                    <Chip color={runModeMeta(mode).color} size="sm" variant="flat">
                      {runModeMeta(mode).label}
                    </Chip>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-default-600">
                    {runModeMeta(mode).description}
                  </p>
                </div>
            </div>
          </CardBody>
        </Card><div
          id="wechat-module-panel"
          aria-labelledby={`wechat-module-tab-${activeModule}`}
          className="flex min-w-0 flex-col gap-4"
          role="tabpanel"
        >
          
          <Card>
            
            <CardBody className="gap-3">
              
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                
                <PanelTitle
                  title={
                    activeModuleInfo.label
                  }
                  desc={
                    activeModuleInfo.desc
                  }
                />
                <div className="grid w-full gap-2 lg:w-auto">
                  
                  <ContactSyncModeChooser
                    value={
                      contactSyncMode
                    }
                    onChange={
                      setContactSyncMode
                    }
                    disabledModes={
                      contactReadiness?.modeSupport.all ===
                      false
                        ? [
                            "all",
                          ]
                        : []
                    }
                    compact
                  />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button
                      variant="flat"
                      isLoading={
                        contactsLoading
                      }
                      isDisabled={
                        !canStartContactSync
                      }
                      startContent={
                        <RefreshCcw
                          size={
                            16
                          }
                        />
                      }
                      onPress={() =>
                        setRiskModal(
                          "contact-sync",
                        )
                      }
                    >
                      同步联系人
                    </Button><Button
                      variant="flat"
                      isLoading={
                        plansLoading
                      }
                      isDisabled={
                        plansLoading
                      }
                      startContent={
                        <RefreshCcw
                          size={
                            16
                          }
                        />
                      }
                      onPress={() =>
                        void loadPlans()
                      }
                    >
                      刷新计划
                    </Button>
                  </div>
                </div>
              </div>{activeModule ===
              "mass-send" ? (
                <div className="grid gap-4 xl:grid-cols-[560px_minmax(0,1fr)]">
                  
                  <div className="grid content-start gap-4">
                    
                    <div className="rounded-[8px] border border-default-200 bg-background p-4">
                      
                      <p className="mb-3 text-sm font-semibold text-default-900">
                        计划设置
                      </p><div className="grid gap-3 sm:grid-cols-2">
                        
                        <div className="sm:col-span-2">
                          <Input
                            label="计划名称"
                            value={
                              groupPlanName
                            }
                            onValueChange={
                              setGroupPlanName
                            }
                          />
                        </div><Button
                          className="h-12"
                          color={
                            groupPlanType ===
                            "immediate"
                              ? "primary"
                              : "default"
                          }
                          variant={
                            groupPlanType ===
                            "immediate"
                              ? "solid"
                              : "flat"
                          }
                          onPress={() =>
                            setGroupPlanType(
                              "immediate",
                            )
                          }
                        >
                          
                          立即执行
                        </Button><Button
                          className="h-12"
                          color={
                            groupPlanType ===
                            "scheduled"
                              ? "primary"
                              : "default"
                          }
                          variant={
                            groupPlanType ===
                            "scheduled"
                              ? "solid"
                              : "flat"
                          }
                          onPress={() =>
                            setGroupPlanType(
                              "scheduled",
                            )
                          }
                        >
                          
                          定时计划
                        </Button><div className="sm:col-span-2">
                          <Input
                            label="计划时间"
                            labelPlacement="outside"
                            value={
                              groupPlanTime
                            }
                            onValueChange={
                              setGroupPlanTime
                            }
                            placeholder="定时计划时填写，例如 2026-06-25 10:30"
                          />
                        </div>
                      </div>
                    </div><div className="rounded-[8px] border border-default-200 bg-background p-4">
                      <SyncedContactsTools
                        count={
                          syncedContacts.length
                        }
                        loading={
                          contactsLoading
                        }
                        contacts={
                          syncedContacts
                        }
                        diagnostics={
                          contactSyncDiagnostics
                        }
                        error={
                          contactSyncError
                        }
                        syncDisabled={
                          !canStartContactSync
                        }
                        syncDisabledReason={
                          contactSyncUnavailableReason
                        }
                        onRefresh={() =>
                          setRiskModal(
                            "contact-sync",
                          )
                        }
                        onFill={() =>
                          setGroupTargets(
                            syncedContacts.join(
                              "\n",
                            ),
                          )
                        }
                        onAppend={() =>
                          setGroupTargets(
                            (
                              current,
                            ) =>
                              mergeListText(
                                current,
                                syncedContacts,
                              ),
                          )
                        }
                        onOpenContacts={
                          openContactsModule
                        }
                        onExportDiagnostics={() =>
                          void exportContactSyncDiagnostics()
                        }
                      />
                    </div><div className="rounded-[8px] border border-default-200 bg-background p-4">
                      
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-default-900">
                          发送对象
                        </p><div className="flex gap-2">
                          <Button
                            size="sm"
                            color={groupMessageMode === "ordinary" ? "primary" : "default"}
                            variant={groupMessageMode === "ordinary" ? "solid" : "flat"}
                            onPress={() => setGroupMessageMode("ordinary")}
                          >
                            统一文案
                          </Button><Button
                            size="sm"
                            color={groupMessageMode === "personalized" ? "primary" : "default"}
                            variant={groupMessageMode === "personalized" ? "solid" : "flat"}
                            onPress={() => setGroupMessageMode("personalized")}
                          >
                            逐人文案
                          </Button>
                        </div>
                      </div>{groupMessageMode === "personalized" ? (
                        <Textarea
                          label="对象与文案"
                          value={groupPersonalizedMessages}
                          onValueChange={setGroupPersonalizedMessages}
                          minRows={10}
                          placeholder={"张三｜张三你好，明天下午方便沟通吗？\n李四｜李四你好，给你留了新的资料。"}
                        />
                      ) : (
                        <Textarea
                          value={
                            groupTargets
                          }
                          onValueChange={
                            setGroupTargets
                          }
                          minRows={
                            10
                          }
                          placeholder="搜索联系人或群聊；也可以每行一个联系人/群聊"
                        />
                      )}
                      {!groupBroadcastTargets.length ? (
                        <p className="mt-2 text-xs leading-5 text-warning-600">
                          {groupMessageMode === "personalized"
                            ? "每行填写“对象｜文案”后才能保存计划。"
                            : "至少填入 1 个联系人或群聊后才能保存群发计划。"}
                        </p>
                      ) : null}
                    </div>
                  </div><div className="flex flex-col gap-3">
                    {groupMessageMode === "ordinary" ? (
                      <Textarea
                        label="群发内容"
                        value={
                          groupMessage
                        }
                        onValueChange={
                          setGroupMessage
                        }
                        minRows={
                          6
                        }
                        placeholder="请输入群发内容"
                      />
                    ) : (
                      <div className="rounded-[8px] border border-default-200 bg-default-50 p-3 text-xs leading-5 text-default-600">
                        已为 {personalizedMessages.length} 个对象准备专属文案。发送前会逐条核对对象和内容。
                      </div>
                    )}{groupMessageMode === "ordinary" && !groupMessage.trim() ? (
                      <p className="text-xs leading-5 text-warning-600">
                        群发内容不能为空。
                      </p>
                    ) : null}
                    <div className="grid gap-3 md:grid-cols-3">
                      <Input
                        label="标签"
                        value={
                          groupTags
                        }
                        onValueChange={
                          setGroupTags
                        }
                      />
                      <Input
                        label="每日上限"
                        value={
                          groupDailyLimit
                        }
                        onValueChange={
                          setGroupDailyLimit
                        }
                      />
                      <Input
                        label="发送间隔（秒）"
                        value={
                          groupIntervalSeconds
                        }
                        onValueChange={
                          setGroupIntervalSeconds
                        }
                      />
                    </div><div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        color={
                          groupChunkedSending
                            ? "primary"
                            : "default"
                        }
                        variant={
                          groupChunkedSending
                            ? "solid"
                            : "flat"
                        }
                        onPress={() =>
                          setGroupChunkedSending(
                            (
                              value,
                            ) =>
                              !value,
                          )
                        }
                      >
                        分段发送
                      </Button>
                    </div><Textarea
	                      label="图片与文件"
                      value={
                        groupFilePaths
                      }
                      onValueChange={
                        setGroupFilePaths
                      }
                      minRows={
                        2
                      }
	                      placeholder="每行一个素材文件"
                    />
                    <Textarea
	                      label="执行备注"
                      value={
                        groupContext
                      }
                      onValueChange={
                        setGroupContext
                      }
                      minRows={
                        3
                      }
	                      placeholder="素材、分段发送要求或执行备注"
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="flat"
                        isDisabled
                      >
                        取消
                      </Button><Button
                        color="primary"
                        isLoading={
                          runningSkill ===
                          "wechat.group.broadcast"
                        }
                        isDisabled={
                          !canCreateGroupBroadcast
                        }
                        onPress={() =>
                          safelyRunWechatTask(
                            () =>
                              wechatGroupBroadcastSkill.buildRunRequest(
                                {
                                  mode,
                                  planName:
                                    groupPlanName,
                                  planType:
                                    groupPlanType,
                                  planTime:
                                    groupPlanTime,
                                  targets:
                                    groupBroadcastTargets,
                                  message:
                                    groupMessage,
                                  personalizedMessages:
                                    groupMessageMode === "personalized"
                                      ? personalizedMessages
                                      : undefined,
                                  tags: splitLines(
                                    groupTags,
                                  ),
                                  dailyLimit:
                                    numberFrom(
                                      groupDailyLimit,
                                      20,
                                    ),
                                  intervalSeconds:
                                    numberFrom(
                                      groupIntervalSeconds,
                                      30,
                                    ),
                                  chunkedSending:
                                    groupChunkedSending,
                                  files:
                                    splitLines(
                                      groupFilePaths,
                                    ),
                                  context:
                                    groupContext,
                                },
                              ),
                            "普通群发创建失败",
                          )
                        }
                      >
                        {groupPlanType === "scheduled" ? "保存计划" : "开始群发"}
                      </Button>
                    </div>{groupPlanType === "immediate" ? (
                      <p className="text-xs leading-5 text-default-500">
                        开始后由本机微信执行；看到发送结果前不计为已发送。
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {activeModule ===
              "contact-add" ? (
                <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
                  
                  <div className="flex flex-col gap-3">
                    <Input
                      label="计划名称"
                      labelPlacement="outside"
                      value={
                        contactPlanName
                      }
                      onValueChange={
                        setContactPlanName
                      }
                    />
                    <SyncedContactsTools
                      count={
                        syncedContacts.length
                      }
                      loading={
                        contactsLoading
                      }
                      contacts={
                        syncedContacts
                      }
                      diagnostics={
                        contactSyncDiagnostics
                      }
                      error={
                        contactSyncError
                      }
                      syncDisabled={
                        !canStartContactSync
                      }
                      syncDisabledReason={
                        contactSyncUnavailableReason
                      }
                      onRefresh={() =>
                        setRiskModal(
                          "contact-sync",
                        )
                      }
                      onFill={() =>
                        setContactTargets(
                          syncedContacts.join(
                            "\n",
                          ),
                        )
                      }
                      onAppend={() =>
                        setContactTargets(
                          (
                            current,
                          ) =>
                            mergeListText(
                              current,
                              syncedContacts,
                            ),
                        )
                      }
                      onOpenContacts={
                        openContactsModule
                      }
                      onExportDiagnostics={() =>
                        void exportContactSyncDiagnostics()
                      }
                    />
                    <Textarea
                      label="号码列表"
                      labelPlacement="outside"
                      value={
                        contactTargets
                      }
                      onValueChange={
                        setContactTargets
                      }
                      minRows={
                        8
                      }
                      placeholder="请输入号码，换行添加多个"
                    />
                      <Textarea
                        label="验证消息"
                      labelPlacement="outside"
                      value={
                        contactVerifyMessage
                      }
                      onValueChange={
                        setContactVerifyMessage
                      }
                      minRows={
                        3
                      }
                        placeholder="请输入验证消息"
                      />{!contactVerifyMessage.trim() ? (
                        <p className="text-xs leading-5 text-warning-600">
                          验证消息不能为空。
                        </p>
                      ) : null}
                    <div className="grid gap-3 md:grid-cols-3">
                      <Input
                        label="24小时内添加最大数量限制"
                        labelPlacement="outside"
                        value={
                          contactDailyLimit
                        }
                        onValueChange={
                          setContactDailyLimit
                        }
                      />
                      <Input
                        label="最小间隔（秒）"
                        labelPlacement="outside"
                        value={
                          contactMinIntervalSeconds
                        }
                        onValueChange={
                          setContactMinIntervalSeconds
                        }
                      />
                      <Input
                        label="最大间隔（秒）"
                        labelPlacement="outside"
                        value={
                          contactMaxIntervalSeconds
                        }
                        onValueChange={
                          setContactMaxIntervalSeconds
                        }
                      />
                    </div><div className="grid gap-3 md:grid-cols-2">
                      
                      <div className="grid gap-2 sm:grid-cols-3 md:grid-cols-1 lg:grid-cols-3">{(
                          [
                            [
                              "manual",
                              "手动设置",
                            ],
                            [
                              "phone_wechat",
                              "电话/微信",
                            ],
                            [
                              "none",
                              "不设置",
                            ],
                          ] as const
                        ).map(
                          ([
                            value,
                            label,
                          ]) => (
                            <Button
                              key={
                                value
                              }
                              size="sm"
                              className="w-full"
                              color={
                                contactRemarkStrategy ===
                                value
                                  ? "primary"
                                  : "default"
                              }
                              variant={
                                contactRemarkStrategy ===
                                value
                                  ? "solid"
                                  : "flat"
                              }
                              onPress={() =>
                                setContactRemarkStrategy(
                                  value,
                                )
                              }
                            >{
                                label
                              }</Button>
                          ),
                        )}</div><Input
                        label="黑名单"
                        labelPlacement="outside"
                        value={
                          contactBlacklist
                        }
                        onValueChange={
                          setContactBlacklist
                        }
                        placeholder="逗号或换行分隔"
                      />
                    </div><Input
                      label="默认备注内容"
                      labelPlacement="outside"
                      value={
                        contactRemarkContent
                      }
                      onValueChange={
                        setContactRemarkContent
                      }
                    />
                    <Textarea
                      label="默认备注内容 / 执行备注"
                      labelPlacement="outside"
                      value={
                        contactContext
                      }
                      onValueChange={
                        setContactContext
                      }
                      minRows={
                        2
                      }
                    />
                    <div className="grid gap-2 sm:grid-cols-3">
                      <Button
                        variant="flat"
                        className="w-full"
                        onPress={() =>{
                          downloadTextFile(
                            "wechat-contact-add-template.csv",
                            "target,remark\nwxid_example,示例备注\n13800000000,手机号示例\n",
                            "text/csv;charset=utf-8",
                          );
                          addToast(
                            {
                              title:
                                "导入模板已下载",
                              description:
                                "按 target 列填写手机号或微信号，再复制到号码列表。",
                              color:
                                "success",
                            },
                          );
                        }}
                      >
                        下载导入模板
                      </Button><Button
                        variant="flat"
                        className="w-full"
                        isDisabled={
                          !contactTargets.trim()
                        }
                        onPress={() =>
                          navigator.clipboard?.writeText(
                            contactTargets,
                          )
                        }
                      >
                        复制号码
                      </Button><Button
                        color="primary"
                        className="w-full"
                        isLoading={
                          runningSkill ===
                          "wechat.contact.add"
                        }
                        isDisabled={
                          !canCreateContactAdd
                        }
                        onPress={() =>{
                          if (
                            !canCreateContactAdd
                          ) {
                            addToast(
                              {
                                title:
                                  "缺少加好友目标",
                                description:
                                  "先在号码列表里输入手机号或微信号，再创建任务。",
                                color:
                                  "warning",
                              },
                            );
                            return;
                          }
                          setRiskModal(
                            "contact-add",
                          );
                        }}
                      >
                        创建任务
                      </Button>
                    </div>
                  </div><RiskNotice
                    title="功能使用警告"
                    tone="danger"
                    lines={[
                      "该功能为高风险功能，极易触发微信风控，从而导致账号被限制使用。",
                      "请根据账号过往使用情况，谨慎规划添加好友数量和频率。",
                      "若出现异常提示，请立即停止相关操作。",
                    ]}
                  />
                </div>
              ) : null}
              {activeModule ===
              "friend-accept" ? (
                <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
                  <div className="flex flex-col gap-3">
                    <Input
                      label="计划名称"
                      value={friendAcceptPlanName}
                      onValueChange={setFriendAcceptPlanName}
                    />
                    <div className="grid gap-2 sm:grid-cols-3">
                      {(
                        [
                          ["request_name", "沿用申请名"],
                          ["phone_wechat", "电话/微信号"],
                          ["manual", "统一备注"],
                        ] as const
                      ).map(([value, label]) => (
                        <Button
                          key={value}
                          size="sm"
                          color={
                            friendAcceptRemarkStrategy === value
                              ? "primary"
                              : "default"
                          }
                          variant={
                            friendAcceptRemarkStrategy === value
                              ? "solid"
                              : "flat"
                          }
                          onPress={() => setFriendAcceptRemarkStrategy(value)}
                        >
                          {label}
                        </Button>
                      ))}
                    </div>
                    <Input
                      label="备注内容"
                      value={friendAcceptRemarkContent}
                      onValueChange={setFriendAcceptRemarkContent}
                      isDisabled={friendAcceptRemarkStrategy !== "manual"}
                    />
                    <Textarea
                      label="通过后的欢迎语"
                      minRows={3}
                      value={friendAcceptWelcomeMessage}
                      onValueChange={setFriendAcceptWelcomeMessage}
                      placeholder="留空则只通过好友，不发送消息"
                    />
                    <div className="grid gap-3 md:grid-cols-2">
                      <Input
                        label="申请语关键词"
                        value={friendAcceptKeywords}
                        onValueChange={setFriendAcceptKeywords}
                        placeholder="多个关键词用逗号或换行分隔"
                      />
                      <Input
                        label="每日上限"
                        value={friendAcceptDailyLimit}
                        onValueChange={setFriendAcceptDailyLimit}
                      />
                    </div>
                    <Textarea
                      label="执行备注"
                      minRows={2}
                      value={friendAcceptContext}
                      onValueChange={setFriendAcceptContext}
                    />
                    <div className="flex justify-end">
                      <Button
                        color="primary"
                        isLoading={runningSkill === "wechat.friend.accept"}
                        isDisabled={busy}
                        onPress={() =>
                          safelyRunWechatTask(
                            () =>
                              wechatFriendAcceptSkill.buildRunRequest({
                                mode,
                                planName: friendAcceptPlanName,
                                remarkStrategy: friendAcceptRemarkStrategy,
                                remarkContent: friendAcceptRemarkContent,
                                welcomeMessage: friendAcceptWelcomeMessage,
                                matchKeywords: splitLines(friendAcceptKeywords),
                                dailyLimit: numberFrom(
                                  friendAcceptDailyLimit,
                                  20,
                                ),
                                context: friendAcceptContext,
                              }),
                            "好友申请处理失败",
                          )
                        }
                      >
                        开始处理
                      </Button>
                    </div>
                  </div><RiskNotice
                    title="执行边界"
                    tone="warning"
                    lines={[
                      "只处理“新的朋友”中状态明确的申请。",
                      "对象不确定、账号受限或无法确认联系人状态时立即停止。",
                      "欢迎语发送成功并能在会话中查到后，才会记为完成。",
                    ]}
                  />
                </div>
              ) : null}
              {activeModule ===
              "moments-publish" ? (
                <MomentsPublishForm
                  busy={
                    busy
                  }
                  running={
                    runningSkill ===
                    "wechat.moments.publish"
                  }
                  planName={
                    momentsPlanName
                  }
                  planDescription={
                    momentsPlanDescription
                  }
                  content={
                    momentsContent
                  }
                  additionalComment={
                    momentsAdditionalComment
                  }
                  assetPath={
                    momentsAssetPath
                  }
                  visibility={
                    momentsVisibility
                  }
                  publishIntervalMinutes={
                    momentsPublishIntervalMinutes
                  }
                  dailyPublished={
                    momentsDailyPublished
                  }
                  dailyQuota={
                    momentsDailyQuota
                  }
                  scheduleStartTime={
                    momentsScheduleStartTime
                  }
                  context={
                    momentsContext
                  }
                  canStart={
                    canStartMomentsPublish
                  }
                  setPlanName={
                    setMomentsPlanName
                  }
                  setPlanDescription={
                    setMomentsPlanDescription
                  }
                  setContent={
                    setMomentsContent
                  }
                  setAdditionalComment={
                    setMomentsAdditionalComment
                  }
                  setAssetPath={
                    setMomentsAssetPath
                  }
                  setVisibility={
                    setMomentsVisibility
                  }
                  setPublishIntervalMinutes={
                    setMomentsPublishIntervalMinutes
                  }
                  setDailyPublished={
                    setMomentsDailyPublished
                  }
                  setDailyQuota={
                    setMomentsDailyQuota
                  }
                  setScheduleStartTime={
                    setMomentsScheduleStartTime
                  }
                  setContext={
                    setMomentsContext
                  }
                  onSubmit={(details) =>{
                    const incompleteIndex = details.findIndex(
                      (detail) =>
                        !detail.content.trim() ||
                        !detail.assetPath.trim() ||
                        !detail.scheduledPublishTime,
                    );
                    if (incompleteIndex >= 0) {
                      addToast(
                        {
                          title:
                            "朋友圈发布缺少内容",
                          description:
                            `请补齐第 ${incompleteIndex + 1} 条的文案、素材和发布时间。`,
                          color:
                            "warning",
                        },
                      );
                      return;
                    }
                    const invalidAsset = details
                      .map((detail, index) => ({
                        index,
                        message: validateMomentsAssets(detail.assetPath),
                      }))
                      .find((item) => item.message);
                    if (invalidAsset) {
                      addToast(
                        {
                          title:
                            "朋友圈素材不符合规则",
                          description:
                            `第 ${invalidAsset.index + 1} 条：${invalidAsset.message}`,
                          color:
                            "warning",
                        },
                      );
                      return;
                    }
                    const firstDetail = details[0];
                    const earliestSchedule = details
                      .map((detail) => detail.scheduledPublishTime)
                      .filter(Boolean)
                      .sort()[0];
                    safelyRunWechatTask(
                      () =>
                        wechatMomentsPublishSkill.buildRunRequest(
                          {
                            mode,
                            planName:
                              momentsPlanName,
                            planDescription:
                              momentsPlanDescription,
                            content:
                              firstDetail.content,
                            additionalComment:
                              firstDetail.additionalComment,
                            assetPath:
                              firstDetail.assetPath,
                            details: details.map((detail) => ({
                              content: detail.content,
                              additionalComment: detail.additionalComment,
                              attachments: splitLines(detail.assetPath),
                              scheduledPublishTime:
                                detail.scheduledPublishTime,
                              visibility: detail.visibility,
                            })),
                            totalCount: details.length,
                            publishIntervalMinutes:
                              numberFrom(
                                momentsPublishIntervalMinutes,
                                0,
                              ),
                            visibility:
                              firstDetail.visibility,
                            dailyPublished:
                              nonNegativeNumberFrom(
                                momentsDailyPublished,
                                0,
                              ),
                            dailyQuota:
                              numberFrom(
                                momentsDailyQuota,
                                1,
                              ),
                            scheduleStartTime:
                              earliestSchedule,
                            context:
                              momentsContext,
                          },
                        ),
                      "朋友圈发布创建失败",
                    );
                  }}
                />
              ) : null}
              {activeModule ===
              "moments-marketing" ? (
                <div className="grid gap-4">
                  <Input
                    label="计划名称"
                    labelPlacement="outside"
                    value={
                      marketingPlanName
                    }
                    onValueChange={
                      setMarketingPlanName
                    }
                  />
                  <div className="grid gap-4 md:grid-cols-2">{(
                      [
                        "random",
                        "targeted",
                      ] as MarketingMode[]
                    ).map(
                      (
                        item,
                      ) => (
                        <button
                          key={
                            item
                          }
                          type="button"
                          className={[
                            "rounded-[8px] border p-4 text-left",
                            marketingMode ===
                            item
                              ? "border-primary-300 bg-primary-50"
                              : "border-default-200 bg-background",
                          ].join(
                            " ",
                          )}
                          onClick={() =>
                            setMarketingMode(
                              item,
                            )
                          }
                        >
                          
                          <p className="font-semibold">{item ===
                            "random"
                              ? "随机营销"
                              : "定向营销"}</p><p className="mt-2 text-sm leading-6 text-default-500">{item ===
                            "random"
                              ? "系统随机浏览公开朋友圈，按设置执行点赞和评论操作。"
                              : "访问指定好友朋友圈主页，AI 分析内容并生成个性化评论。"}</p>
                        </button>
                      ),
                    )}</div>{marketingMode ===
                  "targeted" ? (
                    <div className="grid gap-3">
                      <SyncedContactsTools
                        count={
                          syncedContacts.length
                        }
                        loading={
                          contactsLoading
                        }
                        contacts={
                          syncedContacts
                        }
                        diagnostics={
                          contactSyncDiagnostics
                        }
                        error={
                          contactSyncError
                        }
                        syncDisabled={
                          !canStartContactSync
                        }
                        syncDisabledReason={
                          contactSyncUnavailableReason
                        }
                        onRefresh={() =>
                          setRiskModal(
                            "contact-sync",
                          )
                        }
                        onFill={() =>
                          setMarketingContacts(
                            syncedContacts.join(
                              "\n",
                            ),
                          )
                        }
                        onAppend={() =>
                          setMarketingContacts(
                            (
                              current,
                            ) =>
                              mergeListText(
                                current,
                                syncedContacts,
                              ),
                          )
                        }
                        onOpenContacts={
                          openContactsModule
                        }
                        onExportDiagnostics={() =>
                          void exportContactSyncDiagnostics()
                        }
                      />
                      <Textarea
                        label="选择目标联系人"
                        labelPlacement="outside"
                        value={
                          marketingContacts
                        }
                        onValueChange={
                          setMarketingContacts
                        }
                        minRows={
                          4
                        }
                        placeholder="搜索联系人；定向营销必须选择至少一个联系人"
                      />
                      {!marketingTargetContacts.length ? (
                        <p className="text-xs leading-5 text-warning-600">
                          定向营销至少选择 1 个联系人后才能创建计划。
                        </p>
                      ) : null}
                    </div>
                  ) : null}<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <Input
                      label={
                        marketingMode ===
                        "targeted"
                          ? "每人每天查看条数"
                          : "每天查看条数"
                      }
                      labelPlacement="outside"
                      value={
                        marketingDailyLimit
                      }
                      onValueChange={
                        setMarketingDailyLimit
                      }
                    />
                    <Input
                      label="随机浏览数"
                      labelPlacement="outside"
                      value={
                        marketingBrowseCount
                      }
                      onValueChange={
                        setMarketingBrowseCount
                      }
                    />
                    <Input
                      label="检测间隔（分钟）"
                      labelPlacement="outside"
                      value={
                        marketingCheckIntervalMinutes
                      }
                      onValueChange={
                        setMarketingCheckIntervalMinutes
                      }
                    />
                    <Input
                      label="每天执行时间"
                      labelPlacement="outside"
                      type="time"
                      value={
                        marketingScheduleStartTime
                      }
                      onValueChange={
                        setMarketingScheduleStartTime
                      }
                    />
                  </div><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    <Button
                      size="sm"
                      className="w-full"
                      variant={
                        marketingLike
                          ? "solid"
                          : "flat"
                      }
                      color={
                        marketingLike
                          ? "primary"
                          : "default"
                      }
                      onPress={() =>
                        setMarketingLike(
                          (
                            value,
                          ) =>
                            !value,
                        )
                      }
                    >
                      自动点赞
                    </Button><Button
                      size="sm"
                      className="w-full"
                      variant={
                        marketingComment
                          ? "solid"
                          : "flat"
                      }
                      color={
                        marketingComment
                          ? "primary"
                          : "default"
                      }
                      onPress={() =>
                        setMarketingComment(
                          (
                            value,
                          ) =>
                            !value,
                        )
                      }
                    >
                      自动评论
                    </Button><Button
                      size="sm"
                      className="w-full"
                      variant={
                        marketingCommentMode ===
                        "ai"
                          ? "solid"
                          : "flat"
                      }
                      color={
                        marketingCommentMode ===
                        "ai"
                          ? "primary"
                          : "default"
                      }
                      isDisabled={
                        !marketingComment
                      }
                      onPress={() =>
                        setMarketingCommentMode(
                          "ai",
                        )
                      }
                    >
                      AI智能生成评论
                    </Button><Button
                      size="sm"
                      className="w-full"
                      variant={
                        marketingCommentMode ===
                        "fixed"
                          ? "solid"
                          : "flat"
                      }
                      color={
                        marketingCommentMode ===
                        "fixed"
                          ? "primary"
                          : "default"
                      }
                      isDisabled={
                        !marketingComment
                      }
                      onPress={() =>
                        setMarketingCommentMode(
                          "fixed",
                        )
                      }
                    >
                      固定评论内容
                    </Button>
                  </div><Textarea
                    label="营销内容 / 固定评论内容"
                    labelPlacement="outside"
                    value={
                      marketingCommentMode ===
                      "fixed"
                        ? marketingFixedComment
                        : marketingContent
                    }
                    onValueChange={
                      marketingCommentMode ===
                      "fixed"
                        ? setMarketingFixedComment
                        : setMarketingContent
                    }
                    minRows={
                      3
                    }
                    placeholder="请输入固定评论内容，或提供 AI 评论参考话术"
                  />{marketingComment &&
                  marketingCommentMode ===
                    "fixed" &&
                  !marketingFixedComment.trim() ? (
                    <p className="text-xs leading-5 text-warning-600">
                      固定评论模式需要填写评论内容。
                    </p>
                  ) : null}
                  {!hasMarketingAction ? (
                    <p className="text-xs leading-5 text-warning-600">
                      至少开启点赞或评论中的一个动作。
                    </p>
                  ) : null}
                  <Textarea
                    label="自定义提示词"
                    labelPlacement="outside"
                    value={
                      marketingPrompts
                    }
                    onValueChange={
                      setMarketingPrompts
                    }
                    minRows={
                      3
                    }
                    placeholder="请输入自定义提示词，例如：请以朋友口吻评论，语气自然"
                  />
                  <Textarea
                    label="执行备注"
                    labelPlacement="outside"
                    value={
                      marketingContext
                    }
                    onValueChange={
                      setMarketingContext
                    }
                    minRows={
                      2
                    }
                  />
                  <RiskNotice
                    title="重要提示"
                    tone="warning"
                    lines={[
                      "点赞和评论次数太多会触发微信风控，建议初次使用不要超过50个。",
                      "只支持有文案的朋友圈内容，其它类型会跳过。",
                      "该功能仅限微信常用电脑使用，新电脑登录需等待24小时。",
                    ]}
                  />
                  <div className="flex justify-end">
                    <Button
                      color="primary"
                      isLoading={
                        runningSkill ===
                        "wechat.moments.marketing"
                      }
                      isDisabled={
                        !canCreateMarketingPlan
                      }
                      onPress={() =>
                        safelyRunWechatTask(
                          () =>
                            wechatMomentsMarketingSkill.buildRunRequest(
                              {
                                mode,
                                planName:
                                  marketingPlanName,
                                marketingMode,
                                contacts:
                                  marketingTargetContacts,
                                checkIntervalMinutes:
                                  numberFrom(
                                    marketingCheckIntervalMinutes,
                                    30,
                                  ),
                                dailyViewLimit:
                                  numberFrom(
                                    marketingDailyLimit,
                                    20,
                                  ),
                                randomBrowseCount:
                                  numberFrom(
                                    marketingBrowseCount,
                                    10,
                                  ),
                                actions:
                                  {
                                    like: marketingLike,
                                    comment:
                                      marketingComment,
                                  },
                                autoLike:
                                  marketingLike,
                                autoComment:
                                  marketingComment,
                                scheduleStartTime:
                                  marketingScheduleStartTime,
                                prompts:
                                  parseMomentPrompts(
                                    marketingPrompts,
                                  ),
                                commentMode:
                                  marketingCommentMode,
                                fixedComment:
                                  marketingFixedComment,
                                content:
                                  marketingContent,
                                context:
                                  marketingContext,
                              },
                            ),
                          "朋友圈营销创建失败",
                        )
                      }
                    >
                      创建计划
                    </Button>
                  </div>
                </div>
              ) : null}
              {activeModule ===
              "contacts" ? (
                <ContactsManagerPanel
                  contactsLoading={
                    contactsLoading
                  }
                  contactSaving={
                    contactSaving
                  }
                  syncedContacts={
                    syncedContacts
                  }
                  structuredContacts={
                    structuredContacts
                  }
                  contactSyncMode={
                    contactSyncMode
                  }
                  setContactSyncMode={
                    setContactSyncMode
                  }
                  syncDiagnostics={
                    contactSyncDiagnostics
                  }
                  contactReadiness={
                    contactReadiness
                  }
                  syncError={
                    contactSyncError
                  }
                  syncDisabled={
                    !canStartContactSync
                  }
                  syncDisabledReason={
                    contactSyncUnavailableReason
                  }
                  contactEditingWxid={
                    contactEditingWxid
                  }
                  contactWxid={
                    contactWxid
                  }
                  contactNickname={
                    contactNickname
                  }
                  contactRemark={
                    contactRemark
                  }
                  contactTags={
                    contactTags
                  }
                  setContactWxid={
                    setContactWxid
                  }
                  setContactNickname={
                    setContactNickname
                  }
                  setContactRemark={
                    setContactRemark
                  }
                  setContactTags={
                    setContactTags
                  }
                  onSync={() =>
                    setRiskModal(
                      "contact-sync",
                    )
                  }
                  onExport={() =>
                    void exportStructuredContacts()
                  }
                  onExportDiagnostics={() =>
                    void exportContactSyncDiagnostics()
                  }
                  onOpenContacts={
                    openContactsModule
                  }
                  onClear={() =>
                    void clearStructuredContacts()
                  }
                  onRefresh={() =>
                    void loadSyncedContacts()
                  }
                  onReset={
                    resetContactForm
                  }
                  onSave={() =>
                    void saveStructuredContact()
                  }
                  onEdit={
                    editStructuredContact
                  }
                  onRemove={(
                    wxid,
                  ) =>
                    void removeStructuredContact(
                      wxid,
                    )
                  }
                  onAppendGroup={(
                    label,
                  ) =>
                    setGroupTargets(
                      (
                        current,
                      ) =>
                        mergeListText(
                          current,
                          [
                            label,
                          ],
                        ),
                    )
                  }
                  onFillGroup={() =>
                    setGroupTargets(
                      syncedContacts.join(
                        "\n",
                      ),
                    )
                  }
                  onFillMarketing={() =>
                    setMarketingContacts(
                      syncedContacts.join(
                        "\n",
                      ),
                    )
                  }
                />
              ) : null}
              {activeModule ===
              "chat-history" ? (
                <ChatHistoryPanel
                  sessionsResult={
                    chatSessionsResult
                  }
                  historyResult={
                    chatHistoryResult
                  }
                  selectedSessionId={
                    selectedChatSessionId
                  }
                  sessionsLoading={
                    chatSessionsLoading
                  }
                  historyLoading={
                    chatHistoryLoading
                  }
                  syncLoading={
                    chatSyncLoading
                  }
                  onRefreshSessions={() =>
                    void loadChatSessions()
                  }
                  onSelectSession={
                    setSelectedChatSessionId
                  }
                  onSync={() =>
                    void syncChatHistory()
                  }
                />
              ) : null}</CardBody>
          </Card>{activeModuleInfo.planFilter ? (
            <Card>
              
              <CardBody className="gap-3">
                
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <PanelTitle
                    title="计划列表"
                    desc={`当前模块 ${activePlans.length} 条，支持启动、暂停、恢复、重发、删除和查看记录。`}
                  />
                  <div className="flex flex-wrap gap-2">{WECHAT_PLAN_FILTERS.map(
                      (
                        filter,
                      ) => (
                        <Button
                          key={
                            filter.key
                          }
                          size="sm"
                          color={
                            planFilter ===
                            filter.key
                              ? "primary"
                              : "default"
                          }
                          variant={
                            planFilter ===
                            filter.key
                              ? "solid"
                              : "flat"
                          }
                          onPress={() =>
                            setPlanFilter(
                              filter.key,
                            )
                          }
                        >{
                            filter.label
                          }</Button>
                      ),
                    )}</div>
                </div><div className="grid gap-2">{activePlans.length ? (
                    activePlans
                      .slice(
                        0,
                        20,
                      )
                      .map(
                        (
                          task,
                        ) => (
                          <PlanRow
                            key={
                              task.id
                            }
                            task={
                              task
                            }
                            actionId={
                              planActionId
                            }
                            onAction={(
                              action,
                            ) =>
                              requestPlanAction(
                                task,
                                action,
                              )
                            }
                          />
                        ),
                      )
                  ) : (
                    <div className="rounded-[8px] border border-default-200 px-4 py-8 text-center text-sm text-default-500">
                      暂无计划
                    </div>
                  )}</div>
              </CardBody>
            </Card>
          ) : null}</div>
      </div><WechatRiskModal
        type={
          riskModal
        }
        contactSyncMode={
          contactSyncMode
        }
        onClose={() =>
          setRiskModal(
            "",
          )
        }
        onConfirm={
          riskModal ===
          "contact-add"
            ? createContactAddAfterRisk
            : startContactSyncAfterRisk
        }
      />
      {pendingPlanActionMeta ? (
        <RiskConfirmationDialog
          isOpen={Boolean(pendingPlanAction)}
          title={pendingPlanActionMeta.title}
          description={pendingPlanActionMeta.description}
          riskLevel={pendingPlanActionMeta.riskLevel}
          confirmLabel={pendingPlanActionMeta.confirmLabel}
          impactItems={pendingPlanActionMeta.impactItems}
          checklist={pendingPlanActionMeta.checklist}
          isLoading={Boolean(planActionId)}
          onCancel={() => setPendingPlanAction(null)}
          onConfirm={() => void confirmPlanAction()}
        />
      ) : null}
    </div>
  );
}

function RiskNotice({
  title,
  lines,
  tone,
}: {
  title: string;
  lines: string[];
  tone:
    | "warning"
    | "danger";
}) {
  const className =
    tone ===
    "danger"
      ? "border-danger-200 bg-danger-50 text-danger-700"
      : "border-warning-200 bg-warning-50 text-warning-700";
  return (
    <div
      className={`rounded-[8px] border p-4 text-sm leading-6 ${className}`}
    >
      
      <p className="mb-2 font-semibold">{
          title
        }</p>{lines.map(
        (
          line,
        ) => (
          <p
            key={
              line
            }
          >{
              line
            }</p>
        ),
      )}</div>
  );
}
function ContactSyncModeChooser({
  value,
  onChange,
  compact = false,
  disabledModes = [],
}: {
  value: WechatContactsSyncMode;
  onChange: (
    value: WechatContactsSyncMode,
  ) => void;
  compact?: boolean;
  disabledModes?: WechatContactsSyncMode[];
}) {
  const disabledSet =
    new Set(
      disabledModes,
    );
  return (
    <div
      className={
        compact
          ? "grid w-full grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2 lg:w-[520px]"
          : "grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2"
      }
    >{CONTACT_SYNC_MODE_OPTIONS.map(
        (
          option,
        ) =>{
          const selected =
            value ===
            option.key;
          const disabled =
            disabledSet.has(
              option.key,
            );
          return (
            <button
              key={
                option.key
              }
              type="button"
              className={[
                "min-w-0 rounded-[8px] border p-3 text-left transition",
                compact
                  ? "min-h-[86px]"
                  : "min-h-[112px]",
                disabled
                  ? "cursor-not-allowed opacity-55"
                  : "",
                selected
                  ? "border-primary-300 bg-primary-50 text-primary-900"
                  : disabled
                    ? "border-default-200 bg-default-100 text-default-500"
                    : "border-default-200 bg-background hover:border-default-300 hover:bg-default-50",
              ].join(
                " ",
              )}
              disabled={
                disabled
              }
              onClick={() =>
                disabled
                  ? undefined
                  : onChange(
                      option.key,
                    )
              }
            >
              
              <div className="flex min-w-0 items-start justify-between gap-2">
                
                <span className="min-w-0 text-sm font-semibold">{
                    option.title
                  }</span><Chip
                  size="sm"
                  color={
                    disabled
                      ? "default"
                      : selected
                      ? "primary"
                      : "default"
                  }
                  variant="flat"
                >{disabled
                    ? "需 Windows"
                    : selected
                      ? "当前"
                      : option.badge}</Chip>
              </div><p className="mt-2 text-xs leading-5 text-default-500">{
                  disabled
                    ? "此模式仅支持 Windows 桌面版微信。"
                    : option.desc
                }</p>
            </button>
          );
        },
      )}</div>
  );
}

function ContactSyncReadinessPanel({
  readiness,
}: {
  readiness?: WechatContactsReadinessResult | null;
}) {
  if (!readiness) return null;
  const visibleChecks =
    readiness.status === "blocked" ? readiness.blockers : readiness.warnings;
  const color =
    readiness.status === "ready"
      ? "success"
      : readiness.status === "blocked"
        ? "danger"
        : "warning";
  const statusLabel =
    readiness.status === "ready"
      ? "可同步"
      : readiness.status === "blocked"
        ? "需处理"
        : "有提醒";

  return (
    <div className="rounded-[8px] border border-default-200 bg-default-50 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="shrink-0 text-default-500" />
            <p className="text-sm font-semibold text-default-900">
              同步前自检
            </p>
          </div>
          <p className="mt-1 break-words text-xs leading-5 text-default-600">
		            {readiness.status === "ready"
		              ? "当前环境已准备好，可以开始同步。"
		              : toPublicError(
		                  readiness.nextAction,
		                  "请完成页面列出的准备项后重新同步。",
		                )}
          </p>
        </div>
        <Chip size="sm" color={color} variant="flat">
          {statusLabel}
        </Chip>
      </div>
      <div className="mt-3 grid gap-2 text-xs text-default-600 sm:grid-cols-2">
        <div className="rounded-[8px] border border-default-200 bg-background p-2">
          <span className="text-default-400">缓存：</span>
	          {readiness.cached.count} 个 / {sourceLabel(readiness.cached.source)}
        </div>
        <div className="rounded-[8px] border border-default-200 bg-background p-2">
          <span className="text-default-400">模式：</span>
          {readiness.modeSupport.all ? "随机、全部" : "随机"}
        </div>
      </div>
      {visibleChecks.length ? (
        <div className="mt-3 grid gap-2">
          {visibleChecks.slice(0, 3).map((check) => (
            <div
              key={check.key}
              className="rounded-[8px] border border-default-200 bg-background p-2 text-xs leading-5 text-default-600"
            >
		              <span className="font-semibold text-default-800">
		                {wechatBusinessText(check.name)}
		              </span>
		              ：{toPublicError(
		                check.message,
		                readiness.status === "blocked"
		                  ? "该项尚未满足同步要求，请完成准备后重试。"
		                  : "该项需要确认后再同步。",
		              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ContactSyncDiagnosticsPanel({
  diagnostics,
  error,
  onExportDiagnostics,
}: {
  diagnostics?: WechatContactsSyncDiagnostics | null;
  error?: string;
  onExportDiagnostics?: () => void;
}) {
  if (
    !diagnostics &&
    !error
  )
    return null;
  const layers =
    buildContactSyncDiagnosticLayers(
      diagnostics,
      error,
    );
  const summary =
    contactSyncDiagnosticsSummary(
      diagnostics,
    );
	  const isError =
	    Boolean(
	      error,
	    );
	  const dbHelperRequired =
	    isDbHelperRequiredContactSync(
	      diagnostics,
	      error,
	    );
	  const headline =
	    isError
	      ? contactSyncUserMessage(
	          error,
	          diagnostics,
	          {
	            dbHelperRequired,
	          },
	        )
	      : summary
	        ? "本次同步返回了可查看的状态信息。"
	        : "本次同步已完成。";
	  const showFullError = false;
  const signals =
    buildContactSignalItems(
      diagnostics,
    );
  const containerClass =
    isError
      ? "border-danger-200 bg-danger-50/80 text-danger-800"
      : "border-default-200 bg-default-50 text-default-700";
  return (
    <div
      className={`rounded-[8px] border p-3 ${containerClass}`}
    >
      
      <div className="flex flex-wrap items-start justify-between gap-2">
        
        <div className="min-w-0">
          
          <div className="flex items-center gap-2">
            
            <AlertTriangle
              size={
                16
              }
            />
            <p className="text-sm font-semibold">{isError
                ? "最近同步失败排查"
                : "最近同步情况"}</p>
          </div><p className="mt-1 break-words text-xs leading-5 opacity-90">{
              headline
            }</p>
        </div><div className="flex shrink-0 flex-wrap items-center gap-2">{diagnostics?.source ? (
            <Chip
              size="sm"
              variant="flat"
              color={
                isError
                  ? "danger"
                  : "default"
              }
            >{sourceLabel(
                diagnostics.source,
              )}</Chip>
          ) : null}{onExportDiagnostics ? (
            <Button
              size="sm"
              variant="flat"
              startContent={
                <Download
                  size={
                    14
                  }
                />
              }
              onPress={
                onExportDiagnostics
              }
            >
	              导出排查资料
            </Button>
          ) : null}</div></div>{signals.length ? (
        <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2">{signals.map(
            (
              signal,
            ) => (
              <div
                key={
                  signal.key
                }
                className="min-w-0 rounded-[8px] border border-default-200 bg-background p-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[11px] font-semibold text-default-700">{
                      signal.label
                    }</span><Chip
                    size="sm"
                    color={diagnosticStatusColor(
                      signal.status,
                    )}
                    variant="flat"
                  >{diagnosticStatusLabel(
                      signal.status,
                    )}</Chip>
                </div><p className="mt-1 truncate text-[11px] text-default-500">{
                    signal.detail
                  }</p>
              </div>
            ),
          )}</div>
      ) : null}{showFullError ? (
        <div className="mt-3 max-h-32 overflow-auto rounded-[8px] bg-background p-2 font-mono text-[11px] leading-5 text-default-500">
	          <pre className="whitespace-pre-wrap break-words">{headline}</pre>
        </div>
      ) : null}<div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2">{layers.map(
          (
            layer,
          ) =>{
            const Icon =
              layer.icon;
            return (
              <div
                key={
                  layer.key
                }
                className="min-w-0 rounded-[8px] border border-default-200 bg-background p-3 text-default-700"
              >
                
                <div className="flex items-start justify-between gap-2">
                  
                  <div className="flex min-w-0 items-center gap-2">
                    
                    <Icon
                      size={
                        15
                      }
                      className="shrink-0 text-default-500"
                    />
                    <p className="truncate text-xs font-semibold text-default-900">{
                        layer.title
                      }</p>
                  </div><Chip
                    size="sm"
                    color={diagnosticStatusColor(
                      layer.status,
                    )}
                    variant="flat"
                  >{diagnosticStatusLabel(
                      layer.status,
                    )}</Chip>
                </div><p className="mt-2 text-xs leading-5 text-default-600">{
                    layer.summary
                  }</p>{layer
                  .evidence
                  .length ? (
                  <div className="mt-2 grid gap-1 text-[11px] leading-5 text-default-500">{layer.evidence
                      .slice(
                        0,
                        4,
                      )
                      .map(
                        (
                          item,
                        ) => (
                          <p
                            key={
                              item
                            }
                            className="break-words"
                          >{
                              item
                            }</p>
                        ),
                      )}</div>
                ) : null}<p className="mt-2 text-[11px] leading-5 text-default-500">
                  下一步：
                  {
                    layer.action
                  }</p>
              </div>
            );
          },
        )}</div>{diagnostics
        ?.warnings
        ?.length ? (
        <div className="mt-3 rounded-[8px] bg-background p-2 text-[11px] leading-5 text-default-500">{diagnostics.warnings
            .slice(
              0,
              3,
            )
            .map(
              (
                warning,
              ) => (
                <p
                  key={
                    warning
                  }
                  className="break-words"
                >
	                  提示：
		                  {
		                    toPublicError(
		                      warning,
		                      "请检查同步所需的微信状态与系统权限。",
		                    )
		                  }</p>
              ),
            )}</div>
      ) : null}</div>
  );
}
function NoContactsEmptyState({
  loading,
  onRefresh,
  refreshDisabled = false,
  refreshDisabledReason = "",
  onOpenContacts,
  onExportDiagnostics,
}: {
  loading: boolean;
  onRefresh: () => void;
  refreshDisabled?: boolean;
  refreshDisabledReason?: string;
  onOpenContacts?: () => void;
  onExportDiagnostics?: () => void;
}) {
  return (
    <div className="rounded-[8px] border border-dashed border-default-300 bg-default-50 px-3 py-5 text-center">
      
      <Users
        size={
          24
        }
        className="mx-auto text-default-400"
      />
      <p className="mt-2 text-sm font-semibold text-default-800">
        0
        个联系人
      </p><p className="mx-auto mt-1 max-w-[520px] text-xs leading-5 text-default-500">
        
        请先在微信客户端切到通讯录并刷新列表；如果仍然为
	        0，导出排查资料可以看到微信资料、权限、微信窗口和本机读取服务的状态。
      </p>{refreshDisabledReason ? (
        <p className="mx-auto mt-2 max-w-[520px] text-xs leading-5 text-warning-600">{
            refreshDisabledReason
          }</p>
      ) : null}<div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(148px,1fr))] gap-2">
        <Button
          size="sm"
          variant="flat"
          className="w-full"
          startContent={
            <RefreshCcw
              size={
                15
              }
            />
          }
          isLoading={
            loading
          }
          isDisabled={
            loading ||
            refreshDisabled
          }
          onPress={
            onRefresh
          }
        >
          刷新微信通讯录
        </Button>{onOpenContacts ? (
          <Button
            size="sm"
            variant="flat"
            className="w-full"
            startContent={
              <BookOpen
                size={
                  15
                }
              />
            }
            onPress={
              onOpenContacts
            }
          >
            打开通讯录页
          </Button>
        ) : (
          <Button
            size="sm"
            variant="flat"
            className="w-full"
            startContent={
              <BookOpen
                size={
                  15
                }
              />
            }
            isDisabled
          >
            当前通讯录页
          </Button>
        )}
        {onExportDiagnostics ? (
          <Button
            size="sm"
            variant="flat"
            className="w-full"
            startContent={
              <Download
                size={
                  15
                }
              />
            }
            onPress={
              onExportDiagnostics
            }
          >
	            导出排查资料
          </Button>
        ) : null}</div>
    </div>
  );
}

function WechatRiskModal({
  type,
  contactSyncMode,
  onClose,
  onConfirm,
}: {
  type:
    | ""
    | "contact-sync"
    | "contact-add";
  contactSyncMode: WechatContactsSyncMode;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const isAddFriend =
    type ===
    "contact-add";
  const isFullContactSync =
    type ===
      "contact-sync" &&
    contactSyncMode ===
      "all";
  return (
    <RiskConfirmationDialog
      isOpen={Boolean(type)}
      title={isAddFriend ? "功能使用警告" : "风险提示"}
      description={
        isAddFriend
          ? "该操作会进入真实微信添加好友流程。"
          : isFullContactSync
            ? "将从通讯录顶部开始滚动，并尽量同步全部好友。"
            : "将读取当前可见的部分微信联系人。"
      }
      riskLevel={isAddFriend ? "high" : "medium"}
      confirmLabel={
        isAddFriend
          ? "知晓风险，谨慎启用"
          : isFullContactSync
            ? "开始同步全部好友"
            : "开始随机同步"
      }
      onCancel={onClose}
      onConfirm={onConfirm}
      impactItems={[
        {
          label: "操作范围",
          value: isAddFriend
            ? "添加好友"
            : isFullContactSync
              ? "全部联系人"
              : "部分可见联系人",
        },
      ]}
      checklist={
        isAddFriend
          ? [
              "确认当前微信号处于正常状态，并在常用电脑登录。",
              "控制添加数量和频率，避免一次处理过多对象。",
              "出现异常提示时立即停止，不继续尝试。",
            ]
          : [
              isFullContactSync
                ? "联系人越多，同步时间越长，请保持微信窗口可用。"
                : "随机同步只读取部分可见联系人。",
              "同步期间不要切换微信账号或关闭微信。",
              "确认当前电脑是常用登录环境。",
            ]
      }
    />
  );
}
function MomentsPublishForm({
  busy,
  running,
  planName,
  planDescription,
  content,
  additionalComment,
  assetPath,
  visibility,
  publishIntervalMinutes,
  dailyPublished,
  dailyQuota,
  scheduleStartTime,
  context,
  canStart,
  setPlanName,
  setPlanDescription,
  setContent,
  setAdditionalComment,
  setAssetPath,
  setVisibility,
  setPublishIntervalMinutes,
  setDailyPublished,
  setDailyQuota,
  setScheduleStartTime,
  setContext,
  onSubmit,
}: {
  busy: boolean;
  running: boolean;
  planName: string;
  planDescription: string;
  content: string;
  additionalComment: string;
  assetPath: string;
  visibility: string;
  publishIntervalMinutes: string;
  dailyPublished: string;
  dailyQuota: string;
  scheduleStartTime: string;
  context: string;
  canStart: boolean;
  setPlanName: (
    value: string,
  ) => void;
  setPlanDescription: (
    value: string,
  ) => void;
  setContent: (
    value: string,
  ) => void;
  setAdditionalComment: (
    value: string,
  ) => void;
  setAssetPath: (
    value: string,
  ) => void;
  setVisibility: (
    value: string,
  ) => void;
  setPublishIntervalMinutes: (
    value: string,
  ) => void;
  setDailyPublished: (
    value: string,
  ) => void;
  setDailyQuota: (
    value: string,
  ) => void;
  setScheduleStartTime: (
    value: string,
  ) => void;
  setContext: (
    value: string,
  ) => void;
  onSubmit: (details: MomentsPublishDetailDraft[]) => void;
}) {
  const assetInputRef =
    React.useRef<HTMLInputElement | null>(
      null,
    );
  const extraAssetInputRef = React.useRef<HTMLInputElement | null>(null);
  const extraAssetTargetRef = React.useRef("");
  const [
    assetUploading,
    setAssetUploading,
  ] =
    React.useState(
      false,
    );
  const [
    activeStep,
    setActiveStep,
  ] = React.useState(0);
  const [
    aiGenerating,
    setAiGenerating,
  ] = React.useState(false);
  const [extraAssetUploading, setExtraAssetUploading] = React.useState("");
  const [extraDetails, setExtraDetails] = React.useState<
    MomentsPublishDetailDraft[]
  >([]);
  const details: MomentsPublishDetailDraft[] = [
    {
      id: "primary",
      content,
      additionalComment,
      assetPath,
      visibility,
      scheduledPublishTime: scheduleStartTime,
    },
    ...extraDetails,
  ];
  const detailAssetErrors = details.map((detail) =>
    detail.assetPath.trim() ? validateMomentsAssets(detail.assetPath) : "",
  );
  const allDetailsReady = details.every(
    (detail, index) =>
      Boolean(detail.content.trim() && detail.assetPath.trim()) &&
      !detailAssetErrors[index],
  );
  const allSchedulesReady = details.every((detail) =>
    Boolean(detail.scheduledPublishTime),
  );
  const assetError =
    assetPath.trim()
      ? validateMomentsAssets(
          assetPath,
        )
      : "";
  const uploadAssetFiles = async (files: File[]) => {
    const uploaded: string[] = [];
    for (const file of files) {
      const formData = new FormData();
      formData.append("file", file);
      const asset = await localEngineApi.uploadInteractionAsset(formData);
      uploaded.push(asset.filepath);
    }
    return uploaded;
  };
  const updateExtraDetail = (
    id: string,
    patch: Partial<MomentsPublishDetailDraft>,
  ) => {
    setExtraDetails((current) =>
      current.map((detail) =>
        detail.id === id ? { ...detail, ...patch } : detail,
      ),
    );
  };
  const addDetail = () => {
    const intervalMs = numberFrom(publishIntervalMinutes, 30) * 60 * 1000;
    const previousSchedule =
      extraDetails[extraDetails.length - 1]?.scheduledPublishTime ||
      scheduleStartTime;
    const previousTime = previousSchedule
      ? new Date(previousSchedule).getTime()
      : Date.now() + 10 * 60 * 1000;
    const nextTime = Number.isFinite(previousTime)
      ? previousTime + intervalMs
      : Date.now() + 10 * 60 * 1000;
    setExtraDetails((current) => [
      ...current,
      {
        id: `moments-detail-${Date.now()}-${current.length + 2}`,
        content: "",
        additionalComment: "",
        assetPath: "",
        visibility: "公开",
        scheduledPublishTime: toLocalDateTimeInput(new Date(nextTime)),
      },
    ]);
  };
  const steps = [
    "设置基本参数",
    "创建内容",
    "时间安排",
    "确认发布",
  ];
  const generateContent = async () => {
    setAiGenerating(true);
    try {
      const result = await localEngineApi.generateMomentsDraftContent({
        currentContent: content,
        instruction:
          [planDescription, context]
            .map((item) => item.trim())
            .filter(Boolean)
            .join("；") || "生成一条自然、真实的朋友圈文案",
      });
      setContent(result.content);
      addToast({
        title: content.trim() ? "文案已改写" : "文案已生成",
        color: "success",
      });
    } catch (error) {
      addToast({
        title: "文案生成失败",
        description: toPublicError(error, "请检查模型设置后重试。"),
        color: "danger",
      });
    } finally {
      setAiGenerating(false);
    }
  };
  const rebuildSchedule = () => {
    const start = new Date(Date.now() + 10 * 60 * 1000);
    const localTime = toLocalDateTimeInput(start);
    const intervalMs = numberFrom(publishIntervalMinutes, 30) * 60 * 1000;
    setScheduleStartTime(localTime);
    setExtraDetails((current) =>
      current.map((detail, index) => ({
        ...detail,
        scheduledPublishTime: toLocalDateTimeInput(
          new Date(start.getTime() + (index + 1) * intervalMs),
        ),
      })),
    );
    setDailyPublished("0");
    if (!publishIntervalMinutes.trim()) setPublishIntervalMinutes("30");
    addToast({ title: "时间安排已重建", color: "success" });
  };
  const stepReady =
    activeStep === 0
      ? Boolean(planName.trim())
      : activeStep === 1
        ? allDetailsReady
        : activeStep === 2
          ? Boolean(allSchedulesReady && Number(dailyQuota) > 0)
          : canStart && allDetailsReady && allSchedulesReady;
  return (
    <div className="grid gap-4">
      
      <div className="grid gap-2 md:grid-cols-4">{steps.map(
          (
            step,
            index,
          ) => (
            <button
              key={
                step
              }
              type="button"
              aria-current={activeStep === index ? "step" : undefined}
              className={`rounded-[8px] border px-3 py-2 text-left text-sm ${
                index <= activeStep
                  ? "border-primary-200 bg-primary-50"
                  : "border-divider bg-default-50"
              }`}
              onClick={() => setActiveStep(index)}
            >
              
              <p className="font-semibold">
                第
                {index +
                  1}
                步
              </p><p className="mt-1 text-primary-700">{
                  step
                }</p>
            </button>
          ),
        )}</div><div className={`grid gap-4 ${
          activeStep === 0 || activeStep === 2
            ? "xl:grid-cols-[360px_1fr]"
            : "grid-cols-1"
        }`}>
        
        <div className={`${activeStep === 0 || activeStep === 2 ? "flex" : "hidden"} flex-col gap-3`}>
          <div className={activeStep === 0 ? "contents" : "hidden"}>
          <Input
            label="计划名称"
            value={
              planName
            }
            onValueChange={
              setPlanName
            }
          />
          <Textarea
            label="计划说明"
            value={
              planDescription
            }
            onValueChange={
              setPlanDescription
            }
            minRows={
              2
            }
          />
          <Input
            label="总朋友圈数量"
            value={String(details.length)}
            isReadOnly
          />
          </div>
          <div className={activeStep === 2 ? "contents" : "hidden"}>
          <Input
            label="每日发布数量"
            value={
              dailyQuota
            }
            onValueChange={
              setDailyQuota
            }
          />
          <Input
            label="今日已发"
            value={
              dailyPublished
            }
            onValueChange={
              setDailyPublished
            }
          />
          <Input
            label="第 1 条发布时间"
            type="datetime-local"
            value={
              scheduleStartTime
            }
            onValueChange={
              setScheduleStartTime
            }
          />
          <Input
            label="发布间隔（分钟）"
            value={
              publishIntervalMinutes
            }
            onValueChange={
              setPublishIntervalMinutes
            }
          />
          <Button size="sm" variant="flat" onPress={rebuildSchedule}>
            重建时间安排
          </Button>
          </div>
        </div><div className="flex flex-col gap-3">
          <div className={activeStep === 1 ? "contents" : "hidden"}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-foreground">第 1 条</p>
            <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="flat"
              isLoading={aiGenerating}
              onPress={generateContent}
            >
              {content.trim() ? "AI改写" : "AI生成文案"}
            </Button>
            <Button
              size="sm"
              variant="flat"
              startContent={<Plus size={16} />}
              onPress={addDetail}
            >
              添加一条
            </Button>
            </div>
          </div>
          <Textarea
            label="朋友圈文案"
            value={
              content
            }
            onValueChange={
              setContent
            }
            minRows={
              5
            }
            placeholder="请输入朋友圈文本内容"
          />
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-foreground">
                媒体文件
              </span>
              <Button
                size="sm"
                variant="flat"
                isLoading={
                  assetUploading
                }
                onPress={() =>
                  assetInputRef.current?.click()
                }
              >
                添加素材
              </Button>
              <input
                ref={
                  assetInputRef
                }
                type="file"
                accept="image/*,video/*"
                multiple
                className="hidden"
                onChange={async (
                  event,
                ) =>{
                  const inputElement = event.currentTarget;
                  const files =
                    Array.from(
                      inputElement.files ||
                        [],
                    );
                  if (
                    !files.length
                  )
                    return;
                  setAssetUploading(
                    true,
                  );
                  try {
                    const uploaded = await uploadAssetFiles(files);
                    setAssetPath(
                      [
                        ...splitLines(
                          assetPath,
                        ),
                        ...uploaded,
                      ].join(
                        "\n",
                      ),
                    );
                    addToast({
                      title: `已添加 ${uploaded.length} 个素材`,
                      color: "success",
                    });
                  } catch (error) {
                    addToast({
                      title:
                        "素材添加失败",
                      description:
                        toPublicError(
                          error,
                          "素材未能添加，请检查文件后重试。",
                        ),
                      color: "danger",
                    });
                  } finally {
                    setAssetUploading(
                      false,
                    );
                    inputElement.value =
                      "";
                  }
                }}
              />
            </div>
            <Textarea
              aria-label="媒体文件"
              value={
                assetPath
              }
              onValueChange={
                setAssetPath
              }
              minRows={
                2
              }
              placeholder="每行一个素材文件；图片最多9张，视频最多1个，不能混选"
            />
          </div>{!assetPath.trim() ? (
            <p className="text-xs leading-5 text-warning-600">
              每个朋友圈条目都必须添加媒体文件，当前不会启动桌面发布。
            </p>
          ) : assetError ? (
            <p className="text-xs leading-5 text-warning-600">{
                assetError
              }</p>
          ) : null}<label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">
              可见范围
            </span>
            <select
              className="h-10 rounded-[8px] border border-default-200 bg-default-100 px-3 text-sm outline-none transition-colors focus:border-primary"
              value={
                visibility
              }
              onChange={(
                event,
              ) =>
                setVisibility(
                  event.target.value,
                )
              }
            >
              <option value="公开">
                公开
              </option>
              <option value="私密">
                私密
              </option>
              <option value="部分可见">
                部分可见
              </option>
              <option value="不给谁看">
                不给谁看
              </option>
            </select>
          </label>
          <Textarea
            label="追加评论"
            value={
              additionalComment
            }
            onValueChange={
              setAdditionalComment
            }
            minRows={
              2
            }
            placeholder="可选：发布后追加评论"
          />
          <input
            ref={extraAssetInputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            className="hidden"
            onChange={async (event) => {
              const inputElement = event.currentTarget;
              const files = Array.from(inputElement.files || []);
              const targetId = extraAssetTargetRef.current;
              if (!files.length || !targetId) return;
              setExtraAssetUploading(targetId);
              try {
                const uploaded = await uploadAssetFiles(files);
                setExtraDetails((current) =>
                  current.map((detail) =>
                    detail.id === targetId
                      ? {
                          ...detail,
                          assetPath: [
                            ...splitLines(detail.assetPath),
                            ...uploaded,
                          ].join("\n"),
                        }
                      : detail,
                  ),
                );
                addToast({
                  title: `已为本条添加 ${uploaded.length} 个素材`,
                  color: "success",
                });
              } catch (error) {
                addToast({
                  title: "素材添加失败",
                  description: toPublicError(
                    error,
                    "素材未能添加，请检查文件后重试。",
                  ),
                  color: "danger",
                });
              } finally {
                setExtraAssetUploading("");
                extraAssetTargetRef.current = "";
                inputElement.value = "";
              }
            }}
          />
          {extraDetails.map((detail, index) => {
            const detailAssetError = detailAssetErrors[index + 1];
            return (
              <div
                key={detail.id}
                className="grid gap-3 rounded-[8px] border border-divider p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground">
                    第 {index + 2} 条
                  </p>
                  <Button
                    isIconOnly
                    size="sm"
                    variant="light"
                    aria-label={`移除第 ${index + 2} 条`}
                    title={`移除第 ${index + 2} 条`}
                    onPress={() =>
                      setExtraDetails((current) =>
                        current.filter((item) => item.id !== detail.id),
                      )
                    }
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
                <Textarea
                  label="朋友圈文案"
                  minRows={4}
                  value={detail.content}
                  onValueChange={(value) =>
                    updateExtraDetail(detail.id, { content: value })
                  }
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">
                    媒体文件
                  </span>
                  <Button
                    size="sm"
                    variant="flat"
                    startContent={<Plus size={16} />}
                    isLoading={extraAssetUploading === detail.id}
                    onPress={() => {
                      extraAssetTargetRef.current = detail.id;
                      extraAssetInputRef.current?.click();
                    }}
                  >
                    添加素材
                  </Button>
                </div>
                <Textarea
                  aria-label={`第 ${index + 2} 条媒体文件`}
                  minRows={2}
                  value={detail.assetPath}
                  placeholder="每行一个素材文件；图片最多9张，视频最多1个，不能混选"
                  onValueChange={(value) =>
                    updateExtraDetail(detail.id, { assetPath: value })
                  }
                />
                {!detail.assetPath.trim() || detailAssetError ? (
                  <p className="text-xs leading-5 text-warning-600">
                    {detailAssetError || "请为本条添加图片或视频素材。"}
                  </p>
                ) : null}
                <div className="grid gap-3 md:grid-cols-2">
                  <Input
                    label="发布时间"
                    type="datetime-local"
                    value={detail.scheduledPublishTime}
                    onValueChange={(value) =>
                      updateExtraDetail(detail.id, {
                        scheduledPublishTime: value,
                      })
                    }
                  />
                  <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium text-foreground">
                      可见范围
                    </span>
                    <select
                      className="h-10 rounded-[8px] border border-default-200 bg-default-100 px-3 text-sm outline-none transition-colors focus:border-primary"
                      value={detail.visibility}
                      onChange={(event) =>
                        updateExtraDetail(detail.id, {
                          visibility: event.target.value,
                        })
                      }
                    >
                      <option value="公开">公开</option>
                      <option value="私密">私密</option>
                      <option value="部分可见">部分可见</option>
                      <option value="不给谁看">不给谁看</option>
                    </select>
                  </label>
                </div>
                <Textarea
                  label="追加评论"
                  minRows={2}
                  value={detail.additionalComment}
                  placeholder="可选：发布后追加评论"
                  onValueChange={(value) =>
                    updateExtraDetail(detail.id, {
                      additionalComment: value,
                    })
                  }
                />
              </div>
            );
          })}
          </div>
          <div className={activeStep === 2 ? "contents" : "hidden"}>
          <Textarea
            label="执行备注"
            value={
              context
            }
            onValueChange={
              setContext
            }
            minRows={
              2
            }
            placeholder="素材说明、执行备注"
          />
          </div>
          <div className={activeStep === 3 ? "contents" : "hidden"}>
          <div className="grid gap-2 rounded-[8px] border border-divider bg-default-50 p-3 text-sm text-default-600">
            <p><strong>计划：</strong>{planName || "未命名"}</p>
            <p><strong>发布明细：</strong>{details.length} 条</p>
            {details.map((detail, index) => (
              <p key={detail.id}>
                <strong>第 {index + 1} 条：</strong>
                {detail.scheduledPublishTime || "未设置时间"}，
                {detail.visibility}，{splitLines(detail.assetPath).length} 个素材
              </p>
            ))}
          </div>
          <RiskNotice
            title="重要提示"
            tone="warning"
            lines={[
              "该功能仅限微信常用电脑使用。新电脑登录需等待24小时才能正常使用。",
              "计划创建后按明细执行，建议发布前检查内容、媒体和时间线。",
            ]}
          />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="flat"
              isDisabled={activeStep === 0}
              onPress={() => setActiveStep((step) => Math.max(0, step - 1))}
            >
              上一步
            </Button>{activeStep < steps.length - 1 ? (
              <Button
                color="primary"
                isDisabled={!stepReady}
                onPress={() =>
                  setActiveStep((step) => Math.min(steps.length - 1, step + 1))
                }
              >
                下一步
              </Button>
            ) : (
              <Button
                color="primary"
                isLoading={running}
                isDisabled={!stepReady || busy}
                onPress={() => onSubmit(details)}
              >
                保存计划
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ContactsManagerPanel({
  contactsLoading,
  contactSaving,
  syncedContacts,
  structuredContacts,
  contactSyncMode,
  setContactSyncMode,
  syncDiagnostics,
  contactReadiness,
  syncError,
  syncDisabled,
  syncDisabledReason,
  contactEditingWxid,
  contactWxid,
  contactNickname,
  contactRemark,
  contactTags,
  setContactWxid,
  setContactNickname,
  setContactRemark,
  setContactTags,
  onSync,
  onExport,
  onExportDiagnostics,
  onOpenContacts,
  onClear,
  onRefresh,
  onReset,
  onSave,
  onEdit,
  onRemove,
  onAppendGroup,
  onFillGroup,
  onFillMarketing,
}: {
  contactsLoading: boolean;
  contactSaving: boolean;
  syncedContacts: string[];
  structuredContacts: WechatContact[];
  contactSyncMode: WechatContactsSyncMode;
  setContactSyncMode: (
    value: WechatContactsSyncMode,
  ) => void;
  syncDiagnostics: WechatContactsSyncDiagnostics | null;
  contactReadiness: WechatContactsReadinessResult | null;
  syncError: string;
  syncDisabled: boolean;
  syncDisabledReason: string;
  contactEditingWxid: string;
  contactWxid: string;
  contactNickname: string;
  contactRemark: string;
  contactTags: string;
  setContactWxid: (
    value: string,
  ) => void;
  setContactNickname: (
    value: string,
  ) => void;
  setContactRemark: (
    value: string,
  ) => void;
  setContactTags: (
    value: string,
  ) => void;
  onSync: () => void;
  onExport: () => void;
  onExportDiagnostics: () => void;
  onOpenContacts: () => void;
  onClear: () => void;
  onRefresh: () => void;
  onReset: () => void;
  onSave: () => void;
  onEdit: (
    contact: WechatContact,
  ) => void;
  onRemove: (
    wxid: string,
  ) => void;
  onAppendGroup: (
    label: string,
  ) => void;
  onFillGroup: () => void;
  onFillMarketing: () => void;
}) {
  const allSyncUnsupported =
    contactReadiness?.modeSupport.all ===
    false;
  const selectedSyncModeUnsupported =
    contactSyncMode ===
      "all" &&
    allSyncUnsupported;
  const disabledSyncModes: WechatContactsSyncMode[] =
    allSyncUnsupported
      ? [
          "all",
        ]
      : [];
  const effectiveSyncDisabled =
    syncDisabled ||
    selectedSyncModeUnsupported;
  const effectiveSyncDisabledReason =
    selectedSyncModeUnsupported
      ? "当前环境只支持随机抽样同步，请切换同步方式。"
      : syncDisabledReason;

  return (
    <div
      id="wechat-contacts-manager"
      className="grid gap-4 xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]"
    >
      
      <div className="flex min-w-0 flex-col gap-3">
        
        <div className="rounded-[8px] border border-default-200 bg-default-50 p-3">
          
          <div className="flex items-center justify-between gap-2">
            
            <p className="text-sm font-semibold text-default-900">
              同步方式
            </p><Chip
              size="sm"
              color="primary"
              variant="flat"
            >{
                contactSyncModeOption(
                  contactSyncMode,
                )
                  .label
              }</Chip>
          </div><div className="mt-3">
            
            <ContactSyncModeChooser
              value={
                contactSyncMode
              }
              onChange={
                setContactSyncMode
              }
              disabledModes={
                disabledSyncModes
              }
            />
          </div>{selectedSyncModeUnsupported ? (
            <div className="mt-3 rounded-[8px] border border-warning-200 bg-warning-50 p-3 text-xs leading-5 text-warning-800">
              当前环境只支持随机抽样同步；全部好友同步仅支持 Windows 桌面版微信。
            </div>
          ) : null}<div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Button
              color="primary"
              variant="flat"
              className="w-full"
              isLoading={
                contactsLoading
              }
              isDisabled={
                effectiveSyncDisabled
              }
              startContent={
                <RefreshCcw
                  size={
                    16
                  }
                />
              }
              onPress={
                onSync
              }
            >
              同步联系人
            </Button><Button
              variant="flat"
              className="w-full"
              isLoading={
                contactSaving
              }
              isDisabled={
                contactSaving
              }
              startContent={
                <Download
                  size={
                    16
                  }
                />
              }
              onPress={
                onExportDiagnostics
              }
            >
              
	              导出排查资料
            </Button>
          </div>
          {effectiveSyncDisabledReason ? (
            <p className="mt-2 text-xs leading-5 text-warning-700">{
                effectiveSyncDisabledReason
              }</p>
          ) : null}
        </div><div className="grid gap-2 sm:grid-cols-2">
          <Button
            variant="flat"
            className="w-full"
            isDisabled={
              contactsLoading ||
              !syncedContacts.length
            }
            onPress={
              onFillGroup
            }
          >
            填入群发
          </Button><Button
            variant="flat"
            className="w-full"
            isDisabled={
              contactsLoading ||
              !syncedContacts.length
            }
            onPress={
              onFillMarketing
            }
          >
            填入营销
          </Button><Button
            variant="flat"
            className="w-full"
            isLoading={
              contactSaving
            }
            isDisabled={
              contactSaving ||
              !structuredContacts.length
            }
            onPress={
              onExport
            }
          >
            导出联系人
          </Button><Button
            color="danger"
            variant="flat"
            className="w-full"
            isLoading={
              contactSaving
            }
            isDisabled={
              contactSaving ||
              !structuredContacts.length
            }
            onPress={
              onClear
            }
          >
            清空联系人
          </Button><Button
            as={Link}
            href="/engagement/wechat"
            variant="flat"
            className="w-full"
          >
            会话处理
          </Button><Button
            as={Link}
            href="/engagement/wechat-groups"
            variant="flat"
            className="w-full"
          >
            欢迎语群发
          </Button><Button
            as={Link}
            href="/engagement/customers"
            variant="flat"
            className="w-full"
          >
            客户跟进
          </Button>
        </div><ContactSyncReadinessPanel
          readiness={
            contactReadiness
          }
        /><ContactSyncDiagnosticsPanel
          diagnostics={
            syncDiagnostics
          }
          error={
            syncError
          }
          onExportDiagnostics={
            onExportDiagnostics
          }
        />
        <div className="grid gap-2 rounded-[8px] border border-default-200 p-3">
          
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              label="wxid"
              labelPlacement="outside"
              value={
                contactWxid
              }
              onValueChange={
                setContactWxid
              }
              placeholder="wxid_xxx / 微信号"
              isDisabled={Boolean(
                contactEditingWxid,
              )}
            />
            <Input
              label="昵称"
              labelPlacement="outside"
              value={
                contactNickname
              }
              onValueChange={
                setContactNickname
              }
              placeholder="客户昵称"
            />
            <Input
              label="备注"
              labelPlacement="outside"
              value={
                contactRemark
              }
              onValueChange={
                setContactRemark
              }
              placeholder="微信备注名"
            />
            <Input
              label="标签"
              labelPlacement="outside"
              value={
                contactTags
              }
              onValueChange={
                setContactTags
              }
              placeholder="逗号、顿号或换行分隔"
            />
          </div><div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="flat"
              onPress={
                onReset
              }
            >
              新增
            </Button><Button
              size="sm"
              color="primary"
              isLoading={
                contactSaving
              }
              isDisabled={
                contactSaving ||
                !contactWxid.trim()
              }
              onPress={
                onSave
              }
            >{contactEditingWxid
                ? "保存编辑"
                : "保存联系人"}</Button>
          </div>
        </div>
      </div><div className="rounded-[8px] border border-default-200">
        
        <div className="flex items-center justify-between border-b border-default-200 px-3 py-2">
          
          <span className="text-sm font-semibold">
            联系人
            {structuredContacts.length ||
              syncedContacts.length}</span><Button
            size="sm"
            variant="light"
            isLoading={
              contactsLoading
            }
            isDisabled={
              contactsLoading
            }
            onPress={
              onRefresh
            }
          >
            刷新
          </Button>
        </div><div className="max-h-[520px] overflow-auto p-2">{structuredContacts.length ? (
            <div className="grid gap-1">{structuredContacts.map(
                (
                  contact,
                ) =>{
                  const label =
                    structuredContactLabel(
                      contact,
                    );
                  return (
                    <div
                      key={
                        contact.wxid
                      }
                      className="grid gap-2 rounded-[8px] px-2 py-2 text-sm hover:bg-default-100"
                    >
                      <button
                        type="button"
                        className="min-w-0 text-left"
                        onClick={() =>
                          onAppendGroup(
                            label,
                          )
                        }
                      >
                        
                        <div className="flex min-w-0 items-center justify-between gap-2">
                          
                          <span className="truncate font-medium">{
                              label
                            }</span><span className="shrink-0 text-xs text-default-400">
                            追加
                          </span>
                        </div><div className="mt-1 grid gap-1 text-xs text-default-500">
                          
                          <span className="truncate">
                            wxid：
                            {
                              contact.wxid
                            }</span><span className="truncate">
                            昵称：
                            {contact.nickname ||
                              "-"}</span><span className="truncate">
                            备注：
                            {contact.remark ||
                              "-"}</span>
                        </div>
                      </button><div className="flex flex-wrap items-center justify-between gap-2">
                        
                        <div className="flex min-w-0 flex-wrap gap-1">{(
                            contact.tags ||
                            []
                          )
                            .length ? (
                            contact.tags.map(
                              (
                                tag,
                              ) => (
                                <Chip
                                  key={
                                    tag
                                  }
                                  size="sm"
                                  variant="flat"
                                >{
                                    tag
                                  }</Chip>
                              ),
                            )
                          ) : (
                            <span className="text-xs text-default-400">
                              无标签
                            </span>
                          )}</div><div className="flex shrink-0 gap-1">
                          <Button
                            size="sm"
                            variant="light"
                            isDisabled={
                              contactSaving
                            }
                            onPress={() =>
                              onEdit(
                                contact,
                              )
                            }
                          >
                            编辑
                          </Button><Button
                            size="sm"
                            color="danger"
                            variant="light"
                            isLoading={
                              contactSaving
                            }
                            isDisabled={
                              contactSaving
                            }
                            onPress={() =>
                              onRemove(
                                contact.wxid,
                              )
                            }
                          >
                            删除
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                },
              )}</div>
          ) : syncedContacts.length ? (
            <div className="grid gap-1">{syncedContacts.map(
                (
                  contact,
                ) => (
                  <button
                    key={
                      contact
                    }
                    type="button"
                    className="flex min-h-9 items-center justify-between rounded-[8px] px-2 text-left text-sm hover:bg-default-100"
                    onClick={() =>
                      onAppendGroup(
                        contact,
                      )
                    }
                  >
                    
                    <span className="truncate">{
                        contact
                      }</span><span className="text-xs text-default-400">
                      追加
                    </span>
                  </button>
                ),
              )}</div>
          ) : (
            <NoContactsEmptyState
              loading={
                contactsLoading
              }
              onRefresh={
                onSync
              }
              refreshDisabled={
                effectiveSyncDisabled
              }
              refreshDisabledReason={
                effectiveSyncDisabledReason
              }
              onOpenContacts={
                onOpenContacts
              }
              onExportDiagnostics={
                onExportDiagnostics
              }
            />
          )}</div>
      </div>
    </div>
  );
}
function PanelTitle({
  title,
  desc,
}: {
  title: string;
  desc: string;
}) {
  return (
    <div>
      
      <h2 className="text-lg font-semibold">{
          title
        }</h2><p className="mt-1 text-sm leading-6 text-default-500">{
          desc
        }</p>
    </div>
  );
}
function ChatHistoryPanel({
  sessionsResult,
  historyResult,
  selectedSessionId,
  sessionsLoading,
  historyLoading,
  syncLoading,
  onRefreshSessions,
  onSelectSession,
  onSync,
}: {
  sessionsResult: WechatChatSessionsResult | null;
  historyResult: WechatChatHistoryResult | null;
  selectedSessionId: string;
  sessionsLoading: boolean;
  historyLoading: boolean;
  syncLoading: boolean;
  onRefreshSessions: () => void;
  onSelectSession: (
    sessionId: string,
  ) => void;
  onSync: () => void;
}) {
  const sessions =
    sessionsResult?.sessions ||
    [];
  const selectedSession =
    sessions.find(
      (
        session,
      ) =>
        session.id ===
        selectedSessionId,
    ) ||
    historyResult?.session;
  const blockers =
    uniqueList(
      [
        ...(sessionsResult?.blockers ||
          []),
        ...(historyResult?.blockers ||
          []),
      ],
    );
  const warnings =
    uniqueList(
      [
        ...(sessionsResult?.warnings ||
          []),
        ...(historyResult?.warnings ||
          []),
      ],
    );
  const status =
    historyResult?.status ||
    sessionsResult?.status;
  return (
    <div className="grid gap-3 lg:grid-cols-[320px_1fr]">
      
      <div className="flex flex-col gap-3">
        
        <div className="flex flex-wrap items-start justify-between gap-3">
          <PanelTitle
            title="微信会话历史"
            desc="读取微信会话历史；微信资料或自动化处理暂未配置时显示需处理原因，不伪造消息。"
          />
          <Chip
            color={chatHistoryStatusColor(
              status,
            )}
            variant="flat"
	          >{chatHistoryStatusLabel(status)}</Chip>
        </div><div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="flat"
            isLoading={
              sessionsLoading
            }
            isDisabled={
              sessionsLoading
            }
            onPress={
              onRefreshSessions
            }
          >
            刷新会话
          </Button><Button
            size="sm"
            color="primary"
            variant="flat"
            isLoading={
              syncLoading
            }
            isDisabled={
              syncLoading
            }
            onPress={
              onSync
            }
          >
            
            同步历史
          </Button>
        </div><div className="rounded-[8px] border border-default-200">
          
          <div className="flex items-center justify-between border-b border-default-200 px-3 py-2 text-sm">
            
            <span className="font-semibold">
              会话
	              {sessionsResult?.count ??
	                sessions.length}</span><span className="text-xs text-default-400">{sourceLabel(sessionsResult?.source)}</span>
          </div><div className="max-h-[300px] overflow-auto p-2">{sessions.length ? (
              <div className="grid gap-1">{sessions.map(
                  (
                    session,
                  ) => (
                    <button
                      key={
                        session.id
                      }
                      type="button"
                      className={[
                        "rounded-[8px] px-2 py-2 text-left text-sm hover:bg-default-100",
                        session.id ===
                        selectedSessionId
                          ? "bg-primary-50 text-primary-700"
                          : "",
                      ].join(
                        " ",
                      )}
                      onClick={() =>
                        onSelectSession(
                          session.id,
                        )
                      }
                    >
                      
                      <div className="flex items-center justify-between gap-2">
                        
                        <span className="min-w-0 truncate font-medium">{session.title ||
                            session.contactName ||
                            session.id}</span>{session.unreadCount ? (
                          <Chip
                            size="sm"
                            color="warning"
                            variant="flat"
                          >{
                              session.unreadCount
                            }</Chip>
                        ) : null}</div><p className="mt-1 truncate text-xs text-default-500">{session.lastMessage ||
                          "无最近消息"}</p><p className="mt-1 text-xs text-default-400">{formatTime(
                          session.lastMessageAt ||
                            session.updatedAt,
                        )}</p>
                    </button>
                  ),
                )}</div>
            ) : (
              <div className="px-3 py-8 text-center text-sm text-default-500">
                
                暂无会话。若微信资料读取暂未配置，请查看右侧待处理原因。
              </div>
            )}</div>
        </div>
      </div><div className="flex min-w-0 flex-col gap-3">
        
        <div className="rounded-[8px] border border-default-200 p-3">
          
          <div className="flex flex-wrap items-center justify-between gap-2">
            
            <div className="min-w-0">
              
              <p className="truncate text-sm font-semibold">{selectedSession?.title ||
                  selectedSession?.contactName ||
                  "未选择会话"}</p><p className="text-xs leading-5 text-default-500">
                来源
	                {sourceLabel(historyResult?.source || sessionsResult?.source)}
                ·
                同步
                {formatTime(
                  historyResult?.syncedAt ||
                    sessionsResult?.syncedAt,
                )}</p>
            </div><Chip
              color={chatHistoryStatusColor(
                historyResult?.status,
              )}
              variant="flat"
	            >{chatHistoryStatusLabel(historyResult?.status)}</Chip>
          </div>{blockers.length ? (
            <div className="mt-3 rounded-[8px] bg-danger-50 px-3 py-2 text-xs leading-5 text-danger-700">
              
              <p className="font-semibold">
                待处理原因
              </p>{blockers.map(
                (
                  blocker,
                ) => (
                  <p
                    key={
	                      wechatBusinessText(blocker)
                    }
                  >{
                      blocker
                    }</p>
                ),
              )}
              {historyResult?.nextAction ||
              sessionsResult?.nextAction ? (
                <p className="mt-1 text-danger-600">
                  下一步：
	                  {wechatBusinessText(historyResult?.nextAction ||
	                    sessionsResult?.nextAction)}</p>
              ) : null}</div>
          ) : null}
          {warnings.length ? (
            <div className="mt-3 rounded-[8px] bg-warning-50 px-3 py-2 text-xs leading-5 text-warning-700">{warnings.map(
                (
                  warning,
                ) => (
                  <p
                    key={
	                      wechatBusinessText(warning)
                    }
                  >{
                      warning
                    }</p>
                ),
              )}</div>
          ) : null}</div><div className="rounded-[8px] border border-default-200">
          
          <div className="flex items-center justify-between border-b border-default-200 px-3 py-2 text-sm">
            
            <span className="font-semibold">
              历史消息
              {historyResult?.count ??
                historyResult
                  ?.messages
                  .length ??
                0}</span>{historyLoading ? (
              <span className="text-xs text-default-400">
                读取中...
              </span>
            ) : null}</div><div className="max-h-[360px] overflow-auto p-3">{historyResult
              ?.messages
              .length ? (
              <div className="grid gap-2">{historyResult.messages.map(
                  (
                    message,
                  ) => (
                    <div
                      key={
                        message.id
                      }
                      className="rounded-[8px] bg-default-50 px-3 py-2 text-sm"
                    >
                      
                      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-default-500">
                        <Chip
                          size="sm"
                          variant="flat"
                        >{chatDirectionLabel(
                            message.direction,
                          )}</Chip><span>{message.senderName ||
                            "未知发送方"}</span><span>{formatTime(
                            message.sentAt ||
                              message.createdAt,
                          )}</span>
                      </div><p className="whitespace-pre-wrap break-words text-default-800">{
                          message.content
                        }</p>
                    </div>
                  ),
                )}</div>
            ) : (
              <div className="px-3 py-10 text-center text-sm leading-6 text-default-500">
		                暂无历史消息。请先完成微信资料读取设置，或重新同步查看待处理原因。
              </div>
            )}</div>
        </div>
      </div>
    </div>
  );
}

function planTargetStatusMeta(target: InteractionBatchTarget) {
  const hasEvidence = Boolean(
    target.evidenceRef || target.evidenceEventIds?.length,
  );
  if (target.status === "completed") {
    return {
      color: hasEvidence ? ("success" as const) : ("warning" as const),
      label: hasEvidence ? "完成（有证据）" : "完成，待证据核验",
    };
  }
  if (target.status === "failed") {
    return { color: "danger" as const, label: "失败" };
  }
  if (target.status === "running") {
    return { color: "primary" as const, label: "执行中" };
  }
  if (target.status === "waiting_confirmation") {
    return { color: "warning" as const, label: "等待确认" };
  }
  if (target.status === "skipped") {
    return { color: "default" as const, label: "已跳过" };
  }
  if (target.status === "no_target") {
    return { color: "warning" as const, label: "未找到对象" };
  }
  return { color: "default" as const, label: "排队未发送" };
}

function PlanRow({
  task,
  actionId,
  onAction,
}: {
  task: InteractionTask;
  actionId: string;
  onAction: (
    action: WechatPlanAction,
  ) => void;
}) {
  const [showAllTargets, setShowAllTargets] = React.useState(false);
  const total =
    countTargets(
      task,
    );
  const done =
    task
      .batchSummary
      ?.completed ||
    0;
  const failed =
    task
      .batchSummary
      ?.failed ||
    0;
  const pending =
    Math.max(
      (task
        .batchSummary
        ?.queued ||
        0) +
        (task
          .batchSummary
          ?.running ||
          0) +
        (task
          .batchSummary
          ?.waitingConfirmation ||
          0),
      total -
        done -
        failed -
        (task
          .batchSummary
          ?.skipped ||
          0) -
        (task
          .batchSummary
          ?.noTarget ||
          0),
      0,
    );
  const canStart =
    task.status ===
      "waiting_for_send_confirmation";
  const canPause =
    task.status ===
      "queued" ||
    task.status ===
      "running" ||
    task.status ===
      "waiting_for_send_confirmation";
  const canResume =
    task.status ===
    "paused";
  const canRetry = retryableTargetCountForPlan(task) > 0;
  const loading =
    (
      action: WechatPlanAction,
    ) =>
      actionId ===
      `${task.id}:${action}`;
  const failureReason =
    failureReasonForPlan(
      task,
    );
  const evidenceCount =
    evidenceCountForPlan(
      task,
    );
  const evidenceHref =
    evidenceHrefForPlan(
      task,
    );
  const executionModeMeta =
    planExecutionModeMeta(
      task,
    );
  const targetResults = task.batchTargets || [];
  const visibleTargetResults = showAllTargets
    ? targetResults
    : targetResults.slice(0, 5);
  return (
    <div className="rounded-[8px] border border-default-200 p-3">
      
      <div className="flex flex-wrap items-start justify-between gap-3">
        
        <div className="min-w-0 flex-1">
          
          <div className="flex flex-wrap items-center gap-2">
            <Chip
              size="sm"
              color={statusColor(
                task.status,
              )}
              variant="flat"
            >{planExecutionLabel(
                task,
              )}</Chip>{task.planStatus ? (
              <Chip
                size="sm"
                variant="flat"
              >{planStatusLabel(
                  task,
                )}</Chip>
            ) : null}<Chip
              color={executionModeMeta.color}
              size="sm"
              title={executionModeMeta.description}
              variant="flat"
            >{executionModeMeta.label}</Chip><Chip
              size="sm"
              variant="flat"
            >{typeLabel(
                task.type,
              )}</Chip><span className="min-w-0 truncate text-sm font-semibold text-default-900">{planName(
                task,
              )}</span>
          </div><div className="mt-2 grid gap-2 text-xs leading-5 text-default-600 md:grid-cols-2 xl:grid-cols-3">
            <PlanMetaItem
              label="计划时间"
              value={planScheduleLabel(
                task,
              )}
            />
            <PlanMetaItem
              label="每日上限"
              value={planDailyLimitLabel(
                task,
              )}
            />
            <PlanMetaItem
              label="关联微信号"
              value={planWechatAccountLabel(
                task,
              )}
            />
            <PlanMetaItem
              label="目标对象"
              value={planTargetLabel(
                task,
              )}
            />
            <PlanMetaItem
              label="目标统计"
              value={planStatsLabel(
                task,
                total,
                pending,
                done,
                failed,
              )}
              wide
            />
            <PlanMetaItem
              label="更新时间"
              value={formatTime(
                task.updatedAt,
              )}
            />
          </div>{failureReason ? (
            <p className="mt-2 rounded-[8px] bg-danger-50 px-2 py-1 text-xs leading-5 text-danger-700">
              
              失败原因：
              {
                failureReason
              }</p>
          ) : null}</div><div className="flex flex-wrap justify-end gap-1">
          <Button
            as={
              Link
            }
            href={
              evidenceHref
            }
            size="sm"
            variant="flat"
            isDisabled={
              !evidenceCount
            }
          >
            证据
            {
              evidenceCount
            }</Button><Button
            as={
              Link
            }
            href={
              task.type === "wechat-moments-publish" ||
              task.type === "wechat-moments-marketing"
                ? `/engagement/wechat-moments/detail?planId=${encodeURIComponent(task.id)}`
                : `/local-engine?tab=tasks&taskId=${encodeURIComponent(task.id)}`
            }
            size="sm"
            variant="flat"
          >
            详情
          </Button>{task.status === "blocked" ? (
            <Button
              as={Link}
              href={`/local-engine?tab=tasks&taskId=${encodeURIComponent(task.id)}`}
              size="sm"
              color="warning"
              variant="flat"
            >
              查看原因
            </Button>
          ) : null}<Button
            size="sm"
            color="primary"
            variant="flat"
            isLoading={loading(
              "continue",
            )}
            isDisabled={
              !canStart ||
              Boolean(
                actionId,
              )
            }
            onPress={() =>
              onAction(
                "continue",
              )
            }
          >
            启动
          </Button><Button
            size="sm"
            variant="flat"
            isLoading={loading(
              "pause",
            )}
            isDisabled={
              !canPause ||
              Boolean(
                actionId,
              )
            }
            onPress={() =>
              onAction(
                "pause",
              )
            }
          >
            暂停
          </Button><Button
            size="sm"
            variant="flat"
            isLoading={loading(
              "resume",
            )}
            isDisabled={
              !canResume ||
              Boolean(
                actionId,
              )
            }
            onPress={() =>
              onAction(
                "resume",
              )
            }
          >
            恢复
          </Button><Button
            size="sm"
            variant="flat"
            isLoading={loading(
              "retry",
            )}
            isDisabled={
              !canRetry ||
              Boolean(
                actionId,
              )
            }
            onPress={() =>
              onAction(
                "retry",
              )
            }
          >
            重发
          </Button><Button
            size="sm"
            color="danger"
            variant="flat"
            isLoading={loading(
              "delete",
            )}
            isDisabled={Boolean(
              actionId,
            ) || task.status === "running"}
            onPress={() =>
              onAction(
                "delete",
              )
            }
          >
            
            删除
          </Button>
        </div>
      </div>
      <div className="mt-3 border-t border-default-200 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold text-default-800">
            逐对象结果 {targetResults.length ? `(${targetResults.length})` : ""}
          </p>
          {targetResults.length > 5 ? (
            <Button
              size="sm"
              variant="light"
              onPress={() => setShowAllTargets((value) => !value)}
            >
              {showAllTargets ? "收起" : `查看全部 ${targetResults.length} 个`}
            </Button>
          ) : null}
        </div>
        {visibleTargetResults.length ? (
          <div className="mt-2 grid gap-2">
            {visibleTargetResults.map((target) => {
              const resultMeta = planTargetStatusMeta(target);
              return (
                <div
                  key={target.id}
                  className="grid gap-2 rounded-[6px] border border-default-200 bg-default-50 px-3 py-2 text-xs md:grid-cols-[minmax(0,1fr)_auto] md:items-start"
                >
                  <div className="min-w-0">
                    <p className="break-words font-medium text-default-800">
                      {target.targetName || "未命名对象"}
                    </p>
                    {target.failureReason ? (
                      <p className="mt-1 break-words text-danger-700">
                        {commercialDisplayText(target.failureReason)}
                      </p>
                    ) : null}
                    {target.nextAction ? (
                      <p className="mt-1 break-words text-default-600">
                        下一步：{commercialDisplayText(target.nextAction)}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 md:justify-end">
                    <Chip color={resultMeta.color} size="sm" variant="flat">
                      {resultMeta.label}
                    </Chip>
                    {target.evidenceRef || target.evidenceEventIds?.length ? (
                      <Chip color="success" size="sm" variant="flat">
                        有证据
                      </Chip>
                    ) : null}
                    <span className="text-default-400">
                      {formatTime(target.updatedAt)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mt-2 rounded-[6px] bg-default-50 px-3 py-2 text-xs leading-5 text-default-500">
            服务尚未返回逐对象明细，当前不能判定已送达；请查看任务详情。
          </p>
        )}
      </div>
    </div>
  );
}
function PlanMetaItem({
  label,
  value,
  wide,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div
      className={
        wide
          ? "min-w-0 md:col-span-2 xl:col-span-1"
          : "min-w-0"
      }
    >
      
      <span className="text-default-400">{
          label
        }
        ：
      </span><span className="break-words text-default-700">{value ||
          "-"}</span>
    </div>
  );
}
function SyncedContactsTools({
  count,
  loading,
  contacts,
  diagnostics,
  error,
  syncDisabled = false,
  syncDisabledReason = "",
  onRefresh,
  onFill,
  onAppend,
  onOpenContacts,
  onExportDiagnostics,
}: {
  count: number;
  loading: boolean;
  contacts: string[];
  diagnostics?: WechatContactsSyncDiagnostics | null;
  error?: string;
  syncDisabled?: boolean;
  syncDisabledReason?: string;
  onRefresh: () => void;
  onFill: () => void;
  onAppend: () => void;
  onOpenContacts?: () => void;
  onExportDiagnostics?: () => void;
}) {
  const disabled =
    loading ||
    count ===
      0;
  const refreshDisabled =
    loading ||
    syncDisabled;
  const signals =
    buildContactSignalItems(
      diagnostics,
    );
  return (
    <div className="rounded-[8px] border border-default-200 bg-default-50 p-3">
      
      <div className="grid gap-3">
        
        <div className="min-w-0">
          
          <div className="flex flex-wrap items-center gap-2">
            
            <p className="text-sm font-semibold text-default-900">
              同步名单
            </p><Chip
              size="sm"
              variant="flat"
              color={
                count
                  ? "success"
                  : "default"
              }
            >{
                count
              }
              个联系人
            </Chip>
          </div><p className="mt-1 text-xs leading-5 text-default-500">{count
              ? `已从${sourceLabel(diagnostics?.source)}读取联系人，可填入当前任务。`
              : "当前没有可用联系人，请先刷新微信通讯录或进入联系人页查看诊断。"}</p>
          {signals.length ? (
            <div className="mt-2 grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2">{signals.map(
                (
                  signal,
                ) => (
                  <div
                    key={
                      signal.key
                    }
                    className="min-w-0 rounded-[8px] border border-default-200 bg-background px-2 py-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[11px] font-medium text-default-600">{
                          signal.label
                        }</span><Chip
                        size="sm"
                        color={diagnosticStatusColor(
                          signal.status,
                        )}
                        variant="flat"
                      >{diagnosticStatusLabel(
                          signal.status,
                        )}</Chip>
                    </div><p className="mt-1 truncate text-[11px] text-default-400">{
                        signal.detail
                      }</p>
                  </div>
                ),
              )}</div>
          ) : null}
          {syncDisabledReason ? (
            <p className="mt-2 text-xs leading-5 text-warning-600">{
                syncDisabledReason
              }</p>
          ) : null}
        </div><div className="grid grid-cols-[repeat(auto-fit,minmax(132px,1fr))] gap-2">
          <Button
            size="sm"
            variant="flat"
            className="w-full"
            isLoading={
              loading
            }
            isDisabled={
              refreshDisabled
            }
            startContent={
              <RefreshCcw
                size={
                  15
                }
              />
            }
            onPress={
              onRefresh
            }
          >
            同步通讯录
          </Button><Button
            size="sm"
            color="primary"
            variant="flat"
            className="w-full"
            isDisabled={
              disabled
            }
            onPress={
              onFill
            }
          >
            填入全部
          </Button><Button
            size="sm"
            variant="flat"
            className="w-full"
            isDisabled={
              disabled
            }
            onPress={
              onAppend
            }
          >
            
            追加
          </Button>
        </div>
      </div>{!contacts.length ? (
        <div className="mt-3">
          
          <NoContactsEmptyState
            loading={
              loading
            }
            onRefresh={
              onRefresh
            }
            refreshDisabled={
              refreshDisabled
            }
            refreshDisabledReason={
              syncDisabledReason
            }
            onOpenContacts={
              onOpenContacts
            }
            onExportDiagnostics={
              onExportDiagnostics
            }
          />
        </div>
      ) : null}
      {diagnostics ||
      error ? (
        <div className="mt-3">
          
          <ContactSyncDiagnosticsPanel
            diagnostics={
              diagnostics
            }
            error={
              error
            }
            onExportDiagnostics={
              onExportDiagnostics
            }
          />
        </div>
      ) : null}
      {contacts.length ? (
        <div className="mt-2 flex flex-wrap gap-1">{contacts
            .slice(
              0,
              8,
            )
            .map(
              (
                contact,
              ) => (
                <Chip
                  key={
                    contact
                  }
                  size="sm"
                  variant="flat"
                >{
                    contact
                  }</Chip>
              ),
            )}
          {contacts.length >
          8 ? (
            <Chip
              size="sm"
              variant="flat"
            >
              +
              {contacts.length -
                8}</Chip>
          ) : null}</div>
      ) : null}</div>
  );
}
