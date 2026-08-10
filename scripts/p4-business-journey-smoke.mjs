#!/usr/bin/env node

import { randomBytes, createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

const require = createRequire(import.meta.url);
const args = parseArgs(process.argv.slice(2));
const repoRoot = resolve(import.meta.dirname, "..");
const apiBase = stripTrailingSlash(
  args.apiBase || process.env.API_BASE || "http://127.0.0.1:3011/api",
);
const frontendBase = stripTrailingSlash(
  args.frontendBase ||
    process.env.FRONTEND_BASE ||
    process.env.BASE_URL ||
    "http://127.0.0.1:3010",
);
const timeoutMs = positiveNumber(args.timeoutMs || process.env.TIMEOUT_MS, 15000);
const evidenceDir =
  args.evidenceDir ||
  join(
    repoRoot,
    "docs",
    `acceptance-evidence-${new Date().toISOString().slice(0, 10)}`,
    `p4-business-journey-${timestampForFile()}`,
  );
const authCookieName = process.env.AUTH_COOKIE_NAME || "ai_content_session";
const results = [];
const evidence = {
  generatedAt: new Date().toISOString(),
  apiBase,
  frontendBase,
  checks: [],
  artifacts: {},
};

let localSession = null;

try {
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const headers = await buildAuthHeaders();
  await runContentOptimizationJourney(headers);
  if (!args.skipCrm) {
    runCrmJourney(headers);
  }
} finally {
  if (localSession) cleanupLocalAcceptanceSession(localSession);
  writeEvidenceFiles();
  printSummary();
}

const counts = countStatuses(results);
process.exitCode = counts.FAIL || counts.BLOCKED ? 1 : 0;

async function runContentOptimizationJourney(headers) {
  const title = `P4 商用旅程验收 ${new Date().toISOString().slice(0, 10)}`;
  const content = [
    "这是一篇面向小红书的门店增长笔记。",
    "用户可以在评论区说明需求，我们再人工判断是否适合继续沟通。",
    "原始风险文案包含“私信领取资料”和“免费领清单”，用于验证发布前检查与负责人复核。",
  ].join("\n");

  const version = await apiJson("POST", "/content-optimization/versions", headers, {
    mode: "xhs",
    modeLabel: "小红书笔记优化",
    title,
    content,
    originalTitle: "门店内容没有转化怎么办",
    originalContent: "私信领取资料，免费领清单。",
    platform: "xiaohongshu",
    targetType: "xiaohongshu_note",
    sourceSummary: "P4 商用业务旅程验收",
  });
  if (!expectOk(version, "创作优化：保存优化版本")) return;
  const savedVersion = unwrapData(version.body);
  const versionId = savedVersion?.id;
  const draftId = savedVersion?.draftId;
  addResult(
    versionId && draftId ? "PASS" : "FAIL",
    "创作优化：版本已保存",
    versionId
      ? `version=${versionId}; draft=${draftId}; status=${savedVersion.status}`
      : "版本保存接口未返回 versionId/draftId",
    versionId ? "" : "检查 /content-optimization/versions 响应契约。",
    version,
  );
  if (!versionId) return;
  evidence.artifacts.contentVersionId = versionId;
  evidence.artifacts.contentDraftId = draftId;

  const diff = await apiJson(
    "GET",
    `/content-optimization/versions/${encodeURIComponent(versionId)}/diff`,
    headers,
  );
  if (expectOk(diff, "创作优化：差异摘要可读")) {
    const diffData = unwrapData(diff.body);
    const hasSummary =
      diffData?.summary &&
      typeof diffData.summary.originalLength === "number" &&
      typeof diffData.summary.versionLength === "number";
    addResult(
      hasSummary ? "PASS" : "FAIL",
      "创作优化：差异摘要完整",
      hasSummary
        ? `original=${diffData.summary.originalLength}; version=${diffData.summary.versionLength}`
        : "差异摘要缺少长度信息",
      hasSummary ? "" : "检查版本对比接口和页面展示所需字段。",
      diff,
    );
  }

  const compliance = await apiJson("POST", "/compliance/check", headers, {
    title,
    content,
    platform: "xiaohongshu",
    targetType: "xiaohongshu_note",
    targetId: versionId,
    scenario: "pre_publish",
  });
  if (!expectOk(compliance, "合规检查：发布前检查完成")) return;
  const complianceData = unwrapData(compliance.body);
  const needsReview = ["medium", "high"].includes(complianceData?.riskLevel);
  addResult(
    needsReview && complianceData?.checkId ? "PASS" : "FAIL",
    "合规检查：风险门禁命中",
    `risk=${complianceData?.riskLevel}; score=${complianceData?.riskScore}; findings=${complianceData?.findings?.length ?? 0}`,
    needsReview
      ? ""
      : "本次样本应命中中/高风险，以验证负责人复核门禁。",
    compliance,
  );
  evidence.artifacts.complianceCheckId = complianceData?.checkId;

  const official = await apiJson(
    "POST",
    `/content-optimization/versions/${encodeURIComponent(versionId)}/official`,
    headers,
    { writeBackDraft: true },
  );
  if (!expectOk(official, "创作优化：设为正式稿")) return;
  const officialData = unwrapData(official.body);
  addResult(
    officialData?.isOfficial === true ? "PASS" : "FAIL",
    "创作优化：正式稿状态正确",
    `status=${officialData?.status}; official=${officialData?.isOfficial}`,
    officialData?.isOfficial === true
      ? ""
      : "正式稿接口返回未标记 isOfficial=true。",
    official,
  );

  const blockedPublish = await apiJson(
    "POST",
    "/content-optimization/publish-intents",
    headers,
    { versionId, platform: "xiaohongshu" },
  );
  const blockedMessage = responseMessage(blockedPublish);
  const blockedAsExpected =
    !blockedPublish.ok && /负责人复核|复核|确认/.test(blockedMessage);
  addResult(
    blockedAsExpected ? "PASS" : "FAIL",
    "发布准备：复核前被阻断",
    blockedAsExpected
      ? blockedMessage
      : `unexpected status=${blockedPublish.status}; message=${blockedMessage}`,
    blockedAsExpected
      ? ""
      : "中/高风险内容必须在负责人复核前阻断发布准备。",
    blockedPublish,
  );

  const review = await apiJson(
    "POST",
    `/content-optimization/versions/${encodeURIComponent(versionId)}/manual-review`,
    headers,
    { note: "P4 验收：负责人已确认风险表达需要按发布规范处理。" },
  );
  if (!expectOk(review, "发布准备：负责人复核完成")) return;
  const reviewData = unwrapData(review.body);
  addResult(
    reviewData?.manualReview?.reviewed === true ? "PASS" : "FAIL",
    "发布准备：复核记录可追踪",
    reviewData?.manualReview?.reviewed
      ? `reviewedAt=${reviewData.manualReview.reviewedAt}`
      : "复核接口未返回 reviewed=true",
    reviewData?.manualReview?.reviewed
      ? ""
      : "检查复核记录写入和版本详情映射。",
    review,
  );

  const publish = await apiJson("POST", "/content-optimization/publish-intents", headers, {
    versionId,
    platform: "xiaohongshu",
  });
  if (!expectOk(publish, "发布准备：复核后进入发布准备")) return;
  const publishData = unwrapData(publish.body);
  addResult(
    publishData?.id && publishData.status === "ready" ? "PASS" : "FAIL",
    "发布准备：待发布记录已创建",
    publishData?.id
      ? `publish=${publishData.id}; status=${publishData.status}; platform=${publishData.platform}`
      : "发布准备接口未返回记录 ID",
    publishData?.id ? "" : "检查发布准备任务创建结果。",
    publish,
  );
  evidence.artifacts.publishIntentId = publishData?.id;

  const feedback = await apiJson(
    "POST",
    `/content-optimization/versions/${encodeURIComponent(versionId)}/feedback`,
    headers,
    {
      publishIntentId: publishData?.id,
      platform: "xiaohongshu",
      views: 1280,
      likes: 96,
      comments: 18,
      saves: 33,
      leads: 5,
      note: "P4 验收：发布复盘可记录业务结果。",
    },
  );
  if (expectOk(feedback, "发布复盘：业务结果可记录")) {
    const feedbackData = unwrapData(feedback.body);
    addResult(
      feedbackData?.leads === 5 ? "PASS" : "FAIL",
      "发布复盘：线索指标已保存",
      `views=${feedbackData?.views}; leads=${feedbackData?.leads}`,
      feedbackData?.leads === 5 ? "" : "检查发布复盘指标写入。",
      feedback,
    );
  }

  const comment = await apiJson(
    "POST",
    `/content-optimization/versions/${encodeURIComponent(versionId)}/comments`,
    headers,
    { body: "P4 验收：协作备注可保存，便于复盘时追踪负责人判断。" },
  );
  if (expectOk(comment, "协作备注：备注可记录")) {
    const commentData = unwrapData(comment.body);
    const commentSaved = Boolean(commentData?.id && commentData?.body);
    addResult(
      commentSaved ? "PASS" : "FAIL",
      "协作备注：备注内容已返回",
      commentData?.id ? `comment=${commentData.id}` : "备注接口未返回记录 ID",
      commentSaved ? "" : "检查协作备注写入结果。",
      comment,
    );
  }

  const list = await apiJson(
    "GET",
    `/content-optimization/versions?draftId=${encodeURIComponent(draftId)}`,
    headers,
  );
  if (expectOk(list, "创作优化：版本列表可追踪")) {
    const listData = unwrapData(list.body);
    const hasVersion = Array.isArray(listData?.items)
      ? listData.items.some((item) => item?.id === versionId)
      : false;
    addResult(
      hasVersion ? "PASS" : "FAIL",
      "创作优化：版本列表包含本次记录",
      `total=${listData?.total}; found=${hasVersion}`,
      hasVersion ? "" : "检查版本列表筛选或数据隔离条件。",
      list,
    );
  }
}

function runCrmJourney(headers) {
  if (!isLocalApi(apiBase)) {
    addResult(
      "BLOCKED",
      "CRM 导入：写入回滚验收",
      `API ${apiBase} 不是本机地址，已拒绝执行写入验收。`,
      "只在本机测试库执行 --destructive --confirm-local-crm-write。",
    );
    return;
  }
  const crmDir = join(evidenceDir, "crm-phase1");
  const sessionCookie = headers.Cookie || "";
  const env = {
    ...process.env,
    API_BASE: apiBase,
    BASE_URL: frontendBase,
    COOKIE_HEADER: sessionCookie,
    CRM_SMOKE_COOKIE_HEADER: sessionCookie,
  };
  const result = spawnSync(
    process.execPath,
    [
      "scripts/crm-commercial-phase1-smoke.mjs",
      "--api-only",
      "--destructive",
      "--confirm-local-crm-write",
      "--evidence-dir",
      crmDir,
      "--timeout-ms",
      String(timeoutMs),
    ],
    {
      cwd: repoRoot,
      env,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 6,
    },
  );
  evidence.artifacts.crmEvidenceDir = crmDir;
  evidence.artifacts.crmOutput = `${result.stdout || ""}${result.stderr || ""}`.slice(
    0,
    20000,
  );
  addResult(
    result.status === 0 ? "PASS" : "FAIL",
    "CRM 导入：写入后可回滚",
    result.status === 0
      ? `CRM smoke 通过，证据目录：${crmDir}`
      : `CRM smoke 失败，exit=${result.status}; ${lastLines(result.stdout || result.stderr || "", 6)}`,
    result.status === 0 ? "" : "查看 CRM smoke report.md 并修复失败检查。",
  );
}

async function buildAuthHeaders() {
  const headers = {};
  const cookieHeader =
    process.env.COOKIE_HEADER ||
    process.env.P4_COOKIE_HEADER ||
    process.env.CRM_SMOKE_COOKIE_HEADER ||
    "";
  const sessionToken =
    process.env.SESSION_TOKEN ||
    process.env.P4_SESSION_TOKEN ||
    process.env.CRM_SMOKE_SESSION_TOKEN ||
    "";
  const bearer = process.env.TOKEN || process.env.P4_TOKEN || "";

  if (cookieHeader) headers.Cookie = cookieHeader;
  else if (sessionToken) headers.Cookie = `${authCookieName}=${sessionToken}`;
  if (bearer) headers.Authorization = `Bearer ${bearer}`;

  if (!headers.Cookie && !headers.Authorization) {
    localSession = createLocalAcceptanceSession();
    headers.Cookie = `${authCookieName}=${localSession.sessionToken}`;
  }
  return headers;
}

function createLocalAcceptanceSession() {
  loadBackendEnv();
  const databaseUrl = alignLocalAcceptanceDatabase();
  if (!databaseUrl.startsWith("file:")) {
    throw new Error(
      "P4 smoke needs COOKIE_HEADER/TOKEN for non-SQLite databases.",
    );
  }
  const databasePath = sqlitePathFromUrl(databaseUrl);
  if (!databasePath || !existsSync(databasePath)) {
    throw new Error(`SQLite database not found: ${databaseUrl}`);
  }
  const userId = runSqlite(databasePath, [
    "SELECT id FROM users WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1;",
  ]).trim();
  if (!userId) throw new Error("No active user found for P4 local login.");

  const now = new Date();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const sessionToken = randomBytes(32).toString("base64url");
  const sessionId = `p4_business_journey_${randomBytes(12).toString("hex")}`;
  const metadata = {
    source: "p4-business-journey-smoke",
    localOnly: true,
    kaypalDesktopAccessToken: `local-p4-access-${randomBytes(8).toString("hex")}`,
    kaypalDesktopRefreshToken: `local-p4-refresh-${randomBytes(8).toString("hex")}`,
    kaypalDesktopTokenExpiresAt: expiresAt.toISOString(),
    kaypalDesktopDeviceId: `local-p4-device-${randomBytes(4).toString("hex")}`,
    kaypalSubscriptionPlan: "ADVANCED",
    kaypalSubscriptionPeriodEnd: new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    ).toISOString(),
    kaypalRole: "SUPER_ADMIN",
    kaypalPlatformRole: "SUPER_ADMIN",
    kaypalPermissionNames: ["p4_business_journey_smoke"],
    kaypalMetadataSyncedAt: now.toISOString(),
  };
  runSqlite(databasePath, [
    `INSERT INTO user_sessions (id, user_id, token_hash, expires_at, last_used_at, metadata, created_at, updated_at) VALUES (${sqlQuote(
      sessionId,
    )}, ${sqlQuote(userId)}, ${sqlQuote(
      createHash("sha256").update(sessionToken).digest("hex"),
    )}, ${sqlQuote(expiresAt.toISOString())}, ${sqlQuote(
      now.toISOString(),
    )}, ${sqlQuote(JSON.stringify(metadata))}, ${sqlQuote(
      now.toISOString(),
    )}, ${sqlQuote(now.toISOString())});`,
  ]);
  evidence.localAcceptanceSession = true;
  return { sessionId, sessionToken, databaseUrl };
}

