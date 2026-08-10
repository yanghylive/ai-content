#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const args = parseArgs(process.argv.slice(2));
const evidenceDate = args.date || new Date().toISOString().slice(0, 10);
const evidenceRoot = resolve(
  args.evidenceRoot ||
    join(repoRoot, "docs", `acceptance-evidence-${evidenceDate}`),
);
const reportDir = resolve(
  args.reportDir ||
    join(evidenceRoot, `p9-external-publish-readback-gate-${timestampForFile()}`),
);

const database = loadPublishDatabaseSnapshot();
const supportingEvidence = loadSupportingEvidence();
const rows = buildRows(database, supportingEvidence);
const summary = summarize(rows);
const report = {
  generatedAt: new Date().toISOString(),
  evidenceDate,
  evidenceRoot,
  strict: args.strict,
  status: summary.releaseBlockingCount > 0 ? "BLOCKED_FOR_PRODUCTION" : "PASS",
  database: database.safeSummary,
  supportingEvidence,
  summary,
  rows,
};

writeReport(report);
printSummary(report);

if (args.strict && summary.releaseBlockingCount > 0) {
  process.exitCode = 1;
}

function buildRows(snapshot, evidence) {
  const derived = derivePublishEvidence(snapshot);
  return [
    publishPreparationRow(snapshot, evidence),
    publishFeedbackRow(snapshot, evidence),
    realAccountRow(snapshot, derived),
    realPublishSuccessRow(snapshot, derived),
    platformReadbackRow(snapshot, derived),
    screenshotEvidenceRow(snapshot, derived),
    riskAndRecoveryRow(snapshot, derived),
    auditIntegrityRow(snapshot, derived),
  ];
}

function publishPreparationRow(snapshot, evidence) {
  const p4Check = findCheck(evidence.latestP4, /发布准备：待发布记录已创建/);
  const p4Pass = Boolean(evidence.latestP4?.json?.pass) && p4Check?.status === "PASS";
  const readyIntents = snapshot.publishIntents.filter((intent) =>
    ["ready", "scheduled", "approved"].includes(String(intent.status || "").toLowerCase()),
  );
  const pass = p4Pass || readyIntents.length > 0;
  return row({
    id: "publish-preparation-business-flow",
    title: "发布准备闭环",
    status: pass ? "PASS" : "UNVERIFIED",
    releaseBlocking: false,
    evidence: evidence.latestP4?.filePath || snapshot.evidence,
    detail: pass
      ? `已确认待发布记录可创建；当前待发布/已排期记录 ${readyIntents.length} 条。此项只证明发布准备，不证明外部平台已发布。`
      : "未确认发布准备闭环。",
    nextAction: pass
      ? "继续把发布准备和真实外部发布分开验收。"
      : "先重跑 P4，确认内容通过复核后能生成待发布记录。",
  });
}

function publishFeedbackRow(snapshot, evidence) {
  const p4Check = findCheck(evidence.latestP4, /发布复盘：线索指标已保存/);
  const p4Pass = Boolean(evidence.latestP4?.json?.pass) && p4Check?.status === "PASS";
  const feedbackCount = snapshot.publishFeedback.length;
  const pass = p4Pass || feedbackCount > 0;
  return row({
    id: "publish-feedback-ledger",
    title: "发布复盘记录",
    status: pass ? "PASS" : "UNVERIFIED",
    releaseBlocking: false,
    evidence: evidence.latestP4?.filePath || snapshot.evidence,
    detail: pass
      ? `复盘指标可记录；当前复盘记录 ${feedbackCount} 条。此项不代替平台真实链接、截图或回读。`
      : "未确认发布复盘记录可用。",
    nextAction: pass
      ? "复盘指标继续作为业务结果记录，不作为真实发布证据。"
      : "补齐发布后复盘记录能力。",
  });
}

