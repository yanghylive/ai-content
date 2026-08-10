#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const backendRoot = join(repoRoot, "backend");
const skillhubRoot = join(repoRoot, "skillhub-skills");
const apiBase = (process.env.API_BASE || "http://127.0.0.1:3011/api").replace(
  /\/+$/,
  "",
);
const authCookieName = process.env.AUTH_COOKIE_NAME || "ai_content_session";
const username = process.env.SMOKE_USERNAME || "";
const password = process.env.SMOKE_PASSWORD || "";
const useLocalSession =
  process.env.SMOKE_USE_LOCAL_SESSION === "1" ||
  process.env.SMOKE_USE_LOCAL_SESSION === "true";
const databaseUrl = resolveDatabaseUrl();
const liveRedfox =
  process.env.FULL_REDFOX_LIVE === "1" ||
  process.env.FULL_REDFOX_LIVE === "true";
const liveSkillHub =
  process.env.FULL_SKILLHUB_LIVE === "1" ||
  process.env.FULL_SKILLHUB_LIVE === "true";
const allowHighCost =
  process.env.FULL_REDFOX_ALLOW_HIGH_COST === "1" ||
  process.env.FULL_REDFOX_ALLOW_HIGH_COST === "true";
const keyword = process.env.FULL_REDFOX_KEYWORD || "咖啡";
const maxApiCalls = Number.parseInt(
  process.env.FULL_REDFOX_MAX_API_CALLS || "60",
  10,
);
const onlyApiCodes = new Set(
  (process.env.FULL_REDFOX_ONLY_CODES || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
);
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const evidenceDir = join(
  repoRoot,
  "docs",
  "acceptance-evidence-2026-07-03",
  `solutions-full-coverage-${timestamp}`,
);
const externalInputs = parseJsonEnv("FULL_REDFOX_SAMPLE_INPUTS_JSON", "{}");
const defaultSamples = {
  bilibiliBvid: process.env.FULL_REDFOX_BILIBILI_BVID || "BV1ghJg6hEWV",
  bilibiliMid: process.env.FULL_REDFOX_BILIBILI_MID || "2",
};

process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: "commonjs",
  moduleResolution: "node",
});
require(join(backendRoot, "node_modules", "ts-node/register/transpile-only"));

const { REDFOX_SKILL_MAPPINGS } = require(join(
  backendRoot,
  "src/modules/redfox/redfox-skill-mapping.catalog.ts",
));
const { SOLUTION_PACKAGES } = require(join(
  backendRoot,
  "src/modules/solutions/solutions.catalog.ts",
));

let cookie = "";
let cleanupLocalSession = async () => {};
let liveApiCallCount = 0;

function setCookieFrom(response) {
  const values =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter(Boolean);
  const pairs = values
    .map((item) => String(item).split(";")[0])
    .filter(Boolean);
  if (pairs.length) {
    cookie = pairs.join("; ");
  }
}

function setAuthCookie(token) {
  cookie = `${authCookieName}=${encodeURIComponent(token)}`;
}

async function request(method, path, body) {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  setCookieFrom(response);
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    const error = new Error(
      `${method} ${path} failed with HTTP ${response.status}: ${text.slice(
        0,
        800,
      )}`,
    );
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  if (payload && typeof payload === "object" && "data" in payload) {
    return payload.data;
  }
  return payload;
}

async function requestRaw(method, path, body) {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  setCookieFrom(response);
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  return { status: response.status, text, payload };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function ensureAuthenticated() {
  if (username && password) {
    const login = await request("POST", "/auth/login", { username, password });
    assert(login?.user?.id, "login did not return user");
    return {
      mode: "password",
      userId: login.user.id,
      username: login.user.username || login.user.email || login.user.id,
    };
  }

  if (useLocalSession) {
    const session = await createLocalSmokeSession();
    setAuthCookie(session.token);
    cleanupLocalSession = session.cleanup;
    return {
      mode: "local-session",
      userId: session.user.id,
      username:
        session.user.username || session.user.email || session.user.id || "",
    };
  }

  throw new Error(
    "需要 SMOKE_USERNAME/SMOKE_PASSWORD 或 SMOKE_USE_LOCAL_SESSION=true",
  );
}

async function createLocalSmokeSession() {
  if (databaseUrl.startsWith("file:")) {
    return createSqliteSmokeSession(databaseUrl);
  }
  if (databaseUrl.startsWith("postgres")) {
    return createPostgresSmokeSession(databaseUrl);
  }
  throw new Error(`Unsupported database URL: ${databaseUrl}`);
}

function createSqliteSmokeSession(url) {
  const databasePath = sqliteFileUrlToPath(url);
  if (!databasePath || !existsSync(databasePath)) {
    throw new Error(`SQLite database does not exist: ${databasePath || url}`);
  }

  const users = sqliteJson(
    databasePath,
    `
      select id, username, email
      from users
      where status = 'active'
      order by updated_at desc
      limit 1;
    `,
  );
  const user = users[0];
  assert(user?.id, "No active local user found for full coverage smoke");

  const session = buildLocalSession(user);
  sqliteExec(
    databasePath,
    `
      insert into user_sessions (
        id,
        user_id,
        token_hash,
        expires_at,
        last_used_at,
        metadata,
        created_at,
        updated_at
      ) values (
        ${sqlQuote(session.id)},
        ${sqlQuote(user.id)},
        ${sqlQuote(session.tokenHash)},
        ${sqlQuote(session.expiresAt)},
        ${sqlQuote(session.now)},
        ${sqlQuote(JSON.stringify(session.metadata))},
        ${sqlQuote(session.now)},
        ${sqlQuote(session.now)}
      );
    `,
  );

  return {
    ...session,
    cleanup: async () => {
      sqliteExec(
        databasePath,
        `delete from user_sessions where id = ${sqlQuote(session.id)};`,
      );
    },
  };
}

async function createPostgresSmokeSession(url) {
  const { Client } = require(join(backendRoot, "node_modules", "pg"));
  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: 3000,
  });
  await client.connect();
  try {
    const users = await client.query(`
      select id, username, email
      from users
      where status = 'active'
      order by updated_at desc
      limit 1;
    `);
    const user = users.rows[0];
    assert(user?.id, "No active local user found for full coverage smoke");
    const session = buildLocalSession(user);
    await client.query(
      `
        insert into user_sessions (
          id,
          user_id,
          token_hash,
          expires_at,
          last_used_at,
          metadata,
          created_at,
          updated_at
        ) values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8);
      `,
      [
        session.id,
        user.id,
        session.tokenHash,
        session.expiresAt,
        session.now,
        JSON.stringify(session.metadata),
        session.now,
        session.now,
      ],
    );
    return {
      ...session,
      cleanup: async () => {
        const cleanupClient = new Client({
          connectionString: url,
          connectionTimeoutMillis: 3000,
        });
        await cleanupClient.connect();
        try {
          await cleanupClient.query("delete from user_sessions where id = $1", [
            session.id,
          ]);
        } finally {
          await cleanupClient.end();
        }
      },
    };
  } finally {
    await client.end();
  }
}

