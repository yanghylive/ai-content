#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const SCHEMA_VERSION = "2026-06-29.wechat-diagnostics-evidence-pack.v1";

const args = parseArgs(process.argv.slice(2));
const inputPath = args.input || args._[0];

if (args.help || !inputPath) {
  printUsage();
  process.exit(args.help ? 0 : 2);
}

const resolvedInput = path.resolve(inputPath);
const artifacts = loadArtifacts(resolvedInput);
const failureRecords = dedupeRecords(
  artifacts.flatMap((artifact) => collectFailureRecords(artifact.data, artifact.source)),
);
const evidencePackage = buildEvidencePackage(resolvedInput, artifacts, failureRecords);

if (args.output && !args.validateOnly) {
  const outputPath = path.resolve(args.output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(evidencePackage, null, 2)}\n`, "utf8");
  console.log(`Wrote ${outputPath}`);
} else if (args.validateOnly) {
  console.log(
    JSON.stringify(
      {
        ok: evidencePackage.validation.ok,
        failureCount: evidencePackage.summary.failureCount,
        artifactCount: evidencePackage.summary.artifactCount,
        errors: evidencePackage.validation.errors,
        warnings: evidencePackage.validation.warnings,
      },
      null,
      2,
    ),
  );
} else {
  process.stdout.write(`${JSON.stringify(evidencePackage, null, 2)}\n`);
}

process.exit(evidencePackage.validation.ok ? 0 : 1);

function printUsage() {
  console.log(`Usage:
  node scripts/wechat-diagnostics-evidence-pack.mjs --input <json-or-dir> [--output <file>]
  node scripts/wechat-diagnostics-evidence-pack.mjs <json-or-dir> --validate-only

Builds and validates a WeChat diagnostics evidence package. The input can be a
diagnostics/export JSON file or an acceptance evidence directory.`);
}

function parseArgs(argv) {
  const parsed = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      parsed._.push(item);
      continue;
    }
    const key = toCamel(item.slice(2));
    if (key === "help" || key === "validateOnly") {
      parsed[key] = true;
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      parsed[key] = next;
      index += 1;
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function loadArtifacts(targetPath) {
  const stat = fs.statSync(targetPath);
  const files = stat.isDirectory() ? collectJsonFiles(targetPath) : [targetPath];
  const artifacts = [];
  for (const filePath of files) {
    const raw = fs.readFileSync(filePath, "utf8");
    const data = parseJson(raw, filePath);
    artifacts.push({ source: filePath, data });
    for (const nested of expandNestedJson(data, filePath)) {
      artifacts.push(nested);
    }
  }
  return artifacts;
}

function collectJsonFiles(directory) {
  const result = [];
  const stack = [directory];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        result.push(entryPath);
      }
    }
  }
  return result.sort();
}

function parseJson(raw, source) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Failed to parse JSON from ${source}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function expandNestedJson(data, source) {
  const nested = [];
  const candidates = [
    ["content", data && data.content],
    ["response", data && data.response],
    ["response.content", data && data.response && data.response.content],
  ];
  for (const [label, value] of candidates) {
    if (isRecord(value)) {
      nested.push({ source: `${source}#${label}`, data: value });
      for (const child of expandNestedJson(value, `${source}#${label}`)) {
        nested.push(child);
      }
      continue;
    }
    if (typeof value === "string" && looksLikeJson(value)) {
      const parsed = parseJson(value, `${source}#${label}`);
      nested.push({ source: `${source}#${label}`, data: parsed });
      for (const child of expandNestedJson(parsed, `${source}#${label}`)) {
        nested.push(child);
      }
    }
  }
  return nested;
}

function looksLikeJson(value) {
  const text = value.trim();
  return text.startsWith("{") || text.startsWith("[");
}

function collectFailureRecords(data, source) {
  if (!isRecord(data)) return [];
  const records = [];

  const existingPackage = asRecord(data.evidencePackage);
  if (existingPackage && Array.isArray(existingPackage.failureRecords)) {
    for (const record of existingPackage.failureRecords) {
      records.push(normalizeFailureRecord(record, source));
    }
  }
  if (isRecord(data.failureRecord)) {
    records.push(normalizeFailureRecord(data.failureRecord, source));
  }

  const task = asRecord(data.task);
  if (task && isFailureLike(task)) {
    records.push(buildFailureRecord(task, source));
  }
  if (task && Array.isArray(task.batchTargets)) {
    for (const target of task.batchTargets) {
      if (isRecord(target) && isFailureLike(target)) {
        records.push(buildFailureRecord({ ...task, ...target }, source));
      }
    }
  }
  if (isFailureLike(data)) {
    records.push(buildFailureRecord(data, source));
  }

  return records;
}