function realAccountRow(snapshot, derived) {
  const pass = derived.readyAccounts.length > 0;
  return row({
    id: "real-platform-account-ready",
    title: "真实平台账号可用",
    status: pass ? "PASS" : "CONFIG_REQUIRED",
    releaseBlocking: !pass,
    evidence: snapshot.evidence,
    detail: pass
      ? `发现可用发布账号 ${derived.readyAccounts.length} 个。`
      : "当前运行库没有可用发布账号；不能执行抖音/小红书/微信等外部平台真实发布。",
    nextAction: pass
      ? "发布当天再次确认账号在线、配额可用、品牌测试账号隔离。"
      : "登录或绑定至少一个品牌测试账号，确认账号在线、可发布、可回读。",
  });
}

function realPublishSuccessRow(snapshot, derived) {
  const pass = derived.successPublishRecords.length > 0 || derived.successRuntimePublishes.length > 0;
  return row({
    id: "external-platform-real-publish-success",
    title: "外部平台真实发布成功",
    status: pass ? "PASS" : "REAL_ACCEPTANCE_REQUIRED",
    releaseBlocking: !pass,
    evidence: snapshot.evidence,
    detail: pass
      ? `成功发布记录 ${derived.successPublishRecords.length} 条，成功运行发布记录 ${derived.successRuntimePublishes.length} 条。`
      : "当前没有外部平台成功发布记录；发布准备和复盘数据不能证明内容已经发到平台。",
    nextAction: pass
      ? "保留平台、账号、发布时间、远端对象 ID 或公开链接。"
      : "用品牌测试账号完成至少一次真实发布，记录平台、账号、发布时间、远端对象 ID 或公开链接。",
  });
}

function platformReadbackRow(snapshot, derived) {
  const pass = derived.readbackPublishes.length > 0 || derived.publishRecordsWithUrl.length > 0;
  return row({
    id: "external-platform-publish-readback",
    title: "发布结果回读",
    status: pass ? "PASS" : "REAL_ACCEPTANCE_REQUIRED",
    releaseBlocking: !pass,
    evidence: snapshot.evidence,
    detail: pass
      ? `带回读证据的运行记录 ${derived.readbackPublishes.length} 条，带发布链接/远端 ID 的记录 ${derived.publishRecordsWithUrl.length} 条。`
      : "当前没有平台回读、公开链接、远端对象 ID 或同一内容的结果确认。",
    nextAction: pass
      ? "保留回读时间、远端状态和内容匹配结果。"
      : "发布后从平台回读同一内容，确认标题/正文/素材匹配，并记录公开链接或远端对象 ID。",
  });
}

function screenshotEvidenceRow(snapshot, derived) {
  const pass = derived.screenshotEvidence.length > 0;
  return row({
    id: "external-platform-screenshot-evidence",
    title: "发布页面截图证据",
    status: pass ? "PASS" : "REAL_ACCEPTANCE_REQUIRED",
    releaseBlocking: !pass,
    evidence: snapshot.evidence,
    detail: pass
      ? `发现截图或页面证据 ${derived.screenshotEvidence.length} 条。`
      : "当前没有发布成功页面、作品页或平台后台截图证据。",
    nextAction: pass
      ? "保留截图路径、采集时间和对应发布记录。"
      : "发布成功后保存作品页或平台后台截图，截图必须能对应平台、账号和内容。",
  });
}

function riskAndRecoveryRow(snapshot, derived) {
  const pass = derived.riskPassEvents.length > 0 && derived.recoveryEvents.length > 0;
  return row({
    id: "external-platform-risk-and-recovery",
    title: "平台审核结果与失败恢复",
    status: pass ? "PASS" : "REAL_ACCEPTANCE_REQUIRED",
    releaseBlocking: !pass,
    evidence: snapshot.evidence,
    detail: pass
      ? `平台审核/风控通过证据 ${derived.riskPassEvents.length} 条，失败恢复证据 ${derived.recoveryEvents.length} 条。`
      : `平台审核/风控通过证据=${derived.riskPassEvents.length}，失败恢复证据=${derived.recoveryEvents.length}。`,
    nextAction: pass
      ? "保留审核通过、失败重试或撤回改发的全链路记录。"
      : "补一次正常发布审核通过证据，并演练失败后的重试、撤回或人工接管流程。",
  });
}

