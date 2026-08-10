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
    join(evidenceRoot, `p8-third-party-crm-sync-gate-${timestampForFile()}`),
);

const database = loadCrmDatabaseSnapshot();
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
  const derived = deriveExternalCrmEvidence(snapshot);
  return [
    localCrmBoundaryRow(snapshot, evidence),
    connectorContractBoundaryRow(evidence),
    connectorVaultRow(snapshot, derived),
    readOnlySandboxRow(snapshot, derived),
    productionWriteApprovalRow(snapshot, derived),
    writeReadbackWhitelistRow(snapshot, derived),
    externalRollbackRow(snapshot, derived),
    auditIntegrityRow(snapshot, derived),
  ];
}

function localCrmBoundaryRow(snapshot, evidence) {
  const p4Pass = Boolean(evidence.latestP4Crm?.json?.pass);
  const commitCheck = findCheck(evidence.latestP4Crm, /destructive commit/i);
  const rollbackCheck = findCheck(evidence.latestP4Crm, /destructive rollback/i);
  const p4BoundaryPass =
    p4Pass &&
    checkText(commitCheck).includes("externalCrmTouched=false") &&
    checkText(rollbackCheck).includes("externalCrmTouched=false");
  const localAuditPass =
    hasAuditEvent(snapshot, /crm_import_committed/i, false) &&
    hasAuditEvent(snapshot, /crm_import_rollback_completed/i, false);
  const pass = p4BoundaryPass || localAuditPass;
  return row({
    id: "local-crm-write-rollback-boundary",
    title: "本地 CRM 写入回滚边界",
    status: pass ? "PASS" : "UNVERIFIED",
    releaseBlocking: false,
    evidence: evidence.latestP4Crm?.filePath || snapshot.evidence,
    detail: pass
      ? "本地导入和回滚均证明 externalCrmTouched=false；这只证明本地 CRM 闭环，不证明外部 CRM 生产同步。"
      : "未确认本地 CRM 写入回滚边界；此项是第三方 CRM 同步之前的基础证据。",
    nextAction: pass
      ? "继续把本地写入和外部同步分开验收。"
      : "先运行 P4 或 scripts/crm-commercial-phase1-smoke.mjs --api-only --destructive --confirm-local-crm-write。",
  });
}

function connectorContractBoundaryRow(evidence) {
  const readiness = findCheck(evidence.latestP4Crm, /crm\/connectors\/readiness/i);
  const contract = findCheck(evidence.latestP4Crm, /crm\/connectors\/contract/i);
  const readinessText = checkText(readiness);
  const contractText = checkText(contract);
  const pass =
    /contractOnly=true/i.test(readinessText) &&
    /writeTables=\[\]/i.test(`${readinessText} ${contractText}`) &&
    /requiredFutureGate=11G/i.test(`${readinessText} ${contractText}`);
  return row({
    id: "external-crm-connector-contract-boundary",
    title: "外部 CRM 连接合同边界",
    status: pass ? "PASS" : "UNVERIFIED",
    releaseBlocking: false,
    evidence: evidence.latestP4Crm?.filePath,
    detail: pass
      ? "P4 证明当前连接器为合同/干跑阶段：不收 token、不联网、不写外部系统，真实同步仍需 11G 后续验收。"
      : "未找到连接器 no-token/no-network/no-write 合同边界证据。",
    nextAction: pass
      ? "保持合同边界，后续生产同步必须另跑 P8。"
      : "先重跑 P4 CRM 子验收，确认连接器 dry-run 合同仍为 no-write。",
  });
}

function connectorVaultRow(snapshot, derived) {
  const pass = derived.activeVaultRecords.length > 0;
  return row({
    id: "external-crm-credential-vault",
    title: "外部 CRM 授权保护",
    status: pass ? "PASS" : "CONFIG_REQUIRED",
    releaseBlocking: !pass,
    evidence: snapshot.evidence,
    detail: pass
      ? `发现有效授权记录 ${derived.activeVaultRecords.length} 条，未读取或输出明文。`
      : "当前运行库没有 HubSpot/Salesforce 有效授权记录，不能做真实租户只读探针或同步。",
    nextAction: pass
      ? "生产环境使用专用测试租户授权，保留过期和撤销策略。"
      : "在专用 HubSpot/Salesforce 测试租户保存可撤销授权，确认密钥不回显、不落明文。",
  });
}

