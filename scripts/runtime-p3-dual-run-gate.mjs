#!/usr/bin/env node

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const args = parseArgs(process.argv.slice(2));
const rootDir = process.cwd();
const backendDir = join(rootDir, "backend");
const timestamp = timestampForFile();
const outputDir =
  args.outDir || envValue("P3_DUAL_RUN_OUTPUT_DIR", ".local-logs");
const limit = Math.max(
  1,
  Number(args.limit || envValue("P3_DUAL_RUN_LIMIT", "50")),
);
const minRecords = Math.max(
  1,
  Number(args.minRecords || envValue("P3_DUAL_RUN_MIN_RECORDS", "20")),
);
const runCommercial =
  args.runCommercial || truthyEnv("P3_DUAL_RUN_RUN_COMMERCIAL");
const skipCommercial =
  args.skipCommercial || truthyEnv("P3_DUAL_RUN_SKIP_COMMERCIAL");
const runTests = !(args.skipTests || truthyEnv("P3_DUAL_RUN_SKIP_TESTS"));
const allowEmpty = args.allowEmpty || truthyEnv("P3_DUAL_RUN_ALLOW_EMPTY");
const onlyWithRuntime =
  args.onlyWithRuntime || truthyEnv("P3_DUAL_RUN_ONLY_WITH_RUNTIME");
const recordsPath =
  args.recordsOut ||
  join(outputDir, `runtime-dual-run-records-${timestamp}.json`);
const diffPath =
  args.diffOut || join(outputDir, `runtime-dual-run-diff-${timestamp}.json`);
const reportPath =
  args.reportOut ||
  join(outputDir, `runtime-p3-dual-run-gate-${timestamp}.json`);

const gate = {
  generatedAt: new Date().toISOString(),
  config: {
    rootDir,
    limit,
    minRecords: allowEmpty ? 0 : minRecords,
    runTests,
    runCommercial,
    skipCommercial,
    allowEmpty,
    onlyWithRuntime,
    commercialReport: args.commercialReport,
    taskIds: args.taskIds,
    hasCommercialRealExecution: truthyEnv("COMMERCIAL_REAL_EXECUTION"),
    hasCommercialApproveDrafts: truthyEnv("COMMERCIAL_APPROVE_DRAFTS"),
    hasCommercialRealAutoSend: truthyEnv("COMMERCIAL_REAL_AUTO_SEND"),
    hasCommercialApproveAutoSend: truthyEnv("COMMERCIAL_APPROVE_AUTO_SEND"),
  },
  artifacts: {
    recordsPath,
    diffPath,
    reportPath,
    commercialReportPath: "",
    commercialCreatedTaskIds: [],
  },
  summary: {
    status: "PENDING",
    exitCode: 1,
    sampleCount: null,
    sampleCountOk: null,
    diffFailed: null,
  },
  steps: [],
};

main().catch(async (error) => {
  addStep({
    name: "runtime-p3-dual-run-gate",
    status: "FAILED",
    detail: error instanceof Error ? error.message : String(error),
  });
  await writeGateReport();
  printGateSummary();
  process.exit(1);
});

async function main() {
  if (args.help) {
    printUsage();
    return;
  }
  if (runCommercial && skipCommercial) {
    throw new Error(
      "--run-commercial and --skip-commercial cannot be used together",
    );
  }
  if (args.commercialReport && skipCommercial) {
    throw new Error(
      "--commercial-report and --skip-commercial cannot be used together",
    );
  }

  await mkdir(resolve(outputDir), { recursive: true });
  await runSyntaxChecks();
  await runHealthChecks();
  if (args.commercialReport) {
    await attachCommercialReportPath(args.commercialReport);
  } else if (runCommercial && hasFailedSteps()) {
    addStep({
      name: "commercial acceptance gate",
      status: "BLOCKED",
      detail:
        "Runtime health checks failed, so real account execution was not started.",
    });
  } else {
    await runCommercialGate();
  }
  if (!ensureScopedDualRunSamples()) {
    await finishGate();
    return;
  }
  await runDualRunExport();
  await runDualRunDiff();
  await finishGate();
}

async function runSyntaxChecks() {
  await runCommandStep("dual-run export syntax", process.execPath, [
    "--check",
    "scripts/runtime-dual-run-export.mjs",
  ]);
  await runCommandStep("dual-run diff syntax", process.execPath, [
    "--check",
    "scripts/runtime-dual-run-diff.mjs",
  ]);
}

