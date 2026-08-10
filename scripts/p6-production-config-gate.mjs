#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
    join(evidenceRoot, `p6-production-config-gate-${timestampForFile()}`),
);

const externalOps = latestDirectoryReport(
  "commercial-external-ops-smoke-",
  "summary.json",
);
const rows = buildRows(externalOps);
const summary = summarize(rows);
const report = {
  generatedAt: new Date().toISOString(),
  evidenceDate,
  evidenceRoot,
  strict: args.strict,
  status: summary.releaseBlockingCount > 0 ? "BLOCKED_FOR_PRODUCTION" : "PASS",
  externalOpsEvidence: externalOps?.filePath ? relative(externalOps.filePath) : "",
  summary,
  rows,
};

writeReport(report);
printSummary(report);

if (args.strict && summary.releaseBlockingCount > 0) {
  process.exitCode = 1;
}

function buildRows(ops) {
  return [
    backupSourceRow(ops),
    objectStoreRow(ops),
    uploadDownloadRow(ops),
    restoreRow(ops),
    alertRow(ops),
    evidenceFreshnessRow(ops),
  ];
}

function backupSourceRow(ops) {
  const check = findCheck(ops, "latest-local-backup");
  const pass = check?.status === "PASS";
  const isPostgres = /postgres-pgdump/i.test(check?.message || "");
  return row({
    id: "backup-source-manifest",
    title: "备份源与清单",
    status: pass ? "PASS" : "CONFIG_REQUIRED",
    releaseBlocking: !pass,
    evidence: ops?.filePath,
    detail: pass
      ? `${isPostgres ? "Postgres" : "本地"} 备份清单存在，备份文件可读。`
      : check?.message || "未找到最近一次可用备份清单。",
    nextAction: pass
      ? "保持每次发布前至少一轮最新备份。"
      : check?.nextAction || "先生成一轮备份，再重跑 commercial-external-ops-smoke。",
  });
}

function objectStoreRow(ops) {
  const probe = findCheck(ops, "aliyun-oss-write-read-delete");
  const readback = findCheck(ops, "aliyun-oss-latest-backup-readback");
  const real = ops?.json?.real === true;
  const provider = String(ops?.json?.objectStoreProvider || "");
  const pass =
    real &&
    provider === "aliyun-oss" &&
    probe?.status === "PASS" &&
    readback?.status === "PASS";
  return row({
    id: "object-store-real-readback",
    title: "对象存储真实写读删与远端回读",
    status: pass ? "PASS" : "CONFIG_REQUIRED",
    releaseBlocking: !pass,
    evidence: ops?.filePath,
    detail: pass
      ? "阿里云 OSS 探针写入、读回、删除和最近备份远端回读均通过。"
      : [probe?.message, readback?.message]
          .filter(Boolean)
          .join("；") ||
        `当前对象存储 provider=${provider || "unconfigured"}，real=${real}。`,
    nextAction: pass
      ? "保留 OSS bucket、prefix、manifest、备份 key 作为生产发布证据。"
      : "配置真实 OSS 凭据后运行 node scripts/commercial-external-ops-smoke.mjs --real --upload-latest-backup --download-backup。",
  });
}

function uploadDownloadRow(ops) {
  const upload = findCheck(ops, "aliyun-oss-upload-latest-backup");
  const readback = findCheck(ops, "aliyun-oss-latest-backup-readback");
  const downloaded = ops?.json?.artifacts?.downloadedBackup || {};
  const downloadedFilesExist =
    fileExists(downloaded.manifestFile) && fileExists(downloaded.backupFile);
  const pass =
    ops?.json?.uploadLatestBackup === true &&
    ops?.json?.downloadBackup === true &&
    upload?.status === "PASS" &&
    readback?.status === "PASS" &&
    downloadedFilesExist;
  return row({
    id: "remote-backup-upload-download",
    title: "远端备份上传与下载证据",
    status: pass ? "PASS" : "CONFIG_REQUIRED",
    releaseBlocking: !pass,
    evidence: ops?.filePath,
    detail: pass
      ? "最新备份已上传到 OSS，并下载回证据目录。"
      : `upload=${upload?.status || "missing"}，readback=${readback?.status || "missing"}，downloadedFilesExist=${downloadedFilesExist}。`,
    nextAction: pass
      ? "保留 downloaded-backup/manifest.json 和备份文件用于恢复验收。"
      : "加 --upload-latest-backup --download-backup 重跑外部运维 smoke。",
  });
}