function buildLocalSession(user) {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const token = randomBytes(32).toString("base64url");
  return {
    id: `solutions_full_${randomBytes(12).toString("hex")}`,
    token,
    tokenHash: createHash("sha256").update(token).digest("hex"),
    now,
    expiresAt,
    user,
    metadata: {
      source: "solutions-full-coverage-smoke",
      localOnly: true,
      kaypalDesktopAccessToken: `local-full-access-${randomBytes(8).toString(
        "hex",
      )}`,
      kaypalDesktopRefreshToken: `local-full-refresh-${randomBytes(8).toString(
        "hex",
      )}`,
      kaypalDesktopTokenExpiresAt: expiresAt,
      kaypalDesktopDeviceId: `local-full-device-${randomBytes(4).toString(
        "hex",
      )}`,
      kaypalSubscriptionPlan: "ADVANCED",
      kaypalSubscriptionPeriodEnd: new Date(
        Date.now() + 30 * 24 * 60 * 60 * 1000,
      ).toISOString(),
      kaypalRole: "SUPER_ADMIN",
      kaypalPlatformRole: "SUPER_ADMIN",
      kaypalPermissionNames: ["solutions_full_coverage_smoke"],
      kaypalMetadataSyncedAt: now,
    },
  };
}

function resolveDatabaseUrl() {
  const defaultSqliteCandidates = [
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
  const defaultSqliteUrl = `file:${
    defaultSqliteCandidates.find((candidate) => existsSync(candidate)) ||
    defaultSqliteCandidates[0]
  }`;
  if (process.env.SMOKE_DATABASE_URL) return process.env.SMOKE_DATABASE_URL;
  if (process.env.KAYPAL_DESKTOP_DATABASE_MODE === "sqlite") {
    return process.env.SQLITE_DATABASE_URL || defaultSqliteUrl;
  }
  if (process.env.SQLITE_DATABASE_URL) return process.env.SQLITE_DATABASE_URL;
  return (
    process.env.DATABASE_URL ||
    "postgresql://postgres:postgres@127.0.0.1:5432/ai_content?connect_timeout=5&pool_timeout=30&connection_limit=30"
  );
}

function sqliteFileUrlToPath(value) {
  const text = String(value || "").trim();
  if (!text.startsWith("file:")) return "";
  try {
    const url = new URL(text);
    if (url.protocol === "file:" && url.pathname) {
      return decodeURIComponent(url.pathname);
    }
  } catch {
    // Prisma also accepts file:./relative/path.
  }
  const rawPath = text.replace(/^file:/, "");
  if (!rawPath) return "";
  return rawPath.startsWith("/") ? rawPath : join(repoRoot, rawPath);
}

function sqliteJson(databasePath, sql) {
  const output = sqliteRun(databasePath, sql, ["-json"]).trim();
  return output ? JSON.parse(output) : [];
}

function sqliteExec(databasePath, sql) {
  sqliteRun(databasePath, sql);
}

function sqliteRun(databasePath, sql, extraArgs = []) {
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return execFileSync(
        "sqlite3",
        [...extraArgs, "-cmd", ".timeout 10000", databasePath, sql],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
    } catch (error) {
      lastError = error;
      const stderr = String(error?.stderr || error?.message || "");
      if (!/database is locked|SQLITE_BUSY/i.test(stderr)) {
        throw error;
      }
      execFileSync("sleep", [String(attempt + 1)], {
        stdio: ["ignore", "ignore", "ignore"],
      });
    }
  }
  throw lastError;
}