async function runHealthChecks() {
  if (!runTests) {
    addStep({
      name: "runtime health checks",
      status: "SKIPPED",
      detail: "P3_DUAL_RUN_SKIP_TESTS=1 or --skip-tests was set.",
    });
    return;
  }

  await runCommandStep("backend typecheck", npxCommand(), ["tsc", "--noEmit"], {
    cwd: backendDir,
    timeout: timeoutMs("P3_DUAL_RUN_TSC_TIMEOUT_MS", 10 * 60 * 1000),
  });
  await runCommandStep(
    "runtime jest group",
    npxCommand(),
    [
      "jest",
      "--runInBand",
      "src/modules/runtime/runtime-module-wiring.spec.ts",
      "src/modules/runtime/orchestrator/runtime-orchestrator.service.spec.ts",
      "src/modules/runtime/orchestrator/interaction-task-runtime.mapper.spec.ts",
      "src/modules/runtime/executor-router.spec.ts",
      "src/modules/runtime/runtime.integration.spec.ts",
      "src/modules/runtime/evidence/evidence.service.spec.ts",
      "src/modules/runtime/browser-control/browser-control.service.spec.ts",
    ],
    {
      cwd: backendDir,
      timeout: timeoutMs("P3_DUAL_RUN_JEST_TIMEOUT_MS", 10 * 60 * 1000),
    },
  );
  await runCommandStep(
    "runtime router persistence smoke",
    npxCommand(),
    [
      "ts-node",
      "-r",
      "tsconfig-paths/register",
      "scripts/runtime-router-persistence-smoke.ts",
    ],
    {
      cwd: backendDir,
      timeout: timeoutMs("P3_DUAL_RUN_SMOKE_TIMEOUT_MS", 5 * 60 * 1000),
    },
  );
  await runCommandStep(
    "local-engine runtime smoke",
    npxCommand(),
    [
      "ts-node",
      "-r",
      "tsconfig-paths/register",
      "scripts/local-engine-runtime-smoke.ts",
    ],
    {
      cwd: backendDir,
      timeout: timeoutMs("P3_DUAL_RUN_SMOKE_TIMEOUT_MS", 5 * 60 * 1000),
    },
  );
}

async function runCommercialGate() {
  if (runCommercial) {
    const step = await runCommandStep(
      "commercial acceptance gate",
      process.execPath,
      ["scripts/commercial-acceptance-gate.mjs"],
      {
        timeout: timeoutMs("P3_DUAL_RUN_COMMERCIAL_TIMEOUT_MS", 30 * 60 * 1000),
      },
    );
    await attachCommercialReportFromStep(step);
    return;
  }

  addStep({
    name: "commercial acceptance gate",
    status: skipCommercial ? "SKIPPED" : "BLOCKED",
    detail: skipCommercial
      ? "Existing DB samples only; no real account task was created by this gate."
      : "Real account execution was not requested. Use --run-commercial or P3_DUAL_RUN_RUN_COMMERCIAL=1 after setting the COMMERCIAL_* safety gates.",
  });
}

async function runDualRunExport() {
  const taskIds = args.taskIds.length
    ? args.taskIds
    : gate.artifacts.commercialCreatedTaskIds;
  const commandArgs = [
    "scripts/runtime-dual-run-export.mjs",
    "--limit",
    String(limit),
    "--out",
    recordsPath,
  ];
  if (onlyWithRuntime) commandArgs.push("--only-with-runtime");
  if (args.databaseUrl) commandArgs.push("--database-url", args.databaseUrl);
  if (args.databasePath) commandArgs.push("--database-path", args.databasePath);
  for (const taskId of taskIds) {
    commandArgs.push("--task-id", taskId);
  }
  await runCommandStep("dual-run export", process.execPath, commandArgs);
}

async function runDualRunDiff() {
  const commandArgs = [
    "scripts/runtime-dual-run-diff.mjs",
    recordsPath,
    diffPath,
  ];
  if (allowEmpty) {
    commandArgs.push("--allow-empty");
  } else {
    commandArgs.push("--min-records", String(minRecords));
  }
  await runCommandStep("dual-run diff", process.execPath, commandArgs);
  await attachDiffSummary();
}

async function attachDiffSummary() {
  const diffReport = await readJson(diffPath);
  if (!diffReport?.summary) return;
  gate.summary.sampleCount = diffReport.summary.total;
  gate.summary.sampleCountOk = diffReport.summary.sampleCountOk;
  gate.summary.diffFailed = diffReport.summary.failed;
}