function readOnlySandboxRow(snapshot, derived) {
  const pass = derived.readOnlySandboxEvents.length > 0;
  return row({
    id: "external-crm-read-only-sandbox",
    title: "外部 CRM 只读探针",
    status: pass ? "PASS" : "CONFIG_REQUIRED",
    releaseBlocking: !pass,
    evidence: snapshot.evidence,
    detail: pass
      ? `发现成功只读探针 ${derived.readOnlySandboxEvents.length} 条，证明 externalNetwork=true、externalCrmTouched=true、externalCrmWrite=false。`
      : "当前运行库没有成功的外部 CRM 只读探针；不能确认授权、网络和字段读取可用。",
    nextAction: pass
      ? "保留只读探针作为写入验收前置条件。"
      : "使用专用测试租户运行 HubSpot/Salesforce 只读探针，读取公司/联系人/商机样本并留存审计。",
  });
}

function productionWriteApprovalRow(snapshot, derived) {
  const pass = derived.approvedWriteEvents.length > 0;
  return row({
    id: "external-crm-production-write-approval",
    title: "外部 CRM 生产写入确认",
    status: pass ? "PASS" : "REAL_ACCEPTANCE_REQUIRED",
    releaseBlocking: !pass,
    evidence: snapshot.evidence,
    detail: pass
      ? `发现带人工确认和 11G 证据的外部 CRM 写入 ${derived.approvedWriteEvents.length} 条。`
      : "当前没有 externalCrmWrite=true 且带人工确认/11G 证据的外部 CRM 写入审计。",
    nextAction: pass
      ? "保留审批人、测试租户、远端对象 ID 和 proofHash。"
      : "在专用测试租户执行一次受控写入，必须包含人工确认、字段白名单、远端对象 ID 和 proofHash。",
  });
}

function writeReadbackWhitelistRow(snapshot, derived) {
  const pass =
    derived.writeEvents.length > 0 &&
    derived.readbackEvents.length > 0 &&
    derived.fieldWhitelistEvents.length > 0;
  return row({
    id: "external-crm-write-readback-whitelist",
    title: "外部 CRM 写入后回读与字段白名单",
    status: pass ? "PASS" : "REAL_ACCEPTANCE_REQUIRED",
    releaseBlocking: !pass,
    evidence: snapshot.evidence,
    detail: pass
      ? `外部写入 ${derived.writeEvents.length} 条，回读校验 ${derived.readbackEvents.length} 条，字段白名单证据 ${derived.fieldWhitelistEvents.length} 条。`
      : `外部写入=${derived.writeEvents.length}，回读校验=${derived.readbackEvents.length}，字段白名单=${derived.fieldWhitelistEvents.length}。`,
    nextAction: pass
      ? "保持远端回读和字段白名单作为每次版本发布前门禁。"
      : "写入后立刻从远端 CRM 回读同一对象，校验只写允许字段，禁止把本地通过当成外部同步通过。",
  });
}

function externalRollbackRow(snapshot, derived) {
  const pass = derived.rollbackEvents.length > 0;
  return row({
    id: "external-crm-rollback-cleanup",
    title: "外部 CRM 回滚与清理",
    status: pass ? "PASS" : "REAL_ACCEPTANCE_REQUIRED",
    releaseBlocking: !pass,
    evidence: snapshot.evidence,
    detail: pass
      ? `发现外部 CRM 回滚/清理审计 ${derived.rollbackEvents.length} 条。`
      : "当前没有外部 CRM 回滚、撤销或测试对象清理证据。",
    nextAction: pass
      ? "保留远端对象清理结果和 proofHash。"
      : "对测试租户写入对象执行撤销或清理，确认远端已删除/归档并留下审计。",
  });
}

function auditIntegrityRow(snapshot, derived) {
  const requiredEvents = [
    ...derived.approvedWriteEvents,
    ...derived.readbackEvents,
    ...derived.rollbackEvents,
  ];
  const proofCount = requiredEvents.filter(hasProofHash).length;
  const pass = requiredEvents.length >= 3 && proofCount === requiredEvents.length;
  return row({
    id: "external-crm-audit-integrity",
    title: "外部 CRM 审计链完整性",
    status: pass ? "PASS" : "REAL_ACCEPTANCE_REQUIRED",
    releaseBlocking: !pass,
    evidence: snapshot.evidence,
    detail: pass
      ? `外部写入、回读、回滚审计均带 proofHash：${proofCount}/${requiredEvents.length}。`
      : `外部写入/回读/回滚完整审计=${requiredEvents.length}，带 proofHash=${proofCount}。`,
    nextAction: pass
      ? "把该审计链随版本归档。"
      : "补齐外部写入、远端回读、回滚清理三段审计，并确保每段都有 proofHash 或等价不可抵赖证据。",
  });
}

