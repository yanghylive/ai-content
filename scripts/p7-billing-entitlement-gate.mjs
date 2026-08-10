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
    join(evidenceRoot, `p7-billing-entitlement-gate-${timestampForFile()}`),
);

const database = loadBillingDatabaseSnapshot();
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
  return [
    billingSecretRow(),
    billingSchemaRow(snapshot),
    signedWebhookRow(snapshot),
    activeSubscriptionRow(snapshot),
    invoiceLifecycleRow(snapshot),
    entitlementConsistencyRow(snapshot),
    billingBackupEvidenceRow(evidence),
  ];
}

function billingSecretRow() {
  const configured = configuredWebhookSecrets();
  const pass = configured.length > 0;
  return row({
    id: "billing-webhook-secret-config",
    title: "支付回调签名密钥配置",
    status: pass ? "PASS" : "CONFIG_REQUIRED",
    releaseBlocking: !pass,
    evidence: "",
    detail: pass
      ? `已配置 ${configured.join(" / ")}。`
      : "未配置 KAYPAL_BILLING_WEBHOOK_SECRET、BILLING_WEBHOOK_SECRET 或 STRIPE_WEBHOOK_SECRET。",
    nextAction: pass
      ? "生产环境继续使用独立密钥，禁止复用开发密钥。"
      : "配置真实支付/Kaypal 测试或生产环境 webhook secret 后重跑 P7。",
  });
}

function billingSchemaRow(snapshot) {
  const required = [
    "billing_webhook_events",
    "billing_subscriptions",
    "billing_invoices",
    "tenant_entitlements",
  ];
  const missing = required.filter((table) => !snapshot.tables.includes(table));
  const pass = snapshot.connected && missing.length === 0;
  return row({
    id: "billing-schema-available",
    title: "计费审计表结构",
    status: pass ? "PASS" : "CONFIG_REQUIRED",
    releaseBlocking: !pass,
    evidence: snapshot.evidence,
    detail: pass
      ? "当前数据库包含 webhook、订阅、发票和租户权益表。"
      : snapshot.connected
        ? `当前数据库缺少：${missing.join("、")}。`
        : snapshot.message,
    nextAction: pass
      ? "保持迁移随生产发布执行。"
      : "对当前运行库执行最新 Prisma 迁移，并确认 billing_* 表存在。",
  });
}

function signedWebhookRow(snapshot) {
  const count = snapshot.webhookEvents.filter(
    (event) => event.signatureVerified && event.status === "processed",
  ).length;
  const pass = count > 0;
  return row({
    id: "signed-webhook-processed",
    title: "签名回调已处理",
    status: pass ? "PASS" : "CONFIG_REQUIRED",
    releaseBlocking: !pass,
    evidence: snapshot.evidence,
    detail: pass
      ? `已处理签名回调 ${count} 条。`
      : "当前数据库没有 signature_verified=true 且 status=processed 的支付回调。",
    nextAction: pass
      ? "保留 provider/eventId/processedAt 证据。"
      : "用真实 webhook secret 发送一条签名订阅事件，确认落库并处理为 processed。",
  });
}

function activeSubscriptionRow(snapshot) {
  const active = snapshot.subscriptions.filter((subscription) =>
    isActiveCommercialSubscription(subscription),
  );
  const pass = active.length > 0;
  return row({
    id: "active-commercial-subscription",
    title: "有效商用订阅快照",
    status: pass ? "PASS" : "CONFIG_REQUIRED",
    releaseBlocking: !pass,
    evidence: snapshot.evidence,
    detail: pass
      ? `有效商用订阅 ${active.length} 条。`
      : "当前数据库没有 STANDARD 及以上、状态有效且未过期的订阅快照。",
    nextAction: pass
      ? "保持订阅周期、plan 和 provider 可追溯。"
      : "处理 customer.subscription.created/updated，生成有效 BillingSubscription。",
  });
}