function normalizeFailureRecord(record, source) {
  const normalized = buildFailureRecord(asRecord(record) || {}, source);
  return {
    ...normalized,
    ...asRecord(record),
    sourceFile: optionalText(record && record.sourceFile) || source,
    command: optionalText(record && record.command) || normalized.command,
    runner: optionalText(record && record.runner) || normalized.runner,
    platform: optionalText(record && record.platform) || normalized.platform,
    screenshotPath:
      optionalText(record && record.screenshotPath) || normalized.screenshotPath,
    rawSummary: optionalText(record && record.rawSummary) || normalized.rawSummary,
    nextAction: optionalText(record && record.nextAction) || normalized.nextAction,
  };
}

function buildFailureRecord(value, source) {
  const diagnostics = asRecord(value.diagnostics);
  const runtime = asRecord(diagnostics && diagnostics.runtime);
  const taskDiagnostics = asRecord(value.task && value.task.diagnostics);
  const command =
    firstText(
      value.command,
      diagnostics && diagnostics.command,
      value.taskType,
      value.type,
      value.action,
      inferCommandFromSource(source),
    ) || "wechat-task";
  const runner =
    firstText(
      value.runner,
      value.engine,
      value.fallback,
      diagnostics && diagnostics.runner,
      diagnostics && diagnostics.engine,
      diagnostics && diagnostics.source,
      runtime && runtime.engine,
      taskDiagnostics && taskDiagnostics.runner,
    ) || "unknown";
  const platform =
    firstText(
      value.platform,
      diagnostics && diagnostics.platform,
      diagnostics && diagnostics.os,
      runtime && runtime.platform,
      value.platformType,
      value.platformName,
    ) || "unknown";
  const screenshotPath =
    firstText(value.screenshotPath, diagnostics && diagnostics.screenshotPath) ||
    findScreenshotPath(value) ||
    "";
  const message =
    firstText(
      value.message,
      value.error,
      value.reason,
      value.failureReason,
      diagnostics && diagnostics.failureReason,
      diagnostics && diagnostics.fallbackReason,
    ) || "WeChat task failed";

  return {
    id: makeRecordId(source, command, message),
    sourceFile: source,
    command,
    runner,
    platform,
    screenshotPath,
    rawSummary: summarizeRaw(value, diagnostics),
    nextAction:
      firstText(value.nextAction, diagnostics && diagnostics.nextAction) ||
      inferNextAction(message, runner, screenshotPath),
    status: firstText(value.status, value.exportStatus) || "failed",
    stage: firstText(value.stage, diagnostics && diagnostics.stage) || "",
    errorCode: firstText(value.errorCode, diagnostics && diagnostics.errorCode) || "",
    message,
  };
}

function isFailureLike(value) {
  if (!isRecord(value)) return false;
  const diagnostics = asRecord(value.diagnostics);
  const status = firstText(value.status, value.exportStatus).toLowerCase();
  return (
    value.ok === false ||
    ["failed", "blocked", "incomplete"].includes(status) ||
    Boolean(firstText(value.error, value.failureReason, value.reason)) ||
    Boolean(
      diagnostics &&
        firstText(diagnostics.failureReason, diagnostics.fallbackReason),
    )
  );
}

function buildEvidencePackage(inputPath, artifacts, failureRecords) {
  const validation = validateFailureRecords(failureRecords);
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    source: {
      inputPath,
      inputType: fs.statSync(inputPath).isDirectory() ? "directory" : "file",
    },
    summary: {
      status: validation.ok ? "ready" : "incomplete",
      artifactCount: artifacts.length,
      failureCount: failureRecords.length,
      commands: unique(failureRecords.map((record) => record.command)),
      runners: unique(failureRecords.map((record) => record.runner)),
      platforms: unique(failureRecords.map((record) => record.platform)),
      screenshotPaths: unique(
        failureRecords.map((record) => record.screenshotPath).filter(Boolean),
      ),
      nextActions: unique(failureRecords.map((record) => record.nextAction)),
    },
    failureRecords,
    validation,
  };
}