function deriveExternalCrmEvidence(snapshot) {
  const activeVaultRecords = snapshot.vaultRecords.filter((record) => {
    const connector = String(record.connectorKey || "").toLowerCase();
    return (
      ["hubspot", "salesforce"].includes(connector) &&
      String(record.status || "").toLowerCase() === "active" &&
      !record.revokedAt &&
      !record.quarantinedAt &&
      !dateExpired(record.expiresAt)
    );
  });
  const readOnlySandboxEvents = snapshot.auditEvents.filter((event) => {
    const text = eventText(event);
    return (
      /read[_ -]?only|sandbox/i.test(text) &&
      truthy(event.externalNetwork) &&
      truthy(event.externalCrmTouched) &&
      !eventHasExternalWrite(event) &&
      String(event.status || "").toLowerCase() === "success"
    );
  });
  const writeEvents = snapshot.auditEvents.filter(eventHasExternalWrite);
  const approvedWriteEvents = writeEvents.filter((event) => {
    const text = eventText(event);
    return /11G|approval|approved|confirm|manual|人工|确认|审批/i.test(text);
  });
  const readbackEvents = snapshot.auditEvents.filter((event) => {
    const text = eventText(event);
    return (
      truthy(event.externalCrmTouched) &&
      /readback|read[_ -]?back|verify|verification|reconcile|remote.*(read|object|id)|远端.*(回读|校验)/i.test(text)
    );
  });
  const fieldWhitelistEvents = snapshot.auditEvents.filter((event) =>
    /fieldWhitelist|field_whitelist|allowedFields|allowlist|白名单|允许字段/i.test(
      eventText(event),
    ),
  );
  const rollbackEvents = snapshot.auditEvents.filter((event) => {
    const text = eventText(event);
    return (
      truthy(event.externalCrmTouched) &&
      /rollback|roll_back|cleanup|clean_up|delete|archive|revoke|undo|撤销|回滚|清理|归档/i.test(text)
    );
  });
  return {
    activeVaultRecords,
    readOnlySandboxEvents,
    writeEvents,
    approvedWriteEvents,
    readbackEvents,
    fieldWhitelistEvents,
    rollbackEvents,
  };
}

