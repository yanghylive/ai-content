#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { cpus, platform, release, type } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  bindWindowsReleaseEvidence,
  resolveWindowsReleaseEvidenceBinding,
  windowsReleaseEvidenceMarkdown,
  writeWindowsReleaseEvidenceManifest,
} from "./lib/windows-release-evidence-binding.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const generatedAt = new Date().toISOString();
const runnerRoot = resolve(
  args.runnerRoot ||
    process.env.WECHAT_NATIVE_ACCEPT_RUNNER_ROOT ||
    join(root, "desktop", "runtime", "wechat-native-runners"),
);
const evidenceDir = resolve(
  args.evidenceDir ||
    process.env.WECHAT_NATIVE_ACCEPT_EVIDENCE_DIR ||
    join(
      root,
      "docs",
      `acceptance-evidence-${generatedAt.slice(0, 10)}`,
      args.simulator ? "windows-wechat-native-commands-simulator" : "windows-wechat-native-commands",
    ),
);
const requireRealWechat =
  args.requireRealWechat || /^(1|true|yes|on)$/i.test(process.env.WECHAT_NATIVE_ACCEPT_REQUIRE_REAL_WECHAT || "");
const requireRealWechatCommands =
  args.requireRealWechatCommands ||
  /^(1|true|yes|on)$/i.test(process.env.WECHAT_NATIVE_ACCEPT_REQUIRE_REAL_WECHAT_COMMANDS || "");
const runContacts =
  args.contacts !== false &&
  (args.contacts === true || platform() === "win32" || /^(1|true|yes|on)$/i.test(process.env.WECHAT_NATIVE_ACCEPT_CONTACTS || ""));
const runCommands =
  args.commands !== false &&
  (args.commands === true ||
    platform() === "win32" ||
    /^(1|true|yes|on)$/i.test(process.env.WECHAT_NATIVE_ACCEPT_COMMANDS || ""));
const releaseBinding = resolveWindowsReleaseEvidenceBinding({
  repoRoot: root,
  args,
  env: process.env,
  required: requireRealWechat || requireRealWechatCommands,
});
const nativeCommands = [
  "group-broadcast",
  "contact-add",
  "friend-accept",
  "moments-publish",
  "moments-marketing",
  "chat-history",
];

mkdirSync(evidenceDir, { recursive: true });
writeWindowsReleaseEvidenceManifest({
  evidenceDir,
  binding: releaseBinding,
  evidenceType: "windows-wechat-native-commands",
  generatedAt,
});

const results = [];
writeJson("00-env.json", {
  generatedAt,
  root,
  platform: platform(),
  osPlatform: releaseBinding.osPlatform,
  candidateArchitecture: releaseBinding.candidateArchitecture,
  osArchitecture: releaseBinding.osArchitecture,
  processArch: releaseBinding.processArch,
  osArchitectureSource: releaseBinding.osArchitectureSource,
  os: `${type()} ${release()}`,
  node: process.version,
  cpus: cpus().length,
  simulator: Boolean(args.simulator),
  requireRealWechat,
  requireRealWechatCommands,
  runContacts,
  runCommands,
  nativeCommands,
  runnerRoot,
});

recordSourceSmokeIfAvailable(
  "01-command-contract-smoke.txt",
  "wechat-native-command-contract-smoke",
  "scripts/wechat-native-command-contract-smoke.mjs",
);
recordSourceSmokeIfAvailable(
  "02-bundled-runners-smoke.txt",
  "wechat-native-bundled-runners-smoke",
  "scripts/wechat-native-bundled-runners-smoke.mjs",
);
recordSourceSmokeIfAvailable(
  "03-external-runner-smoke.txt",
  "wechat-native-external-runner-smoke",
  "scripts/wechat-native-external-runner-smoke.mjs",
);

if (runContacts) {
  recordContactsRuntime();
} else {
  results.push({
    name: "contacts-native-runtime-real",
    status: "skipped",
    evidence: null,
    message: "未在 Windows 环境，或未传 --contacts，已跳过真实联系人 runtime。",
  });
}

if (runCommands) {
  for (const command of nativeCommands) {
    recordNativeCommandRuntime(command);
  }
} else {
  for (const command of nativeCommands) {
    results.push({
      name: `native-command-real:${command}`,
      status: "skipped",
      required: requireRealWechatCommands,
      evidence: null,
      message: "未在 Windows 环境，或传入 --skip-commands，已跳过真实 native 命令验收。",
    });
  }
}

