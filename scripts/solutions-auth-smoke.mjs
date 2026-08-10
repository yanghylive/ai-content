#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const apiBase = (process.env.API_BASE || "http://127.0.0.1:3011/api").replace(
  /\/+$/,
  "",
);
const username = process.env.SMOKE_USERNAME || "";
const password = process.env.SMOKE_PASSWORD || "";
const authCookieName = process.env.AUTH_COOKIE_NAME || "ai_content_session";
const useLocalSession =
  process.env.SMOKE_USE_LOCAL_SESSION === "1" ||
  process.env.SMOKE_USE_LOCAL_SESSION === "true";
const databaseUrl = resolveDatabaseUrl();
const liveRedfoxExecution = truthyEnv("SMOKE_REDFOX_REAL_EXECUTION");
const liveRedfoxSkillCode =
  process.env.SMOKE_REDFOX_SKILL_CODE || "douyin-search-article";
const liveRedfoxSkillName = process.env.SMOKE_REDFOX_SKILL_NAME || "";
const liveRedfoxInputJson = process.env.SMOKE_REDFOX_LIVE_INPUT_JSON || "";
const liveRedfoxEstimatedCostPoints = Math.max(
  1,
  Math.floor(Number(process.env.SMOKE_REDFOX_ESTIMATED_COST_POINTS || "1")),
);

let cookie = "";
let cleanupLocalSession = async () => {};

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
    throw new Error(
      `${method} ${path} failed with HTTP ${response.status}: ${text.slice(
        0,
        500,
      )}`,
    );
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
  return { status: response.status, text };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function truthyEnv(name) {
  return process.env[name] === "1" || process.env[name] === "true";
}

async function ensureAuthenticated() {
  if (username && password) {
    const login = await request("POST", "/auth/login", { username, password });
    assert(login?.user?.id, "login did not return user");
    console.log(`[PASS] login as ${login.user.username || login.user.id}`);
    return;
  }

  if (useLocalSession) {
    const session = await createLocalSmokeSession();
    setAuthCookie(session.token);
    cleanupLocalSession = session.cleanup;
    console.log(
      `[PASS] created local smoke session for ${
        session.user.username || session.user.email || session.user.id
      }`,
    );
    return;
  }

  console.log(
    "[SKIP] solutions authenticated smoke requires SMOKE_USERNAME/SMOKE_PASSWORD or SMOKE_USE_LOCAL_SESSION=true.",
  );
  process.exit(0);
}