function loadCrmDatabaseSnapshot() {
  const source = resolveDatabaseSource();
  if (!source) {
    return emptySnapshot({
      connected: false,
      kind: "unknown",
      evidence: "",
      message:
        "未找到可检查的数据库。请配置 SQLITE_DATABASE_URL、P8_CRM_SQLITE_DATABASE 或 DATABASE_URL。",
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
  if (tables.includes("crm_audit_events")) {
    snapshot.auditEvents = querySqliteJson(
      file,
      "select id,owner_id as ownerId,tenant_id as tenantId,import_batch_id as importBatchId,event_type as eventType,action,status,proof_hash as proofHash,external_network as externalNetwork,external_crm_touched as externalCrmTouched,write_tables as writeTables,read_tables as readTables,summary,payload,metadata,created_at as createdAt from crm_audit_events order by created_at desc limit 500;",
    ).map(normalizeRecord);
  }
  if (tables.includes("crm_connector_vault_records")) {
    snapshot.vaultRecords = querySqliteJson(
      file,
      "select id,owner_id as ownerId,tenant_id as tenantId,connector_key as connectorKey,credential_kind as credentialKind,label,status,metadata,expires_at as expiresAt,revoked_at as revokedAt,quarantined_at as quarantinedAt,created_at as createdAt,updated_at as updatedAt from crm_connector_vault_records order by created_at desc limit 200;",
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
  if (snapshot.tables.includes("crm_audit_events")) {
    snapshot.auditEvents = queryPostgresJson(
      psql,
      databaseUrl,
      'select id,owner_id as "ownerId",tenant_id as "tenantId",import_batch_id as "importBatchId",event_type as "eventType",action,status,proof_hash as "proofHash",external_network as "externalNetwork",external_crm_touched as "externalCrmTouched",write_tables as "writeTables",read_tables as "readTables",summary,payload,metadata,created_at as "createdAt" from crm_audit_events order by created_at desc limit 500;',
    ).map(normalizeRecord);
  }
  if (snapshot.tables.includes("crm_connector_vault_records")) {
    snapshot.vaultRecords = queryPostgresJson(
      psql,
      databaseUrl,
      'select id,owner_id as "ownerId",tenant_id as "tenantId",connector_key as "connectorKey",credential_kind as "credentialKind",label,status,metadata,expires_at as "expiresAt",revoked_at as "revokedAt",quarantined_at as "quarantinedAt",created_at as "createdAt",updated_at as "updatedAt" from crm_connector_vault_records order by created_at desc limit 200;',
    ).map(normalizeRecord);
  }
  snapshot.safeSummary = safeSummary(snapshot);
  return snapshot;
}

function loadSupportingEvidence() {
  return {
    latestP4: latestDirectoryReport("p4-business-journey-", "report.json"),
    latestP4Crm: latestDirectoryReport(
      "p4-business-journey-",
      join("crm-phase1", "report.json"),
    ),
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
  const sqliteArg = args.database || process.env.P8_CRM_SQLITE_DATABASE || "";
  if (sqliteArg) {
    return { kind: "sqlite", file: resolvePath(sqliteArg) };
  }
  for (const envName of ["SQLITE_DATABASE_URL", "COMMERCIAL_CRM_SQLITE_DATABASE_URL"]) {
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

function checkText(check) {
  return `${check?.name || ""} ${check?.details || ""}`;
}

function hasAuditEvent(snapshot, eventPattern, expectedExternalTouched) {
  return snapshot.auditEvents.some(
    (event) =>
      eventPattern.test(String(event.eventType || "")) &&
      truthy(event.status === "success" || event.status === "pass") &&
      Boolean(event.externalCrmTouched) === expectedExternalTouched,
  );
}

function eventHasExternalWrite(event) {
  if (!truthy(event.externalCrmTouched)) return false;
  const text = eventText(event);
  if (/read[_ -]?only|no[-_ ]?write|externalCrmWrite[": ]*false/i.test(text)) {
    return false;
  }
  if (/externalCrmWrite[": ]*true/i.test(text)) return true;
  return /crm\.connector\..*(write|sync|upsert|create|update)|external.*(write|sync|upsert|create|update)|hubspot.*(write|sync|upsert|create|update)|salesforce.*(write|sync|upsert|create|update)|远端.*(写入|同步|新增|更新)/i.test(
    text,
  );
}

function eventText(event) {
  return JSON.stringify({
    eventType: event.eventType,
    action: event.action,
    status: event.status,
    summary: event.summary,
    writeTables: event.writeTables,
    readTables: event.readTables,
    payload: event.payload,
    metadata: event.metadata,
  });
}

function hasProofHash(event) {
  return Boolean(
    stringValue(event.proofHash) ||
      /proofHash[": ]+[0-9a-f]{16,}/i.test(eventText(event)) ||
      /proof[": ]+[0-9a-f]{16,}/i.test(eventText(event)),
  );
}

function emptySnapshot(input) {
  const snapshot = {
    ...input,
    tables: [],
    auditEvents: [],
    vaultRecords: [],
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
      ["crm_audit_events", "crm_connector_vault_records", "crm_connector_vault_handles"].includes(table),
    ),
    auditEventCount: snapshot.auditEvents.length,
    vaultRecordCount: snapshot.vaultRecords.length,
    activeExternalVaultRecordCount: snapshot.vaultRecords.filter((record) =>
      ["hubspot", "salesforce"].includes(String(record.connectorKey || "").toLowerCase()) &&
      String(record.status || "").toLowerCase() === "active" &&
      !record.revokedAt &&
      !record.quarantinedAt &&
      !dateExpired(record.expiresAt),
    ).length,
  };
}

function normalizeRecord(record) {
  const normalized = { ...record };
  for (const [key, value] of Object.entries(normalized)) {
    if (value === 0 || value === 1) {
      if (/external|verified|allowed|cancel|touch/i.test(key)) {
        normalized[key] = Boolean(value);
      }
    }
    if (["payload", "metadata", "writeTables", "readTables"].includes(key)) {
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
    "# P8 Third-party CRM Sync Gate",
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
      ? "第三方 CRM 只能认定为本地边界和连接合同已确认，不能认定为生产同步可用。"
      : "第三方 CRM 生产同步门禁通过，可作为 P5 生产发布矩阵证据。",
    "",
  );
  return `${lines.join("\n")}\n`;
}

function printSummary(data) {
  console.log("P8 third-party CRM sync gate");
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
  return value === true || value === 1 || /^(1|true|yes|on|success|pass)$/i.test(String(value || ""));
}

function stringValue(value) {
  return String(value || "").trim();
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
  node scripts/p8-third-party-crm-sync-gate.mjs
  node scripts/p8-third-party-crm-sync-gate.mjs --strict
  node scripts/p8-third-party-crm-sync-gate.mjs --database backend/prisma/data/sqlite-runtime/kaypal-ai.sqlite

Options:
  --strict             Exit 1 when third-party CRM sync blockers exist.
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
