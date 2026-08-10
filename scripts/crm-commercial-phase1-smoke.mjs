#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

const args = parseArgs(process.argv.slice(2));
const frontendBase = stripTrailingSlash(args.baseUrl || process.env.BASE_URL || process.env.FRONTEND_URL || "http://127.0.0.1:3010");
const apiBase = stripTrailingSlash(args.apiBase || process.env.API_BASE || "http://127.0.0.1:3011/api");
const skipAuth = args.skipAuth || isTruthy(process.env.SKIP_AUTH);
const timeoutMs = positiveNumber(args.timeoutMs || process.env.TIMEOUT_MS, 10000);
const destructive = args.destructive || isTruthy(process.env.CRM_SMOKE_DESTRUCTIVE);
const confirmLocalCrmWrite = args.confirmLocalCrmWrite || isTruthy(process.env.CONFIRM_LOCAL_CRM_WRITE);

const results = [];
const evidence = {
  generatedAt: new Date().toISOString(),
  frontendBase,
  apiBase,
  skipAuth,
  destructive,
  confirmLocalCrmWrite,
  checks: [],
};

const sampleImportRows = [
  {
    company: "Acme Pilot Co",
    contact: "Ava Chen",
    phone: "13800000000",
    email: "ava@example.com",
    wechat: "ava_acceptance",
    opportunity: "AI content pilot",
    note: "Asked for a commercial walkthrough this week.",
  },
  {
    company: "Beta Studio",
    contact: "Ben Li",
    phone: "13900000000",
    email: "ben@example.com",
    wechat: "ben_acceptance",
    opportunity: "CRM closer rollout",
    note: "Needs manager daily report.",
  },
];

await main();

async function main() {
  if (args.help) {
    printHelp();
    return;
  }

  if (!args.apiOnly) {
    await runFrontendChecks();
  }

  if (!args.frontendOnly) {
    await runApiChecks();
    if (destructive) {
      await runDestructiveLocalCrmChecks();
    }
  }

  printSummary();

  if (args.json) {
    console.log(JSON.stringify(evidence, null, 2));
  }

  if (args.evidenceDir) {
    writeEvidenceFiles(args.evidenceDir);
  }

  const hasFailed = results.some((item) => item.status === "FAIL" || item.status === "BLOCKED");
  process.exitCode = hasFailed ? 1 : 0;
}

async function runFrontendChecks() {
  const routes = [
    "/crm",
    "/crm/import",
    "/crm/closer",
    "/crm/connectors",
    "/commercial-readiness",
  ];

  for (const route of routes) {
    const response = await request(`${frontendBase}${route}`, {
      headers: { Accept: "text/html,application/xhtml+xml" },
    });
    const status = routeStatus(response, false);
    addResult(
      status,
      `frontend:${route}`,
      `HTTP ${response.status}${response.error ? ` (${response.error})` : ""}`,
      status === "PASS" ? "" : `Start the frontend or implement route ${route}.`,
      response,
    );
  }
}

async function runApiChecks() {
  const headers = buildHeaders();

  await apiCheck("GET", "/commercial-readiness/summary", null, headers, validateReadinessSummary);
  await apiCheck("GET", "/crm/summary", null, headers, validateCrmSummary);
  await apiCheck("POST", "/crm/import/preview", importPayload("preview"), headers, validateImportPreview);
  await apiCheck("POST", "/crm/import/dry-run", importPayload("dry-run"), headers, validateImportDryRun);
  await apiCheck("GET", "/crm/closer/summary", null, headers, validateCloserSummary, { optionalShape: true });
  await apiCheck("POST", "/crm/closer/advice", { limit: 5, includeDormant: true }, headers, validateCloserAdvice, {
    optionalShape: true,
  });
  await apiCheck("GET", "/crm/connectors/readiness", null, headers, validateConnectorReadiness);
  await apiCheck("POST", "/crm/connectors/contract", { connectorKey: "hubspot", includeProof: true }, headers, validateConnectorContract);
}