async function createLocalSmokeSession() {
  if (databaseUrl.startsWith("file:")) {
    return createSqliteSmokeSession(databaseUrl);
  }
  if (databaseUrl.startsWith("postgres")) {
    return createPostgresSmokeSession(databaseUrl);
  }
  throw new Error(
    `Unsupported SMOKE_DATABASE_URL/DATABASE_URL: ${databaseUrl}`,
  );
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
  assert(user?.id, "No active local user found for solutions smoke");

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
  const { Client } = require(join(repoRoot, "backend", "node_modules", "pg"));
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
    assert(user?.id, "No active local user found for solutions smoke");

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

async function findSolutionResults(runId, kind) {
  if (databaseUrl.startsWith("file:")) {
    const databasePath = sqliteFileUrlToPath(databaseUrl);
    if (!databasePath || !existsSync(databasePath)) {
      throw new Error(
        `SQLite database does not exist: ${databasePath || databaseUrl}`,
      );
    }
    return sqliteJson(
      databasePath,
      `
        select
          id,
          run_id as runId,
          task_id as taskId,
          kind,
          status,
          approved_by as approvedBy,
          accepted_at as acceptedAt
        from solution_results
        where run_id = ${sqlQuote(runId)}
          and kind = ${sqlQuote(kind)}
        order by created_at desc;
      `,
    );
  }

  if (databaseUrl.startsWith("postgres")) {
    const { Client } = require(join(repoRoot, "backend", "node_modules", "pg"));
    const client = new Client({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 3000,
    });
    await client.connect();
    try {
      const result = await client.query(
        `
          select
            id,
            run_id as "runId",
            task_id as "taskId",
            kind,
            status,
            approved_by as "approvedBy",
            accepted_at as "acceptedAt"
          from solution_results
          where run_id = $1
            and kind = $2
          order by created_at desc;
        `,
        [runId, kind],
      );
      return result.rows;
    } finally {
      await client.end();
    }
  }

  throw new Error(
    `Unsupported SMOKE_DATABASE_URL/DATABASE_URL: ${databaseUrl}`,
  );
}

async function assertRedfoxApprovalPersisted(runId) {
  const approvals = await findSolutionResults(
    runId,
    "redfox_execution_approval",
  );
  assert(
    approvals.some((item) => item.status === "approved" && item.approvedBy),
    `direct RedFox execution did not persist audit result for run ${runId}`,
  );
  console.log(`[PASS] RedFox execution audit persisted: run=${runId}`);
}

async function assertRedfoxNormalizationPersisted(runId) {
  const plans = await findSolutionResults(runId, "redfox_output_normalization");
  assert(
    plans.some((item) =>
      ["planned", "mapping_required", "persisted"].includes(item.status),
    ),
    `live RedFox execution did not persist output normalization plan for run ${runId}`,
  );
  console.log(
    `[PASS] RedFox output normalization plan persisted: run=${runId}`,
  );
}

function buildLocalSession(user) {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const token = randomBytes(32).toString("base64url");
  return {
    id: `solutions_smoke_${randomBytes(12).toString("hex")}`,
    token,
    tokenHash: createHash("sha256").update(token).digest("hex"),
    now,
    expiresAt,
    user,
    metadata: {
      source: "solutions-auth-smoke",
      localOnly: true,
      kaypalDesktopAccessToken: `local-solutions-access-${randomBytes(
        8,
      ).toString("hex")}`,
      kaypalDesktopRefreshToken: `local-solutions-refresh-${randomBytes(
        8,
      ).toString("hex")}`,
      kaypalDesktopTokenExpiresAt: expiresAt,
      kaypalDesktopDeviceId: `local-solutions-device-${randomBytes(4).toString(
        "hex",
      )}`,
      kaypalSubscriptionPlan: "ADVANCED",
      kaypalSubscriptionPeriodEnd: new Date(
        Date.now() + 30 * 24 * 60 * 60 * 1000,
      ).toISOString(),
      kaypalRole: "SUPER_ADMIN",
      kaypalPlatformRole: "SUPER_ADMIN",
      kaypalPermissionNames: ["solutions_smoke"],
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
    }
  }
  throw lastError;
}

function sqlQuote(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

function parseJsonEnv(name, value) {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${name} must be a JSON object`);
    }
    return parsed;
  } catch (error) {
    throw new Error(
      `${name} must be a valid JSON object: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function createRedfoxReadyRun(input, estimatedCostPoints) {
  const run = await request("POST", "/solutions/hot-topic-solution/runs", {
    input,
    maxCostPoints: Math.max(3, estimatedCostPoints + 2),
  });
  const task = run.tasks.find((item) => item.executorKind === "redfox");
  assert(task?.id, "solution run has no RedFox task");

  await request(
    "POST",
    `/solutions/runs/${encodeURIComponent(run.id)}/tasks/${encodeURIComponent(
      task.id,
    )}/redfox-dry-run`,
    {
      skillCode: liveRedfoxSkillCode,
      ...(liveRedfoxSkillName ? { skillName: liveRedfoxSkillName } : {}),
      input,
      body: input,
      estimatedCostPoints,
    },
  );

  return { run, task };
}

async function createDirectRedfoxRun(input, estimatedCostPoints) {
  const run = await request("POST", "/solutions/hot-topic-solution/runs", {
    input,
    maxCostPoints: Math.max(3, estimatedCostPoints + 2),
    dryRun: false,
  });
  const task = run.tasks.find((item) => item.executorKind === "redfox");
  assert(task?.id, "solution run has no RedFox task");
  return { run, task };
}

async function runDirectWhitelistGate() {
  const { run, task } = await createDirectRedfoxRun({ keyword: "咖啡" }, 1);

  const directExecute = await requestRaw(
    "POST",
    `/solutions/runs/${encodeURIComponent(run.id)}/tasks/${encodeURIComponent(
      task.id,
    )}/redfox-execute`,
    {
      skillName: "solutions-smoke-unmapped-skill",
      input: { keyword: "咖啡" },
      estimatedCostPoints: 1,
    },
  );
  assert(
    directExecute.status === 403,
    `direct execute should reach runner whitelist gate, got HTTP ${directExecute.status}`,
  );
  assert(
    !directExecute.text.includes("确认口令"),
    "direct execute was still blocked by a removed confirmation gate",
  );
  await assertRedfoxApprovalPersisted(run.id);
  console.log(
    "[PASS] direct RedFox execution reaches whitelist gate from a fresh queued task without external call",
  );
}

async function runLiveRedfoxExecutionGate() {
  const input = liveRedfoxInputJson.trim()
    ? parseJsonEnv("SMOKE_REDFOX_LIVE_INPUT_JSON", liveRedfoxInputJson)
    : { keyword: "咖啡" };
  const connection = await request("GET", "/redfox/connection");
  assert(
    connection?.configured,
    "RedFox connection is not configured. Set REDFOX_API_KEY for the backend or save a RedFox connection first.",
  );

  const skills = await request(
    "GET",
    `/redfox/skills?keyword=${encodeURIComponent(liveRedfoxSkillCode)}&limit=5`,
  );
  const enabledSkill = skills?.items?.find((item) => item.enabled);
  if (enabledSkill) {
    console.log(`[PASS] local RedFox skill enabled: ${enabledSkill.code}`);
  } else {
    console.log(
      `[PASS] no local RedFox skill install required for verified API mapping: ${liveRedfoxSkillCode}`,
    );
  }

  const { run, task } = await createDirectRedfoxRun(
    input,
    liveRedfoxEstimatedCostPoints,
  );

  const result = await request(
    "POST",
    `/solutions/runs/${encodeURIComponent(run.id)}/tasks/${encodeURIComponent(
      task.id,
    )}/redfox-execute`,
    {
      skillCode: liveRedfoxSkillCode,
      ...(liveRedfoxSkillName ? { skillName: liveRedfoxSkillName } : {}),
      input,
      body: input,
      estimatedCostPoints: liveRedfoxEstimatedCostPoints,
    },
  );

  assert(
    result?.redfoxRun?.status === "success",
    `live RedFox execution did not succeed: ${JSON.stringify(result)}`,
  );
  assert(
    result?.redfoxRun?.callLogId,
    "live execution did not record callLogId",
  );
  await assertRedfoxApprovalPersisted(run.id);
  await assertRedfoxNormalizationPersisted(run.id);
  console.log(
    `[PASS] live RedFox sandbox execution succeeded: skill=${liveRedfoxSkillCode}, callLog=${result.redfoxRun.callLogId}`,
  );
}

async function runBusinessResultActionClosure() {
  const suffix = randomBytes(4).toString("hex");
  const run = await request("POST", "/solutions/hot-topic-solution/runs", {
    input: {
      keyword: `咖啡-${suffix}`,
      businessObjective: `solutions smoke ${suffix}`,
    },
    maxCostPoints: 3,
    dryRun: false,
  });
  assert(run?.id, "solution run for result actions was not created");

  const actions = [
    {
      kind: "monitor",
      label: `创建监控任务 ${suffix}`,
      targetModule: "监控中心",
      description: "持续观察热点变化",
    },
    {
      kind: "crm_task",
      label: `创建跟进任务 ${suffix}`,
      targetModule: "待办",
      description: "把高价值选题交给运营跟进",
    },
    {
      kind: "intelligence_report",
      label: `生成日报 ${suffix}`,
      targetModule: "报告中心",
      description: "沉淀本次方案结果",
    },
    {
      kind: "crm_lead",
      label: `创建 CRM 线索 ${suffix}`,
      targetModule: "CRM",
      description: "把评论或账号机会转成线索",
    },
    {
      kind: "publish_preparation",
      label: `加入发布排期 ${suffix}`,
      targetModule: "发布中心",
      description: "把方案内容加入发布准备",
    },
  ];

  for (const action of actions) {
    const first = await request(
      "POST",
      `/solutions/runs/${encodeURIComponent(run.id)}/result-actions`,
      action,
    );
    assert(
      first?.status === "created",
      `${action.kind} first action should create a business object`,
    );
    assert(first?.refId, `${action.kind} first action did not return refId`);
    assert(first?.href, `${action.kind} first action did not return href`);

    const second = await request(
      "POST",
      `/solutions/runs/${encodeURIComponent(run.id)}/result-actions`,
      action,
    );
    assert(
      second?.status === "reused",
      `${action.kind} second action should reuse the existing business object`,
    );
    assert(
      second?.refId === first.refId,
      `${action.kind} second action reused a different refId`,
    );
  }

  console.log(
    `[PASS] business result actions create and reuse real objects: run=${run.id}, actions=${actions.length}`,
  );
}

async function main() {
  await ensureAuthenticated();

  const me = await request("GET", "/auth/me");
  assert(me?.id, "auth/me did not return user");
  console.log(`[PASS] authenticated guard works for ${me.username || me.id}`);

  const packages = await request("GET", "/solutions");
  const hotTopicPackage = packages?.items?.find(
    (item) => item.code === "hot-topic-solution",
  );
  assert(
    hotTopicPackage?.productization?.configurationFields?.length >= 1,
    "solution package did not include productization configuration fields",
  );
  assert(
    hotTopicPackage?.productization?.templates?.length >= 1,
    "solution package did not include productization templates",
  );
  assert(
    hotTopicPackage?.productization?.roiMetrics?.length >= 1,
    "solution package did not include ROI metrics",
  );
  console.log("[PASS] solution productization profile returned");

  const plan = await request(
    "POST",
    "/solutions/hot-topic-solution/run-plan",
    {},
  );
  assert(plan?.status === "ready_for_mapping", "run-plan is not ready");
  assert(
    plan?.steps?.[0]?.businessCheckpoint,
    "run-plan step did not include business checkpoint",
  );
  assert(
    plan?.steps?.[0]?.deliverables?.length >= 1,
    "run-plan step did not include deliverables",
  );
  console.log(`[PASS] run plan generated with ${plan.steps.length} steps`);

  const mappingCoverage = await request(
    "GET",
    "/solutions/redfox-mapping-coverage",
  );
  assert(
    mappingCoverage?.totalPackageSkillRefs > 0,
    "RedFox mapping coverage did not return package skill refs",
  );
  assert(
    mappingCoverage?.mappedPackageSkillRefs >= 1,
    "RedFox mapping coverage did not report any mapped skill refs",
  );
  assert(
    mappingCoverage?.verifiedApiPathRefs >= 1,
    "RedFox mapping coverage did not report any verified API path refs",
  );
  assert(
    mappingCoverage?.verifiedSkillHubRefs >= 1,
    "RedFox mapping coverage did not report any verified SkillHub refs",
  );
  assert(
    mappingCoverage?.contractOnlyRefs === 0,
    "RedFox mapping coverage still has contract-only refs",
  );
  assert(
    mappingCoverage.verifiedApiPathRefs +
      mappingCoverage.verifiedSkillHubRefs +
      mappingCoverage.contractOnlyRefs +
      mappingCoverage.unmappedPackageSkillRefs ===
      mappingCoverage.totalPackageSkillRefs,
    "RedFox mapping coverage status totals are inconsistent",
  );
  assert(
    Array.isArray(mappingCoverage?.unmappedSkills),
    "RedFox mapping coverage did not include unmapped skill list",
  );
  assert(
    Array.isArray(mappingCoverage?.contractOnlySkills),
    "RedFox mapping coverage did not include contract-only skill list",
  );
  console.log(
    `[PASS] RedFox mapping coverage checked: mapped=${mappingCoverage.mappedPackageSkillRefs}, api=${mappingCoverage.verifiedApiPathRefs}, skillhub=${mappingCoverage.verifiedSkillHubRefs}, contractOnly=${mappingCoverage.contractOnlyRefs}, unmapped=${mappingCoverage.unmappedPackageSkillRefs}`,
  );

  const run = await request("POST", "/solutions/hot-topic-solution/runs", {
    input: { keyword: "咖啡" },
    maxCostPoints: 3,
    dryRun: false,
  });
  assert(run?.id, "solution run was not created");
  assert(
    run?.summary?.configuredInput?.keyword === "咖啡",
    "solution run did not persist configured input",
  );
  assert(
    Array.isArray(run?.outputRefs) && run.outputRefs.length >= 1,
    "solution run did not persist planned output refs",
  );
  const redfoxTask = run.tasks.find((task) => task.executorKind === "redfox");
  assert(redfoxTask?.id, "solution run has no RedFox task");
  console.log(`[PASS] solution run created: ${run.id}`);

  const directWhitelistExecute = await requestRaw(
    "POST",
    `/solutions/runs/${encodeURIComponent(run.id)}/tasks/${encodeURIComponent(
      redfoxTask.id,
    )}/redfox-execute`,
    {
      skillName: "solutions-smoke-unmapped-skill",
      input: { keyword: "咖啡" },
      estimatedCostPoints: 1,
    },
  );
  assert(
    directWhitelistExecute.status === 403,
    `direct unmapped execution should reach whitelist gate, got HTTP ${directWhitelistExecute.status}`,
  );
  assert(
    !directWhitelistExecute.text.includes("确认口令"),
    "direct unmapped execution was still blocked by a removed confirmation gate",
  );
  console.log("[PASS] RedFox direct execution no longer requires confirmation");
  await assertRedfoxApprovalPersisted(run.id);
  await runBusinessResultActionClosure();

  if (liveRedfoxExecution) {
    await runLiveRedfoxExecutionGate();
  } else {
    await runDirectWhitelistGate();
    console.log(
      "[SKIP] live RedFox sandbox execution requires SMOKE_REDFOX_REAL_EXECUTION=true and SMOKE_REDFOX_LIVE_INPUT_JSON.",
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
      console.warn(
        `[WARN] failed to clean local smoke session: ${error.message}`,
      );
    }
  });