const summary = {
  generatedAt,
  evidenceDir,
  appVersion: releaseBinding.appVersion,
  installerSha256: releaseBinding.installerSha256,
  candidateArchitecture: releaseBinding.candidateArchitecture,
  osPlatform: releaseBinding.osPlatform,
  osArchitecture: releaseBinding.osArchitecture,
  processArch: releaseBinding.processArch,
  osArchitectureSource: releaseBinding.osArchitectureSource,
  platform: platform(),
  simulator: Boolean(args.simulator),
  requireRealWechat,
  requireRealWechatCommands,
  results,
  counts: {
    passed: results.filter((item) => item.status === "passed").length,
    blocked: results.filter((item) => item.status === "blocked").length,
    failed: results.filter((item) => item.status === "failed").length,
    skipped: results.filter((item) => item.status === "skipped").length,
  },
};

writeJson("summary.json", summary);
writeFileSync(join(evidenceDir, "summary.md"), renderMarkdown(summary), "utf8");

console.log(`Windows 微信 native 命令验收证据：${evidenceDir}`);
console.log(
  `passed=${summary.counts.passed} blocked=${summary.counts.blocked} failed=${summary.counts.failed} skipped=${summary.counts.skipped}`,
);

const failedRequired = results.filter((item) => item.required && item.status !== "passed");
if (failedRequired.length) {
  for (const item of failedRequired) {
    console.log(`FAILED ${item.name}: ${item.message || ""}`);
  }
  process.exit(1);
}

function recordScript(filename, name, command) {
  const result = run(command, { timeoutMs: Number(args.smokeTimeoutMs || 120000) });
  const body = [
    `$ ${command.join(" ")}`,
    `exit=${result.status}`,
    "--- stdout ---",
    result.stdout,
    "--- stderr ---",
    result.stderr,
  ].join("\n");
  writeFileSync(join(evidenceDir, filename), body, "utf8");
  const passed = result.status === 0;
  results.push({
    name,
    status: passed ? "passed" : "failed",
    required: true,
    evidence: filename,
    message: passed ? "smoke passed" : trimText(result.stderr || result.stdout || `exit ${result.status}`, 500),
  });
}

function recordSourceSmokeIfAvailable(filename, name, relativeScript) {
  const scriptPath = join(root, relativeScript);
  if (!existsSync(scriptPath)) {
    results.push({
      name,
      status: "skipped",
      required: false,
      evidence: null,
      message: `安装目录验收不要求完整源码树，已跳过缺失的源码 smoke：${scriptPath}`,
    });
    return;
  }
  recordScript(filename, name, ["node", scriptPath]);
}

function recordNativeCommandRuntime(command) {
  const runnerPath = resolveNativeRunner(command);
  if (!existsSync(runnerPath)) {
    results.push({
      name: `native-command-real:${command}`,
      status: "failed",
      required: requireRealWechatCommands,
      evidence: null,
      message: `runner not found: ${runnerPath}`,
    });
    return;
  }

  const request = requestForNativeCommand(command);
  const commandLine = runnerPath.toLowerCase().endsWith(".js")
    ? ["node", runnerPath, command]
    : [runnerPath, command];
  const result = run(commandLine, {
    input: JSON.stringify(request),
    timeoutMs: Number(args.commandsTimeoutMs || 240000),
  });
  const parsed = parseLastJson(result.stdout);
  const copiedEvidence = copyRunnerEvidence(command, parsed);
  const filename = `05-native-command-${command}.json`;
  writeJson(filename, {
    command: commandLine,
    exit: result.status,
    request,
    parsed,
    copiedEvidence,
    stdoutTail: trimText(result.stdout, 12000),
    stderrTail: trimText(result.stderr, 6000),
  });
  const evaluation = evaluateNativeCommand(command, parsed, copiedEvidence);
  results.push({
    name: `native-command-real:${command}`,
    status: evaluation.status,
    required: requireRealWechatCommands,
    evidence: filename,
    message: evaluation.message,
    diagnostics: evaluation.diagnostics,
  });
}

function resolveNativeRunner(command) {
  const candidates = [
    join(runnerRoot, `kaypal-wechat-${command}-runner.exe`),
    join(runnerRoot, `kaypal-wechat-${command}-runner.js`),
    join(runnerRoot, `wechat-${command}-runner.exe`),
    join(runnerRoot, `wechat-${command}-runner.js`),
  ];
  return candidates.find((candidate) => existsSync(candidate)) || candidates[1];
}

