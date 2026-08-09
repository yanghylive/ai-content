"use client";

import React from "react";
import {
  Button,
  Card,
  CardBody,
  Chip,
  Divider,
  Spinner,
  Textarea,
} from "@heroui/react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardPaste,
  DatabaseZap,
  FileSpreadsheet,
  Fingerprint,
  History,
  LockKeyhole,
  PlayCircle,
  RefreshCw,
  ShieldCheck,
  UploadCloud,
  Wand2,
} from "lucide-react";
import toast from "@/lib/toast";
import { FunctionalEmptyState } from "../../components/functional-empty-state";
import * as crmApi from "@/lib/api/crm";
import { getCrmAppState, type MarketAppState } from "@/lib/api/app-market";
import { commercialDisplayText } from "@/lib/commercial-display-text";
import { toPublicError } from "@/lib/public-error";
import type {
  CrmImportCommitResponse,
  CrmImportBatch,
  CrmAuditEvent,
  CrmImportDryRunResponse,
  CrmImportIssue,
  CrmImportPreviewRow,
  CrmImportRollbackResponse,
} from "@/lib/api/crm";

type TargetField =
  | "displayName"
  | "companyName"
  | "title"
  | "email"
  | "phone"
  | "wechat"
  | "status"
  | "sourcePlatform"
  | "sourceKeyword"
  | "sourceText"
  | "latestReply"
  | "score"
  | "tags"
  | "profileUrl"
  | "externalUserId"
  | "dedupeKey"
  | "owner"
  | "ignore";

type Severity = "danger" | "warning" | "default";

interface ColumnInsight {
  source: string;
  sample: string;
  nonEmpty: number;
  unique: number;
  suggestedField: TargetField;
  confidence: number;
  pii: string[];
  warnings: string[];
}

interface QualityWarning {
  severity: Severity;
  scope: string;
  message: string;
}

interface PreviewRow {
  rowNumber: number;
  displayName: string;
  companyName: string;
  contact: string;
  tags: string;
  action: "ready_for_review" | "dedupe_review" | "blocked";
  reason: string;
}

interface AuditItem {
  label: string;
  value: string;
}

interface ImportDryRunResult {
  proofId: string;
  proofHash: string;
  createdAt: string;
  adapter: "frontend-local" | "crm-api-adapter";
  delimiter: string;
  rowCount: number;
  columnCount: number;
  importableRows: number;
  duplicateRows: number;
  piiColumns: number;
  columns: ColumnInsight[];
  warnings: QualityWarning[];
  previewRows: PreviewRow[];
  audit: AuditItem[];
}

const SAMPLE_DATA = [
  "姓名,公司,职位,手机号,邮箱,微信,来源平台,来源关键词,线索内容,最近回复,标签,评分",
  "林知夏,星禾口腔,运营负责人,13800138000,lin@example.com,lin_zhixia,小红书,牙科私域,咨询门店获客和企微承接,希望本周看演示,口腔;私域,82",
  "Michael Chen,Northwind Dental,Partner,+1 415 555 0138,m.chen@northwind.example,mchen_sf,Webinar,CRM 迁移,询问安全导入和操作留痕,发送导入检查清单,enterprise;演示,76",
  "周明,星禾口腔,市场经理,13800138000,zhouming@example.com,zhou_ming,视频号,牙科私域,同公司重复手机号需要去重,等待预算确认,重复线索,68",
  "匿名访客,未识别公司,,not-an-email,,visitor-8848,官网表单,报价,只留下了需求描述没有电话,需要人工补齐联系方式,待补全,41",
].join("\n");

const TARGET_LABELS: Record<TargetField, string> = {
  displayName: "联系人姓名",
  companyName: "公司",
  title: "职位",
  email: "邮箱",
  phone: "手机号",
  wechat: "微信",
  status: "跟进状态",
  sourcePlatform: "来源平台",
  sourceKeyword: "来源关键词",
  sourceText: "来源内容",
  latestReply: "最近回复",
  score: "线索评分",
  tags: "标签",
  profileUrl: "主页链接",
  externalUserId: "外部用户 ID",
  dedupeKey: "去重键",
  owner: "跟进人",
  ignore: "暂不导入",
};

const FIELD_KEYWORDS: Record<Exclude<TargetField, "ignore">, string[]> = {
  displayName: [
    "name",
    "fullname",
    "customer",
    "contact",
    "姓名",
    "昵称",
    "客户名",
    "联系人",
  ],
  companyName: ["company", "account", "org", "公司", "企业", "客户公司"],
  title: ["title", "job", "role", "position", "职位", "岗位", "职务"],
  email: ["email", "mail", "e-mail", "邮箱", "邮件"],
  phone: ["phone", "mobile", "tel", "cell", "手机号", "电话", "手机"],
  wechat: ["wechat", "weixin", "wx", "微信", "企微", "企业微信"],
  status: ["status", "stage", "状态", "阶段", "跟进状态"],
  sourcePlatform: ["platform", "channel", "来源平台", "渠道", "来源渠道"],
  sourceKeyword: ["keyword", "campaign", "utm", "关键词", "来源关键词"],
  sourceText: [
    "sourcecontent",
    "sourcetext",
    "note",
    "需求",
    "来源内容",
    "线索内容",
  ],
  latestReply: ["reply", "latestreply", "lastmessage", "最近回复", "最近沟通"],
  score: ["score", "rating", "分数", "评分", "线索评分"],
  tags: ["tag", "tags", "label", "标签", "分组"],
  profileUrl: ["url", "link", "profile", "homepage", "链接", "主页"],
  externalUserId: ["externalid", "openid", "unionid", "外部id", "外部用户"],
  dedupeKey: ["dedupe", "uniquekey", "fingerprint", "去重", "唯一键"],
  owner: ["owner", "assignee", "sales", "跟进人", "负责人", "销售"],
};