function auditIntegrityRow(snapshot, derived) {
  const publishEvidenceCount =
    derived.successRuntimePublishes.length +
    derived.readbackPublishes.length +
    derived.screenshotEvidence.length;
  const pass =
    publishEvidenceCount > 0 &&
    derived.successRuntimePublishes.some((item) => hasProofLikeEvidence(item)) &&
    derived.readbackPublishes.some((item) => hasReadbackIdentity(item));
  return row({
    id: "external-platform-publish-audit-integrity",
    title: "外部发布审计链完整性",
    status: pass ? "PASS" : "REAL_ACCEPTANCE_REQUIRED",
    releaseBlocking: !pass,
    evidence: snapshot.evidence,
    detail: pass
      ? "外部发布、回读和证据附件可以互相对应。"
      : `可关联外部发布证据=${publishEvidenceCount}；缺少可互相对应的发布、回读和证据附件。`,
    nextAction: pass
      ? "把该审计链随版本归档。"
      : "补齐一次从内容版本、发布账号、平台结果、回读、截图到复盘指标的完整链路。",
  });
}

function derivePublishEvidence(snapshot) {
  const readyAccounts = snapshot.publishAccounts.filter((account) => {
    const config = asObject(account.config);
    const status = String(config.status || account.status || "").toLowerCase();
    const sessionStatus = String(config.sessionStatus || "").toLowerCase();
    return (
      isExternalPlatform(account.platform) &&
      (
        ["ready", "active", "online", "logged_in", "verified"].includes(status) ||
        ["logged_in", "online", "normal"].includes(sessionStatus) ||
        (account.appId && account.apiToken)
      )
    );
  });
  const successPublishRecords = snapshot.publishRecords.filter(
    (record) =>
      isExternalPlatform(record.platform) &&
      ["success", "published", "posted"].includes(String(record.status || "").toLowerCase()),
  );
  const publishRecordsWithUrl = successPublishRecords.filter((record) =>
    hasRemoteIdentity(record.publishUrl),
  );
  const successRuntimePublishes = snapshot.runtimeExecutions.filter(
    (execution) =>
      execution.ok === true &&
      ["success", "completed", "published"].includes(String(execution.status || "").toLowerCase()) &&
      isExternalPlatform(execution.platform) &&
      isPublishTask(execution.taskType, execution.runtimeJson),
  );
  const readbackPublishes = successRuntimePublishes.filter((execution) =>
    hasReadbackIdentity(execution),
  );
  const screenshotEvidence = snapshot.runtimeExecutions.flatMap((execution) =>
    evidenceItems(execution).filter((item) => /screenshot|image|png|jpg|jpeg|作品页|截图|页面/i.test(JSON.stringify(item))),
  );
  const riskPassEvents = snapshot.runtimeExecutions.filter((execution) => {
    const text = executionText(execution);
    return (
      isExternalPlatform(execution.platform) &&
      /risk|review|audit|审核|风控|通过|approved|accepted|visible|public/i.test(text) &&
      !/blocked|rejected|failed|失败|拒绝|拦截/i.test(text)
    );
  });
  const recoveryEvents = snapshot.runtimeExecutions.filter((execution) => {
    const text = executionText(execution);
    return (
      isExternalPlatform(execution.platform) &&
      /retry|recover|rollback|withdraw|delete|manual|handoff|重试|恢复|撤回|删除|人工接管/i.test(text)
    );
  });
  return {
    readyAccounts,
    successPublishRecords,
    publishRecordsWithUrl,
    successRuntimePublishes,
    readbackPublishes,
    screenshotEvidence,
    riskPassEvents,
    recoveryEvents,
  };
}

function loadPublishDatabaseSnapshot() {
  const source = resolveDatabaseSource();
  if (!source) {
    return emptySnapshot({
      connected: false,
      kind: "unknown",
      evidence: "",
      message:
        "未找到可检查的数据库。请配置 SQLITE_DATABASE_URL、P9_PUBLISH_SQLITE_DATABASE 或 DATABASE_URL。",
    });
  }
  if (source.kind === "sqlite") {
    return loadSqliteSnapshot(source.file);
  }
  return loadPostgresSnapshot(source.url);
}