function invoiceLifecycleRow(snapshot) {
  const paidInvoices = snapshot.invoices.filter((invoice) =>
    ["paid", "succeeded", "payment_succeeded"].includes(
      String(invoice.status || "").toLowerCase(),
    ),
  );
  const failureSignals =
    snapshot.invoices.filter((invoice) =>
      ["failed", "payment_failed", "past_due", "uncollectible"].includes(
        String(invoice.status || "").toLowerCase(),
      ),
    ).length +
    snapshot.webhookEvents.filter((event) =>
      /customer\.subscription\.deleted|invoice\.payment_failed/i.test(
        event.eventType,
      ),
    ).length +
    snapshot.entitlements.filter((entitlement) =>
      ["past_due", "canceled", "cancelled", "expired"].includes(
        String(entitlement.status || "").toLowerCase(),
      ),
    ).length;
  const lifecycleEvents = snapshot.webhookEvents.filter((event) =>
    /customer\.subscription\.(created|updated|deleted)|invoice\.(paid|payment_failed)/i.test(
      event.eventType,
    ),
  );
  const pass =
    paidInvoices.length > 0 && failureSignals > 0 && lifecycleEvents.length >= 2;
  return row({
    id: "invoice-and-revoke-lifecycle",
    title: "发票审计与失效降级",
    status: pass ? "PASS" : "CONFIG_REQUIRED",
    releaseBlocking: !pass,
    evidence: snapshot.evidence,
    detail: pass
      ? `付费发票 ${paidInvoices.length} 条，失效/降级证据 ${failureSignals} 条，生命周期事件 ${lifecycleEvents.length} 条。`
      : `付费发票=${paidInvoices.length}，失效/降级证据=${failureSignals}，生命周期事件=${lifecycleEvents.length}。`,
    nextAction: pass
      ? "保留 invoice.paid 和失败/取消类事件作为回归门禁。"
      : "补跑 invoice.paid 与 invoice.payment_failed 或 subscription.deleted，确认发票审计和权益降级。",
  });
}

function entitlementConsistencyRow(snapshot) {
  const activeSubscriptions = snapshot.subscriptions.filter((subscription) =>
    isActiveCommercialSubscription(subscription),
  );
  const activeEntitlements = snapshot.entitlements.filter((entitlement) =>
    isActiveCommercialEntitlement(entitlement),
  );
  const missingEntitlements = activeSubscriptions.filter((subscription) => {
    const subscriptionId = stringValue(subscription.externalSubscriptionId);
    return !activeEntitlements.some(
      (entitlement) =>
        stringValue(entitlement.externalSubscriptionId) === subscriptionId &&
        normalizePlan(entitlement.plan) === normalizePlan(subscription.plan),
    );
  });
  const danglingEntitlements = activeEntitlements.filter((entitlement) => {
    const subscriptionId = stringValue(entitlement.externalSubscriptionId);
    return (
      !subscriptionId ||
      !activeSubscriptions.some(
        (subscription) =>
          stringValue(subscription.externalSubscriptionId) === subscriptionId,
      )
    );
  });
  const pass =
    activeSubscriptions.length > 0 &&
    activeEntitlements.length > 0 &&
    missingEntitlements.length === 0 &&
    danglingEntitlements.length === 0;
  return row({
    id: "subscription-entitlement-consistency",
    title: "订阅与权益一致性",
    status: pass ? "PASS" : "CONFIG_REQUIRED",
    releaseBlocking: !pass,
    evidence: snapshot.evidence,
    detail: pass
      ? `有效订阅 ${activeSubscriptions.length} 条均有一致租户权益。`
      : `有效订阅=${activeSubscriptions.length}，有效权益=${activeEntitlements.length}，缺权益=${missingEntitlements.length}，孤立权益=${danglingEntitlements.length}。`,
    nextAction: pass
      ? "保持 BillingSubscription 与 TenantEntitlement 的 externalSubscriptionId 一致。"
      : "重放订阅 webhook 或修复权益同步，确保权益来自计费订阅而不是本地开关。",
  });
}