function sqlQuote(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

function parseJsonEnv(name, fallback) {
  const raw = process.env[name] || fallback;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("must be a JSON object");
    }
    return parsed;
  } catch (error) {
    throw new Error(
      `${name} must be a JSON object: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function buildCoverageFromCatalog() {
  const packageSkillRefs = SOLUTION_PACKAGES.flatMap((solutionPackage) =>
    solutionPackage.redfoxSkills.map((skillName) => {
      const mappings = REDFOX_SKILL_MAPPINGS.filter((mapping) =>
        [
          mapping.code,
          mapping.skillCode,
          mapping.skillName,
          ...mapping.aliases,
        ]
          .map(normalizeKey)
          .includes(normalizeKey(skillName)),
      );
      return {
        packageCode: solutionPackage.code,
        packageName: solutionPackage.name,
        skillName,
        mappings,
      };
    }),
  );
  const apiRefs = packageSkillRefs.filter((item) =>
    item.mappings.some((mapping) => Boolean(mapping.path?.trim())),
  );
  const skillHubRefs = packageSkillRefs.filter((item) =>
    item.mappings.some((mapping) => (mapping.skillHubRefs || []).length > 0),
  );
  const unmapped = packageSkillRefs.filter((item) => item.mappings.length === 0);
  const contractOnly = packageSkillRefs.filter(
    (item) =>
      item.mappings.length > 0 &&
      item.mappings.every(
        (mapping) =>
          !mapping.path?.trim() && !(mapping.skillHubRefs || []).length,
      ),
  );

  return {
    packageCount: SOLUTION_PACKAGES.length,
    packageSkillRefCount: packageSkillRefs.length,
    apiRefCount: apiRefs.length,
    skillHubRefCount: skillHubRefs.length,
    uniqueSkillCount: new Set(packageSkillRefs.map((item) => item.skillName))
      .size,
    uniqueApiMappingCount: REDFOX_SKILL_MAPPINGS.filter((item) =>
      Boolean(item.path?.trim()),
    ).length,
    uniqueSkillHubRefCount: new Set(
      REDFOX_SKILL_MAPPINGS.flatMap((item) =>
        (item.skillHubRefs || []).map((ref) => ref.skillCode),
      ),
    ).size,
    mappingCatalogSize: REDFOX_SKILL_MAPPINGS.length,
    unmapped: unmapped.map((item) => ({
      packageCode: item.packageCode,
      skillName: item.skillName,
    })),
    contractOnly: contractOnly.map((item) => ({
      packageCode: item.packageCode,
      skillName: item.skillName,
      mappings: item.mappings.map((mapping) => mapping.code),
    })),
    packageSkillRefs: packageSkillRefs.map((item) => ({
      packageCode: item.packageCode,
      packageName: item.packageName,
      skillName: item.skillName,
      mappingCodes: item.mappings.map((mapping) => mapping.code),
      apiMappings: item.mappings
        .filter((mapping) => Boolean(mapping.path?.trim()))
        .map((mapping) => mapping.code),
      skillHubRefs: item.mappings.flatMap((mapping) =>
        (mapping.skillHubRefs || []).map((ref) => ({
          mappingCode: mapping.code,
          skillCode: ref.skillCode,
          skillName: ref.skillName,
          skillNo: ref.skillNo,
        })),
      ),
    })),
  };
}

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

async function verifyBackendCatalog() {
  const apiCoverage = await request("GET", "/solutions/redfox-mapping-coverage");
  return {
    status:
      apiCoverage?.totalPackageSkillRefs === 64 &&
      apiCoverage?.verifiedApiPathRefs === 43 &&
      apiCoverage?.verifiedSkillHubRefs === 21 &&
      apiCoverage?.unmappedPackageSkillRefs === 0 &&
      apiCoverage?.contractOnlyRefs === 0
        ? "passed"
        : "failed",
    apiCoverage,
  };
}

async function verifyFrontendGuard() {
  const pagePath = join(
    repoRoot,
    "frontend/src/app/(dashboard)/solutions/page.tsx",
  );
  const source = readFileSync(pagePath, "utf8");
  const checks = [
    {
      name: "admin diagnostics hidden",
      passed: /const\s+showAdminDiagnostics\s*=\s*false/.test(source),
      detail: "普通用户页不展示 runner/API/SkillHub 诊断块",
    },
    {
      name: "no visible trial copy",
      passed: !/试跑|dry run|dry-run|确认口令/.test(source),
      detail: "普通用户动作不能再叫试跑或确认口令",
    },
    {
      name: "direct business action copy",
      passed:
        /生成热点选题|分析竞品|提取线索|生成内容|检查风险/.test(source),
      detail: "入口动词是业务动作，不是工程动作",
    },
  ];
  return {
    status: checks.every((item) => item.passed) ? "passed" : "failed",
    checks,
  };
}

async function verifySkillHubMatrix() {
  const refs = uniqueBy(
    REDFOX_SKILL_MAPPINGS.flatMap((mapping) =>
      (mapping.skillHubRefs || []).map((ref) => ({
        mappingCode: mapping.code,
        mappingScenario: mapping.scenario,
        outputObjects: mapping.outputObjects,
        ...ref,
      })),
    ),
    (item) => item.skillCode,
  );
  const installedDirs = existsSync(skillhubRoot)
    ? new Set(
        readdirSync(skillhubRoot, { withFileTypes: true })
          .filter((item) => item.isDirectory())
          .map((item) => item.name),
      )
    : new Set();

  const items = [];
  for (const ref of refs) {
    const skillPath = join(skillhubRoot, ref.skillCode, "SKILL.md");
    const localReady = installedDirs.has(ref.skillCode) && existsSync(skillPath);
    let liveResult = null;
    let status = localReady ? "ready_local_skill" : "missing_local_skill";
    if (liveSkillHub && localReady) {
      liveResult = await runOneSkillHubRef(ref);
      status = liveResult.status === "success" ? "live_success" : "live_blocked";
    }
    items.push({
      skillCode: ref.skillCode,
      skillName: ref.skillName,
      skillNo: ref.skillNo,
      mappingCode: ref.mappingCode,
      repoUrl: ref.repoUrl,
      requiresApiKey: ref.requiresApiKey,
      localPath: localReady ? skillPath : null,
      status,
      liveResult,
    });
  }

  return {
    status: items.every((item) =>
      ["ready_local_skill", "live_success"].includes(item.status),
    )
      ? "passed"
      : "partial",
    total: items.length,
    readyLocal: items.filter((item) => item.status === "ready_local_skill")
      .length,
    liveSuccess: items.filter((item) => item.status === "live_success").length,
    blocked: items.filter((item) => item.status.endsWith("blocked")).length,
    missing: items.filter((item) => item.status === "missing_local_skill")
      .length,
    items,
  };
}

async function runOneSkillHubRef(ref) {
  const input = buildSkillHubInput(ref);
  const result = await requestRaw("POST", "/redfox/skills/run", {
    skillCode: ref.skillCode,
    dryRun: false,
    input,
    body: input,
    estimatedCostPoints: 1,
    operation: `solutions.full_coverage.skillhub.${ref.skillCode}`,
  });
  const payload = result.payload?.data || result.payload;
  const redfoxStatus = payload?.status || null;
  const success = result.status >= 200 && result.status < 300 && redfoxStatus === "success";
  return {
    status: success ? "success" : "failed",
    httpStatus: result.status,
    redfoxStatus,
    warnings: Array.isArray(payload?.warnings) ? payload.warnings : [],
    payloadSummary: payload?.payloadSummary || null,
    summary: summarizeResponse(payload),
    message: success ? null : result.text,
  };
}

function buildSkillHubInput(ref) {
  const base = buildGenericInputForMapping({
    inputContract: {
      requiredAny: ["keyword", "text", "topic"],
      optional: ["platforms", "limit"],
    },
  });
  if (ref.skillCode === "pdf-image-text-extractor") {
    return {
      ...base,
      filePath: ensureSamplePdf(),
    };
  }
  if (ref.skillCode === "video-prompt-expert") {
    return {
      ...base,
      prompt: "咖啡新品 5 秒产品展示视频，干净自然光，镜头慢推",
      recordOnly: true,
    };
  }
  return base;
}

function ensureSamplePdf() {
  const filePath = join(evidenceDir, "skillhub-sample.pdf");
  if (existsSync(filePath)) return filePath;
  const pdf = [
    "%PDF-1.4",
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj",
    "4 0 obj << /Length 72 >> stream",
    "BT /F1 18 Tf 36 96 Td (Kaypal RedFox SkillHub OCR sample) Tj 0 -28 Td (Coffee plan) Tj ET",
    "endstream endobj",
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
    "xref",
    "0 6",
    "0000000000 65535 f ",
    "0000000009 00000 n ",
    "0000000058 00000 n ",
    "0000000115 00000 n ",
    "0000000241 00000 n ",
    "0000000364 00000 n ",
    "trailer << /Root 1 0 R /Size 6 >>",
    "startxref",
    "434",
    "%%EOF",
  ].join("\n");
  writeFileSync(filePath, pdf);
  return filePath;
}

async function verifyApiMatrix() {
  const apiMappings = REDFOX_SKILL_MAPPINGS.filter(
    (mapping) =>
      Boolean(mapping.path?.trim()) &&
      (!onlyApiCodes.size || onlyApiCodes.has(mapping.code)),
  );
  const connection = await request("GET", "/redfox/connection").catch(
    (error) => ({
      configured: false,
      error: error.message,
    }),
  );
  const sampleState = {
    values: {
      bilibiliWorkUrl: `https://www.bilibili.com/video/${defaultSamples.bilibiliBvid}/`,
      bvId: defaultSamples.bilibiliBvid,
      bvid: defaultSamples.bilibiliBvid,
      bilibiliAccountId: defaultSamples.bilibiliMid,
      mid: defaultSamples.bilibiliMid,
      xhsAccountId: "6712113999",
      xhsUserId: "6357c096000000001802aa80",
      gzhAccountId: "rmrbwx",
      gzhAccountName: "人民日报",
    },
    responses: {},
    taskIds: {},
  };
  const items = [];

  for (const mapping of orderApiMappings(apiMappings)) {
    const plannedInput = buildInputForApiMapping(mapping, sampleState);
    const highCost = Number(mapping.estimatedCostPoints || 0) > 5;
    const canLive =
      liveRedfox &&
      connection?.configured &&
      liveApiCallCount < maxApiCalls &&
      plannedInput.status === "ready" &&
      (!highCost || allowHighCost);

    if (!liveRedfox) {
      items.push({
        code: mapping.code,
        skillCode: mapping.skillCode,
        skillName: mapping.skillName,
        path: mapping.path,
        estimatedCostPoints: mapping.estimatedCostPoints,
        status: "planned_not_called",
        reason: "FULL_REDFOX_LIVE 未开启",
        input: plannedInput.input,
      });
      continue;
    }

    if (!connection?.configured) {
      items.push({
        code: mapping.code,
        skillCode: mapping.skillCode,
        skillName: mapping.skillName,
        path: mapping.path,
        estimatedCostPoints: mapping.estimatedCostPoints,
        status: "blocked_no_connection",
        reason: "RedFox connection 未配置",
        input: plannedInput.input,
      });
      continue;
    }

    if (plannedInput.status !== "ready") {
      const recoveredInput = recoverInputAfterUpstreamWait(
        mapping,
        sampleState,
        plannedInput,
      );
      if (recoveredInput.status === "ready") {
        const result = await runReadyApiMapping(mapping, recoveredInput, items);
        captureSamples(mapping, result, sampleState);
        continue;
      }
      items.push({
        code: mapping.code,
        skillCode: mapping.skillCode,
        skillName: mapping.skillName,
        path: mapping.path,
        estimatedCostPoints: mapping.estimatedCostPoints,
        status: "blocked_missing_sample_input",
        reason: plannedInput.reason,
        input: plannedInput.input,
      });
      continue;
    }

    if (highCost && !allowHighCost) {
      items.push({
        code: mapping.code,
        skillCode: mapping.skillCode,
        skillName: mapping.skillName,
        path: mapping.path,
        estimatedCostPoints: mapping.estimatedCostPoints,
        status: "skipped_high_cost",
        reason: "高成本生成/详情接口默认不外呼；设置 FULL_REDFOX_ALLOW_HIGH_COST=true 可跑",
        input: plannedInput.input,
      });
      continue;
    }

    if (!canLive) {
      items.push({
        code: mapping.code,
        skillCode: mapping.skillCode,
        skillName: mapping.skillName,
        path: mapping.path,
        estimatedCostPoints: mapping.estimatedCostPoints,
        status: "skipped_call_limit",
        reason: `超过 FULL_REDFOX_MAX_API_CALLS=${maxApiCalls}`,
        input: plannedInput.input,
      });
      continue;
    }

    const result = await runReadyApiMapping(mapping, plannedInput, items);
    captureSamples(mapping, result, sampleState);
  }

  const counts = countBy(items, (item) => item.status);
  return {
    status:
      (counts.live_success || 0) > 0 &&
      (counts.live_failed || 0) === 0 &&
      (counts.blocked_no_connection || 0) === 0
        ? "passed_with_classification"
        : "partial",
    total: items.length,
    liveCalls: liveApiCallCount,
    counts,
    connection: {
      configured: Boolean(connection?.configured),
      enabled: Boolean(connection?.enabled),
      baseUrl: connection?.baseUrl || null,
      timeoutMs: connection?.timeoutMs || null,
    },
    items,
  };
}