function loadSqliteSnapshot(file) {
  const evidence = relative(file);
  if (!existsSync(file)) {
    return emptySnapshot({
      connected: false,
      kind: "sqlite",
      evidence,
      message: `SQLite 数据库不存在：${file}`,
    });
  }
  const tables = querySqliteJson(
    file,
    "select name from sqlite_master where type='table';",
  ).map((item) => item.name);
  const snapshot = emptySnapshot({
    connected: true,
    kind: "sqlite",
    evidence,
    message: "SQLite 数据库已连接。",
  });
  snapshot.tables = tables;
  if (tables.includes("publish_accounts")) {
    snapshot.publishAccounts = querySqliteJson(
      file,
      "select id,platform,name,app_id as appId,api_token as apiToken,config,created_at as createdAt,updated_at as updatedAt from publish_accounts order by created_at desc limit 300;",
    ).map(normalizeRecord);
  }
  if (tables.includes("publish_records")) {
    snapshot.publishRecords = querySqliteJson(
      file,
      "select id,article_id as articleId,account_id as accountId,platform,status,publish_url as publishUrl,error_message as errorMessage,created_at as createdAt,updated_at as updatedAt from publish_records order by created_at desc limit 300;",
    ).map(normalizeRecord);
  }
  if (tables.includes("runtime_executions")) {
    snapshot.runtimeExecutions = querySqliteJson(
      file,
      'select id,relatedId,relatedType,executor,platform,taskType,accountId,ok,status,reasonCode,userMessage,technicalMessage,runtimeJson,evidenceJson,readbackJson,agentSSessionId,engineUrl,createdAt from runtime_executions order by createdAt desc limit 500;',
    ).map(normalizeRecord);
  }
  if (tables.includes("content_publish_intents")) {
    snapshot.publishIntents = querySqliteJson(
      file,
      "select id,version_id as versionId,tenant_id as tenantId,user_id as userId,platform,title,status,scheduled_at as scheduledAt,metadata,created_at as createdAt,updated_at as updatedAt from content_publish_intents order by created_at desc limit 300;",
    ).map(normalizeRecord);
  }
  if (tables.includes("content_publish_feedback")) {
    snapshot.publishFeedback = querySqliteJson(
      file,
      "select id,version_id as versionId,publish_intent_id as publishIntentId,tenant_id as tenantId,user_id as userId,platform,views,likes,comments,saves,leads,note,metadata,created_at as createdAt,updated_at as updatedAt from content_publish_feedback order by created_at desc limit 300;",
    ).map(normalizeRecord);
  }
  snapshot.safeSummary = safeSummary(snapshot);
  return snapshot;
}