function billingBackupEvidenceRow(evidence) {
  const pass =
    evidence.latestPostgresDump &&
    evidence.postgresDumpHasBillingSchema &&
    evidence.postgresDumpHasBillingData;
  return row({
    id: "billing-backup-supporting-evidence",
    title: "备份中的计费数据辅助证据",
    status: pass ? "PASS" : "UNVERIFIED",
    releaseBlocking: false,
    evidence: evidence.latestPostgresDump || "",
    detail: pass
      ? "最近 Postgres 备份包含计费表结构和计费数据。"
      : "未确认最近备份中包含完整计费数据；此项不代替当前运行库门禁。",
    nextAction: pass
      ? "保留该证据作为恢复链路的计费数据佐证。"
      : "确保生产备份包含 billing_* 与 tenant_entitlements 数据。",
  });
}

function loadBillingDatabaseSnapshot() {
  const source = resolveDatabaseSource();
  if (!source) {
    return emptySnapshot({
      connected: false,
      kind: "unknown",
      evidence: "",
      message:
        "未找到可检查的数据库。请配置 SQLITE_DATABASE_URL、P7_BILLING_SQLITE_DATABASE 或 DATABASE_URL。",
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
  ).map((row) => row.name);
  const snapshot = emptySnapshot({
    connected: true,
    kind: "sqlite",
    evidence,
    message: "SQLite 数据库已连接。",
  });
  snapshot.tables = tables;
  if (tables.includes("billing_webhook_events")) {
    snapshot.webhookEvents = querySqliteJson(
      file,
      "select provider,event_id as eventId,event_type as eventType,signature_verified as signatureVerified,status,tenant_id as tenantId,external_subscription_id as externalSubscriptionId,processed_at as processedAt,created_at as createdAt from billing_webhook_events order by created_at desc limit 200;",
    ).map(normalizeRecord);
  }
  if (tables.includes("billing_subscriptions")) {
    snapshot.subscriptions = querySqliteJson(
      file,
      "select tenant_id as tenantId,provider,external_customer_id as externalCustomerId,external_subscription_id as externalSubscriptionId,plan,status,current_period_start as currentPeriodStart,current_period_end as currentPeriodEnd,cancel_at_period_end as cancelAtPeriodEnd,latest_webhook_event_id as latestWebhookEventId,updated_at as updatedAt from billing_subscriptions order by updated_at desc limit 200;",
    ).map(normalizeRecord);
  }
  if (tables.includes("billing_invoices")) {
    snapshot.invoices = querySqliteJson(
      file,
      "select tenant_id as tenantId,provider,external_invoice_id as externalInvoiceId,external_customer_id as externalCustomerId,external_subscription_id as externalSubscriptionId,status,amount_due as amountDue,amount_paid as amountPaid,currency,paid_at as paidAt,failed_at as failedAt,latest_webhook_event_id as latestWebhookEventId,updated_at as updatedAt from billing_invoices order by updated_at desc limit 200;",
    ).map(normalizeRecord);
  }
  if (tables.includes("tenant_entitlements")) {
    snapshot.entitlements = querySqliteJson(
      file,
      "select tenant_id as tenantId,source,plan,status,commercial_execution_allowed as commercialExecutionAllowed,external_subscription_id as externalSubscriptionId,period_start as periodStart,period_end as periodEnd,updated_at as updatedAt from tenant_entitlements where source='kaypal-subscription' order by updated_at desc limit 200;",
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
  ).map((row) => row.name);
  if (snapshot.tables.includes("billing_webhook_events")) {
    snapshot.webhookEvents = queryPostgresJson(
      psql,
      databaseUrl,
      "select provider,event_id as \"eventId\",event_type as \"eventType\",signature_verified as \"signatureVerified\",status,tenant_id as \"tenantId\",external_subscription_id as \"externalSubscriptionId\",processed_at as \"processedAt\",created_at as \"createdAt\" from billing_webhook_events order by created_at desc limit 200;",
    ).map(normalizeRecord);
  }
  if (snapshot.tables.includes("billing_subscriptions")) {
    snapshot.subscriptions = queryPostgresJson(
      psql,
      databaseUrl,
      "select tenant_id as \"tenantId\",provider,external_customer_id as \"externalCustomerId\",external_subscription_id as \"externalSubscriptionId\",plan,status,current_period_start as \"currentPeriodStart\",current_period_end as \"currentPeriodEnd\",cancel_at_period_end as \"cancelAtPeriodEnd\",latest_webhook_event_id as \"latestWebhookEventId\",updated_at as \"updatedAt\" from billing_subscriptions order by updated_at desc limit 200;",
    ).map(normalizeRecord);
  }
  if (snapshot.tables.includes("billing_invoices")) {
    snapshot.invoices = queryPostgresJson(
      psql,
      databaseUrl,
      "select tenant_id as \"tenantId\",provider,external_invoice_id as \"externalInvoiceId\",external_customer_id as \"externalCustomerId\",external_subscription_id as \"externalSubscriptionId\",status,amount_due as \"amountDue\",amount_paid as \"amountPaid\",currency,paid_at as \"paidAt\",failed_at as \"failedAt\",latest_webhook_event_id as \"latestWebhookEventId\",updated_at as \"updatedAt\" from billing_invoices order by updated_at desc limit 200;",
    ).map(normalizeRecord);
  }
  if (snapshot.tables.includes("tenant_entitlements")) {
    snapshot.entitlements = queryPostgresJson(
      psql,
      databaseUrl,
      "select tenant_id as \"tenantId\",source,plan,status,commercial_execution_allowed as \"commercialExecutionAllowed\",external_subscription_id as \"externalSubscriptionId\",period_start as \"periodStart\",period_end as \"periodEnd\",updated_at as \"updatedAt\" from tenant_entitlements where source='kaypal-subscription' order by updated_at desc limit 200;",
    ).map(normalizeRecord);
  }
  snapshot.safeSummary = safeSummary(snapshot);
  return snapshot;
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
  const sqliteArg = args.database || process.env.P7_BILLING_SQLITE_DATABASE || "";
  if (sqliteArg) {
    return { kind: "sqlite", file: resolvePath(sqliteArg) };
  }
  for (const envName of ["SQLITE_DATABASE_URL", "COMMERCIAL_BILLING_SQLITE_DATABASE_URL"]) {
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

function loadSupportingEvidence() {
  const latestPostgresDump = latestFile(
    evidenceRoot,
    /commercial-external-ops-smoke-.+\/downloaded-backup\/postgres-dump\.sql$/,
  );
  const text = latestPostgresDump ? readTextSafe(latestPostgresDump) : "";
  return {
    latestPostgresDump: latestPostgresDump ? relative(latestPostgresDump) : "",
    postgresDumpHasBillingSchema:
      /CREATE TABLE public\.billing_webhook_events/i.test(text) &&
      /CREATE TABLE public\.billing_subscriptions/i.test(text) &&
      /CREATE TABLE public\.billing_invoices/i.test(text),
    postgresDumpHasBillingData:
      /COPY public\.billing_subscriptions[\s\S]+?\n[^\\.\n]/i.test(text) &&
      /COPY public\.tenant_entitlements[\s\S]+?\n[^\\.\n]/i.test(text),
  };
}

function latestFile(root, pattern) {
  if (!existsSync(root)) return "";
  const matches = [];
  walk(root);
  return matches.sort((a, b) => mtimeKey(b) - mtimeKey(a))[0] || "";

  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = join(dir, entry.name);
      const rel = relative(absolute);
      if (entry.isDirectory()) {
        if (entry.name.startsWith("p7-billing-entitlement-gate-")) continue;
        walk(absolute);
      } else if (pattern.test(rel)) {
        matches.push(absolute);
      }
    }
  }
}

function emptySnapshot(input) {
  const snapshot = {
    ...input,
    tables: [],
    webhookEvents: [],
    subscriptions: [],
    invoices: [],
    entitlements: [],
    safeSummary: {},
  };
  snapshot.safeSummary = safeSummary(snapshot);
  return snapshot;
}

function safeSummary(snapshot) {
  return {
    connected: snapshot.connected,
    kind: snapshot.kind,
    evidence: snapshot.evidence,
    message: snapshot.message,
    tableCount: snapshot.tables.length,
    tables: snapshot.tables.filter((table) =>
      ["billing_webhook_events", "billing_subscriptions", "billing_invoices", "tenant_entitlements"].includes(table),
    ),
    webhookEventCount: snapshot.webhookEvents.length,
    subscriptionCount: snapshot.subscriptions.length,
    invoiceCount: snapshot.invoices.length,
    entitlementCount: snapshot.entitlements.length,
  };
}

function normalizeRecord(record) {
  const normalized = { ...record };
  for (const [key, value] of Object.entries(normalized)) {
    if (value === 0 || value === 1) {
      if (/verified|allowed|cancel/i.test(key)) normalized[key] = Boolean(value);
    }
  }
  return normalized;
}

function isActiveCommercialSubscription(subscription) {
  const status = String(subscription.status || "").toLowerCase();
  return (
    ["active", "trialing", "paid"].includes(status) &&
    planRank(subscription.plan) >= planRank("STANDARD") &&
    !dateExpired(subscription.currentPeriodEnd)
  );
}

function isActiveCommercialEntitlement(entitlement) {
  const status = String(entitlement.status || "").toLowerCase();
  return (
    entitlement.source === "kaypal-subscription" &&
    ["active", "trialing", "paid"].includes(status) &&
    truthy(entitlement.commercialExecutionAllowed) &&
    planRank(entitlement.plan) >= planRank("STANDARD") &&
    !dateExpired(entitlement.periodEnd)
  );
}

function planRank(plan) {
  return {
    FREE: 0,
    TRIAL: 0,
    STANDARD: 1,
    ADVANCED: 2,
    FLAGSHIP: 3,
    ENTERPRISE: 3,
  }[normalizePlan(plan)] ?? 0;
}

function normalizePlan(plan) {
  return String(plan || "FREE")
    .trim()
    .toUpperCase()
    .replace(/^PRO$/, "ADVANCED");
}

function dateExpired(value) {
  if (value === null || value === undefined || value === "") return false;
  const time = dateMs(value);
  return Number.isFinite(time) && time <= Date.now();
}

function dateMs(value) {
  if (typeof value === "number") {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  const text = String(value || "").trim();
  if (!text) return NaN;
  if (/^\d+$/.test(text)) return dateMs(Number(text));
  return Date.parse(text);
}

function truthy(value) {
  return value === true || value === 1 || /^(1|true|yes|on)$/i.test(String(value || ""));
}

function stringValue(value) {
  return String(value || "").trim();
}

function configuredWebhookSecrets() {
  return [
    "BILLING_WEBHOOK_SECRET",
    "KAYPAL_BILLING_WEBHOOK_SECRET",
    "KAYPAL_WEBHOOK_SECRET",
    "STRIPE_WEBHOOK_SECRET",
  ].filter((name) => Boolean(process.env[name]?.trim()));
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
    "# P7 Billing Entitlement Gate",
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
      ? "支付、订阅回调与权益一致性仍未闭环，不能判定为生产可用。"
      : "支付、订阅回调与权益一致性门禁通过，可作为 P5 生产发布矩阵证据。",
    "",
  );
  return `${lines.join("\n")}\n`;
}

function printSummary(data) {
  console.log("P7 billing entitlement gate");
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

function readTextSafe(filePath) {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
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
  node scripts/p7-billing-entitlement-gate.mjs
  node scripts/p7-billing-entitlement-gate.mjs --strict
  node scripts/p7-billing-entitlement-gate.mjs --database backend/prisma/data/sqlite-runtime/kaypal-ai.sqlite

Options:
  --strict             Exit 1 when billing/entitlement blockers exist.
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