function cleanupLocalAcceptanceSession(session) {
  const databasePath = sqlitePathFromUrl(session.databaseUrl);
  if (!databasePath || !existsSync(databasePath)) return;
  runSqlite(databasePath, [
    `DELETE FROM user_sessions WHERE id = ${sqlQuote(session.sessionId)};`,
  ]);
}

async function apiJson(method, path, headers, body) {
  const controller = new AbortController();
  const startedAt = Date.now();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${apiBase}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      latencyMs: Date.now() - startedAt,
      body: parseJson(text),
      bodyPreview: text.slice(0, 800),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      latencyMs: Date.now() - startedAt,
      error:
        error?.name === "AbortError"
          ? `timeout after ${timeoutMs}ms`
          : error?.message || String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

function expectOk(response, name) {
  if (response.ok) {
    addResult(
      "PASS",
      name,
      `HTTP ${response.status}; ${response.latencyMs}ms`,
      "",
      response,
    );
    return true;
  }
  addResult(
    response.status === 401 || response.status === 403 || response.status === 0
      ? "BLOCKED"
      : "FAIL",
    name,
    `HTTP ${response.status}; ${response.error || responseMessage(response)}`,
    response.status === 401 || response.status === 403
      ? "提供有效登录态，或使用本机 SQLite 验收登录。"
      : "查看后端日志和接口响应。",
    response,
  );
  return false;
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

function writeEvidenceFiles() {
  mkdirSync(evidenceDir, { recursive: true });
  const statusCounts = countStatuses(results);
  const report = {
    ...evidence,
    evidenceDir,
    statusCounts,
    pass: !statusCounts.FAIL && !statusCounts.BLOCKED,
  };
  writeFileSync(
    join(evidenceDir, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(join(evidenceDir, "report.md"), renderMarkdown(report), "utf8");
  writeFileSync(
    join(evidenceDir, "00-env.json"),
    `${JSON.stringify(
      {
        generatedAt: report.generatedAt,
        cwd: process.cwd(),
        node: process.version,
        apiBase,
        frontendBase,
        localAcceptanceSession: Boolean(localSession),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function printSummary() {
  const counts = countStatuses(results);
  console.log("P4 business journey smoke summary");
  console.log(
    `PASS=${counts.PASS || 0} FAIL=${counts.FAIL || 0} BLOCKED=${
      counts.BLOCKED || 0
    }`,
  );
  for (const item of results) {
    const next = item.nextStep ? ` | next: ${item.nextStep}` : "";
    console.log(`[${item.status}] ${item.name}: ${item.details}${next}`);
  }
  console.log(`Evidence: ${evidenceDir}`);
}

function renderMarkdown(report) {
  const counts = report.statusCounts || {};
  const lines = [
    "# P4 Business Journey Smoke Evidence",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- API: ${report.apiBase}`,
    `- Frontend: ${report.frontendBase}`,
    `- Result: ${report.pass ? "PASS" : "FAIL"}`,
    `- Counts: PASS=${counts.PASS || 0} FAIL=${counts.FAIL || 0} BLOCKED=${
      counts.BLOCKED || 0
    }`,
    "",
    "## Artifacts",
    "",
  ];
  for (const [key, value] of Object.entries(report.artifacts || {})) {
    if (key === "crmOutput") continue;
    lines.push(`- ${key}: ${value ?? ""}`);
  }
  lines.push("", "## Checks", "");
  lines.push("| Status | Check | Details | Next step |");
  lines.push("| --- | --- | --- | --- |");
  for (const item of report.checks || []) {
    lines.push(
      `| ${escapeMarkdownTable(item.status)} | ${escapeMarkdownTable(
        item.name,
      )} | ${escapeMarkdownTable(item.details)} | ${escapeMarkdownTable(
        item.nextStep || "",
      )} |`,
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const parsed = {
    help: false,
    skipCrm: false,
    apiBase: "",
    frontendBase: "",
    evidenceDir: "",
    timeoutMs: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--skip-crm") parsed.skipCrm = true;
    else if (arg === "--api-base") parsed.apiBase = argv[++index] || "";
    else if (arg === "--frontend-base" || arg === "--base-url") {
      parsed.frontendBase = argv[++index] || "";
    } else if (arg === "--evidence-dir") parsed.evidenceDir = argv[++index] || "";
    else if (arg === "--timeout-ms") parsed.timeoutMs = argv[++index] || "";
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage:
  node scripts/p4-business-journey-smoke.mjs
  node scripts/p4-business-journey-smoke.mjs --skip-crm
  COOKIE_HEADER='ai_content_session=...' node scripts/p4-business-journey-smoke.mjs

Options:
  --skip-crm            Only run content optimization journey.
  --api-base URL        Backend API base. Default: http://127.0.0.1:3011/api.
  --frontend-base URL   Frontend base. Default: http://127.0.0.1:3010.
  --evidence-dir DIR    Evidence output directory.
  --timeout-ms N        Per request timeout. Default: 15000.
`);
}

function loadBackendEnv() {
  const envPath = join(repoRoot, "backend", ".env");
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [key, ...rest] = line.split("=");
    if (!key || process.env[key]) continue;
    process.env[key] = rest.join("=").trim().replace(/^['"]|['"]$/g, "");
  }
}

function alignLocalAcceptanceDatabase() {
  const explicitDatabaseUrl = process.env.P4_DATABASE_URL?.trim();
  const localIntegrationDatabasePath = readLocalIntegrationEnv(
    "COMMERCIAL_DATABASE_PATH",
  );
  const localIntegrationDatabaseUrl = localIntegrationDatabasePath
    ? `file:${localIntegrationDatabasePath}`
    : "";
  const fallbackSqlitePaths = [
    localIntegrationDatabasePath,
    join(repoRoot, "backend", "prisma", "ai-content-dev.db"),
    join(
      repoRoot,
      "backend",
      "prisma",
      "data",
      "sqlite-runtime",
      "kaypal-ai.sqlite",
    ),
  ];
  const databaseUrl =
    explicitDatabaseUrl ||
    localIntegrationDatabaseUrl ||
    (fallbackSqlitePaths
      .filter(Boolean)
      .filter((candidate) => existsSync(candidate))
      .map((candidate) => `file:${candidate}`)[0] || "");
  if (!databaseUrl) return process.env.DATABASE_URL || "";
  process.env.DATABASE_URL = databaseUrl;
  process.env.SQLITE_DATABASE_URL = databaseUrl;
  process.env.KAYPAL_DESKTOP_DATABASE_MODE = "sqlite";
  return databaseUrl;
}

function readLocalIntegrationEnv(key) {
  const envPath = join(repoRoot, ".local-logs", "local-integration.env");
  if (!existsSync(envPath)) return "";
  const line = readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim() : "";
}

function sqlitePathFromUrl(databaseUrl) {
  const value = String(databaseUrl || "").replace(/^file:/, "");
  return value.startsWith("/") ? value : join(repoRoot, "backend", value);
}

function runSqlite(databasePath, statements) {
  const result = spawnSync("sqlite3", [databasePath, statements.join("\n")], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `sqlite3 failed with exit ${result.status}`);
  }
  return result.stdout || "";
}

function sqlQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function unwrapData(body) {
  if (body && typeof body === "object" && "success" in body && "data" in body) {
    return body.data;
  }
  return body;
}

function responseMessage(response) {
  const body = response?.body;
  if (!body) return response?.bodyPreview || response?.error || "";
  if (typeof body?.message === "string") return body.message;
  if (Array.isArray(body?.message)) return body.message.join("; ");
  if (typeof body?.error === "string") return body.error;
  if (body?.data?.message) return String(body.data.message);
  return response?.bodyPreview || JSON.stringify(body).slice(0, 500);
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
  const raw = JSON.stringify(response, null, 2)
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/g, "$1[REDACTED]")
    .replace(/(ai_content_session=)[^;\"\\s]+/g, "$1[REDACTED]")
    .replace(/(\"authorization\"\\s*:\\s*\")[^\"]+(\")/gi, "$1[REDACTED]$2")
    .replace(/(\"cookie\"\\s*:\\s*\")[^\"]+(\")/gi, "$1[REDACTED]$2");
  return parseJson(raw) || { status: response.status, ok: response.ok };
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

function timestampForFile() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function escapeMarkdownTable(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

function isLocalApi(value) {
  try {
    const url = new URL(value);
    return ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function lastLines(text, count) {
  return String(text || "")
    .trim()
    .split(/\r?\n/)
    .slice(-count)
    .join(" / ");
}