function validateFailureRecords(records) {
  const errors = [];
  const warnings = [];
  if (!records.length) {
    warnings.push("No failure records found.");
  }
  records.forEach((record, index) => {
    for (const field of ["command", "runner", "platform", "rawSummary", "nextAction"]) {
      if (!optionalText(record[field])) {
        errors.push(`failureRecords[${index}].${field} is required`);
      }
    }
    if (!optionalText(record.screenshotPath)) {
      warnings.push(`failureRecords[${index}].screenshotPath is empty`);
    }
  });
  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

function dedupeRecords(records) {
  const seen = new Set();
  const result = [];
  for (const record of records) {
    const key = [record.sourceFile, record.command, record.runner, record.message].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(record);
  }
  return result;
}

function summarizeRaw(value, diagnostics) {
  const parts = [
    value.rawSummary,
    value.outputTail,
    value.stderrTail,
    value.stdoutTail,
    value.error,
    value.reason,
    value.failureReason,
    diagnostics && diagnostics.failureReason,
    diagnostics && diagnostics.fallbackReason,
    arraySummary("rawPreview", diagnostics && diagnostics.rawPreview),
    arraySummary("ocrPreview", diagnostics && diagnostics.ocrPreview),
  ]
    .map(optionalText)
    .filter(Boolean);
  if (parts.length) return compact(parts.join(" | "), 700);
  return compact(JSON.stringify(value), 700);
}

function arraySummary(label, value) {
  return Array.isArray(value) && value.length
    ? `${label}=${value.slice(0, 5).map(optionalText).filter(Boolean).join(" / ")}`
    : "";
}

function inferCommandFromSource(source) {
  const basename = path.basename(String(source || "")).toLowerCase();
  if (basename.includes("contact-add")) return "contact-add";
  if (basename.includes("moments-marketing")) return "moments-marketing";
  if (basename.includes("moments-publish")) return "moments-publish";
  if (basename.includes("group")) return "group-broadcast";
  if (basename.includes("chat-history")) return "chat-history";
  if (basename.includes("contact")) return "contacts";
  return "";
}

function inferNextAction(message, runner, screenshotPath) {
  const text = `${message} ${runner}`;
  if (/unsupported|not-windows|windows/i.test(text)) {
    return "Run the task on a Windows desktop with WeChat open and export diagnostics again.";
  }
  if (/permission|access|uia|screen/i.test(text)) {
    return "Grant desktop control or UIA permissions, reopen the WeChat target screen, then retry.";
  }
  if (/db|sqlite|encrypted|locked|helper/i.test(text)) {
    return "Check the WeChat DB helper, sqlite path, and file lock state before retrying.";
  }
  if (!screenshotPath) {
    return "Capture a screenshot path on the next retry so the evidence chain can prove the active WeChat window.";
  }
  return "Inspect rawSummary, runner status, platform, and screenshot, then rerun diagnostics after fixing the blocker.";
}

function findScreenshotPath(value, depth = 0) {
  if (depth > 5 || !value) return "";
  if (typeof value === "string") {
    return /\.(png|jpe?g|webp)$/i.test(value) ? value : "";
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findScreenshotPath(item, depth + 1);
      if (found) return found;
    }
    return "";
  }
  if (!isRecord(value)) return "";
  const direct = firstText(value.screenshotPath, value.screenshot, value.path, value.value, value.url);
  if (direct && /\.(png|jpe?g|webp)$/i.test(direct)) return direct;
  for (const entry of Object.values(value)) {
    const found = findScreenshotPath(entry, depth + 1);
    if (found) return found;
  }
  return "";
}

function makeRecordId(source, command, message) {
  const raw = `${path.basename(source)}-${command}-${message}`;
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function firstText(...values) {
  for (const value of values) {
    const text = optionalText(value);
    if (text) return text;
  }
  return "";
}

function optionalText(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function compact(value, maxLength) {
  const text = optionalText(value) || String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function unique(values) {
  return [...new Set(values.map(optionalText).filter(Boolean))];
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value) {
  return isRecord(value) ? value : undefined;
}