async function attachCommercialReportFromStep(step) {
  const reportPath = parseCommercialReportPath(
    `${step.stdoutTail || ""}\n${step.stderrTail || ""}`,
  );
  if (!reportPath) {
    addStep({
      name: "commercial report discovery",
      status: "BLOCKED",
      detail:
        "Commercial acceptance ran, but no report path was printed. Dual-run export will fall back to explicit task ids or recent tasks.",
    });
    return;
  }

  await attachCommercialReportPath(reportPath);
}

async function attachCommercialReportPath(reportPath) {
  const absoluteReportPath = resolve(reportPath);
  gate.artifacts.commercialReportPath = reportPath;
  const report = await readJson(absoluteReportPath);
  const taskIds = Array.isArray(report?.artifacts?.createdTaskIds)
    ? report.artifacts.createdTaskIds.filter(Boolean)
    : [];
  gate.artifacts.commercialCreatedTaskIds = [...new Set(taskIds)];
  addStep({
    name: "commercial report discovery",
    status: taskIds.length ? "PASS" : "BLOCKED",
    detail: taskIds.length
      ? `Using ${taskIds.length} created task id(s) from ${reportPath}.`
      : `No created task ids found in ${reportPath}; dual-run export will fall back to explicit task ids or recent tasks.`,
  });
}

function ensureScopedDualRunSamples() {
  const needsScopedSamples = runCommercial || Boolean(args.commercialReport);
  if (!needsScopedSamples || args.taskIds.length > 0) return true;
  if (gate.artifacts.commercialCreatedTaskIds.length > 0) return true;

  addStep({
    name: "dual-run sample scope",
    status: "FAILED",
    detail:
      "Commercial mode did not produce created task ids. Refusing to export recent historical tasks as acceptance samples.",
  });
  return false;
}

async function finishGate() {
  const failedCount = gate.steps.filter(
    (step) => step.status === "FAILED",
  ).length;
  const blockedCount = gate.steps.filter(
    (step) => step.status === "BLOCKED",
  ).length;
  gate.summary.status =
    failedCount > 0 ? "FAILED" : blockedCount > 0 ? "BLOCKED" : "PASS";
  gate.summary.exitCode = gate.summary.status === "PASS" ? 0 : 1;
  await writeGateReport();
  printGateSummary();
  process.exit(gate.summary.exitCode);
}

function hasFailedSteps() {
  return gate.steps.some((step) => step.status === "FAILED");
}

async function runCommandStep(name, command, commandArgs, options = {}) {
  const startedAt = Date.now();
  const step = {
    name,
    status: "PENDING",
    command: [command, ...commandArgs].join(" "),
    cwd: options.cwd || rootDir,
    startedAt: new Date(startedAt).toISOString(),
    durationMs: 0,
    exitCode: null,
    stdoutTail: "",
    stderrTail: "",
  };
  try {
    const result = await execFileAsync(command, commandArgs, {
      cwd: options.cwd || rootDir,
      env: process.env,
      timeout:
        options.timeout ||
        timeoutMs("P3_DUAL_RUN_STEP_TIMEOUT_MS", 10 * 60 * 1000),
      maxBuffer: 32 * 1024 * 1024,
    });
    step.status = "PASS";
    step.exitCode = 0;
    step.stdoutTail = tailText(result.stdout);
    step.stderrTail = tailText(result.stderr);
  } catch (error) {
    step.status = "FAILED";
    step.exitCode = Number.isInteger(error?.code) ? error.code : 1;
    step.stdoutTail = tailText(error?.stdout);
    step.stderrTail = tailText(error?.stderr || error?.message);
  } finally {
    step.durationMs = Date.now() - startedAt;
    gate.steps.push(step);
    console.log(`${step.status} ${name}`);
    if (step.stderrTail && step.status !== "PASS") {
      console.log(step.stderrTail.split(/\r?\n/).slice(-6).join("\n"));
    }
    return step;
  }
}

function addStep(step) {
  gate.steps.push({
    name: step.name,
    status: step.status,
    detail: step.detail || "",
    at: new Date().toISOString(),
  });
  console.log(
    `${step.status} ${step.name}${step.detail ? `: ${step.detail}` : ""}`,
  );
}