function loadPostgresSnapshot(databaseUrl) {
  const psql = process.env.PSQL_PATH || "psql";
  const probe = spawnSync(psql, ["--version"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0) {
    return emptySnapshot({
      connected: false,
      kind: "postgres",
      evidence: redactDatabaseUrl(databaseUrl),
      message: `未找到 psql：${probe.error?.message || probe.stderr || "psql unavailable"}`,
    });
  }
  const snapshot = emptySnapshot({
    connected: true,
    kind: "postgres",
    evidence: redactDatabaseUrl(databaseUrl),
    message: "Postgres 数据库已连接。",
  });
  snapshot.tables = queryPostgresJson(
    psql,
    databaseUrl,
    "select table_name as name from information_schema.tables where table_schema='public';",
  ).map((item) => item.name);
  if (snapshot.tables.includes("publish_accounts")) {
    snapshot.publishAccounts = queryPostgresJson(
      psql,
      databaseUrl,
      'select id,platform,name,app_id as "appId",api_token as "apiToken",config,created_at as "createdAt",updated_at as "updatedAt" from publish_accounts order by created_at desc limit 300;',
    ).map(normalizeRecord);
  }
  if (snapshot.tables.includes("publish_records")) {
    snapshot.publishRecords = queryPostgresJson(
      psql,
      databaseUrl,
      'select id,article_id as "articleId",account_id as "accountId",platform,status,publish_url as "publishUrl",error_message as "errorMessage",created_at as "createdAt",updated_at as "updatedAt" from publish_records order by created_at desc limit 300;',
    ).map(normalizeRecord);
  }
  if (snapshot.tables.includes("runtime_executions")) {
    snapshot.runtimeExecutions = queryPostgresJson(
      psql,
      databaseUrl,
      'select id,"relatedId","relatedType",executor,platform,"taskType","accountId",ok,status,"reasonCode","userMessage","technicalMessage","runtimeJson","evidenceJson","readbackJson","agentSSessionId","engineUrl","createdAt" from runtime_executions order by "createdAt" desc limit 500;',
    ).map(normalizeRecord);
  }
  if (snapshot.tables.includes("content_publish_intents")) {
    snapshot.publishIntents = queryPostgresJson(
      psql,
      databaseUrl,
      'select id,version_id as "versionId",tenant_id as "tenantId",user_id as "userId",platform,title,status,scheduled_at as "scheduledAt",metadata,created_at as "createdAt",updated_at as "updatedAt" from content_publish_intents order by created_at desc limit 300;',
    ).map(normalizeRecord);
  }
  if (snapshot.tables.includes("content_publish_feedback")) {
    snapshot.publishFeedback = queryPostgresJson(
      psql,
      databaseUrl,
      'select id,version_id as "versionId",publish_intent_id as "publishIntentId",tenant_id as "tenantId",user_id as "userId",platform,views,likes,comments,saves,leads,note,metadata,created_at as "createdAt",updated_at as "updatedAt" from content_publish_feedback order by created_at desc limit 300;',
    ).map(normalizeRecord);
  }
  snapshot.safeSummary = safeSummary(snapshot);
  return snapshot;
}

function loadSupportingEvidence() {
  return {
    latestP4: latestDirectoryReport("p4-business-journey-", "report.json"),
  };
}

function latestDirectoryReport(prefix, fileName) {
  if (!existsSync(evidenceRoot)) return null;
  const dirs = readdirSync(evidenceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => {
      const filePath = join(evidenceRoot, entry.name, fileName);
      const json = readJson(filePath);
      return json
        ? {
            dir: join(evidenceRoot, entry.name),
            filePath,
            json,
            sortKey: Date.parse(json.generatedAt || "") || mtimeKey(filePath),
          }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.sortKey - a.sortKey);
  return dirs[0] || null;
}

function querySqliteJson(file, sql) {
  try {
    const output = execFileSync("sqlite3", ["-json", file, sql], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 20,
    }).trim();
    return output ? JSON.parse(output) : [];
  } catch {
    return [];
  }
}

function queryPostgresJson(psql, databaseUrl, sql) {
  try {
    const wrapped = `select coalesce(json_agg(row_to_json(t)), '[]'::json) from (${sql.replace(/;$/, "")}) t;`;
    const output = execFileSync(
      psql,
      [databaseUrl, "-X", "-q", "-t", "-A", "-c", wrapped],
      { encoding: "utf8", maxBuffer: 1024 * 1024 * 20 },
    ).trim();
    return output ? JSON.parse(output) : [];
  } catch {
    return [];
  }
}

function resolveDatabaseSource() {
  const sqliteArg = args.database || process.env.P9_PUBLISH_SQLITE_DATABASE || "";
  if (sqliteArg) {
    return { kind: "sqlite", file: resolvePath(sqliteArg) };
  }
  for (const envName of ["SQLITE_DATABASE_URL", "COMMERCIAL_PUBLISH_SQLITE_DATABASE_URL"]) {
    const file = sqliteFileFromUrl(process.env[envName] || "");
    if (file) return { kind: "sqlite", file };
  }
  if (process.env.DATABASE_URL?.trim()) {
    return { kind: "postgres", url: process.env.DATABASE_URL.trim() };
  }
  for (const candidate of [
    "backend/prisma/data/sqlite-runtime/kaypal-ai.sqlite",
    "backend/prisma/data/kaypal-ai.sqlite",
    "backend/prisma/kaypal-ai.sqlite",
    "backend/prisma/dev.db",
  ]) {
    const file = resolve(repoRoot, candidate);
    if (existsSync(file)) return { kind: "sqlite", file };
  }
  return null;
}

function findCheck(report, pattern) {
  const checks = report?.json?.checks || [];
  return checks.find((item) => pattern.test(`${item.name || ""} ${item.details || ""}`));
}

function isExternalPlatform(platform) {
  return /douyin|xiaohongshu|wechat|wechat-channel|channels|kuaishou|bilibili|小红书|抖音|微信|视频号|快手/i.test(
    String(platform || ""),
  );
}

function isPublishTask(taskType, runtimeJson) {
  return /publish|upload|post|moments|article|video|note|发布|上传|作品/i.test(
    `${taskType || ""} ${JSON.stringify(runtimeJson || {})}`,
  );
}

function hasRemoteIdentity(value) {
  return /https?:\/\/|platform:\/\/|remote|object|note|aweme|article|post|publish|作品|笔记|文章|视频/i.test(
    String(value || ""),
  );
}

function hasReadbackIdentity(execution) {
  const readback = asObject(execution.readbackJson);
  const text = JSON.stringify(readback);
  return (
    Boolean(readback) &&
    (
      /matched[": ]*true/i.test(text) ||
      /published|visible|public|success|已发布|可见|公开/i.test(text) ||
      /https?:\/\/|remoteId|objectId|publishUrl|postId|noteId|articleId|awemeId/i.test(text)
    )
  );
}

function hasProofLikeEvidence(execution) {
  return evidenceItems(execution).length > 0 || /proof|hash|evidence|截图|链接/i.test(executionText(execution));
}

function evidenceItems(execution) {
  const value = execution.evidenceJson;
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return [value];
}

function executionText(execution) {
  return JSON.stringify({
    platform: execution.platform,
    taskType: execution.taskType,
    status: execution.status,
    reasonCode: execution.reasonCode,
    userMessage: execution.userMessage,
    technicalMessage: execution.technicalMessage,
    runtimeJson: execution.runtimeJson,
    evidenceJson: execution.evidenceJson,
    readbackJson: execution.readbackJson,
  });
}

function emptySnapshot(input) {
  const snapshot = {
    ...input,
    tables: [],
    publishAccounts: [],
    publishRecords: [],
    runtimeExecutions: [],
    publishIntents: [],
    publishFeedback: [],
    safeSummary: {},
  };
  snapshot.safeSummary = safeSummary(snapshot);
  return snapshot;
}

function safeSummary(snapshot) {
  const runtimePublishCount = snapshot.runtimeExecutions.filter((item) =>
    isPublishTask(item.taskType, item.runtimeJson),
  ).length;
  return {
    connected: snapshot.connected,
    kind: snapshot.kind,
    evidence: snapshot.evidence,
    message: snapshot.message,
    tableCount: snapshot.tables.length,
    tables: snapshot.tables.filter((table) =>
      [
        "publish_accounts",
        "publish_records",
        "runtime_executions",
        "content_publish_intents",
        "content_publish_feedback",
      ].includes(table),
    ),
    publishAccountCount: snapshot.publishAccounts.length,
    publishRecordCount: snapshot.publishRecords.length,
    runtimeExecutionCount: snapshot.runtimeExecutions.length,
    runtimePublishCount,
    publishIntentCount: snapshot.publishIntents.length,
    publishFeedbackCount: snapshot.publishFeedback.length,
  };
}

function normalizeRecord(record) {
  const normalized = { ...record };
  for (const [key, value] of Object.entries(normalized)) {
    if (value === 0 || value === 1) {
      if (/ok|valid|ready|success/i.test(key)) normalized[key] = Boolean(value);
    }
    if (["config", "metadata", "runtimeJson", "evidenceJson", "readbackJson"].includes(key)) {
      normalized[key] = parseJsonMaybe(value);
    }
  }
  return normalized;
}

function parseJsonMaybe(value) {
  if (Array.isArray(value) || (value && typeof value === "object")) return value;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed || !/^[{[]/.test(trimmed)) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function summarize(items) {
  const byStatus = {};
  for (const item of items) {
    byStatus[item.status] = (byStatus[item.status] || 0) + 1;
  }
  const blockers = items.filter((item) => item.releaseBlocking);
  return {
    total: items.length,
    byStatus,
    passCount: items.filter((item) => item.status === "PASS").length,
    releaseBlockingCount: blockers.length,
    releaseBlockingIds: blockers.map((item) => item.id),
  };
}

function writeReport(data) {
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(join(reportDir, "report.json"), `${JSON.stringify(data, null, 2)}\n`);
  writeFileSync(join(reportDir, "report.md"), renderMarkdown(data));
}

function renderMarkdown(data) {
  const lines = [
    "# P9 External Publish Readback Gate",
    "",
    `- Generated: ${data.generatedAt}`,
    `- Evidence root: ${relative(data.evidenceRoot)}`,
    `- Database: ${escapeCell(data.database.kind || "unknown")} ${escapeCell(data.database.evidence || "")}`,
    `- Status: **${data.status}**`,
    `- Release blocking items: ${data.summary.releaseBlockingCount}`,
    "",
    "| Status | Gate | Detail | Evidence | Next action |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const item of data.rows) {
    lines.push(
      `| ${escapeCell(item.status)} | ${escapeCell(item.title)} | ${escapeCell(item.detail)} | ${escapeCell(item.evidence)} | ${escapeCell(item.nextAction)} |`,
    );
  }
  lines.push("");
  lines.push(
    "## Decision",
    "",
    data.summary.releaseBlockingCount > 0
      ? "外部平台发布当前只能认定为发布准备和复盘记录可用，不能认定为真实平台发布与回读闭环完成。"
      : "外部平台真实发布与回读门禁通过，可作为 P5 生产发布矩阵证据。",
    "",
  );
  return `${lines.join("\n")}\n`;
}

function printSummary(data) {
  console.log("P9 external publish readback gate");
  console.log(`Status: ${data.status}`);
  console.log(`Rows: ${data.summary.total}`);
  console.log(`Release blockers: ${data.summary.releaseBlockingCount}`);
  for (const item of data.rows) {
    console.log(`[${item.status}] ${item.title}`);
  }
  console.log(`Report: ${join(reportDir, "report.md")}`);
}

function row(input) {
  return {
    ...input,
    evidence: input.evidence ? relative(input.evidence) : "",
  };
}

function resolvePath(value) {
  return isAbsolute(value) ? value : resolve(repoRoot, value);
}

function sqliteFileFromUrl(databaseUrl) {
  if (!databaseUrl.startsWith("file:")) return null;
  const raw = databaseUrl.slice("file:".length);
  if (!raw) return null;
  return raw.startsWith("./") || raw.startsWith("../")
    ? resolve(repoRoot, raw)
    : resolve(raw);
}

function readJson(filePath) {
  if (!filePath || !existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function mtimeKey(filePath) {
  try {
    return existsSync(filePath) ? statSync(filePath).mtimeMs : 0;
  } catch {
    return 0;
  }
}

function timestampForFile() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function redactDatabaseUrl(databaseUrl) {
  try {
    const parsed = new URL(databaseUrl);
    if (parsed.password) parsed.password = "***";
    if (parsed.username) parsed.username = "***";
    return parsed.toString();
  } catch {
    return String(databaseUrl || "").replace(/:\/\/([^:@/]+):([^@/]+)@/, "://***:***@");
  }
}

function relative(filePath) {
  return filePath ? String(filePath).replace(`${repoRoot}/`, "") : "";
}

function escapeCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

function parseArgs(argv) {
  const parsed = {
    strict: false,
    date: "",
    evidenceRoot: "",
    reportDir: "",
    database: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--strict") parsed.strict = true;
    else if (arg === "--date") parsed.date = argv[++index] || "";
    else if (arg === "--evidence-root") parsed.evidenceRoot = argv[++index] || "";
    else if (arg === "--report-dir") parsed.reportDir = argv[++index] || "";
    else if (arg === "--database") parsed.database = argv[++index] || "";
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage:
  node scripts/p9-external-publish-readback-gate.mjs
  node scripts/p9-external-publish-readback-gate.mjs --strict
  node scripts/p9-external-publish-readback-gate.mjs --database backend/prisma/data/sqlite-runtime/kaypal-ai.sqlite

Options:
  --strict             Exit 1 when external publish/readback blockers exist.
  --date YYYY-MM-DD    Evidence date folder to inspect.
  --evidence-root DIR  Evidence root override.
  --report-dir DIR     Output report directory override.
  --database FILE      SQLite database override.
`);
      process.exit(0);
    }
  }
  return parsed;
}