async function runReadyApiMapping(mapping, plannedInput, items) {
  liveApiCallCount += 1;
  logProgress(`calling ${mapping.code}`);
  const result = await runOneApiMapping(mapping, plannedInput.input);
  logProgress(`finished ${mapping.code}: ${result.status}`);
  items.push({
    code: mapping.code,
    skillCode: mapping.skillCode,
    skillName: mapping.skillName,
    path: mapping.path,
    estimatedCostPoints: mapping.estimatedCostPoints,
    status: result.status,
    reason: result.reason,
    input: plannedInput.input,
    httpStatus: result.httpStatus,
    callLogId: result.callLogId,
    payloadSummary: result.payloadSummary,
    payloadSample: result.payloadSample,
    extracted: result.extracted,
  });
  return result;
}

async function runOneApiMapping(mapping, input) {
  let result;
  try {
    result = await requestRaw("POST", "/redfox/skills/run", {
      skillCode: mapping.code,
      dryRun: false,
      input,
      body: input,
      estimatedCostPoints: mapping.estimatedCostPoints,
      operation: `solutions.full_coverage.redfox.${mapping.code}`,
    });
  } catch (error) {
    return {
      status: "live_failed",
      httpStatus: null,
      reason: `transport failed while calling ${mapping.code}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      callLogId: null,
      payloadSummary: null,
      payloadSample: null,
      extracted: {},
    };
  }
  const payload = result.payload?.data || result.payload;
  if (result.status >= 200 && result.status < 300) {
    const redfoxFailure = redfoxBusinessFailure(payload);
    if (redfoxFailure) {
      return {
        status: "live_failed",
        httpStatus: result.status,
        reason: redfoxFailure,
        callLogId: payload?.callLogId || null,
        payloadSummary: payload?.payloadSummary || summarizeResponse(payload),
        payloadSample: payload?.payloadSample || null,
        extracted: extractUsefulValues(payload?.payloadSample || payload),
      };
    }
    return {
      status: "live_success",
      httpStatus: result.status,
      reason: null,
      callLogId: payload?.callLogId || null,
      payloadSummary: payload?.payloadSummary || summarizeResponse(payload),
      payloadSample: payload?.payloadSample || null,
      extracted: extractUsefulValues(payload?.payloadSample || payload),
    };
  }
  return {
    status: "live_failed",
    httpStatus: result.status,
    reason: result.text.slice(0, 800),
    callLogId: payload?.callLogId || null,
    payloadSummary: summarizeResponse(payload),
    payloadSample: payload,
    extracted: extractUsefulValues(payload),
  };
}

function redfoxBusinessFailure(payload) {
  const sample = payload?.payloadSample || payload;
  if (!sample || typeof sample !== "object" || Array.isArray(sample)) {
    return "";
  }
  const code = sample.code;
  if (code === undefined || code === null || String(code) === "2000") {
    return "";
  }
  return (
    sample.msg ||
    sample.message ||
    sample.error ||
    sample.errorMessage ||
    `RedFox 返回非成功业务码 ${code}`
  );
}

function logProgress(message) {
  if (
    process.env.FULL_REDFOX_PROGRESS === "1" ||
    process.env.FULL_REDFOX_PROGRESS === "true"
  ) {
    console.error(`[progress] ${new Date().toISOString()} ${message}`);
  }
}

function orderApiMappings(mappings) {
  const priority = [
    "douyin-search-article",
    "douyin-search-user",
    "xiaohongshu-search-article",
    "xiaohongshu-search-user",
    "gzh-search-article",
    "gzh-search-user",
    "deepsearch-doubao-submit",
    "tiktok-search-user",
    "douyin-query-work",
    "douyin-query-user",
    "douyin-comment",
    "xiaohongshu-query-account",
    "xiaohongshu-comment",
    "gzh-query-user",
    "media-parse-work",
    "deepsearch-doubao-result",
    "bilibili-work-detail",
    "bilibili-account-detail",
    "bilibili-comment-submit",
    "bilibili-comment-result",
    "gzh-query-article",
    "gpt-image-submit",
    "gpt-image-result",
    "seedream-image-submit",
    "seedream-image-result",
    "seedance-video-submit",
    "seedance-video-result",
  ];
  const rank = new Map(priority.map((code, index) => [code, index]));
  return [...mappings].sort(
    (left, right) =>
      (rank.get(left.code) ?? 999) - (rank.get(right.code) ?? 999) ||
      left.code.localeCompare(right.code),
  );
}

function buildInputForApiMapping(mapping, sampleState) {
  const explicit = externalInputs[mapping.code] || externalInputs[mapping.skillCode];
  if (explicit && typeof explicit === "object" && !Array.isArray(explicit)) {
    return { status: "ready", input: explicit, reason: "external input" };
  }

  if (mapping.inputContract?.required?.includes("taskId")) {
    const taskId =
      sampleState.taskIds[mapping.code] ||
      sampleState.values[`${mapping.code}TaskId`];
    if (!taskId) {
      return {
        status: "blocked",
        input: {},
        reason: "缺上游 submit 返回的 taskId",
      };
    }
    return { status: "ready", input: { taskId }, reason: null };
  }

  switch (mapping.code) {
    case "deepsearch-doubao-submit":
      return {
        status: "ready",
        input: {
          inquiryText: keyword,
          searchText: keyword,
          keyword,
          query: keyword,
          q: keyword,
          limit: 3,
        },
        reason: null,
      };
    case "douyin-query-work":
    case "douyin-comment":
      return inputFromValues(
        ["douyinWorkId", "workId", "douyinWorkUrl"],
        sampleState,
      );
    case "douyin-query-user":
      return inputFromValues(
        ["douyinAccountId", "douyinAccountUrl"],
        sampleState,
      );
    case "xiaohongshu-query-account":
      return inputFromValues(
        ["xhsAccountId", "xhsAccountUrl"],
        sampleState,
      );
    case "xiaohongshu-comment":
      return inputFromValues(["noteId", "xhsWorkUrl"], sampleState);
    case "gzh-query-user":
      return inputFromValues(
        ["gzhAccountId", "gzhAccountName", "accountName", "accountId"],
        sampleState,
      );
    case "gzh-query-article":
      return inputFromValues(["gzhArticleUrl", "url", "articleId"], sampleState);
    case "media-parse-work":
      return inputFromValues(
        ["douyinWorkUrl", "xhsWorkUrl", "gzhArticleUrl"],
        sampleState,
      );
    case "bilibili-work-detail":
      return inputFromValues(["bvId", "bilibiliWorkUrl", "bvid", "opusId"], sampleState);
    case "bilibili-comment-submit":
      return inputFromValues(["bilibiliWorkUrl", "bvid", "opusId"], sampleState);
    case "bilibili-account-detail":
      return inputFromValues(["bilibiliAccountId", "mid"], sampleState);
    case "gpt-image-submit":
      return {
        status: "ready",
        input: {
          prompt: "一张干净的咖啡新品营销封面，文字留白，适合小红书",
          parameters: {
            modelName: "gpt-image-2",
            n: 1,
            size: "1024x1024",
            background: "opaque",
            outputFormat: "png",
            quality: "medium",
          },
        },
        reason: null,
      };
    case "seedream-image-submit":
      return {
        status: "ready",
        input: {
          model: "doubao-seedream-5-0-260128",
          prompt: "一张干净的咖啡新品营销封面，文字留白，适合小红书",
          size: "2048x2048",
          watermark: false,
          responseFormat: "url",
          outputFormat: "jpeg",
          sequentialImageGeneration: "disabled",
          optimizePromptOptions: { mode: "fast" },
        },
        reason: null,
      };
    case "seedance-video-submit":
      return {
        status: "ready",
        input: {
          model: "doubao-seedance-2-0-260128",
          content: [
            {
              type: "text",
              text: "咖啡新品 5 秒产品展示视频，干净自然光，镜头慢推",
            },
          ],
          resolution: "720p",
          ratio: "16:9",
          duration: 5,
          watermark: false,
          generateAudio: false,
        },
        reason: null,
      };
    default:
      return {
        status: "ready",
        input: buildGenericInputForMapping(mapping),
        reason: null,
      };
  }
}

function recoverInputAfterUpstreamWait(mapping, sampleState, plannedInput) {
  if (!mapping.inputContract?.required?.includes("taskId")) {
    return plannedInput;
  }
  const taskId =
    sampleState.taskIds[mapping.code] ||
    sampleState.values[`${mapping.code}TaskId`];
  if (!taskId) return plannedInput;
  return { status: "ready", input: { taskId }, reason: "upstream taskId" };
}

function inputFromValues(keys, sampleState) {
  for (const key of keys) {
    const value = sampleState.values[key];
    if (value) {
      if (key === "douyinAccountUrl") return { status: "ready", input: { accountUrl: value }, reason: null };
      if (key === "xhsAccountUrl") return { status: "ready", input: { accountUrl: value, profileUrl: value }, reason: null };
      if (key === "gzhArticleUrl") return { status: "ready", input: { workUrl: value, url: value }, reason: null };
      if (key === "bilibiliWorkUrl") return { status: "ready", input: { workUrl: value, opusId: sampleState.values.bvid || value, sortType: "1", dataNum: "10", offset: "0" }, reason: null };
      if (key === "bilibiliAccountId") return { status: "ready", input: { mid: value, accountId: value }, reason: null };
      if (key === "xhsAccountId") return { status: "ready", input: { accountId: value, userId: sampleState.values.xhsUserId || value }, reason: null };
      if (key === "gzhAccountId") return { status: "ready", input: { account: value, accountName: sampleState.values.gzhAccountName || value }, reason: null };
      if (key === "bvId") return { status: "ready", input: { bvId: value }, reason: null };
      if (key.toLowerCase().includes("url")) return { status: "ready", input: { workUrl: value, url: value }, reason: null };
      if (key.toLowerCase().includes("accountname")) return { status: "ready", input: { accountName: value, account: value }, reason: null };
      if (key.toLowerCase().includes("bvid")) return { status: "ready", input: { bvid: value }, reason: null };
      if (key.toLowerCase().includes("opus")) return { status: "ready", input: { opusId: value }, reason: null };
      if (key.toLowerCase().includes("note")) return { status: "ready", input: { noteId: value }, reason: null };
      if (key.toLowerCase().includes("mid")) return { status: "ready", input: { mid: value }, reason: null };
      if (key.toLowerCase().includes("work")) return { status: "ready", input: { workId: value, videoId: value }, reason: null };
      if (key.toLowerCase().includes("douyinaccount")) return { status: "ready", input: { accountId: value, secUid: value, userId: value }, reason: null };
      if (key.toLowerCase().includes("xhsaccount")) return { status: "ready", input: { accountId: value, userId: value }, reason: null };
      return { status: "ready", input: { accountId: value, workId: value }, reason: null };
    }
  }
  return {
    status: "blocked",
    input: {},
    reason: `缺可复用样本字段：${keys.join("/")}`,
  };
}

function buildGenericInputForMapping(mapping) {
  const requiredAny = mapping.inputContract?.requiredAny || [];
  const required = mapping.inputContract?.required || [];
  const input = {
    keyword,
    query: keyword,
    q: keyword,
    limit: 3,
    platforms: ["抖音", "小红书", "公众号"],
    industry: "咖啡",
    topic: "咖啡新品内容选题",
    brief: "面向本地咖啡店，生成可直接运营的内容建议。",
    text: "这是一段咖啡新品推广文案，需要检查风险并改写成多平台版本。",
    content: "咖啡新品推广文案",
    account: keyword,
  };
  for (const key of required) {
    if (!input[key]) input[key] = keyword;
  }
  for (const key of requiredAny) {
    if (input[key]) return input;
  }
  const first = requiredAny[0];
  if (first) input[first] = keyword;
  return input;
}

function captureSamples(mapping, result, sampleState) {
  if (result.status !== "live_success") return;
  sampleState.responses[mapping.code] = result.payloadSample;
  const extracted = result.extracted || {};
  const values = sampleState.values;
  for (const [key, value] of Object.entries(extracted)) {
    if (value && !values[key]) values[key] = value;
  }

  if (mapping.code === "douyin-search-article") {
    values.douyinWorkUrl ||= validWorkPageUrl(extracted.workUrl) ? extracted.workUrl : validWorkPageUrl(extracted.url) ? extracted.url : null;
    values.douyinWorkId ||= extracted.workId || extracted.id;
    values.douyinAccountUrl ||= validAccountPageUrl(extracted.accountUrl) ? extracted.accountUrl : validAccountPageUrl(extracted.authorUrl) ? extracted.authorUrl : null;
    values.douyinAccountId ||= extracted.authorId || extracted.userId || extracted.accountId;
  }
  if (mapping.code === "douyin-search-user") {
    values.douyinAccountUrl ||= validAccountPageUrl(extracted.accountUrl) ? extracted.accountUrl : validAccountPageUrl(extracted.url) ? extracted.url : null;
    values.douyinAccountId ||= extracted.userId || extracted.authorId || extracted.accountId || extracted.id;
  }
  if (mapping.code === "xiaohongshu-search-article") {
    values.xhsWorkUrl ||= validWorkPageUrl(extracted.workUrl) ? extracted.workUrl : validWorkPageUrl(extracted.url) ? extracted.url : null;
    values.noteId ||= extractXhsNoteId(values.xhsWorkUrl) || extracted.noteId || extracted.id;
  }
  if (mapping.code === "xiaohongshu-search-user") {
    values.xhsAccountUrl ||= validAccountPageUrl(extracted.accountUrl) ? extracted.accountUrl : validAccountPageUrl(extracted.profileUrl) ? extracted.profileUrl : validAccountPageUrl(extracted.url) ? extracted.url : null;
    values.xhsAccountId ||= extracted.userId || extracted.accountId || extracted.id;
  }
  if (mapping.code === "gzh-search-article") {
    values.gzhArticleUrl ||= extracted.url || extracted.workUrl;
    values.articleId ||= extracted.articleId || extracted.workId || extracted.id;
  }
  if (mapping.code === "gzh-search-user") {
    values.gzhAccountName ||= extracted.accountName || extracted.nickname || extracted.name;
    values.gzhAccountId ||= extracted.accountId || extracted.id;
  }
  if (mapping.code === "deepsearch-doubao-submit") {
    const taskId = firstNonEmpty(extracted.taskId, extracted.task_id, extracted.id);
    if (taskId) {
      sampleState.taskIds["deepsearch-doubao-result"] = taskId;
    }
  }
  if (mapping.code === "bilibili-comment-submit") {
    const taskId = firstNonEmpty(extracted.taskId, extracted.task_id, extracted.id);
    if (taskId) sampleState.taskIds["bilibili-comment-result"] = taskId;
  }
  if (mapping.code === "gpt-image-submit") {
    const taskId = firstNonEmpty(extracted.taskId, extracted.task_id, extracted.id);
    if (taskId) sampleState.taskIds["gpt-image-result"] = taskId;
  }
  if (mapping.code === "seedream-image-submit") {
    const taskId = firstNonEmpty(extracted.taskId, extracted.task_id, extracted.id);
    if (taskId) sampleState.taskIds["seedream-image-result"] = taskId;
  }
  if (mapping.code === "seedance-video-submit") {
    const taskId = firstNonEmpty(extracted.taskId, extracted.task_id, extracted.id);
    if (taskId) sampleState.taskIds["seedance-video-result"] = taskId;
  }
}

function extractUsefulValues(payload) {
  const found = {};
  visit(payload, (key, value) => {
    if (typeof value !== "string" && typeof value !== "number") return;
    const text = String(value);
    const normalizedKey = String(key || "").toLowerCase();
    if (!found.url && /^https?:\/\//.test(text)) found.url = text;
    if (!found.workUrl && validWorkPageUrl(text)) {
      found.workUrl = text;
    }
    if (!found.accountUrl && validAccountPageUrl(text) && /(user|author|profile|account|主页|个人)/i.test(`${normalizedKey} ${text}`)) {
      found.accountUrl = text;
    }
    if (!found.authorUrl && validAccountPageUrl(text) && /author|sec_uid|user/i.test(normalizedKey)) {
      found.authorUrl = text;
    }
    if (!found.taskId && /(taskid|task_id|task|任务|jobid|job_id)/.test(normalizedKey)) found.taskId = text;
    if (!found.task_id && /(task_id|taskid)/.test(normalizedKey)) found.task_id = text;
    if (!found.bvid && /^BV[a-z0-9]+$/i.test(text)) found.bvid = text;
    if (!found.bvid && /bvid/.test(normalizedKey)) found.bvid = text;
    if (!found.mid && /(mid|uid)/.test(normalizedKey) && /^\d+$/.test(text)) found.mid = text;
    if (!found.noteId && /note/.test(normalizedKey)) found.noteId = text;
    if (!found.workId && !/^https?:\/\//.test(text) && /(work|aweme|item|作品|video|bvid)/.test(normalizedKey)) found.workId = text;
    if (!found.accountId && !/^https?:\/\//.test(text) && /(account|user|uid|secuid|mid|author)/.test(normalizedKey)) found.accountId = text;
    if (!found.userId && /(userid|user_id|uid)/.test(normalizedKey)) found.userId = text;
    if (!found.authorId && /(authorid|author_id|secuid|sec_uid)/.test(normalizedKey)) found.authorId = text;
    if (!found.articleId && /(article|文章)/.test(normalizedKey)) found.articleId = text;
    if (!found.accountName && /(accountname|nickname|name|title|名称)/.test(normalizedKey)) found.accountName = text;
    if (!found.id && normalizedKey === "id") found.id = text;
  });
  return found;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function validWorkPageUrl(value) {
  const text = String(value || "");
  if (!/^https?:\/\//.test(text)) return false;
  if (/\.(jpeg|jpg|png|webp|gif|mp3|mp4)(\?|$)/i.test(text)) return false;
  return /(douyin\.com\/video|douyin\.com\/note|xiaohongshu\.com\/explore|bilibili\.com\/video|mp\.weixin\.qq\.com\/s|tiktok\.com\/@.+\/video)/i.test(text);
}

function validAccountPageUrl(value) {
  const text = String(value || "");
  if (!/^https?:\/\//.test(text)) return false;
  if (/\.(jpeg|jpg|png|webp|gif|mp3|mp4)(\?|$)/i.test(text)) return false;
  return /(douyin\.com\/user|xiaohongshu\.com\/user\/profile|bilibili\.com\/space|tiktok\.com\/@|mp\.weixin\.qq\.com\/mp\/profile_ext)/i.test(text);
}

function extractXhsNoteId(value) {
  const match = String(value || "").match(/xiaohongshu\.com\/explore\/([a-z0-9]+)/i);
  return match?.[1] || null;
}

function visit(value, visitor, key = "") {
  visitor(key, value);
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.slice(0, 20).forEach((item, index) => visit(item, visitor, String(index)));
    return;
  }
  Object.entries(value)
    .slice(0, 100)
    .forEach(([entryKey, entryValue]) => visit(entryValue, visitor, entryKey));
}

async function verifySolutionPackages() {
  const items = [];
  for (const solutionPackage of SOLUTION_PACKAGES) {
    const run = await request("POST", `/solutions/${solutionPackage.code}/runs`, {
      input: buildPackageInput(solutionPackage),
      maxCostPoints: Math.max(solutionPackage.redfoxSkills.length + 3, 10),
      dryRun: false,
      source: "solutions-full-coverage-smoke",
    });
    const redfoxTasks = (run.tasks || []).filter(
      (task) => task.executorKind === "redfox",
    );
    const manualTasks = (run.tasks || []).filter(
      (task) => task.executorKind !== "redfox",
    );
    const action = await request(
      "POST",
      `/solutions/runs/${encodeURIComponent(run.id)}/result-actions`,
      {
        kind: "intelligence_report",
        label: `全量验收报告 ${solutionPackage.code}`,
        targetModule: "报告中心",
        description: `全量验收脚本为 ${solutionPackage.name} 创建业务报告对象`,
      },
    );
    const reused = await request(
      "POST",
      `/solutions/runs/${encodeURIComponent(run.id)}/result-actions`,
      {
        kind: "intelligence_report",
        label: `全量验收报告 ${solutionPackage.code}`,
        targetModule: "报告中心",
        description: `全量验收脚本为 ${solutionPackage.name} 创建业务报告对象`,
      },
    );
    items.push({
      code: solutionPackage.code,
      name: solutionPackage.name,
      status: action?.refId && reused?.status === "reused" ? "passed" : "failed",
      runId: run.id,
      runStatus: run.status,
      taskCount: (run.tasks || []).length,
      redfoxTaskCount: redfoxTasks.length,
      manualTaskCount: manualTasks.length,
      outputRefCount: (run.outputRefs || []).length,
      resultAction: {
        status: action?.status,
        refId: action?.refId,
        href: action?.href,
        reusedStatus: reused?.status,
      },
    });
  }
  return {
    status: items.every((item) => item.status === "passed")
      ? "passed"
      : "failed",
    total: items.length,
    passed: items.filter((item) => item.status === "passed").length,
    items,
  };
}

function buildPackageInput(solutionPackage) {
  return {
    businessObjective: `${solutionPackage.name} 全量验收`,
    keyword,
    keywords: [keyword, "本地生活", "新品"],
    platforms: ["抖音", "小红书", "公众号"],
    industry: "咖啡",
    targetAudience: "本地年轻消费者",
    deliveryTarget: "报告中心",
    text: "这是一段咖啡新品推广文案，需要生成多平台内容并检查风险。",
    brief: solutionPackage.summary,
    account: keyword,
    timeRange: "近 7 天",
  };
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function countBy(items, keyFn) {
  return items.reduce((counts, item) => {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function summarizeResponse(value) {
  if (value && typeof value === "object" && "data" in value) {
    return summarizeResponse(value.data);
  }
  if (Array.isArray(value)) {
    return { kind: "array", count: value.length };
  }
  if (!value || typeof value !== "object") {
    return { kind: typeof value };
  }
  const record = value;
  return {
    kind: "object",
    keys: Object.keys(record).slice(0, 20),
    status: record.status || null,
    message: record.message || record.error || null,
  };
}

function makeReport(data) {
  const apiCounts = data.apiMatrix.counts || {};
  const lines = [
    "# 3010 方案能力全量验收报告",
    "",
    `生成时间：${data.generatedAt}`,
    `API Base：${data.env.apiBase}`,
    "",
    "## 总口径",
    "",
    `- 方案包：${data.catalog.packageCount}`,
    `- 方案包功能引用：${data.catalog.packageSkillRefCount}`,
    `- 普通 RedFox API 引用：${data.catalog.apiRefCount}`,
    `- SkillHub/Agent Skill 引用：${data.catalog.skillHubRefCount}`,
    `- 去重 API mapping：${data.catalog.uniqueApiMappingCount}`,
    `- 去重 SkillHub：${data.catalog.uniqueSkillHubRefCount}`,
    "",
    "## 后端接入总表",
    "",
    `- 状态：${data.backendCoverage.status}`,
    `- unmapped：${data.backendCoverage.apiCoverage.unmappedPackageSkillRefs}`,
    `- contractOnly：${data.backendCoverage.apiCoverage.contractOnlyRefs}`,
    "",
    "## 前端产品口径",
    "",
    `- 状态：${data.frontendGuard.status}`,
    ...data.frontendGuard.checks.map(
      (check) => `- ${check.passed ? "PASS" : "FAIL"} ${check.name}：${check.detail}`,
    ),
    "",
    "## 27 个去重 API mapping 分类",
    "",
    `- live 调用数：${data.apiMatrix.liveCalls}`,
    ...Object.entries(apiCounts).map(([status, count]) => `- ${status}：${count}`),
    "",
    "| API mapping | 状态 | 说明 | 调用日志 |",
    "|---|---|---|---|",
    ...data.apiMatrix.items.map(
      (item) =>
        `| ${item.code} | ${item.status} | ${escapeMd(
          item.reason || item.skillName,
        )} | ${item.callLogId || ""} |`,
    ),
    "",
    "## 21 个 SkillHub 能力分类",
    "",
    `- 本地 Skill 就绪：${data.skillHubMatrix.readyLocal}`,
    `- live 成功：${data.skillHubMatrix.liveSuccess}`,
    `- 缺本地 Skill：${data.skillHubMatrix.missing}`,
    "",
    "| SkillHub | 状态 | 本地目录 |",
    "|---|---|---|",
    ...data.skillHubMatrix.items.map(
      (item) =>
        `| ${item.skillCode} | ${item.status} | ${
          item.localPath ? "有" : "无"
        } |`,
    ),
    "",
    "## 15 个方案包业务闭环",
    "",
    `- 通过：${data.solutionPackages.passed}/${data.solutionPackages.total}`,
    "",
    "| 方案包 | 状态 | runId | 业务对象 |",
    "|---|---|---|---|",
    ...data.solutionPackages.items.map(
      (item) =>
        `| ${item.name} | ${item.status} | ${item.runId} | ${
          item.resultAction.refId || ""
        } |`,
    ),
    "",
    "## 仍需人工判断的项",
    "",
    ...buildRemainingRiskLines(data),
    "",
  ];
  return lines.join("\n");
}

function buildRemainingRiskLines(data) {
  const lines = [];
  const skippedHighCost = data.apiMatrix.items.filter(
    (item) => item.status === "skipped_high_cost",
  );
  const blockedMissing = data.apiMatrix.items.filter(
    (item) => item.status === "blocked_missing_sample_input",
  );
  const failed = data.apiMatrix.items.filter(
    (item) => item.status === "live_failed",
  );
  if (skippedHighCost.length) {
    lines.push(
      `- 高成本接口未默认外呼：${skippedHighCost
        .map((item) => item.code)
        .join("、")}。要跑完整外部生成，设置 FULL_REDFOX_ALLOW_HIGH_COST=true。`,
    );
  }
  if (blockedMissing.length) {
    lines.push(
      `- 缺真实样本输入的接口：${blockedMissing
        .map((item) => item.code)
        .join("、")}。需要从上游搜索结果或人工样本提供链接/账号/taskId。`,
    );
  }
  if (failed.length) {
    lines.push(
      `- live 外呼失败接口：${failed
        .map((item) => `${item.code}(${item.httpStatus})`)
        .join("、")}。需要看 RedFox 返回错误和接口参数。`,
    );
  }
  if (!data.env.liveSkillHub) {
    lines.push(
      "- 21 个 SkillHub 本轮做了本地目录和映射就绪检查；如要真实跑 Agent-S，设置 FULL_SKILLHUB_LIVE=true。",
    );
  }
  if (!lines.length) {
    lines.push("- 本轮脚本未发现剩余阻断项。");
  }
  return lines;
}

function escapeMd(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

async function main() {
  mkdirSync(evidenceDir, { recursive: true });
  const auth = await ensureAuthenticated();
  const me = await request("GET", "/auth/me");
  assert(me?.id, "auth/me did not return user");

  const catalog = buildCoverageFromCatalog();
  assert(catalog.packageCount === 15, `方案包数量应为 15，实际 ${catalog.packageCount}`);
  assert(
    catalog.packageSkillRefCount === 64,
    `功能引用应为 64，实际 ${catalog.packageSkillRefCount}`,
  );
  assert(catalog.apiRefCount === 43, `API 引用应为 43，实际 ${catalog.apiRefCount}`);
  assert(
    catalog.skillHubRefCount === 21,
    `SkillHub 引用应为 21，实际 ${catalog.skillHubRefCount}`,
  );
  assert(catalog.unmapped.length === 0, "仍有 unmapped 功能引用");
  assert(catalog.contractOnly.length === 0, "仍有 contract-only 功能引用");

  const backendCoverage = await verifyBackendCatalog();
  const frontendGuard = await verifyFrontendGuard();
  const skillHubMatrix = await verifySkillHubMatrix();
  const apiMatrix = await verifyApiMatrix();
  const solutionPackages = await verifySolutionPackages().catch((error) => ({
    status: "failed",
    total: 0,
    passed: 0,
    error: error instanceof Error ? error.message : String(error),
    items: [],
  }));

  const data = {
    generatedAt: new Date().toISOString(),
    env: {
      apiBase,
      authMode: auth.mode,
      username: auth.username,
      databaseUrl: databaseUrl.replace(/:\/\/([^:@]+):([^@]+)@/, "://$1:[redacted]@"),
      liveRedfox,
      liveSkillHub,
      allowHighCost,
      maxApiCalls,
      keyword,
    },
    catalog,
    backendCoverage,
    frontendGuard,
    skillHubMatrix,
    apiMatrix,
    solutionPackages,
  };

  writeFileSync(
    join(evidenceDir, "report.json"),
    `${JSON.stringify(data, null, 2)}\n`,
  );
  writeFileSync(join(evidenceDir, "report.md"), makeReport(data));
  console.log(`[PASS] full coverage report written: ${evidenceDir}`);
  console.log(
    `[PASS] catalog packages=${catalog.packageCount} refs=${catalog.packageSkillRefCount} apiRefs=${catalog.apiRefCount} skillHubRefs=${catalog.skillHubRefCount}`,
  );
  console.log(
    `[PASS] solution packages=${solutionPackages.passed}/${solutionPackages.total}, skillHub local=${skillHubMatrix.readyLocal}/${skillHubMatrix.total}, api liveCalls=${apiMatrix.liveCalls}`,
  );
  if (frontendGuard.status !== "passed") {
    throw new Error("前端产品口径检查失败");
  }
  if (backendCoverage.status !== "passed") {
    throw new Error("后端接入总表检查失败");
  }
  if (solutionPackages.status !== "passed") {
    throw new Error(
      solutionPackages.error || "15 个方案包业务闭环检查失败",
    );
  }
}

main()
  .catch((error) => {
    console.error(`[FAIL] ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await cleanupLocalSession();
    } catch (error) {
      console.warn(`[WARN] failed to clean local session: ${error.message}`);
    }
  });