function requestForNativeCommand(command) {
  const sendMode = args.sendMode || process.env.WECHAT_NATIVE_ACCEPT_SEND_MODE || "approval";
  const targetName =
    args.targetName ||
    process.env.WECHAT_NATIVE_ACCEPT_TARGET_NAME ||
    process.env.WECHAT_NATIVE_ACCEPT_TARGET ||
    "Kaypal验收目标";
  const targetSearch =
    args.targetSearch ||
    process.env.WECHAT_NATIVE_ACCEPT_TARGET_SEARCH ||
    process.env.WECHAT_NATIVE_ACCEPT_TARGET ||
    targetName;
  const sampleText =
    args.sampleText || process.env.WECHAT_NATIVE_ACCEPT_SAMPLE_TEXT || `Kaypal 微信真机验收 ${generatedAt}`;
  const commentText =
    args.commentText || process.env.WECHAT_NATIVE_ACCEPT_COMMENT_TEXT || `Kaypal 评论验收 ${generatedAt}`;
  const base = {
    contractVersion: "2026-06-26.wechat-native-v1",
    command,
    context: {
      runId: `wechat-native-commands-acceptance-${command}-${Date.now()}`,
      timeoutMs: Number(args.commandRuntimeTimeoutMs || 180000),
      safety: {
        sendMode,
        dryRun: false,
        readbackRequired: true,
      },
    },
  };
  if (command === "group-broadcast") {
    return {
      ...base,
      input: {
        targets: [{ id: targetSearch, displayName: targetName, searchText: targetSearch }],
        message: { text: sampleText, attachments: splitList(args.assetPaths || process.env.WECHAT_NATIVE_ACCEPT_ASSET_PATHS || "") },
      },
    };
  }
  if (command === "contact-add") {
    return {
      ...base,
      input: {
        targets: [{ id: targetSearch, displayName: targetName, searchText: targetSearch, verifyMessage: sampleText }],
        verifyMessage: sampleText,
      },
    };
  }
  if (command === "friend-accept") {
    const friendKeyword =
      args.friendAcceptKeyword ||
      process.env.WECHAT_NATIVE_ACCEPT_FRIEND_KEYWORD ||
      `KAYPAL-TEST-FRIEND-${generatedAt.replace(/[^0-9]/g, "").slice(0, 14)}`;
    return {
      ...base,
      input: {
        remark: {
          strategy: "manual",
          value:
            args.friendAcceptRemark ||
            process.env.WECHAT_NATIVE_ACCEPT_FRIEND_REMARK ||
            "Kaypal真机验收",
        },
        welcomeMessage:
          args.friendAcceptWelcome ||
          process.env.WECHAT_NATIVE_ACCEPT_FRIEND_WELCOME ||
          sampleText,
        matchKeywords: [friendKeyword],
        dailyLimit: 1,
      },
    };
  }
  if (command === "moments-publish") {
    return {
      ...base,
      input: {
        content: {
          text: sampleText,
          assets: splitList(args.momentsAssetPaths || args.assetPaths || process.env.WECHAT_NATIVE_ACCEPT_MOMENTS_ASSET_PATHS || ""),
        },
      },
    };
  }
  if (command === "moments-marketing") {
    return {
      ...base,
      input: {
        mode: "random",
        actions: { browse: true, like: false, comment: true },
        browseLimit: Number(args.marketingBrowseLimit || process.env.WECHAT_NATIVE_ACCEPT_MARKETING_BROWSE_LIMIT || 1),
        comment: { mode: "fixed", fixedText: commentText },
      },
    };
  }
  return {
    ...base,
    input: {
      action: "sync",
      sessionId: args.chatSessionId || process.env.WECHAT_NATIVE_ACCEPT_CHAT_SESSION_ID || "",
      limit: Number(args.chatLimit || process.env.WECHAT_NATIVE_ACCEPT_CHAT_LIMIT || 30),
    },
  };
}

