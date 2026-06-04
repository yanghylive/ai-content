#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
const inputPath = args.inputPath || process.env.RUNTIME_DUAL_RUN_INPUT || "";
const outputPath =
  args.outputPath ||
  process.env.RUNTIME_DUAL_RUN_REPORT ||
  ".local-logs/runtime-dual-run-diff.json";
const minRecords = args.allowEmpty
  ? 0
  : Math.max(
      1,
      Number(args.minRecords || process.env.RUNTIME_DUAL_RUN_MIN_RECORDS || 1),
    );

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main() {
  if (!inputPath) {
    printUsage();
    process.exit(2);
  }
  if (!existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  const records = loadRecords(inputPath);
  const report = buildReport(records, { minRecords });

  await mkdir(dirname(resolve(outputPath)), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  printSummary(report);
  process.exit(
    report.summary.failed === 0 && report.summary.sampleCountOk ? 0 : 1,
  );
}

function printUsage() {
  console.error(`Usage:
  node scripts/runtime-dual-run-diff.mjs <dual-run-records.json|jsonl> [report.json] [--min-records 1] [--allow-empty]

Record shape:
  {
    "taskId": "interaction-task-id",
    "taskType": "douyin-comment-reply",
    "platform": "douyin",
    "legacy": { "ok": true, "status": "sent", "message": "...", "readbackText": "..." },
    "runtime": { "ok": true, "status": "success", "reasonCode": "success", "userMessage": "...", "readback": { "actualText": "..." } }
  }

JSON input may be either an array of records, { "records": [...] }, or JSONL.
By default at least 1 record is required; use --allow-empty only for plumbing checks.`);
}

function parseArgs(values) {
  const parsed = {
    inputPath: "",
    outputPath: "",
    minRecords: "",
    allowEmpty: false,
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--allow-empty") {
      parsed.allowEmpty = true;
    } else if (value === "--min-records") {
      parsed.minRecords = values[++index] || "";
    } else if (value.startsWith("--")) {
      throw new Error(`Unknown option: ${value}`);
    } else if (!parsed.inputPath) {
      parsed.inputPath = value;
    } else if (!parsed.outputPath) {
      parsed.outputPath = value;
    } else {
      throw new Error(`Unexpected argument: ${value}`);
    }
  }
  return parsed;
}

function loadRecords(filePath) {
  const raw = readFileSync(filePath, "utf8").trim();
  if (!raw) return [];

  if (raw.startsWith("[") || raw.startsWith("{")) {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.records)) return parsed.records;
    return [parsed];
  }

  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function buildReport(records, options) {
  const cases = records.map(compareRecord);
  const failed = cases.filter((item) => item.status === "failed");
  const passed = cases.filter((item) => item.status === "passed");
  const minRecords = options.minRecords ?? 1;
  const sampleCountOk = records.length >= minRecords;

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      total: cases.length,
      passed: passed.length,
      failed: failed.length,
      minRecords,
      sampleCountOk,
    },
    errors: sampleCountOk
      ? []
      : [
          {
            field: "sampleCount",
            message: `需要至少 ${minRecords} 条双跑样本，当前 ${records.length} 条。`,
          },
        ],
    cases,
  };
}

function compareRecord(record) {
  const legacy = normalizeLegacy(record.legacy);
  const runtime = normalizeRuntime(record.runtime);
  const diffs = [];

  if (!record.runtime) {
    diffs.push({
      field: "runtime",
      legacy: "present",
      runtime: "missing",
    });
  }

  if (legacy.ok !== runtime.ok) {
    diffs.push({
      field: "ok",
      legacy: legacy.ok,
      runtime: runtime.ok,
    });
  }
  if (legacy.status !== runtime.status) {
    diffs.push({
      field: "status",
      legacy: legacy.status,
      runtime: runtime.status,
    });
  }
  if (
    legacy.readbackText &&
    runtime.readbackText &&
    legacy.readbackText !== runtime.readbackText
  ) {
    diffs.push({
      field: "readbackText",
      legacy: legacy.readbackText,
      runtime: runtime.readbackText,
    });
  }
  if (legacy.evidenceCount === 0 || runtime.evidenceCount === 0) {
    diffs.push({
      field: "evidenceCount",
      legacy: legacy.evidenceCount,
      runtime: runtime.evidenceCount,
    });
  }

  return {
    taskId:
      record.taskId ||
      record.relatedId ||
      legacy.taskId ||
      runtime.taskId ||
      "<unknown>",
    taskType:
      record.taskType || legacy.taskType || runtime.taskType || "<unknown>",
    platform:
      record.platform || legacy.platform || runtime.platform || "<unknown>",
    status: diffs.length ? "failed" : "passed",
    diffs,
    legacy,
    runtime,
  };
}

function normalizeLegacy(value = {}) {
  const evidence = normalizeArray(value.evidence);
  return {
    taskId: value.taskId,
    taskType: value.taskType,
    platform: value.platform,
    ok: value.ok === true,
    status: normalizeLegacyStatus(value.status),
    reasonCode: value.reasonCode || value.failureReason || "",
    message: value.message || "",
    readbackText: value.readbackText || "",
    evidenceCount: evidence.length,
  };
}

function normalizeRuntime(value = {}) {
  const source = value ?? {};
  const evidence = normalizeArray(source.evidence ?? source.evidenceJson);
  const readback = source.readback ?? source.readbackJson ?? {};
  return {
    taskId: source.relatedId || source.taskId,
    taskType: source.taskType,
    platform: source.platform,
    ok: source.ok === true,
    status: normalizeRuntimeStatus(source),
    reasonCode: source.reasonCode || "",
    message: source.userMessage || source.message || "",
    readbackText: readback.actualText || source.readbackText || "",
    evidenceCount: evidence.length,
  };
}

function normalizeLegacyStatus(status) {
  switch (status) {
    case "sent":
    case "draft_filled":
      return "success";
    case "comment_missing":
    case "message_missing":
    case "no_target":
      return "no_target";
    case "unsupported":
    case "editor_missing":
    case "wechat_missing":
    case "desktop_permission_missing":
    case "send_failed":
    default:
      return "failed";
  }
}

function normalizeRuntimeStatus(value) {
  if (value.ok === true) return "success";
  if (value.reasonCode === "target_not_found") return "no_target";
  return value.status === "skipped" ? "no_target" : "failed";
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

function printSummary(report) {
  const { total, passed, failed, minRecords, sampleCountOk } = report.summary;
  console.log(
    `Runtime dual-run diff: total=${total}, passed=${passed}, failed=${failed}, minRecords=${minRecords}, sampleCountOk=${sampleCountOk}`,
  );
  console.log(`Report: ${outputPath}`);
  for (const error of report.errors || []) {
    console.log(`FAILED ${error.field}: ${error.message}`);
  }
  for (const item of report.cases.filter(
    (entry) => entry.status === "failed",
  )) {
    console.log(
      `FAILED ${item.taskId} ${item.taskType}/${item.platform}: ${item.diffs.map((diff) => diff.field).join(", ")}`,
    );
  }
}