async function runDestructiveLocalCrmChecks() {
  const headers = buildHeaders();
  if (Object.keys(headers).length === 0) {
    addResult(
      "BLOCKED",
      "api:destructive local CRM commit/rollback",
      "Missing auth header/cookie for destructive CRM smoke.",
      "Provide TOKEN, COOKIE_HEADER, or SESSION_TOKEN. This check writes local CRM rows then rolls them back.",
    );
    return;
  }
  if (!confirmLocalCrmWrite) {
    addResult(
      "BLOCKED",
      "api:destructive local CRM commit/rollback",
      "Refusing local CRM write without --confirm-local-crm-write.",
      "Re-run with --destructive --confirm-local-crm-write after pointing API_BASE at a test tenant/user.",
    );
    return;
  }

  const dryRun = await apiRequestData("POST", "/crm/import/dry-run", destructiveImportPayload(), headers);
  if (!dryRun.ok) {
    addResult(dryRun.status, "api:destructive dry-run", dryRun.message, dryRun.nextStep, dryRun.response);
    return;
  }

  const commitBody = {
    ...destructiveImportPayload(),
    dryRunId: dryRun.data.id,
    proofHash: dryRun.data.proof?.hash,
    confirmationGate: "MIGO_LOCAL_CRM_IMPORT_APPROVED",
    commit: true,
  };
  const commit = await apiRequestData("POST", "/crm/import/commit", commitBody, headers);
  if (!commit.ok) {
    addResult(commit.status, "api:destructive commit", commit.message, commit.nextStep, commit.response);
    return;
  }

  const commitValidation = validateImportCommit(commit.data);
  addResult(
    commitValidation.ok ? "PASS" : "FAIL",
    "api:destructive commit",
    commitValidation.message,
    commitValidation.ok ? "" : commitValidation.nextStep,
    commit.response,
  );
  if (!commitValidation.ok) return;

  const rollbackBody = {
    importCommitId: commit.data.rollbackPlan.importCommitId,
    rollbackToken: commit.data.rollbackPlan.rollbackToken,
    customerIds: commit.data.rollbackPlan.customerIds,
    reason: "crm-commercial-phase1-smoke rollback",
  };
  const rollback = await apiRequestData("POST", "/crm/import/rollback", rollbackBody, headers);
  if (!rollback.ok) {
    addResult(rollback.status, "api:destructive rollback", rollback.message, rollback.nextStep, rollback.response);
    return;
  }

  const rollbackValidation = validateImportRollback(rollback.data, commit.data);
  addResult(
    rollbackValidation.ok ? "PASS" : "FAIL",
    "api:destructive rollback",
    rollbackValidation.message,
    rollbackValidation.ok ? "" : rollbackValidation.nextStep,
    rollback.response,
  );

  const timeline = await apiRequestData("GET", "/crm/timeline", null, headers);
  if (!timeline.ok) {
    addResult(timeline.status, "api:destructive audit timeline", timeline.message, timeline.nextStep, timeline.response);
    return;
  }
  const auditValidation = validateImportAuditTimeline(timeline.data, commit.data, rollback.data);
  addResult(
    auditValidation.ok ? "PASS" : "FAIL",
    "api:destructive audit timeline",
    auditValidation.message,
    auditValidation.ok ? "" : auditValidation.nextStep,
    timeline.response,
  );

  const batches = await apiRequestData("GET", "/crm/import/batches", null, headers);
  if (!batches.ok) {
    addResult(batches.status, "api:destructive import batch ledger", batches.message, batches.nextStep, batches.response);
    return;
  }
  const batchValidation = validateImportBatchLedger(batches.data, commit.data, rollback.data);
  addResult(
    batchValidation.ok ? "PASS" : "FAIL",
    "api:destructive import batch ledger",
    batchValidation.message,
    batchValidation.ok ? "" : batchValidation.nextStep,
    batches.response,
  );

  const importBatchId = commit.data?.rollbackPlan?.importCommitId || commit.data?.id;
  const auditEvents = await apiRequestData("GET", `/crm/audit/events?importBatchId=${encodeURIComponent(importBatchId)}`, null, headers);
  if (!auditEvents.ok) {
    addResult(auditEvents.status, "api:destructive audit event ledger", auditEvents.message, auditEvents.nextStep, auditEvents.response);
    return;
  }
  const auditEventValidation = validateAuditEventLedger(auditEvents.data, commit.data, rollback.data);
  addResult(
    auditEventValidation.ok ? "PASS" : "FAIL",
    "api:destructive audit event ledger",
    auditEventValidation.message,
    auditEventValidation.ok ? "" : auditEventValidation.nextStep,
    auditEvents.response,
  );
}