function evaluateNativeCommand(command, parsed, copiedEvidence) {
  if (!parsed) {
    return { status: "failed", message: "runner did not return JSON" };
  }
  const errorCode = String(parsed.errorCode || "");
  const blockedCodes =
    /approval_required|wechat_not_running|wechat_not_logged_in|permission_missing|unsupported_platform|runtime_unavailable|target_missing|target_not_found|target_ambiguous|risk_prompt_detected/i;
  if (parsed.ok !== true) {
    return {
      status: blockedCodes.test(errorCode) ? "blocked" : "failed",
      message: trimText(parsed.nextAction || parsed.error || parsed.message || errorCode, 900),
      diagnostics: {
        errorCode,
        stage: parsed.diagnostics?.stage,
        status: parsed.status,
      },
    };
  }
  const output = parsed.output || {};
  if (command === "chat-history") {
    const sessions = Array.isArray(output.sessions) ? output.sessions : [];
    const messages = Array.isArray(output.messages) ? output.messages : [];
    const readback = output.readback || {};
    const ok =
      output.source === "windows-wechat-uia" &&
      sessions.length > 0 &&
      messages.length > 0 &&
      readback.matched === true &&
      hasScreenshotEvidence(output, copiedEvidence);
    return {
      status: ok ? "passed" : "failed",
      message: ok
        ? `sessions=${sessions.length}; messages=${messages.length}; readback=matched`
        : "chat-history 缺少真实会话、消息、readback 或截图证据。",
      diagnostics: { source: output.source, sessions: sessions.length, messages: messages.length, readbackMatched: readback.matched },
    };
  }

  const readback = findCommandReadback(output);
  const attempted = parsed.raw?.realWechatActionAttempted === true;
  const ok = attempted && readback?.matched === true && hasScreenshotEvidence(output, copiedEvidence);
  return {
    status: ok ? "passed" : "failed",
    message: ok
      ? `realWechatActionAttempted=true; readback=matched; screenshots=${copiedEvidence.length}`
      : `缺少真实动作、readback 或截图证据：attempted=${attempted}, readback=${readback?.matched}, screenshots=${copiedEvidence.length}`,
    diagnostics: {
      attempted,
      readbackMatched: readback?.matched,
      screenshotCount: copiedEvidence.length,
      status: parsed.status,
      errorCode,
    },
  };
}

function findCommandReadback(output) {
  if (output?.readback) return output.readback;
  const results = Array.isArray(output?.results) ? output.results : [];
  return results.find((item) => item?.readback)?.readback || null;
}

function hasScreenshotEvidence(output, copiedEvidence) {
  if (copiedEvidence.length > 0) return true;
  const evidence = flattenEvidence(output);
  return evidence.some((item) => item?.type === "desktop_screenshot" && (item.sha256 || item.path));
}

function flattenEvidence(value) {
  const found = [];
  const stack = [value];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    if (current.type) found.push(current);
    for (const child of Object.values(current)) {
      if (child && typeof child === "object") stack.push(child);
    }
  }
  return found;
}

function copyRunnerEvidence(command, parsed) {
  const screenshots = new Set();
  collectScreenshotPaths(parsed, screenshots);
  const copied = [];
  let index = 0;
  for (const source of screenshots) {
    if (!source || !existsSync(source)) continue;
    index += 1;
    const target = join(evidenceDir, `screenshot-${command}-${index}.png`);
    try {
      copyFileSync(source, target);
      copied.push({ source, file: target });
    } catch {
      // keep evidence JSON even when temp screenshot cannot be copied
    }
  }
  return copied;
}

function collectScreenshotPaths(value, out) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectScreenshotPaths(item, out);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (/screenshotPath|path/i.test(key) && typeof child === "string" && /\.png$/i.test(child)) out.add(child);
    if (child && typeof child === "object") collectScreenshotPaths(child, out);
  }
}