const FIELD_PRIORITY: Partial<Record<TargetField, number>> = {
  displayName: 9,
  phone: 8,
  email: 8,
  wechat: 7,
  companyName: 7,
  sourceText: 5,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_FIND_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_FIND_RE = /(?:\+?\d[\d\s().-]{6,}\d)/;
const URL_FIND_RE = /https?:\/\/[^\s]+/i;

function normalizeHeader(value: string) {
  return value
    .toLowerCase()
    .replace(/[\s_\-:/\\|()[\]{}."'`]+/g, "")
    .trim();
}

function displayDelimiter(delimiter: string) {
  if (delimiter === "\t") return "表格制表符";
  if (delimiter === ",") return "CSV 逗号";
  if (delimiter === ";") return "分号";
  if (delimiter === "|") return "竖线";
  return "自动识别";
}

function displayImportAuditLabel(label: string) {
  const labels: Record<string, string> = {
    mode: "检查模式",
    crm_write: "客户写入",
    token_usage: "第三方授权",
    external_crm: "第三方 CRM",
    future_gate: "后续确认",
    api_adapter: "检查服务",
  };
  return labels[label] || label.replace(/_/g, " ");
}

function visibleAuditItems(items: AuditItem[]) {
  const visibleLabels = new Set([
    "mode",
    "crm_write",
    "token_usage",
    "第三方授权",
    "external_crm",
    "future_gate",
    "api_adapter",
  ]);
  return items.filter((item) => visibleLabels.has(item.label));
}

function displayImportAuditValue(value: string) {
  return commercialDisplayText(
    String(value)
      .replace(/dry-run/gi, "仅检查")
      .replace(/blocked\/commit:false/gi, "需确认后写入")
      .replace(/blocked\/no-write/gi, "写入已关闭")
      .replace(/0\/no-token/gi, "未使用第三方授权")
      .replace(/not_touched/gi, "未触碰")
      .replace(/manual-confirmation-required/gi, "需要人工确认")
      .replace(/\bnone\b/gi, "无")
      .replace(/no-token/gi, "第三方授权关闭")
      .replace(/no-write/gi, "写入关闭"),
  );
}

function displayImportStatus(value: string) {
  return commercialDisplayText(
    String(value)
      .replace(/dry-run/gi, "仅检查")
      .replace(/committed/gi, "已导入")
      .replace(/rolled_back/gi, "已回滚")
      .replace(/rollback/gi, "回滚")
      .replace(/success/gi, "成功")
      .replace(/failed/gi, "失败"),
  );
}

function detectDelimiter(rawText: string) {
  const firstLines = rawText.split(/\r?\n/).slice(0, 5);
  const candidates = ["\t", ",", ";", "|"];
  const scores = candidates.map((candidate) => ({
    candidate,
    score: firstLines.reduce(
      (sum, line) => sum + countDelimiterOutsideQuotes(line, candidate),
      0,
    ),
  }));
  scores.sort((a, b) => b.score - a.score);
  return scores[0]?.score ? scores[0].candidate : ",";
}

function countDelimiterOutsideQuotes(line: string, delimiter: string) {
  let count = 0;
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes && char === delimiter) {
      count += 1;
    }
  }
  return count;
}

function parseDelimitedText(rawText: string) {
  const delimiter = detectDelimiter(rawText);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const normalized = rawText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (char === '"') {
      if (inQuotes && normalized[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && char === delimiter) {
      row.push(cell.trim());
      cell = "";
      continue;
    }
    if (!inQuotes && char === "\n") {
      row.push(cell.trim());
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }

  row.push(cell.trim());
  if (row.some((value) => value.trim())) rows.push(row);

  const rawHeaders = rows[0] || [];
  const headerCounts = new Map<string, number>();
  const headers = rawHeaders.map((header, index) => {
    const base = header.trim() || `column_${index + 1}`;
    const count = headerCounts.get(base) || 0;
    headerCounts.set(base, count + 1);
    return count ? `${base}_${count + 1}` : base;
  });
  const dataRows = rows.slice(1).map((cells) =>
    headers.reduce<Record<string, string>>((record, header, index) => {
      record[header] = cells[index]?.trim() || "";
      return record;
    }, {}),
  );

  return { delimiter, headers, rows: dataRows, rawRowCount: rows.length };
}

function inferField(
  header: string,
  values: string[],
): {
  field: TargetField;
  confidence: number;
} {
  const normalized = normalizeHeader(header);
  const scored = Object.entries(FIELD_KEYWORDS).map(([field, keywords]) => {
    const exact = keywords.some(
      (keyword) => normalized === normalizeHeader(keyword),
    );
    const partial = keywords.some((keyword) =>
      normalized.includes(normalizeHeader(keyword)),
    );
    const sampleBoost = scoreFieldBySamples(field as TargetField, values);
    const priority = FIELD_PRIORITY[field as TargetField] || 0;
    return {
      field: field as TargetField,
      score: (exact ? 72 : partial ? 54 : 0) + sampleBoost + priority,
    };
  });
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < 28) return { field: "ignore", confidence: 18 };
  return { field: best.field, confidence: Math.min(98, best.score) };
}

function scoreFieldBySamples(field: TargetField, values: string[]) {
  const nonEmpty = values.filter(Boolean);
  if (!nonEmpty.length) return 0;
  const hitRate = (predicate: (value: string) => boolean) =>
    nonEmpty.filter(predicate).length / nonEmpty.length;
  if (field === "email")
    return hitRate((value) => EMAIL_FIND_RE.test(value)) * 32;
  if (field === "phone")
    return hitRate((value) => PHONE_FIND_RE.test(value)) * 30;
  if (field === "profileUrl")
    return hitRate((value) => URL_FIND_RE.test(value)) * 22;
  if (field === "score") {
    return hitRate((value) => Number.isFinite(Number(value))) * 18;
  }
  return 0;
}

function detectPii(field: TargetField, values: string[]) {
  const pii = new Set<string>();
  if (field === "displayName") pii.add("identity");
  if (field === "email") pii.add("email");
  if (field === "phone") pii.add("phone");
  if (field === "wechat") pii.add("wechat_id");
  if (field === "profileUrl") pii.add("profile_url");
  values.forEach((value) => {
    if (EMAIL_FIND_RE.test(value)) pii.add("email");
    if (PHONE_FIND_RE.test(value)) pii.add("phone");
    if (URL_FIND_RE.test(value)) pii.add("profile_url");
  });
  return Array.from(pii);
}

function buildColumnInsights(
  headers: string[],
  rows: Record<string, string>[],
) {
  const usedFields = new Set<TargetField>();
  return headers.map<ColumnInsight>((header) => {
    const values = rows.map((row) => row[header] || "");
    const nonEmptyValues = values.filter(Boolean);
    const uniqueValues = new Set(
      nonEmptyValues.map((value) => value.toLowerCase()),
    );
    const inferred = inferField(header, nonEmptyValues);
    let suggestedField = inferred.field;
    let confidence = inferred.confidence;

    if (suggestedField !== "ignore" && usedFields.has(suggestedField)) {
      suggestedField = "ignore";
      confidence = 24;
    }
    if (suggestedField !== "ignore") usedFields.add(suggestedField);

    const pii = detectPii(suggestedField, nonEmptyValues);
    const warnings: string[] = [];
    const missingRatio = rows.length
      ? (rows.length - nonEmptyValues.length) / rows.length
      : 0;
    if (missingRatio > 0.4) warnings.push("空值偏高");
    if (suggestedField === "email") {
      const invalidEmails = nonEmptyValues.filter(
        (value) => !EMAIL_RE.test(value),
      );
      if (invalidEmails.length)
        warnings.push(`${invalidEmails.length} 条邮箱格式异常`);
    }
    if (suggestedField === "score") {
      const invalidScores = nonEmptyValues.filter(
        (value) => !Number.isFinite(Number(value)),
      );
      if (invalidScores.length)
        warnings.push(`${invalidScores.length} 条评分非数字`);
    }
    if (suggestedField === "ignore") warnings.push("未匹配 CRM 字段");

    return {
      source: header,
      sample: nonEmptyValues[0] || "-",
      nonEmpty: nonEmptyValues.length,
      unique: uniqueValues.size,
      suggestedField,
      confidence: Math.round(confidence),
      pii,
      warnings,
    };
  });
}

function valueForField(
  field: TargetField,
  row: Record<string, string>,
  insights: ColumnInsight[],
) {
  const column = insights.find((insight) => insight.suggestedField === field);
  return column ? row[column.source] || "" : "";
}

function buildDedupeKey(
  row: Record<string, string>,
  insights: ColumnInsight[],
) {
  const explicitKey = valueForField("dedupeKey", row, insights);
  if (explicitKey) return explicitKey.toLowerCase();
  const email = valueForField("email", row, insights);
  const phone = valueForField("phone", row, insights);
  const wechat = valueForField("wechat", row, insights);
  if (email) return `email:${email.toLowerCase()}`;
  if (phone) return `phone:${phone.replace(/\D/g, "")}`;
  if (wechat) return `wechat:${wechat.toLowerCase()}`;
  return [
    valueForField("displayName", row, insights).toLowerCase(),
    valueForField("companyName", row, insights).toLowerCase(),
  ]
    .filter(Boolean)
    .join("|");
}

function buildPreviewRows(
  rows: Record<string, string>[],
  insights: ColumnInsight[],
  duplicateKeys: Set<string>,
) {
  return rows.slice(0, 8).map<PreviewRow>((row, index) => {
    const displayName = valueForField("displayName", row, insights);
    const companyName = valueForField("companyName", row, insights);
    const phone = valueForField("phone", row, insights);
    const email = valueForField("email", row, insights);
    const wechat = valueForField("wechat", row, insights);
    const key = buildDedupeKey(row, insights);
    const contact = phone || email || wechat;
    let action: PreviewRow["action"] = "ready_for_review";
    let reason = "字段完整，等待人工确认";
    if (!displayName && !contact) {
      action = "blocked";
      reason = "缺少姓名和联系方式";
    } else if (key && duplicateKeys.has(key)) {
      action = "dedupe_review";
      reason = "命中重复线索候选";
    }
    return {
      rowNumber: index + 2,
      displayName: displayName || "-",
      companyName: companyName || "-",
      contact: maskContact(contact || "-"),
      tags: valueForField("tags", row, insights) || "-",
      action,
      reason,
    };
  });
}

function buildQualityWarnings(
  rows: Record<string, string>[],
  insights: ColumnInsight[],
  duplicateRows: number,
  rawRowCount: number,
) {
  const warnings: QualityWarning[] = [];
  const mappedFields = new Set(
    insights.map((insight) => insight.suggestedField),
  );
  if (!mappedFields.has("displayName")) {
    warnings.push({
      severity: "danger",
      scope: "字段映射",
      message: "未识别联系人姓名字段，正式导入前必须人工指定。",
    });
  }
  if (
    !mappedFields.has("phone") &&
    !mappedFields.has("email") &&
    !mappedFields.has("wechat")
  ) {
    warnings.push({
      severity: "danger",
      scope: "联系方式",
      message: "未识别电话、邮箱或微信，无法形成可跟进线索。",
    });
  }
  if (duplicateRows > 0) {
    warnings.push({
      severity: "warning",
      scope: "去重",
      message: `检测到 ${duplicateRows} 行共享同一联系方式或去重键。`,
    });
  }
  if (rawRowCount > rows.length + 1) {
    warnings.push({
      severity: "warning",
      scope: "行结构",
      message: "部分空行已跳过，检查结果只展示有效数据行。",
    });
  }
  insights.forEach((insight) => {
    insight.warnings.forEach((warning) => {
      warnings.push({
        severity: insight.suggestedField === "ignore" ? "default" : "warning",
        scope: insight.source,
        message: warning,
      });
    });
  });
  if (!warnings.length) {
    warnings.push({
      severity: "default",
      scope: "数据质量",
      message: "未发现阻塞项，仍需业务负责人确认映射后才能正式导入。",
    });
  }
  return warnings;
}

function getDuplicateKeys(
  rows: Record<string, string>[],
  insights: ColumnInsight[],
) {
  const counts = new Map<string, number>();
  rows.forEach((row) => {
    const key = buildDedupeKey(row, insights);
    if (!key) return;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return new Set(
    Array.from(counts.entries())
      .filter(([, count]) => count > 1)
      .map(([key]) => key),
  );
}

function maskContact(value: string) {
  if (!value || value === "-") return value;
  if (value.includes("@")) {
    const [name, domain] = value.split("@");
    return `${name.slice(0, 2)}***@${domain || "***"}`;
  }
  const compact = value.replace(/\s/g, "");
  if (compact.length <= 6) return `${compact.slice(0, 2)}***`;
  return `${compact.slice(0, 3)}****${compact.slice(-2)}`;
}

function maskSample(value: string, pii: string[]) {
  if (!pii.length || value === "-") return value;
  if (pii.includes("email") || value.includes("@")) return maskContact(value);
  if (pii.includes("phone") || PHONE_FIND_RE.test(value))
    return maskContact(value);
  if (pii.includes("identity")) return `${value.slice(0, 1)}*`;
  return value.length > 10 ? `${value.slice(0, 8)}...` : value;
}

function actionLabel(action: PreviewRow["action"]) {
  if (action === "blocked") return "阻塞";
  if (action === "dedupe_review") return "去重复核";
  return "待确认";
}

function actionColor(action: PreviewRow["action"]): Severity | "success" {
  if (action === "blocked") return "danger";
  if (action === "dedupe_review") return "warning";
  return "success";
}

function severityColor(severity: Severity) {
  return severity === "danger"
    ? "danger"
    : severity === "warning"
      ? "warning"
      : "default";
}

function hasCriticalWarning(warnings: QualityWarning[]) {
  return warnings.some((warning) => warning.severity === "danger");
}

async function sha256(value: string) {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const encoded = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", encoded);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fallback-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

async function buildLocalDryRun(rawText: string): Promise<ImportDryRunResult> {
  const parsed = parseDelimitedText(rawText);
  const columns = buildColumnInsights(parsed.headers, parsed.rows);
  const duplicateKeys = getDuplicateKeys(parsed.rows, columns);
  const duplicateRows = parsed.rows.filter((row) =>
    duplicateKeys.has(buildDedupeKey(row, columns)),
  ).length;
  const warnings = buildQualityWarnings(
    parsed.rows,
    columns,
    duplicateRows,
    parsed.rawRowCount,
  );
  const previewRows = buildPreviewRows(parsed.rows, columns, duplicateKeys);
  const importableRows = previewRows.filter(
    (row) => row.action !== "blocked",
  ).length;
  const proofHash = await sha256(
    JSON.stringify({
      rawText,
      mode: "dry_run",
      target: "crm_customers",
      noWrite: true,
      noToken: true,
    }),
  );
  const createdAt = new Date().toISOString();

  return {
    proofId: `crm-dry-${proofHash.slice(0, 10)}-${parsed.rows.length}`,
    proofHash,
    createdAt,
    adapter: "frontend-local",
    delimiter: parsed.delimiter,
    rowCount: parsed.rows.length,
    columnCount: parsed.headers.length,
    importableRows,
    duplicateRows,
    piiColumns: columns.filter((column) => column.pii.length).length,
    columns,
    warnings,
    previewRows,
    audit: [
      { label: "mode", value: "dry_run" },
      { label: "crm_write", value: "blocked/no-write" },
      { label: "第三方授权", value: "0/no-token" },
      { label: "external_crm", value: "not_touched" },
    ],
  };
}

function buildMapping(columns: ColumnInsight[]) {
  return columns.reduce<Record<string, string>>((mapping, column) => {
    if (column.suggestedField !== "ignore") {
      mapping[column.suggestedField] = column.source;
    }
    return mapping;
  }, {});
}

function issueToWarning(
  issue: CrmImportIssue,
  fallback: Severity,
): QualityWarning {
  if (typeof issue === "string") {
    return { severity: fallback, scope: "import", message: issue };
  }
  const severity =
    issue.severity === "error"
      ? "danger"
      : issue.severity === "warning"
        ? "warning"
        : fallback;
  const field = issue.field ? ` · ${issue.field}` : "";
  return {
    severity,
    scope: `${issue.rowNumber ? `row ${issue.rowNumber}` : "import"}${field}`,
    message: issue.message,
  };
}

function previewRowValue(row: CrmImportPreviewRow, field: TargetField) {
  const normalized =
    row.normalized && typeof row.normalized === "object" ? row.normalized : {};
  const value = normalized[field];
  if (typeof value === "string" || typeof value === "number")
    return String(value);
  return "";
}

function normalizeBackendPreviewRows(rows: CrmImportPreviewRow[]) {
  return rows.slice(0, 8).map<PreviewRow>((row) => {
    const errors = row.errors || [];
    const action =
      row.status === "invalid" || errors.length
        ? "blocked"
        : row.status === "duplicate"
          ? "dedupe_review"
          : "ready_for_review";
    const contact =
      previewRowValue(row, "phone") ||
      previewRowValue(row, "email") ||
      previewRowValue(row, "wechat") ||
      "-";
    return {
      rowNumber: row.rowNumber,
      displayName: previewRowValue(row, "displayName") || "-",
      companyName: previewRowValue(row, "companyName") || "-",
      contact: maskContact(contact),
      tags: previewRowValue(row, "tags") || "-",
      action,
      reason:
        errors
          .map((issue) => issueToWarning(issue, "danger").message)
          .join(" / ") ||
        row.warnings
          .map((issue) => issueToWarning(issue, "warning").message)
          .join(" / ") ||
        "检查已完成",
    };
  });
}

function normalizeBackendDryRun(
  response: CrmImportDryRunResponse,
  localResult: ImportDryRunResult,
): ImportDryRunResult {
  const apiWarnings = [
    ...response.errors.map((issue) => issueToWarning(issue, "danger")),
    ...response.warnings.map((issue) => issueToWarning(issue, "warning")),
  ];
  const previewRows = normalizeBackendPreviewRows(response.previewRows);
  return {
    ...localResult,
    proofId: response.proofId || response.id || localResult.proofId,
    proofHash: response.hash || localResult.proofHash,
    createdAt: response.createdAt || localResult.createdAt,
    adapter: "crm-api-adapter",
    rowCount: response.rowCount,
    importableRows: response.validCount,
    duplicateRows: response.duplicateCount,
    warnings: apiWarnings.length ? apiWarnings : localResult.warnings,
    previewRows: previewRows.length ? previewRows : localResult.previewRows,
    audit: [
      { label: "mode", value: response.status || "dry-run" },
      { label: "crm_write", value: "blocked/commit:false" },
      { label: "第三方授权", value: "0/no-token" },
      { label: "external_crm", value: "not_touched" },
      {
        label: "future_gate",
        value: response.requiredFutureGate || "manual-confirmation-required",
      },
    ],
  };
}

async function runDryImport(rawText: string, useBackendAdapter = true) {
  const parsed = parseDelimitedText(rawText);
  const columns = buildColumnInsights(parsed.headers, parsed.rows);
  const localResult = await buildLocalDryRun(rawText);
  if (!useBackendAdapter) return localResult;
  try {
    const response = await crmApi.dryRunCrmImport({
      filename: "pasted-crm-import.csv",
      sourceType: "paste",
      rows: parsed.rows,
      mapping: buildMapping(columns),
      hasHeader: true,
      delimiter: parsed.delimiter,
      proofLabel: "crm-import-workbench/no-write/no-token",
      confirmationGate: "dry-run-only",
      commit: false,
    });
    return normalizeBackendDryRun(response, localResult);
  } catch (error) {
    return {
      ...localResult,
      audit: [
        ...localResult.audit,
        {
          label: "api_adapter",
          value: toPublicError(error, "后端检查暂时不可用，已改用本机检查。"),
        },
      ],
    };
  }
}

async function runCommitImport(rawText: string, dryRun: ImportDryRunResult) {
  const parsed = parseDelimitedText(rawText);
  const columns = buildColumnInsights(parsed.headers, parsed.rows);
  return crmApi.commitCrmImport({
    filename: "pasted-crm-import.csv",
    sourceType: "paste",
    rows: parsed.rows,
    mapping: buildMapping(columns),
    hasHeader: true,
    delimiter: parsed.delimiter,
    dryRunId: dryRun.proofId,
    proofHash: dryRun.proofHash,
    confirmationGate: "MIGO_LOCAL_CRM_IMPORT_APPROVED",
    commit: true,
  });
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

export default function CrmImportPage() {
  const [rawText, setRawText] = React.useState(SAMPLE_DATA);
  const [running, setRunning] = React.useState(false);
  const [committing, setCommitting] = React.useState(false);
  const [rollingBack, setRollingBack] = React.useState(false);
  const [result, setResult] = React.useState<ImportDryRunResult | null>(null);
  const [commitResult, setCommitResult] =
    React.useState<CrmImportCommitResponse | null>(null);
  const [rollbackResult, setRollbackResult] =
    React.useState<CrmImportRollbackResponse | null>(null);
  const [importBatches, setImportBatches] = React.useState<CrmImportBatch[]>(
    [],
  );
  const [auditEvents, setAuditEvents] = React.useState<CrmAuditEvent[]>([]);
  const [ledgerLoading, setLedgerLoading] = React.useState(false);
  const [crmAppState, setCrmAppState] = React.useState<MarketAppState | null>(
    null,
  );
  const [crmAppLoading, setCrmAppLoading] = React.useState(true);
  const [crmAppError, setCrmAppError] = React.useState<string | null>(null);

  const adapterAvailable = Boolean(crmApi.dryRunCrmImport);
  const crmInstalled = Boolean(crmAppState?.installed);
  const crmEntitled = crmAppState
    ? !crmAppState.commercialEntitlementRequired ||
      crmAppState.commercialEntitled
    : false;
  const crmWriteReady = crmInstalled && crmEntitled;
  const canUseBackendAdapter = adapterAvailable && crmWriteReady;

  const refreshCrmState = React.useCallback(async () => {
    setCrmAppLoading(true);
    try {
      const state = await getCrmAppState();
      setCrmAppState(state);
      setCrmAppError(null);
    } catch (error) {
      setCrmAppState(null);
      setCrmAppError(
        toPublicError(error, "CRM 状态暂时无法读取，请重新加载。"),
      );
    } finally {
      setCrmAppLoading(false);
    }
  }, []);

  const refreshLedgers = React.useCallback(async () => {
    if (!crmWriteReady) {
      setImportBatches([]);
      setAuditEvents([]);
      setLedgerLoading(false);
      return;
    }
    setLedgerLoading(true);
    try {
      const [batches, events] = await Promise.all([
        crmApi.listCrmImportBatches(),
        crmApi.listCrmAuditEvents(),
      ]);
      setImportBatches(batches);
      setAuditEvents(events);
    } catch {
      setImportBatches([]);
      setAuditEvents([]);
    } finally {
      setLedgerLoading(false);
    }
  }, [crmWriteReady]);

  React.useEffect(() => {
    void refreshCrmState();
  }, [refreshCrmState]);

  React.useEffect(() => {
    if (!crmAppLoading) void refreshLedgers();
  }, [crmAppLoading, refreshLedgers]);

  const handleDryRun = React.useCallback(async () => {
    const trimmed = rawText.trim();
    if (!trimmed) {
      toast.error("请先粘贴 CSV 或表格文本");
      return;
    }
    setRunning(true);
    try {
      const nextResult = await runDryImport(trimmed, canUseBackendAdapter);
      setResult(nextResult);
      setCommitResult(null);
      setRollbackResult(null);
      toast.success("检查已完成，未写入 CRM");
    } catch (error) {
      toast.error(toPublicError(error, "导入检查未完成，请检查数据后重试。"));
    } finally {
      setRunning(false);
    }
  }, [canUseBackendAdapter, rawText]);

  const critical = result ? hasCriticalWarning(result.warnings) : false;

  const handleCommit = React.useCallback(async () => {
    if (!result) {
      toast.error("请先完成检查");
      return;
    }
    if (critical) {
      toast.error("存在危险级质量问题，不能写入本地 CRM");
      return;
    }
    if (!crmWriteReady) {
      toast.error("请先开通并安装 CRM 客户管理");
      return;
    }
    setCommitting(true);
    try {
      const nextResult = await runCommitImport(rawText.trim(), result);
      setCommitResult(nextResult);
      setRollbackResult(null);
      void refreshLedgers();
      toast.success(`已写入本地 CRM：${nextResult.committedCount} 条`);
    } catch (error) {
      toast.error(toPublicError(error, "CRM 导入未完成，请检查数据后重试。"));
    } finally {
      setCommitting(false);
    }
  }, [critical, crmWriteReady, rawText, refreshLedgers, result]);

  const handleRollback = React.useCallback(async () => {
    if (!commitResult) {
      toast.error("没有可回滚的导入批次");
      return;
    }
    const customerIds = commitResult.rollbackPlan.customerIds || [];
    if (!customerIds.length) {
      toast.error("当前导入结果没有可回滚客户");
      return;
    }
    setRollingBack(true);
    try {
      const nextResult = await crmApi.rollbackCrmImport({
        importCommitId: commitResult.rollbackPlan.importCommitId,
        rollbackToken: commitResult.rollbackPlan.rollbackToken,
        customerIds,
        reason: "crm-import-workbench-local-rollback",
      });
      setRollbackResult(nextResult);
      void refreshLedgers();
      toast.success(`已归档回滚：${nextResult.archivedCount} 条`);
    } catch (error) {
      toast.error(toPublicError(error, "本次导入未能回退，请重试。"));
    } finally {
      setRollingBack(false);
    }
  }, [commitResult, refreshLedgers]);

  return (
    <div className="mx-auto flex w-full max-w-[1460px] flex-col gap-3 pb-8 text-[13px]">
      <header className="kaypal-v3-page-header flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Chip
              color="primary"
              variant="flat"
              startContent={<DatabaseZap size={14} />}
            >
              CRM 导入工作台
            </Chip>
            <Chip
              color="success"
              variant="flat"
              startContent={<ShieldCheck size={14} />}
            >
              导入前检查
            </Chip>
            <Chip variant="flat" startContent={<LockKeyhole size={14} />}>
              写入确认
            </Chip>
          </div>
          <h1 className="mt-2">CRM 导入检查</h1>
          <p className="mt-1 text-sm text-default-500">
            粘贴线索表，先做字段识别、隐私标记、质量检查和操作留痕；确认通过后只写入当前
            CRM，不触碰第三方 CRM。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="flat"
            className="rounded-[8px] font-semibold"
            startContent={<FileSpreadsheet size={16} />}
            onPress={() => setRawText(SAMPLE_DATA)}
          >
            样例数据
          </Button>
          <Button
            color="primary"
            className="rounded-[8px] font-semibold"
            isLoading={running}
            startContent={!running ? <PlayCircle size={16} /> : null}
            onPress={handleDryRun}
          >
            开始检查
          </Button>
        </div>
      </header>

      {crmAppLoading || !crmWriteReady || crmAppError ? (
        <Card className="border border-warning-200 bg-warning-50/70 shadow-sm">
          <CardBody className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
              {crmAppLoading ? (
                <Spinner className="mt-0.5" size="sm" />
              ) : (
                <AlertTriangle className="mt-0.5 text-warning-600" size={18} />
              )}
              <div>
                <div className="font-semibold text-[var(--kaypal-v3-ink)]">
                  {crmAppLoading
                    ? "正在检查 CRM 状态"
                    : crmAppError
                      ? "CRM 状态暂不可用"
                      : "CRM 客户管理未开通"}
                </div>
                <p className="mt-1 text-xs leading-5 text-default-600">
                  {crmAppLoading
                    ? "检查完成后会自动载入导入批次和结果留存。"
                    : crmAppError
                      ? "当前只保留本机检查，不读取导入台账。"
                      : "当前仍可做字段识别和质量检查；开通并安装后才能写入客户库和查看导入台账。"}
                </p>
              </div>
            </div>
            {!crmAppLoading ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  as="a"
                  href="/apps"
                  color="primary"
                  variant="flat"
                  className="rounded-[8px] font-semibold"
                >
                  去开通
                </Button>
                <Button
                  variant="flat"
                  className="rounded-[8px] font-semibold"
                  startContent={<RefreshCw size={14} />}
                  onPress={refreshCrmState}
                >
                  刷新状态
                </Button>
              </div>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      <section className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.1fr)_420px]">
        <Card className="border border-default-200 bg-content1 shadow-sm">
          <CardBody className="gap-3 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-[var(--kaypal-v3-ink)]">
                  导入源
                </h2>
                <p className="text-xs text-default-500">
                  CSV、TSV、Excel/Sheets 复制文本均可。
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                <Chip size="sm" variant="flat">
                  {rawText.trim().split(/\r?\n/).filter(Boolean).length || 0}{" "}
                  行文本
                </Chip>
                <Chip size="sm" variant="flat">
                  {canUseBackendAdapter ? "服务已连接" : "本机检查"}
                </Chip>
              </div>
            </div>
            <Textarea
              minRows={12}
              value={rawText}
              onValueChange={setRawText}
              placeholder="粘贴 CSV 或表格文本"
              classNames={{
                input: "font-mono text-[12px] leading-5",
                inputWrapper: "rounded-[8px]",
              }}
            />
            <div className="flex flex-wrap items-center gap-2 text-xs text-default-500">
              <span className="inline-flex items-center gap-1">
                <ClipboardPaste size={14} />
                粘贴数据源
              </span>
              <span className="inline-flex items-center gap-1">
                <Wand2 size={14} />
                稳定解析
              </span>
              <span className="inline-flex items-center gap-1">
                <Fingerprint size={14} />
                记录凭证
              </span>
            </div>
          </CardBody>
        </Card>

        <Card className="border border-default-200 bg-content1 shadow-sm">
          <CardBody className="gap-3 p-3">
            <div>
              <h2 className="text-sm font-bold text-[var(--kaypal-v3-ink)]">
                安全导入确认
              </h2>
              <p className="text-xs text-default-500">
                第三方 CRM 写入保持关闭，当前 CRM 写入需要通过检查和确认。
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Metric label="行数" value={result?.rowCount ?? "-"} />
              <Metric label="字段数" value={result?.columnCount ?? "-"} />
              <Metric label="隐私字段" value={result?.piiColumns ?? "-"} />
              <Metric
                label="重复线索"
                value={result?.duplicateRows ?? "-"}
                tone={result?.duplicateRows ? "warning" : "default"}
              />
            </div>
            <Divider />
            <div className="flex flex-col gap-2">
              <GateItem label="仅做检查" value="已开启" ok />
              <GateItem
                label="当前 CRM 写入"
                value={crmWriteReady ? "需确认" : "需开通"}
                ok={crmWriteReady}
              />
              <GateItem label="第三方 CRM 写入" value="已关闭" ok />
              <GateItem label="第三方授权" value="未使用" ok />
              <GateItem
                label="高风险警告"
                value={critical ? "需复核" : "通过"}
                ok={!critical}
              />
            </div>
            <Button
              color="success"
              className="rounded-[8px] font-semibold"
              isDisabled={!result || critical || !crmWriteReady}
              isLoading={committing}
              startContent={!committing ? <UploadCloud size={16} /> : null}
              onPress={handleCommit}
            >
              {crmWriteReady ? "受控导入当前 CRM" : "开通后可导入"}
            </Button>
            <p className="text-xs leading-5 text-default-500">
              写入范围：客户、公司、时间线；第三方
              CRM、第三方授权和网络写入都保持关闭。
            </p>
          </CardBody>
        </Card>
      </section>

      {running ? (
        <div className="flex min-h-[260px] items-center justify-center rounded-[8px] border border-default-200 bg-content1">
          <div className="flex items-center gap-3 rounded-[8px] border border-default-200 bg-content2 px-4 py-3 shadow-sm">
            <Spinner size="sm" />
            <span className="text-sm text-default-500">
              正在检查数据，本流程不会写入 CRM...
            </span>
          </div>
        </div>
      ) : result ? (
        <>
          <section className="grid grid-cols-1 gap-2 md:grid-cols-4">
            <Metric label="可进入复核" value={result.importableRows} />
            <Metric
              label="阻塞警告"
              value={
                result.warnings.filter((item) => item.severity === "danger")
                  .length
              }
              tone="danger"
            />
            <Metric
              label="解析格式"
              value={displayDelimiter(result.delimiter)}
            />
            <Metric
              label="处理方式"
              value={adapterAvailable ? "服务检查" : "本机检查"}
            />
          </section>

          <section className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_420px]">
            <Card className="border border-default-200 bg-content1 shadow-sm">
              <CardBody className="gap-3 p-3">
                <PanelTitle
                  title="字段识别与映射建议"
                  subtitle="建议不等于写入，需人工确认后才可进入正式导入。"
                />
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[920px] border-collapse">
                    <thead className="bg-default-50 text-left text-[12px] font-semibold text-default-500">
                      <tr>
                        <th className="px-3 py-2">源字段</th>
                        <th className="px-3 py-2">样例</th>
                        <th className="px-3 py-2">建议映射</th>
                        <th className="px-3 py-2">置信度</th>
                        <th className="px-3 py-2">PII</th>
                        <th className="px-3 py-2">质量</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.columns.map((column) => (
                        <tr
                          key={column.source}
                          className="border-t border-default-100 hover:bg-default-50"
                        >
                          <td className="px-3 py-2 font-semibold text-[var(--kaypal-v3-ink)]">
                            {column.source}
                            <div className="text-xs font-normal text-default-400">
                              {column.nonEmpty}/{result.rowCount} 非空 ·{" "}
                              {column.unique} unique
                            </div>
                          </td>
                          <td className="max-w-[240px] truncate px-3 py-2 text-default-600">
                            {maskSample(column.sample, column.pii)}
                          </td>
                          <td className="px-3 py-2">
                            <Chip
                              size="sm"
                              variant="flat"
                              color={
                                column.suggestedField === "ignore"
                                  ? "default"
                                  : "primary"
                              }
                            >
                              {TARGET_LABELS[column.suggestedField]}
                            </Chip>
                          </td>
                          <td className="px-3 py-2 text-default-600">
                            {column.confidence}%
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-1">
                              {column.pii.length ? (
                                column.pii.map((pii) => (
                                  <Chip
                                    key={pii}
                                    size="sm"
                                    color="warning"
                                    variant="flat"
                                    className="h-5 rounded-[6px] text-[11px]"
                                  >
                                    {pii}
                                  </Chip>
                                ))
                              ) : (
                                <span className="text-default-400">-</span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-default-600">
                            {column.warnings.length
                              ? column.warnings.join(" / ")
                              : "OK"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardBody>
            </Card>

            <Card className="border border-default-200 bg-content1 shadow-sm">
              <CardBody className="gap-3 p-3">
                <PanelTitle
                  title="检查记录"
                  subtitle="用于操作留痕，不代表已经写入 CRM。"
                />
                <div className="rounded-[8px] border border-default-200 bg-content2 p-3">
                  <div className="text-[11px] font-semibold text-default-500">
                    检查状态
                  </div>
                  <div className="mt-1 text-sm font-semibold text-[var(--kaypal-v3-ink)]">
                    已完成并保留操作记录
                  </div>
                </div>
                <div className="overflow-hidden rounded-[8px] border border-default-200">
                  <table className="w-full border-collapse text-[12px]">
                    <tbody>
                      <tr className="border-b border-default-100">
                        <td className="bg-default-50 px-3 py-2 font-semibold text-default-500">
                          创建时间
                        </td>
                        <td className="px-3 py-2">
                          {formatTime(result.createdAt)}
                        </td>
                      </tr>
                      {visibleAuditItems(result.audit).map((item) => (
                        <tr
                          key={item.label}
                          className="border-b border-default-100 last:border-0"
                        >
                          <td className="bg-default-50 px-3 py-2 font-semibold text-default-500">
                            {displayImportAuditLabel(item.label)}
                          </td>
                          <td className="px-3 py-2">
                            {displayImportAuditValue(item.value)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {commitResult ? (
                  <div className="rounded-[8px] border border-success-200 bg-success-50/70 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-[11px] font-semibold text-success-700">
                          当前 CRM 导入
                        </div>
                        <div className="mt-1 text-sm font-bold text-success-700">
                          已写入 {commitResult.committedCount} 条
                        </div>
                      </div>
                      <Chip color="success" variant="flat" size="sm">
                        {displayImportStatus(commitResult.status)}
                      </Chip>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
                      <div>
                        <div className="text-default-500">第三方 CRM</div>
                        <div className="font-semibold">
                          {commitResult.externalCrmTouched
                            ? "已触碰"
                            : "未触碰"}
                        </div>
                      </div>
                      <div>
                        <div className="text-default-500">可回退</div>
                        <div className="font-semibold">是</div>
                      </div>
                    </div>
                    <div className="mt-2 text-xs leading-5 text-default-600">
                      本次只更新当前组织内的客户数据，操作记录已由系统保留。
                    </div>
                    <Button
                      color="danger"
                      variant="flat"
                      size="sm"
                      className="mt-3 rounded-[8px] font-semibold"
                      isLoading={rollingBack}
                      isDisabled={Boolean(rollbackResult)}
                      onPress={handleRollback}
                    >
                      归档回滚本批导入
                    </Button>
                  </div>
                ) : null}
                {rollbackResult ? (
                  <div className="rounded-[8px] border border-warning-200 bg-warning-50/70 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-[11px] font-semibold text-warning-700">
                          本批导入已归档
                        </div>
                        <div className="mt-1 text-sm font-bold text-warning-700">
                          已归档 {rollbackResult.archivedCount} 条，跳过{" "}
                          {rollbackResult.skippedCount} 条
                        </div>
                      </div>
                      <Chip color="warning" variant="flat" size="sm">
                        {rollbackResult.status}
                      </Chip>
                    </div>
                    <div className="mt-2 text-xs leading-5 text-default-600">
                      回退已完成；第三方 CRM{" "}
                      {rollbackResult.externalCrmTouched ? "已触碰" : "未触碰"}
                      。
                    </div>
                  </div>
                ) : null}
              </CardBody>
            </Card>
          </section>

          <section className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_420px]">
            <Card className="border border-default-200 bg-content1 shadow-sm">
              <CardBody className="gap-3 p-3">
                <PanelTitle
                  title="检查结果预览"
                  subtitle="仅显示前 8 行，联系方式已脱敏。"
                />
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[840px] border-collapse">
                    <thead className="bg-default-50 text-left text-[12px] font-semibold text-default-500">
                      <tr>
                        <th className="px-3 py-2">行号</th>
                        <th className="px-3 py-2">联系人</th>
                        <th className="px-3 py-2">公司</th>
                        <th className="px-3 py-2">联系方式</th>
                        <th className="px-3 py-2">标签</th>
                        <th className="px-3 py-2">动作</th>
                        <th className="px-3 py-2">原因</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.previewRows.map((row) => (
                        <tr
                          key={`${row.rowNumber}-${row.displayName}`}
                          className="border-t border-default-100 hover:bg-default-50"
                        >
                          <td className="px-3 py-2 text-default-500">
                            {row.rowNumber}
                          </td>
                          <td className="px-3 py-2 font-semibold text-[var(--kaypal-v3-ink)]">
                            {row.displayName}
                          </td>
                          <td className="px-3 py-2 text-default-600">
                            {row.companyName}
                          </td>
                          <td className="px-3 py-2 font-mono text-[12px] text-default-600">
                            {row.contact}
                          </td>
                          <td className="max-w-[180px] truncate px-3 py-2 text-default-600">
                            {row.tags}
                          </td>
                          <td className="px-3 py-2">
                            <Chip
                              size="sm"
                              variant="flat"
                              color={actionColor(row.action)}
                            >
                              {actionLabel(row.action)}
                            </Chip>
                          </td>
                          <td className="px-3 py-2 text-default-600">
                            {row.reason}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardBody>
            </Card>

            <Card className="border border-default-200 bg-content1 shadow-sm">
              <CardBody className="gap-3 p-3">
                <PanelTitle
                  title="数据质量警告"
                  subtitle="危险项会阻止进入正式导入。"
                />
                <div className="flex max-h-[360px] flex-col gap-2 overflow-auto pr-1">
                  {result.warnings.map((warning, index) => (
                    <div
                      key={`${warning.scope}-${warning.message}-${index}`}
                      className="rounded-[8px] border border-default-200 bg-content2 p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-semibold text-[var(--kaypal-v3-ink)]">
                          {warning.scope}
                        </div>
                        <Chip
                          size="sm"
                          color={severityColor(warning.severity)}
                          variant="flat"
                        >
                          {warning.severity}
                        </Chip>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-default-600">
                        {warning.message}
                      </p>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          </section>
        </>
      ) : (
        <div className="rounded-[8px] border border-dashed border-default-300 bg-content1 p-8 text-center">
          <AlertTriangle className="mx-auto text-default-400" size={24} />
          <div className="mt-2 font-semibold text-[var(--kaypal-v3-ink)]">
            等待检查
          </div>
          <p className="mt-1 text-sm text-default-500">
            点击开始检查后生成字段匹配、隐私标记、质量警告和结果留存。
          </p>
        </div>
      )}

      <section className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_460px]">
        <Card className="border border-default-200 bg-content1 shadow-sm">
          <CardBody className="gap-3 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <PanelTitle
                title="导入批次账本"
                subtitle="系统保留的导入批次、处理数量和回退状态。"
              />
              <Button
                size="sm"
                variant="flat"
                className="rounded-[8px] font-semibold"
                isDisabled={!crmWriteReady}
                isLoading={ledgerLoading}
                startContent={!ledgerLoading ? <RefreshCw size={14} /> : null}
                onPress={refreshLedgers}
              >
                刷新
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse">
                <thead className="bg-default-50 text-left text-[12px] font-semibold text-default-500">
                  <tr>
                    <th className="px-3 py-2">批次</th>
                    <th className="px-3 py-2">状态</th>
                    <th className="px-3 py-2">行数</th>
                    <th className="px-3 py-2">回退状态</th>
                    <th className="px-3 py-2">时间</th>
                  </tr>
                </thead>
                <tbody>
                  {importBatches.slice(0, 8).map((batch) => (
                    <tr
                      key={batch.id}
                      className="border-t border-default-100 hover:bg-default-50"
                    >
                      <td className="px-3 py-2">
                        <div className="font-semibold text-[var(--kaypal-v3-ink)]">
                          {batch.id}
                        </div>
                        <div className="text-xs text-default-400">
                          {batch.filename || "-"} · {batch.sourceType}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <Chip
                          size="sm"
                          variant="flat"
                          color={
                            batch.status.includes("rolled")
                              ? "warning"
                              : batch.status.includes("committed")
                                ? "success"
                                : "default"
                          }
                        >
                          {displayImportStatus(batch.status)}
                        </Chip>
                      </td>
                      <td className="px-3 py-2 text-default-600">
                        {batch.committedCount}/{batch.rowCount}
                      </td>
                      <td className="px-3 py-2 text-xs text-default-600">
                        {batch.rollbackProofHash ? "已完成回退" : "未回退"}
                      </td>
                      <td className="px-3 py-2 text-xs text-default-500">
                        {formatTime(batch.updatedAt)}
                      </td>
                    </tr>
                  ))}
                  {!importBatches.length ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-6">
                        <FunctionalEmptyState
                          actions={[
                            { href: "/apps", label: "应用市场" },
                            { href: "/crm", label: "CRM 客户" },
                          ]}
                          description={
                            crmWriteReady
                              ? "还没有写入过 CRM 导入批次。先粘贴 CSV 或表格文本，完成检查后再受控导入。"
                              : "CRM 客户管理开通后，这里会显示每次导入批次、处理数量和回退状态。"
                          }
                          examples={[
                            "粘贴 CSV",
                            "字段映射",
                            "受控导入",
                            "回退状态",
                          ]}
                          icon={FileSpreadsheet}
                          surface="plain"
                          title={
                            crmWriteReady
                              ? "当前没有导入批次"
                              : "开通 CRM 后显示导入批次"
                          }
                        />
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>

        <Card className="border border-default-200 bg-content1 shadow-sm">
          <CardBody className="gap-3 p-3">
            <div className="flex items-center justify-between gap-2">
              <PanelTitle title="结果留存" subtitle="关键动作的可追溯记录。" />
              <History size={18} className="text-default-400" />
            </div>
            <div className="flex max-h-[420px] flex-col gap-2 overflow-auto pr-1">
              {auditEvents.slice(0, 12).map((event) => (
                <div
                  key={event.id}
                  className="rounded-[8px] border border-default-200 bg-content2 p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-[var(--kaypal-v3-ink)]">
                        {event.eventType}
                      </div>
                      <div className="mt-0.5 text-xs text-default-500">
                        {event.action} · {formatTime(event.createdAt)}
                      </div>
                    </div>
                    <Chip
                      size="sm"
                      variant="flat"
                      color={event.status === "success" ? "success" : "default"}
                    >
                      {event.status}
                    </Chip>
                  </div>
                  {event.summary ? (
                    <p className="mt-2 text-xs leading-5 text-default-600">
                      {event.summary}
                    </p>
                  ) : null}
                  <div className="mt-2 text-xs text-default-500">
                    操作记录已保留；第三方 CRM{" "}
                    {event.externalCrmTouched ? "已触碰" : "未触碰"}
                  </div>
                </div>
              ))}
              {!auditEvents.length ? (
                <FunctionalEmptyState
                  actions={[
                    { href: "/crm/import", label: "导入线索" },
                    { href: "/tasks/evidence", label: "结果留存" },
                  ]}
                  description={
                    crmWriteReady
                      ? "还没有产生 CRM 导入、回滚或操作记录。完成一次检查和受控导入后，这里会显示处理结果。"
                      : "CRM 客户管理开通后，这里会显示导入、回滚和关键动作的可追溯记录。"
                  }
                  examples={["导入记录", "回滚记录", "处理结果", "操作状态"]}
                  icon={History}
                  surface="plain"
                  title={
                    crmWriteReady
                      ? "当前没有结果留存"
                      : "开通 CRM 后显示结果留存"
                  }
                />
              ) : null}
            </div>
          </CardBody>
        </Card>
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number | string;
  tone?: "default" | "danger" | "warning";
}) {
  const toneClass =
    tone === "danger"
      ? "border-danger-200 text-danger"
      : tone === "warning"
        ? "border-warning-200 text-warning-600"
        : "border-default-200 text-[var(--kaypal-v3-ink)]";
  return (
    <div
      className={`rounded-[8px] border bg-content1 p-3 shadow-sm ${toneClass}`}
    >
      <div className="text-[11px] font-semibold text-default-500">{label}</div>
      <div className="mt-1 truncate text-lg font-bold">{value}</div>
    </div>
  );
}

function GateItem({
  label,
  value,
  ok,
}: {
  label: string;
  value: string;
  ok: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[8px] border border-default-200 bg-content2 px-3 py-2">
      <span className="text-xs font-semibold text-default-500">{label}</span>
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--kaypal-v3-ink)]">
        {ok ? (
          <CheckCircle2 className="text-success" size={14} />
        ) : (
          <AlertTriangle className="text-warning" size={14} />
        )}
        {value}
      </span>
    </div>
  );
}

function PanelTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="text-sm font-bold text-[var(--kaypal-v3-ink)]">
          {title}
        </h2>
        <p className="text-xs text-default-500">{subtitle}</p>
      </div>
    </div>
  );
}