async function writeGateReport() {
  await mkdir(resolve(outputDir), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(gate, null, 2)}\n`, "utf8");
}

function printGateSummary() {
  const summary = gate.summary;
  console.log("");
  console.log(`P3 dual-run gate: ${summary.status}`);
  console.log(`Report: ${reportPath}`);
  console.log(`Records: ${recordsPath}`);
  console.log(`Diff: ${diffPath}`);
  if (summary.sampleCount !== null) {
    console.log(
      `Samples: ${summary.sampleCount}, sampleCountOk=${summary.sampleCountOk}, diffFailed=${summary.diffFailed}`,
    );
  }
}

async function readJson(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function parseArgs(values) {
  const parsed = {
    help: false,
    skipTests: false,
    runCommercial: false,
    skipCommercial: false,
    allowEmpty: false,
    onlyWithRuntime: false,
    outDir: "",
    recordsOut: "",
    diffOut: "",
    reportOut: "",
    limit: "",
    minRecords: "",
    databaseUrl: "",
    databasePath: "",
    commercialReport: "",
    taskIds: [],
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--help" || value === "-h") {
      parsed.help = true;
    } else if (value === "--skip-tests") {
      parsed.skipTests = true;
    } else if (value === "--run-commercial") {
      parsed.runCommercial = true;
    } else if (value === "--skip-commercial") {
      parsed.skipCommercial = true;
    } else if (value === "--allow-empty") {
      parsed.allowEmpty = true;
    } else if (value === "--only-with-runtime") {
      parsed.onlyWithRuntime = true;
    } else if (value === "--out-dir") {
      parsed.outDir = values[++index] || "";
    } else if (value === "--records-out") {
      parsed.recordsOut = values[++index] || "";
    } else if (value === "--diff-out") {
      parsed.diffOut = values[++index] || "";
    } else if (value === "--report-out") {
      parsed.reportOut = values[++index] || "";
    } else if (value === "--limit") {
      parsed.limit = values[++index] || "";
    } else if (value === "--min-records") {
      parsed.minRecords = values[++index] || "";
    } else if (value === "--database-url") {
      parsed.databaseUrl = values[++index] || "";
    } else if (value === "--database-path") {
      parsed.databasePath = values[++index] || "";
    } else if (value === "--commercial-report") {
      parsed.commercialReport = values[++index] || "";
    } else if (value === "--task-id") {
      parsed.taskIds.push(values[++index] || "");
    } else if (value.startsWith("--")) {
      throw new Error(`Unknown option: ${value}`);
    } else {
      parsed.taskIds.push(value);
    }
  }
  parsed.taskIds = parsed.taskIds.filter(Boolean);
  return parsed;
}

function printUsage() {
  console.log(`Usage:
  node scripts/runtime-p3-dual-run-gate.mjs [options]

Safe local check, no real account actions:
  node scripts/runtime-p3-dual-run-gate.mjs --skip-commercial --min-records 20

Real P3 double-run gate:
  P3_DUAL_RUN_RUN_COMMERCIAL=1 \\
  COMMERCIAL_REAL_EXECUTION=1 \\
  COMMERCIAL_APPROVE_DRAFTS=1 \\
  node scripts/runtime-p3-dual-run-gate.mjs --min-records 20

Options:
  --skip-tests              Skip typecheck, Runtime Jest group, and smoke scripts.
  --run-commercial          Run scripts/commercial-acceptance-gate.mjs.
  --skip-commercial         Evaluate existing DB samples only.
  --allow-empty             Permit 0 diff samples for plumbing checks only.
  --only-with-runtime       Export only records that already have Runtime rows.
  --limit <n>               Export limit, default 50.
  --min-records <n>         Required diff sample count, default 20.
  --task-id <id>            Restrict export to one task id; repeatable.
  --commercial-report <file>
                            Use createdTaskIds from an existing commercial acceptance report.
  --out-dir <dir>           Output directory, default .local-logs.
  --records-out <file>      Override records artifact path.
  --diff-out <file>         Override diff artifact path.
  --report-out <file>       Override gate report artifact path.
  --database-url <url>      Override DB URL passed to export.
  --database-path <path>    Override SQLite DB path passed to export.`);
}

function timestampForFile() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function envValue(key, fallback) {
  return process.env[key] || fallback;
}

function truthyEnv(key) {
  return /^(1|true|yes|on)$/i.test(String(process.env[key] || "").trim());
}

function timeoutMs(key, fallback) {
  return Math.max(1, Number(process.env[key] || fallback));
}

function parseCommercialReportPath(text) {
  const match = String(text || "").match(/^Report:\s*(.+)$/m);
  return match?.[1]?.trim() || "";
}

function npxCommand() {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

function tailText(value, maxLength = 12000) {
  const text = String(value || "").trim();
  return text.length > maxLength ? text.slice(-maxLength) : text;
}