function restoreRow(ops) {
  const restore = findCheck(ops, "restore-runbook-real-execution");
  const pass = ops?.json?.real === true && ops?.json?.runRestore === true && restore?.status === "PASS";
  return row({
    id: "isolated-restore-execution",
    title: "隔离恢复真实执行",
    status: pass ? "PASS" : "CONFIG_REQUIRED",
    releaseBlocking: !pass,
    evidence: ops?.filePath,
    detail: pass
      ? "下载后的备份已恢复到隔离库。"
      : restore?.message || "未执行真实隔离恢复。",
    nextAction: pass
      ? "生产前确认恢复库不是生产库，并保留恢复输出。"
      : "配置 COMMERCIAL_RESTORE_DATABASE_URL 指向隔离库，并用 --real --restore --download-backup 重跑。",
  });
}

function alertRow(ops) {
  const probe = findCheck(ops, "alert-webhook-real-probe");
  const targetBlocked = findCheck(ops, "alert-webhook-production-target");
  const configBlocked = findCheck(ops, "alert-webhook-config");
  const target = ops?.json?.alertWebhook || {};
  const productionCandidate = target.productionCandidate !== false;
  const pass =
    ops?.json?.real === true &&
    probe?.status === "PASS" &&
    productionCandidate &&
    !targetBlocked;
  const blocker = targetBlocked || configBlocked;
  return row({
    id: "backup-alert-real-channel",
    title: "值班告警真实通道",
    status: pass ? "PASS" : "CONFIG_REQUIRED",
    releaseBlocking: !pass,
    evidence: ops?.filePath,
    detail: pass
      ? `告警 webhook 已真实发送，provider=${ops?.json?.alertProvider || target.provider || "unknown"}。`
      : blocker?.message || probe?.message || "未发现真实告警发送通过证据。",
    nextAction: pass
      ? "保留值班群消息截图或 webhook 响应证据。"
      : blocker?.nextAction ||
        "配置真实值班群或外部告警系统 webhook 后，用 --real 重跑外部运维 smoke。",
  });
}

function evidenceFreshnessRow(ops) {
  const generatedAt = ops?.json?.generatedAt || "";
  const ageHours = generatedAt
    ? (Date.now() - Date.parse(generatedAt)) / 1000 / 60 / 60
    : Number.POSITIVE_INFINITY;
  const pass = Number.isFinite(ageHours) && ageHours <= 24;
  return row({
    id: "production-config-evidence-freshness",
    title: "生产配置证据新鲜度",
    status: pass ? "PASS" : "CONFIG_REQUIRED",
    releaseBlocking: !pass,
    evidence: ops?.filePath,
    detail: pass
      ? `最近外部运维证据距今 ${ageHours.toFixed(1)} 小时。`
      : generatedAt
        ? `最近外部运维证据已超过 24 小时：${generatedAt}。`
        : "未找到外部运维证据。",
    nextAction: pass
      ? "发布当天重跑一次 P6。"
      : "发布当天重新执行 external ops smoke 和 P6 gate。",
  });
}

function findCheck(ops, name) {
  const checks = Array.isArray(ops?.json?.checks) ? ops.json.checks : [];
  return checks.find((item) => item?.name === name) || null;
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

function writeReport(data) {
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(join(reportDir, "report.json"), `${JSON.stringify(data, null, 2)}\n`);
  writeFileSync(join(reportDir, "report.md"), renderMarkdown(data));
}

function renderMarkdown(data) {
  const lines = [
    "# P6 Production Config Gate",
    "",
    `- Generated: ${data.generatedAt}`,
    `- Evidence root: ${relative(data.evidenceRoot)}`,
    `- External ops evidence: ${data.externalOpsEvidence || "-"}`,
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
      ? "生产配置仍未闭环，不能把备份、恢复、对象存储和值班告警判定为生产可用。"
      : "生产配置门禁通过，可作为 P5 生产发布矩阵的备份/恢复/告警证据。",
    "",
  );
  return `${lines.join("\n")}\n`;
}

function printSummary(data) {
  console.log("P6 production config gate");
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

function readJson(filePath) {
  if (!filePath || !existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function fileExists(filePath) {
  return typeof filePath === "string" && filePath.length > 0 && existsSync(filePath);
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

function relative(filePath) {
  return filePath ? filePath.replace(`${repoRoot}/`, "") : "";
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
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--strict") parsed.strict = true;
    else if (arg === "--date") parsed.date = argv[++index] || "";
    else if (arg === "--evidence-root") parsed.evidenceRoot = argv[++index] || "";
    else if (arg === "--report-dir") parsed.reportDir = argv[++index] || "";
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage:
  node scripts/p6-production-config-gate.mjs
  node scripts/p6-production-config-gate.mjs --strict

Options:
  --strict             Exit 1 when production config blockers exist.
  --date YYYY-MM-DD    Evidence date folder to inspect.
  --evidence-root DIR  Evidence root override.
  --report-dir DIR     Output report directory override.
`);
      process.exit(0);
    }
  }
  return parsed;
}
