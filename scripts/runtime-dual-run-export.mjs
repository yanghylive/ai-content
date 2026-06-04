#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

const backendRequire = createRequire(
  join(process.cwd(), "backend", "package.json"),
);
const args = parseArgs(process.argv.slice(2));
const backendEnvPath =
  process.env.RUNTIME_DUAL_RUN_BACKEND_ENV_PATH ||
  join(process.cwd(), "backend", ".env");
const databaseUrl =
  args.databaseUrl ||
  process.env.RUNTIME_DUAL_RUN_DATABASE_URL ||
  readBackendEnvValue("DATABASE_URL");
const databasePath =
  args.databasePath ||
  process.env.RUNTIME_DUAL_RUN_DATABASE_PATH ||
  join(process.cwd(), "backend", "prisma", "dev.db");
const databaseMode = /^postgres(?:ql)?:\/\//i.test(databaseUrl || "")
  ? "postgres"
  : "sqlite";
const outputPath =
  args.out ||
  process.env.RUNTIME_DUAL_RUN_EXPORT ||
  ".local-logs/runtime-dual-run-records.json";
const limit = Math.max(
  1,
  Number(args.limit || process.env.RUNTIME_DUAL_RUN_LIMIT || 50),
);
const taskIds = [
  ...args.taskIds,
  ...listEnv("RUNTIME_DUAL_RUN_TASK_IDS"),
].filter(Boolean);
const onlyWithRuntime =
  args.onlyWithRuntime || truthyEnv("RUNTIME_DUAL_RUN_ONLY_WITH_RUNTIME");

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main() {
  if (args.help) {
    printUsage();
    return;
  }

  const tasks = await readInteractionTasks();
  const runtimeRows = await readRuntimeExecutions(
    tasks.map((task) => task.taskId),
  ).catch((error) => {
    console.warn(
      `Runtime execution query skipped: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  });
  const latestRuntimeByTask = groupLatestRuntime(runtimeRows);
  const allRecords = tasks.map((task) =>
    toDualRunRecord(task, latestRuntimeByTask.get(task.taskId)),
  );
  const records = onlyWithRuntime
    ? allRecords.filter((record) => Boolean(record.runtime?.id))
    : allRecords;
  const payload = {
    generatedAt: new Date().toISOString(),
    database: {
      mode: databaseMode,
      target:
        databaseMode === "postgres"
          ? redactDatabaseUrl(databaseUrl)
          : databasePath,
    },
    filters: {
      taskIds,
      limit,
      onlyWithRuntime,
    },
    records,
  };

  await mkdir(dirname(resolve(outputPath)), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  const withRuntime = records.filter((record) =>
    Boolean(record.runtime?.id),
  ).length;
  console.log(
    `Runtime dual-run export: tasks=${records.length}, withRuntime=${withRuntime}, withoutRuntime=${records.length - withRuntime}, mode=${onlyWithRuntime ? "only-with-runtime" : "strict"}`,
  );
  if (onlyWithRuntime && allRecords.length !== records.length) {
    console.log(
      `Skipped without Runtime: ${allRecords.length - records.length}`,
    );
  }
  console.log(`Output: ${outputPath}`);
}

function printUsage() {
  console.log(`Usage:
  node scripts/runtime-dual-run-export.mjs [--out .local-logs/runtime-dual-run-records.json] [--limit 50] [--only-with-runtime] [--task-id <id> ...]

Environment:
  RUNTIME_DUAL_RUN_TASK_IDS=id1,id2
  RUNTIME_DUAL_RUN_LIMIT=50
  RUNTIME_DUAL_RUN_ONLY_WITH_RUNTIME=1
  RUNTIME_DUAL_RUN_EXPORT=.local-logs/runtime-dual-run-records.json
  RUNTIME_DUAL_RUN_DATABASE_URL=postgresql://...
  RUNTIME_DUAL_RUN_DATABASE_PATH=backend/prisma/dev.db

Then diff:
  node scripts/runtime-dual-run-diff.mjs .local-logs/runtime-dual-run-records.json .local-logs/runtime-dual-run-diff.json`);
}

function parseArgs(values) {
  const parsed = {
    help: false,
    out: "",
    limit: "",
    taskIds: [],
    databaseUrl: "",
    databasePath: "",
    onlyWithRuntime: false,
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--help" || value === "-h") {
      parsed.help = true;
    } else if (value === "--out") {
      parsed.out = values[++index] || "";
    } else if (value === "--limit") {
      parsed.limit = values[++index] || "";
    } else if (value === "--task-id") {
      parsed.taskIds.push(values[++index] || "");
    } else if (value === "--database-url") {
      parsed.databaseUrl = values[++index] || "";
    } else if (value === "--database-path") {
      parsed.databasePath = values[++index] || "";
    } else if (value === "--only-with-runtime") {
      parsed.onlyWithRuntime = true;
    } else if (value.startsWith("--")) {
      throw new Error(`Unknown option: ${value}`);
    } else {
      parsed.taskIds.push(value);
    }
  }
  return parsed;
}

async function readInteractionTasks() {
  const where = taskIds.length
    ? `where id in (${taskIds.map(sqlQuote).join(", ")})`
    : "";
  const sql = `
    select
      id as "taskId",
      "taskType" as "taskType",
      "accountId" as "accountId",
      "sendMode" as "sendMode",
      status as "status",
      "currentTarget" as "currentTarget",
      "draftText" as "draftText",
      events as "events",
      evidence as "evidence",
      config as "config",
      "createdAt" as "createdAt",
      "updatedAt" as "updatedAt"
    from "interaction_tasks"
    ${where}
    order by "updatedAt" desc
    limit ${Number(limit)};
  `;
  return dbJson(sql);
}

async function readRuntimeExecutions(ids) {
  if (!ids.length) return [];
  const sql = `
    select
      id,
      "relatedId" as "relatedId",
      "relatedType" as "relatedType",
      executor,
      platform,
      "taskType" as "taskType",
      "accountId" as "accountId",
      ok,
      status,
      "reasonCode" as "reasonCode",
      "userMessage" as "userMessage",
      "technicalMessage" as "technicalMessage",
      "runtimeJson" as "runtimeJson",
      "evidenceJson" as "evidenceJson",
      "readbackJson" as "readbackJson",
      "agentSSessionId" as "agentSSessionId",
      "engineUrl" as "engineUrl",
      "createdAt" as "createdAt"
    from "runtime_executions"
    where "relatedId" in (${ids.map(sqlQuote).join(", ")})
    order by "relatedId" asc, "createdAt" desc;
  `;
  return dbJson(sql);
}

function groupLatestRuntime(rows) {
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.relatedId)) {
      grouped.set(row.relatedId, row);
    }
  }
  return grouped;
}

function toDualRunRecord(taskRow, runtimeRow) {
  const taskConfig = parseJsonObject(taskRow.config);
  const legacyStatus = normalizeTaskStatus(taskConfig.status || taskRow.status);
  const events = normalizeArray(taskConfig.events ?? taskRow.events);
  const eventEvidence = events.map((event) => event?.evidence).filter(Boolean);
  const directEvidence = normalizeArray(
    taskConfig.evidence ?? taskRow.evidence,
  );
  const evidence = directEvidence.length ? directEvidence : eventEvidence;

  return {
    taskId: taskRow.taskId,
    taskType: normalizeTaskType(taskConfig.type || taskRow.taskType),
    platform: inferPlatform(taskConfig.type || taskRow.taskType),
    legacy: {
      taskId: taskRow.taskId,
      taskType: normalizeTaskType(taskConfig.type || taskRow.taskType),
      platform: inferPlatform(taskConfig.type || taskRow.taskType),
      ok: legacyStatus === "completed",
      status: legacyStatusToResultStatus(
        legacyStatus,
        taskConfig.sendMode || taskRow.sendMode,
      ),
      message:
        taskConfig.statusLabel ||
        taskConfig.diagnostics?.summary ||
        taskConfig.failureReason ||
        legacyStatus,
      readbackText: taskConfig.resultSummary?.detail || "",
      evidence,
    },
    runtime: runtimeRow ? normalizeRuntimeRow(runtimeRow) : null,
  };
}

function normalizeRuntimeRow(row) {
  return {
    id: row.id,
    relatedId: row.relatedId,
    relatedType: row.relatedType,
    executor: row.executor,
    platform: row.platform,
    taskType: row.taskType,
    accountId: row.accountId,
    ok: normalizeBoolean(row.ok),
    status: row.status,
    reasonCode: row.reasonCode,
    userMessage: row.userMessage,
    technicalMessage: row.technicalMessage,
    runtime: parseJsonObject(row.runtimeJson),
    evidence: normalizeArray(row.evidenceJson),
    readback: parseJsonObject(row.readbackJson),
    agentSSessionId: row.agentSSessionId,
    engineUrl: row.engineUrl,
    createdAt: row.createdAt,
  };
}

function normalizeTaskStatus(value) {
  const text = String(value || "").toLowerCase();
  const map = {
    completed: "completed",
    failed: "failed",
    blocked: "failed",
    no_target: "no_target",
    skipped: "no_target",
    waiting_for_send_confirmation: "waiting",
    running: "running",
    queued: "running",
    paused: "running",
    completed_at: "completed",
  };
  return map[text] || text || "unknown";
}

function legacyStatusToResultStatus(status, sendMode) {
  if (status === "completed") {
    return sendMode === "auto-send" ? "sent" : "draft_filled";
  }
  if (status === "no_target") return "no_target";
  if (status === "waiting") return "unsupported";
  return "send_failed";
}

function normalizeTaskType(value) {
  const text = String(value || "");
  const map = {
    DOUYIN_COMMENT_REPLY: "douyin-comment-reply",
    DOUYIN_DIRECT_MESSAGE_REPLY: "douyin-direct-message-reply",
    WECHAT_CHANNEL_COMMENT_REPLY: "wechat-channel-comment-reply",
    WECHAT_CHANNEL_DIRECT_MESSAGE_REPLY: "wechat-channel-direct-message-reply",
    WECHAT_REPLY_DRAFT: "wechat-reply-draft",
    WECHAT_GROUP_BROADCAST: "wechat-group-broadcast",
    WECHAT_MOMENTS_PUBLISH: "wechat-moments-publish",
  };
  return map[text] || text;
}

function inferPlatform(taskType) {
  const normalized = normalizeTaskType(taskType);
  if (normalized.startsWith("douyin-")) return "douyin";
  if (normalized.startsWith("wechat-channel-")) return "wechat-channel";
  if (normalized.startsWith("wechat-")) return "wechat-desktop";
  return "mixed";
}

async function dbJson(sql) {
  if (databaseMode === "postgres") return postgresJson(sql);
  return sqliteJson(sql);
}

async function postgresJson(sql) {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is empty");
  }
  const { Client } = backendRequire("pg");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query(sql);
    return result.rows || [];
  } finally {
    await client.end();
  }
}

function sqliteJson(sql) {
  if (!existsSync(databasePath)) {
    throw new Error(`SQLite database not found: ${databasePath}`);
  }
  const output = execFileSync("sqlite3", ["-json", databasePath, sql], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  return output ? JSON.parse(output) : [];
}

function sqlQuote(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

function parseJsonObject(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeBoolean(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function listEnv(key) {
  return String(process.env[key] || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function truthyEnv(key) {
  return /^(1|true|yes|on)$/i.test(String(process.env[key] || "").trim());
}

function parseEnvFile(content) {
  const env = {};
  for (const rawLine of String(content || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function readBackendEnvValue(key) {
  if (!existsSync(backendEnvPath)) return "";
  try {
    const env = parseEnvFile(readFileSync(backendEnvPath, "utf8"));
    return env[key] || "";
  } catch {
    return "";
  }
}

function redactDatabaseUrl(value) {
  if (!value) return "<empty>";
  try {
    const url = new URL(value);
    if (url.password) url.password = "***";
    return url.toString();
  } catch {
    return "<database-url>";
  }
}