function splitList(value) {
  return String(value || "")
    .split(/[,\n;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function recordContactsRuntime() {
  const runtimePath = join(root, "desktop/runtime/wechat-native-runtime/kaypal-wechat-native-runtime.js");
  if (!existsSync(runtimePath)) {
    results.push({
      name: "contacts-native-runtime-real",
      status: "failed",
      required: requireRealWechat,
      evidence: null,
      message: `runtime not found: ${runtimePath}`,
    });
    return;
  }

  const request = {
    command: "contacts",
    input: {
      action: "sync",
      mode: args.mode === "all" ? "all" : "random",
      includeDiagnostics: true,
    },
    context: {
      runId: `wechat-native-commands-acceptance-${Date.now()}`,
      safety: {
        sendMode: "read-only",
        dryRun: false,
        readbackRequired: true,
      },
    },
  };
  const result = run(["node", runtimePath, "contacts"], {
    input: JSON.stringify(request),
    timeoutMs: Number(args.contactsTimeoutMs || 240000),
  });
  const parsed = parseLastJson(result.stdout);
  const filename = "04-contacts-native-runtime-real.json";
  writeJson(filename, {
    command: ["node", runtimePath, "contacts"],
    exit: result.status,
    request,
    parsed,
    stdoutTail: trimText(result.stdout, 8000),
    stderrTail: trimText(result.stderr, 4000),
  });
  const contactCount = Number(parsed?.output?.count ?? parsed?.count ?? 0);
  const ok = parsed?.ok === true && contactCount > 0;
  const blocked =
    !ok &&
    parsed &&
    /wechat_not_running|wechat_not_logged_in|permission_missing|unsupported_platform|runtime_unavailable|target_missing|target_not_found|target_ambiguous/i.test(
      String(parsed.errorCode || ""),
    );
  results.push({
    name: "contacts-native-runtime-real",
    status: ok ? "passed" : blocked ? "blocked" : "failed",
    required: requireRealWechat,
    evidence: filename,
    message: ok
      ? `contacts=${contactCount}`
      : trimText(
          parsed?.nextAction ||
            parsed?.error ||
            parsed?.message ||
            parsed?.diagnostics?.failureReason ||
            result.stderr ||
            result.stdout,
          700,
        ),
    diagnostics: parsed?.diagnostics
      ? {
          stage: parsed.diagnostics.stage,
          windowStatus: parsed.diagnostics.windowStatus,
          dbStatus: parsed.diagnostics.dbStatus,
          helperStatus: parsed.diagnostics.helperStatus,
          uiaStatus: parsed.diagnostics.uiaStatus,
          failureLayer: parsed.diagnostics.failureLayer,
          failureReason: parsed.diagnostics.failureReason,
        }
      : undefined,
  });
}

function run(command, options = {}) {
  const executable = command[0] === "node" ? process.execPath : command[0];
  const result = spawnSync(executable, command.slice(1), {
    cwd: root,
    input: options.input,
    encoding: "utf8",
    timeout: options.timeoutMs || 120000,
    windowsHide: true,
    env: process.env,
  });
  return {
    status: result.status ?? (result.error ? 1 : 0),
    stdout: result.stdout || "",
    stderr: result.stderr || (result.error ? String(result.error.message || result.error) : ""),
  };
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    if (key === "simulator") {
      parsed.simulator = true;
      continue;
    }
    if (key === "contacts") {
      parsed.contacts = true;
      continue;
    }
    if (key === "skip-contacts") {
      parsed.contacts = false;
      continue;
    }
    if (key === "commands") {
      parsed.commands = true;
      continue;
    }
    if (key === "skip-commands") {
      parsed.commands = false;
      continue;
    }
    if (key === "require-real-wechat") {
      parsed.requireRealWechat = true;
      continue;
    }
    if (key === "require-real-wechat-commands") {
      parsed.requireRealWechatCommands = true;
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      parsed[toCamel(key)] = next;
      index += 1;
    } else {
      parsed[toCamel(key)] = true;
    }
  }
  return parsed;
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function writeJson(filename, value) {
  const record = bindWindowsReleaseEvidence(value, releaseBinding);
  writeFileSync(join(evidenceDir, filename), `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

function parseLastJson(value) {
  const lines = String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {
      // keep scanning
    }
  }
  return null;
}

function trimText(value, max) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function renderMarkdown(summary) {
  const lines = [
    "# Windows WeChat Native Commands Acceptance",
    "",
    `- Generated: ${summary.generatedAt}`,
    `- Platform: ${summary.platform}`,
    `- Simulator: ${summary.simulator ? "yes" : "no"}`,
    `- Require real WeChat success: ${summary.requireRealWechat ? "yes" : "no"}`,
    `- Require real WeChat commands success: ${summary.requireRealWechatCommands ? "yes" : "no"}`,
    ...windowsReleaseEvidenceMarkdown(releaseBinding),
    `- Runner root: ${runnerRoot}`,
    `- Counts: passed ${summary.counts.passed}, blocked ${summary.counts.blocked}, failed ${summary.counts.failed}, skipped ${summary.counts.skipped}`,
    "",
    "## Results",
    "",
  ];
  for (const item of summary.results) {
    lines.push(
      `- ${item.status.toUpperCase()} ${item.name}${item.required ? " (required)" : ""}${item.evidence ? ` -> ${item.evidence}` : ""}: ${item.message || ""}`,
    );
  }
  lines.push("");
  lines.push("## Rule");
  lines.push("");
  lines.push(
    "Core runner smoke failures block packaging. Real WeChat contact success is required by --require-real-wechat. The six native WeChat command runners are required by --require-real-wechat-commands and must return readback plus screenshot evidence. Friend acceptance additionally requires auto-send and an explicitly prepared test request whose text matches --friend-accept-keyword.",
  );
  lines.push("");
  return lines.join("\n");
}