async function apiCheck(method, path, body, headers, validator, options = {}) {
  const response = await request(`${apiBase}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const status = routeStatus(response, true);
  if (status !== "PASS") {
    addResult(status, `api:${method} ${path}`, `HTTP ${response.status}${response.error ? ` (${response.error})` : ""}`, apiNextStep(path, response), response);
    return;
  }

  const data = unwrapData(response.body);
  const validation = validator(data, options);
  addResult(
    validation.ok ? "PASS" : "FAIL",
    `api:${method} ${path}`,
    validation.message,
    validation.ok ? "" : validation.nextStep || `Fix ${path} response contract.`,
    response,
  );
}

function validateReadinessSummary(data) {
  const checks = Array.isArray(data?.checks) ? data.checks : [];
  const hasCrmGate = checks.some((item) => String(item?.key || "").includes("crm"));
  if (!data || typeof data !== "object") {
    return fail("Readiness summary is not an object.");
  }
  if (!("overallStatus" in data) || !Array.isArray(data.checks)) {
    return fail("Readiness summary is missing overallStatus/checks.");
  }
  return {
    ok: true,
    message: `overallStatus=${data.overallStatus}; checks=${checks.length}; crmGate=${hasCrmGate}`,
  };
}

function validateCrmSummary(data) {
  if (!data || typeof data !== "object") {
    return fail("CRM summary is not an object.");
  }
  const required = ["totalCustomers", "totalCompanies", "activeOpportunities", "openTasks", "timelineEvents"];
  const missing = required.filter((key) => !(key in data));
  if (missing.length > 0) {
    return fail(`CRM summary missing fields: ${missing.join(", ")}`);
  }
  return {
    ok: true,
    message: `customers=${data.totalCustomers}; companies=${data.totalCompanies}; opportunities=${data.activeOpportunities}; openTasks=${data.openTasks}`,
  };
}

function validateImportPreview(data) {
  if (!data || typeof data !== "object") {
    return fail("Import preview is not an object.");
  }
  const mapping = data.mapping || data.fieldMapping;
  const rows = data.previewRows;
  const proof = data.proof;
  if (!mapping || typeof mapping !== "object") {
    return fail("Import preview missing field mapping.");
  }
  if (!Array.isArray(rows)) {
    return fail("Import preview missing previewRows array.");
  }
  if (!proof?.id && !data.proofId) {
    return fail("Import preview missing proof id.");
  }
  return {
    ok: true,
    message: `rows=${data.rowCount ?? rows.length}; previewRows=${rows.length}; proof=${proof?.id || data.proofId}`,
  };
}

function validateImportDryRun(data) {
  const preview = validateImportPreview(data);
  if (!preview.ok) return preview;
  const writeTables = collectWriteTables(data);
  const futureGate = data.requiredFutureGate || data.proof?.requiredFutureGate || data.safety?.requiredFutureGate;
  const noWrite = writeTables.length === 0 || writeTables.every((item) => !item);
  if (!noWrite) {
    return fail(`Import dry-run exposes writeTables=${JSON.stringify(writeTables)}.`, "Keep Phase 1 import dry-run-only with writeTables=[].");
  }
  if (futureGate && String(futureGate).toUpperCase() !== "11G") {
    return fail(`Import dry-run requiredFutureGate is ${futureGate}, expected 11G.`);
  }
  return {
    ok: true,
    message: `${preview.message}; writeTables=[]; requiredFutureGate=${futureGate || "not surfaced"}`,
  };
}

function validateCloserSummary(data) {
  if (!data || typeof data !== "object") {
    return fail("Closer summary is not an object.");
  }
  const count = data.totalAdvice ?? data.dailySummary?.recommendedActionCount ?? data.todayFollowUps?.length;
  const humanReview = data.safety?.humanReviewRequired === true || /human|人工|判断|review/i.test(JSON.stringify(data));
  if (count === undefined && !data.dailyReport && !data.dailySummary) {
    return fail("Closer summary missing advice count or daily report.");
  }
  return {
    ok: true,
    message: `adviceCount=${count ?? "unknown"}; humanReview=${humanReview}`,
  };
}

function validateCloserAdvice(data) {
  if (!data || typeof data !== "object") {
    return fail("Closer advice response is not an object.");
  }
  const advice = Array.isArray(data.advice)
    ? data.advice
    : Array.isArray(data.todayFollowUps)
      ? data.todayFollowUps
      : [];
  const safety = data.safety || {};
  const noAutoWrite = safety.autoWrite === false || safety.writeTables?.length === 0 || /read-only|只读|不写/i.test(JSON.stringify(data));
  if (advice.length === 0) {
    return fail("Closer advice returned no advice items. Load acceptance CRM data before commercial walkthrough.");
  }
  if (!noAutoWrite) {
    return fail("Closer advice response does not prove read-only/no-write safety.");
  }
  return {
    ok: true,
    message: `advice=${advice.length}; readOnly=${noAutoWrite}`,
  };
}

function validateConnectorReadiness(data) {
  if (!data || typeof data !== "object") {
    return fail("Connector readiness is not an object.");
  }
  const connectors = Array.isArray(data.connectors) ? data.connectors : [];
  const text = JSON.stringify(data);
  const noWrite = collectWriteTables(data).length === 0 || /noWrite|no-write|不写|writeTables\":\[\]/i.test(text);
  const contractOnly = /contract-only|contract-ready|dry-run-only|no-token|noNetwork|不收 token|不联网/i.test(text);
  if (connectors.length === 0) {
    return fail("Connector readiness missing connectors array.");
  }
  if (!noWrite || !contractOnly) {
    return fail("Connector readiness does not clearly prove contract-only/no-write boundary.");
  }
  return {
    ok: true,
    message: `connectors=${connectors.length}; contractOnly=${contractOnly}; writeTables=[]`,
  };
}

function validateConnectorContract(data) {
  if (!data || typeof data !== "object") {
    return fail("Connector contract is not an object.");
  }
  const text = JSON.stringify(data);
  const noWrite = collectWriteTables(data).length === 0 || /noWrite|no-write|不写|writeTables\":\[\]/i.test(text);
  const futureGate = data.requiredFutureGate || data.safetyBoundary?.requiredFutureGate || data.summary?.requiredFutureGate;
  if (!noWrite) {
    return fail("Connector contract does not clearly keep writeTables empty.");
  }
  if (futureGate && String(futureGate).toUpperCase() !== "11G") {
    return fail(`Connector contract requiredFutureGate is ${futureGate}, expected 11G.`);
  }
  return {
    ok: true,
    message: `connector=${data.connectorKey || data.key || data.id || "unknown"}; writeTables=[]; requiredFutureGate=${futureGate || "not surfaced"}`,
  };
}

function validateImportCommit(data) {
  if (!data || typeof data !== "object") {
    return fail("Import commit response is not an object.");
  }
  const committedCount = Number(data.committedCount ?? 0);
  const plan = data.rollbackPlan || {};
  const customerIds = Array.isArray(plan.customerIds) ? plan.customerIds : [];
  const writeTables = collectWriteTables(data);
  if (committedCount < 1) {
    return fail("Import commit did not create/update any local CRM customer.");
  }
  if (!data.proof?.hash) {
    return fail("Import commit missing proof hash.");
  }
  if (data.externalCrmTouched !== false) {
    return fail("Import commit did not prove externalCrmTouched=false.");
  }
  if (!plan.importCommitId || !plan.rollbackToken || customerIds.length < 1) {
    return fail("Import commit missing rollback plan/token/customer ids.");
  }
  if (!data.importBatch?.id || data.importBatch.id !== plan.importCommitId) {
    return fail("Import commit missing persisted importBatch id matching rollback plan.");
  }
  if (!data.audit?.auditEvent?.id) {
    return fail("Import commit missing persisted audit event.");
  }
  if (!writeTables.includes("crm_customers") || !writeTables.includes("crm_timeline_events")) {
    return fail(`Import commit writeTables missing local CRM tables: ${JSON.stringify(writeTables)}.`);
  }
  if (!writeTables.includes("crm_import_batches") || !writeTables.includes("crm_audit_events")) {
    return fail(`Import commit writeTables missing commercial audit tables: ${JSON.stringify(writeTables)}.`);
  }
  return {
    ok: true,
    message: `committed=${committedCount}; customers=${customerIds.length}; batch=${data.importBatch.id}; proof=${data.proof.hash}; externalCrmTouched=false`,
  };
}

function validateImportRollback(data, commitData) {
  if (!data || typeof data !== "object") {
    return fail("Import rollback response is not an object.");
  }
  const archivedCount = Number(data.archivedCount ?? 0);
  const expected = Array.isArray(commitData?.rollbackPlan?.customerIds) ? commitData.rollbackPlan.customerIds.length : 0;
  const writeTables = collectWriteTables(data);
  if (archivedCount !== expected) {
    return fail(`Rollback archived ${archivedCount}, expected ${expected}.`);
  }
  if (!data.proof?.hash) {
    return fail("Rollback missing proof hash.");
  }
  if (data.externalCrmTouched !== false) {
    return fail("Rollback did not prove externalCrmTouched=false.");
  }
  if (!writeTables.includes("crm_customers") || !writeTables.includes("crm_timeline_events")) {
    return fail(`Rollback writeTables missing local CRM tables: ${JSON.stringify(writeTables)}.`);
  }
  if (!writeTables.includes("crm_import_batches") || !writeTables.includes("crm_audit_events")) {
    return fail(`Rollback writeTables missing commercial audit tables: ${JSON.stringify(writeTables)}.`);
  }
  if (!data.audit?.auditEvent?.id) {
    return fail("Rollback missing persisted audit event.");
  }
  return {
    ok: true,
    message: `archived=${archivedCount}; proof=${data.proof.hash}; externalCrmTouched=false`,
  };
}

function validateImportAuditTimeline(data, commitData, rollbackData) {
  const events = Array.isArray(data) ? data : Array.isArray(data?.events) ? data.events : [];
  const eventTypes = new Set(events.map((event) => event?.eventType).filter(Boolean));
  const required = [
    "customer_created",
    "crm_import_committed",
    "crm_import_rollback_archived",
    "crm_import_rollback_completed",
  ];
  const missing = required.filter((eventType) => !eventTypes.has(eventType));
  const text = JSON.stringify(events);
  const hasCommitId = commitData?.rollbackPlan?.importCommitId && text.includes(commitData.rollbackPlan.importCommitId);
  const hasCommitProof = commitData?.proof?.hash && text.includes(commitData.proof.hash);
  const hasRollbackProof = rollbackData?.proof?.hash && text.includes(rollbackData.proof.hash);
  if (missing.length > 0) {
    return fail(`Timeline missing audit event types: ${missing.join(", ")}.`);
  }
  if (!hasCommitId || !hasCommitProof || !hasRollbackProof) {
    return fail("Timeline does not include commit id plus commit/rollback proof hashes.");
  }
  return {
    ok: true,
    message: `events=${events.length}; requiredEvents=${required.join(",")}; proofHashesLinked=true`,
  };
}

function validateImportBatchLedger(data, commitData, rollbackData) {
  const batches = Array.isArray(data) ? data : Array.isArray(data?.batches) ? data.batches : [];
  const importBatchId = commitData?.rollbackPlan?.importCommitId || commitData?.id;
  const batch = batches.find((item) => item?.id === importBatchId);
  if (!batch) {
    return fail(`Import batch ledger missing batch ${importBatchId}.`);
  }
  if (batch.commitProofHash !== commitData?.proof?.hash) {
    return fail("Import batch ledger commitProofHash does not match commit proof.");
  }
  if (batch.rollbackProofHash !== rollbackData?.proof?.hash) {
    return fail("Import batch ledger rollbackProofHash does not match rollback proof.");
  }
  if (!/rolled_back|rollback_no_changes/.test(String(batch.status))) {
    return fail(`Import batch ledger status is ${batch.status}, expected rolled_back/rollback_no_changes.`);
  }
  const writeTables = collectWriteTables(batch);
  if (!writeTables.includes("crm_import_batches") || !writeTables.includes("crm_audit_events")) {
    return fail(`Import batch ledger writeTables missing audit tables: ${JSON.stringify(writeTables)}.`);
  }
  return {
    ok: true,
    message: `batch=${batch.id}; status=${batch.status}; commitProof=${batch.commitProofHash}; rollbackProof=${batch.rollbackProofHash}`,
  };
}

function validateAuditEventLedger(data, commitData, rollbackData) {
  const events = Array.isArray(data) ? data : Array.isArray(data?.events) ? data.events : [];
  const eventTypes = new Set(events.map((event) => event?.eventType).filter(Boolean));
  const required = ["crm_import_committed", "crm_import_rollback_completed"];
  const missing = required.filter((eventType) => !eventTypes.has(eventType));
  const text = JSON.stringify(events);
  if (missing.length > 0) {
    return fail(`Audit event ledger missing event types: ${missing.join(", ")}.`);
  }
  if (!text.includes(commitData?.proof?.hash) || !text.includes(rollbackData?.proof?.hash)) {
    return fail("Audit event ledger does not include commit and rollback proof hashes.");
  }
  return {
    ok: true,
    message: `auditEvents=${events.length}; requiredEvents=${required.join(",")}; proofHashesLinked=true`,
  };
}

function importPayload(label) {
  return {
    filename: `crm-phase1-${label}.csv`,
    sourceType: "phase1-smoke",
    proofLabel: `crm-phase1-${label}`,
    commit: false,
    rows: sampleImportRows,
  };
}

function destructiveImportPayload() {
  const suffix = String(Date.now()).slice(-8);
  return {
    ...importPayload(`destructive-${suffix}`),
    rows: sampleImportRows.map((row, index) => ({
      ...row,
      company: `${row.company} ${suffix}`,
      contact: `${row.contact} ${suffix}`,
      phone: `137${suffix.slice(0, 7)}${index}`,
      email: `crm-smoke-${suffix}-${index}@example.com`,
      note: `${row.note} destructive-smoke-${suffix}`,
    })),
  };
}

async function apiRequestData(method, path, body, headers) {
  const response = await request(`${apiBase}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const status = routeStatus(response, true);
  if (status !== "PASS") {
    return {
      ok: false,
      status,
      message: `HTTP ${response.status}${response.error ? ` (${response.error})` : ""}`,
      nextStep: apiNextStep(path, response),
      response,
    };
  }
  return {
    ok: true,
    status,
    data: unwrapData(response.body),
    response,
  };
}

async function request(url, options = {}) {
  const controller = new AbortController();
  const startedAt = Date.now();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      ...options,
      signal: controller.signal,
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      latencyMs: Date.now() - startedAt,
      body: parseJson(text),
      bodyPreview: text.slice(0, 500),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      latencyMs: Date.now() - startedAt,
      error: error?.name === "AbortError" ? `timeout after ${timeoutMs}ms` : error?.message || String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

function routeStatus(response, authProtected) {
  if (response.ok) {
    if (!authProtected && looksLikeFrontendNotFound(response)) return "FAIL";
    return "PASS";
  }
  if (authProtected && skipAuth && (response.status === 401 || response.status === 403)) return "SKIP";
  if (response.status === 401 || response.status === 403 || response.status === 0) return "BLOCKED";
  return "FAIL";
}

function looksLikeFrontendNotFound(response) {
  const text = String(response.bodyPreview || "").toLowerCase();
  if (!text) return false;
  const has404Signal = text.includes("404") || text.includes("not-found") || text.includes("not found");
  const hasNextNotFound = text.includes("this page could not be found") || text.includes("__next_error__");
  return has404Signal && hasNextNotFound;
}

function apiNextStep(path, response) {
  if (response.status === 401 || response.status === 403) {
    return skipAuth ? "Auth was skipped by SKIP_AUTH=1." : "Provide TOKEN, COOKIE_HEADER, or SESSION_TOKEN; or set SKIP_AUTH=1 for route-only smoke.";
  }
  if (response.status === 404 || response.status === 405) {
    return `Implement or wire API route ${path}.`;
  }
  if (response.status === 0) {
    return "Start backend or fix API_BASE/TIMEOUT_MS.";
  }
  return "Inspect backend logs and response contract.";
}

function buildHeaders() {
  const headers = {};
  const cookieHeader = process.env.COOKIE_HEADER || process.env.CRM_SMOKE_COOKIE_HEADER || "";
  const sessionToken = process.env.SESSION_TOKEN || process.env.CRM_SMOKE_SESSION_TOKEN || "";
  const token = process.env.TOKEN || process.env.CRM_SMOKE_TOKEN || "";
  const authCookieName = process.env.AUTH_COOKIE_NAME || "ai_content_session";

  if (cookieHeader) {
    headers.Cookie = cookieHeader;
  } else if (sessionToken) {
    headers.Cookie = `${authCookieName}=${sessionToken}`;
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function addResult(status, name, details, nextStep = "", response = null) {
  const item = {
    status,
    name,
    details,
    nextStep,
    httpStatus: response?.status,
    latencyMs: response?.latencyMs,
  };
  results.push(item);
  evidence.checks.push({
    ...item,
    response: response ? redactResponse(response) : null,
  });
}

function printSummary() {
  const counts = countStatuses(results);
  console.log("CRM commercial Phase 1 smoke summary");
  console.log(`PASS=${counts.PASS || 0} SKIP=${counts.SKIP || 0} FAIL=${counts.FAIL || 0} BLOCKED=${counts.BLOCKED || 0}`);
  for (const item of results) {
    const next = item.nextStep ? ` | next: ${item.nextStep}` : "";
    console.log(`[${item.status}] ${item.name}: ${item.details}${next}`);
  }
}

function parseArgs(argv) {
  const parsed = {
    apiOnly: false,
    frontendOnly: false,
    json: false,
    help: false,
    skipAuth: false,
    destructive: false,
    confirmLocalCrmWrite: false,
    evidenceDir: "",
    apiBase: "",
    baseUrl: "",
    timeoutMs: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--api-only") parsed.apiOnly = true;
    else if (arg === "--frontend-only") parsed.frontendOnly = true;
    else if (arg === "--json") parsed.json = true;
    else if (arg === "--skip-auth") parsed.skipAuth = true;
    else if (arg === "--destructive") parsed.destructive = true;
    else if (arg === "--confirm-local-crm-write") parsed.confirmLocalCrmWrite = true;
    else if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--api-base") parsed.apiBase = argv[++index] || "";
    else if (arg === "--base-url") parsed.baseUrl = argv[++index] || "";
    else if (arg === "--evidence-dir") parsed.evidenceDir = argv[++index] || "";
    else if (arg === "--timeout-ms") parsed.timeoutMs = argv[++index] || "";
  }

  return parsed;
}

function printHelp() {
  console.log(`Usage:
  node scripts/crm-commercial-phase1-smoke.mjs
  BASE_URL=http://127.0.0.1:3010 API_BASE=http://127.0.0.1:3011/api TOKEN='...' node scripts/crm-commercial-phase1-smoke.mjs
  SKIP_AUTH=1 node scripts/crm-commercial-phase1-smoke.mjs --json
  COOKIE_HEADER='ai_content_session=...' node scripts/crm-commercial-phase1-smoke.mjs --api-only --destructive --confirm-local-crm-write

Options:
  --frontend-only   Check frontend routes only.
  --api-only        Check backend API only.
  --json            Print JSON evidence after the text summary.
  --skip-auth       Treat 401/403 protected API responses as skipped.
  --destructive     Also write test rows into local CRM, roll them back, and verify audit timeline events.
  --confirm-local-crm-write
                   Required together with --destructive. Prevents accidental writes to a non-test tenant.
  --base-url URL    Frontend base URL. Default: BASE_URL or http://127.0.0.1:3010.
  --api-base URL    Backend API base. Default: API_BASE or http://127.0.0.1:3011/api.
  --evidence-dir DIR
                   Write report.json, report.md, and 00-env.json for release gates.
  --timeout-ms N    Per-request timeout. Default: 10000.
`);
}

function writeEvidenceFiles(dir) {
  const targetDir = resolve(String(dir));
  mkdirSync(targetDir, { recursive: true });
  const statusCounts = countStatuses(results);
  const report = {
    ...evidence,
    statusCounts,
    pass: (statusCounts.FAIL || 0) === 0 && (statusCounts.BLOCKED || 0) === 0,
  };
  const env = {
    generatedAt: evidence.generatedAt,
    platform: process.platform,
    node: process.version,
    cwd: process.cwd(),
    frontendBase,
    apiBase,
    destructive,
    confirmLocalCrmWrite,
    skipAuth,
  };
  writeFileSync(join(targetDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(join(targetDir, "00-env.json"), `${JSON.stringify(env, null, 2)}\n`, "utf8");
  writeFileSync(join(targetDir, "report.md"), renderMarkdownReport(report), "utf8");
  console.log(`Evidence written to ${targetDir}`);
}

function renderMarkdownReport(report) {
  const counts = report.statusCounts || {};
  const lines = [
    "# CRM Commercial Phase 1 Smoke Evidence",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Frontend: ${report.frontendBase}`,
    `- API: ${report.apiBase}`,
    `- Destructive local CRM write: ${report.destructive ? "yes" : "no"}`,
    `- Result: ${report.pass ? "PASS" : "FAIL"}`,
    `- Counts: PASS=${counts.PASS || 0} SKIP=${counts.SKIP || 0} FAIL=${counts.FAIL || 0} BLOCKED=${counts.BLOCKED || 0}`,
    "",
    "## Checks",
    "",
    "| Status | Check | Details | Next step |",
    "| --- | --- | --- | --- |",
  ];
  for (const item of report.checks || []) {
    lines.push(
      `| ${escapeMarkdownTable(item.status)} | ${escapeMarkdownTable(item.name)} | ${escapeMarkdownTable(item.details)} | ${escapeMarkdownTable(item.nextStep || "")} |`,
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function escapeMarkdownTable(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

function unwrapData(body) {
  if (body && typeof body === "object" && "success" in body && "data" in body) {
    return body.data;
  }
  return body;
}

function collectWriteTables(value) {
  const found = [];
  visit(value, (key, candidate) => {
    if (key === "writeTables" && Array.isArray(candidate)) {
      found.push(...candidate);
    }
  });
  return found.filter((item) => item !== undefined && item !== null && String(item).trim() !== "");
}

function visit(value, visitor, key = "") {
  visitor(key, value);
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => visit(item, visitor, String(index)));
    return;
  }
  for (const [nextKey, nextValue] of Object.entries(value)) {
    visit(nextValue, visitor, nextKey);
  }
}

function fail(message, nextStep = "") {
  return { ok: false, message, nextStep };
}

function countStatuses(items) {
  return items.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
}

function stripTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isTruthy(value) {
  return /^(1|true|yes|y)$/i.test(String(value || ""));
}

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function redactResponse(response) {
  const text = JSON.stringify(response, null, 2)
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/g, "$1[REDACTED]")
    .replace(/(ai_content_session=)[^;\"\\s]+/g, "$1[REDACTED]")
    .replace(/(\"authorization\"\\s*:\\s*\")[^\"]+(\")/gi, "$1[REDACTED]$2")
    .replace(/(\"cookie\"\\s*:\\s*\")[^\"]+(\")/gi, "$1[REDACTED]$2");
  return parseJson(text) || { status: response.status, ok: response.ok };
}
