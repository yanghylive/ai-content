#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  bindWindowsReleaseEvidence,
  hasWindowsReleaseEvidenceBinding,
  resolveWindowsReleaseEvidenceBinding,
  windowsReleaseEvidenceMarkdown,
  writeWindowsReleaseEvidenceManifest,
} from "./lib/windows-release-evidence-binding.mjs";

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseUrl = trimSlash(args.baseUrl || process.env.WECHAT_ACCEPT_BASE_URL || "http://127.0.0.1:3011");
const realRun = args.real || boolEnv("WECHAT_ACCEPT_REAL");
const simulatorRun = args.simulator || boolEnv("WECHAT_ACCEPT_SIMULATOR");
const runAll = args.all !== false && !boolEnv("WECHAT_ACCEPT_SKIP_ALL");
if (realRun && !isLoopbackBaseUrl(baseUrl)) {
  throw new Error(
    `real Windows contact acceptance must target the local installed runtime; rejected base URL ${baseUrl}`,
  );
}
const evidenceDir = path.resolve(
  args.evidenceDir ||
    process.env.WECHAT_ACCEPT_EVIDENCE_DIR ||
    path.join(
      root,
      "docs",
      "acceptance-evidence-" + new Date().toISOString().slice(0, 10),
      simulatorRun ? "windows-wechat-contacts-simulator" : "windows-wechat-contacts",
    ),
);
const releaseBinding = resolveWindowsReleaseEvidenceBinding({
  repoRoot: root,
  args,
  env: process.env,
  required: realRun,
});
const headers = buildHeaders();
const results = [];

fs.mkdirSync(evidenceDir, { recursive: true });
writeWindowsReleaseEvidenceManifest({
  evidenceDir,
  binding: releaseBinding,
  evidenceType: "windows-wechat-contacts",
});

if (simulatorRun) {
  runSimulator();
} else {
  await step("readiness", "GET", "/local-engine/wechat/contacts/readiness", "00-readiness.json");
  await step("contacts-before", "GET", "/local-engine/wechat/contacts", "01-contacts-before.json");

  if (realRun) {
    await step(
      "contacts-random-sync",
      "POST",
      "/local-engine/wechat/contacts/sync",
      "02-contacts-random-sync-result.json",
      { force: true, mode: "random" },
      Number(args.randomTimeoutMs || process.env.WECHAT_ACCEPT_RANDOM_TIMEOUT_MS || 240000),
    );
    if (runAll) {
      await step(
        "contacts-all-sync",
        "POST",
        "/local-engine/wechat/contacts/sync",
        "03-contacts-all-sync-result.json",
        { force: true, mode: "all" },
        Number(args.allTimeoutMs || process.env.WECHAT_ACCEPT_ALL_TIMEOUT_MS || 900000),
      );
    }
  } else {
    results.push({
      name: "contacts-real-sync",
      status: "skipped",
      message: "未传 --real，已跳过真实微信 random/all 同步。",
    });
  }

  await step("contacts-after", "GET", "/local-engine/wechat/contacts", "04-contacts-after.json");
  await step("contacts-export", "GET", "/local-engine/wechat/contacts/export", "05-contacts-export.json");
  await step(
    "contacts-diagnostics-export",
    "GET",
    "/local-engine/wechat/contacts/diagnostics/export",
    "06-contacts-diagnostics-export.json",
  );
}

writeSummary();

const failed = results.filter((item) => item.status === "failed");
console.log(`Windows 微信联系人验收证据：${evidenceDir}`);
console.log(`passed=${results.filter((item) => item.status === "passed").length} failed=${failed.length} skipped=${results.filter((item) => item.status === "skipped").length}`);
if (failed.length) {
  for (const item of failed) {
    console.log(`FAILED ${item.name}: ${item.message}`);
  }
  process.exit(1);
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    if (key === "real") {
      parsed.real = true;
      continue;
    }
    if (key === "simulator") {
      parsed.simulator = true;
      continue;
    }
    if (key === "skip-all") {
      parsed.all = false;
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      parsed[toCamel(key)] = next;
      i += 1;
    } else {
      parsed[toCamel(key)] = true;
    }
  }
  return parsed;
}

function runSimulator() {
  const syncedAt = new Date().toISOString();
  const allContacts = [
    contact("wxid_sim_001", "海选007", "海选007", ["老客户"]),
    contact("wxid_sim_002", "何长龙", "何长龙", ["意向客户"]),
    contact("wxid_sim_003", "A0000秦大江奥特莱", "A0000秦大江奥特莱", ["渠道"]),
    contact("wxid_sim_004", "A00-法律服务、信用", "A00-法律服务、信用", ["合作"]),
    contact("wxid_sim_005", "张庄（时惠儿）", "张庄（时惠儿）", ["复购"]),
    contact("wxid_sim_006", "田园", "田园", ["朋友"]),
  ];
  const randomContacts = allContacts.slice(0, 3);
  const diagnostics = {
    stage: "simulator-windows-contacts",
    source: "windows-wechat-contacts-simulator",
    engine: "kaypal-local-simulator",
    engineVersion: "1",
    pagesScanned: runAll ? 3 : 1,
    dbContactCount: allContacts.length,
    uiaContactCount: allContacts.length,
    rawTextCount: allContacts.length,
    warnings: [
      "这是本机模拟器证据，用于验证 random/all 同步合同、导出和诊断链路，不代表 Windows 真机已通过。",
    ],
  };

  writeSimulatorRecord("readiness", "00-readiness.json", {
    ready: true,
    status: "ready",
    platform: "win32-simulator",
    modeSupport: { random: true, all: true },
    cached: { count: 0, source: "simulator-empty" },
    checks: [
      {
        key: "simulator",
        name: "Windows 本机模拟器",
        status: "ready",
        message: "模拟器已接管联系人同步合同，可验证 random/all 流程。",
      },
    ],
    blockers: [],
    warnings: [],
    nextAction: "可以运行模拟 random/all 同步。",
  });
  writeSimulatorRecord("contacts-before", "01-contacts-before.json", {
    count: 0,
    source: "simulator-empty",
    items: [],
  });
  writeSimulatorRecord("contacts-random-sync", "02-contacts-random-sync-result.json", {
    count: randomContacts.length,
    source: "windows-wechat-contacts-simulator-random",
    syncedAt,
    mode: "random",
    items: randomContacts,
    diagnostics: { ...diagnostics, pagesScanned: 1, uiaContactCount: randomContacts.length },
  });
  if (runAll) {
    writeSimulatorRecord("contacts-all-sync", "03-contacts-all-sync-result.json", {
      count: allContacts.length,
      source: "windows-wechat-contacts-simulator-all",
      syncedAt,
      mode: "all",
      items: allContacts,
      diagnostics,
    });
  } else {
    results.push({
      name: "contacts-all-sync",
      status: "skipped",
      message: "已传 --skip-all，模拟器跳过全部好友同步。",
    });
  }
  writeSimulatorRecord("contacts-after", "04-contacts-after.json", {
    count: runAll ? allContacts.length : randomContacts.length,
    source: runAll ? "windows-wechat-contacts-simulator-all" : "windows-wechat-contacts-simulator-random",
    syncedAt,
    items: runAll ? allContacts : randomContacts,
    diagnostics,
  });
  writeSimulatorRecord("contacts-export", "05-contacts-export.json", {
    filename: `wechat-contacts-simulator-${Date.now()}.json`,
    mimeType: "application/json",
    count: runAll ? allContacts.length : randomContacts.length,
    items: runAll ? allContacts : randomContacts,
  });
  writeSimulatorRecord("contacts-diagnostics-export", "06-contacts-diagnostics-export.json", {
    filename: `wechat-contact-sync-diagnostics-simulator-${Date.now()}.json`,
    mimeType: "application/json",
    diagnostics,
  });
}

function contact(wxid, nickname, remark, tags) {
  return { wxid, nickname, remark, tags };
}

function writeSimulatorRecord(name, filename, response) {
  const now = new Date().toISOString();
  writeEvidenceJson(filename, {
    name,
    simulator: true,
    ok: true,
    statusCode: 200,
    startedAt: now,
    completedAt: now,
    response,
  });
  results.push({ name, status: "passed", evidence: filename });
}

function writeEvidenceJson(filename, value) {
  const record = bindWindowsReleaseEvidence(value, releaseBinding);
  fs.writeFileSync(
    path.join(evidenceDir, filename),
    `${JSON.stringify(record, null, 2)}\n`,
    "utf8",
  );
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function boolEnv(name) {
  return /^(1|true|yes|on)$/i.test(String(process.env[name] || ""));
}

function trimSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function isLoopbackBaseUrl(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname);
  } catch {
    return false;
  }
}

function buildHeaders() {
  const output = { Accept: "application/json" };
  const cookie = args.cookie || process.env.WECHAT_ACCEPT_COOKIE || process.env.LIANDAO_SMOKE_COOKIE;
  const bearer = args.bearerToken || process.env.WECHAT_ACCEPT_BEARER_TOKEN || process.env.LIANDAO_SMOKE_BEARER_TOKEN;
  if (cookie) output.Cookie = cookie;
  if (bearer) output.Authorization = `Bearer ${bearer}`;
  return output;
}

async function step(name, method, urlPath, filename, body, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = new Date().toISOString();
  try {
    const response = await fetch(`${baseUrl}${urlPath}`, {
      method,
      headers: body
        ? { ...headers, "Content-Type": "application/json" }
        : headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    const payload = parseJson(text);
    const record = {
      name,
      method,
      url: `${baseUrl}${urlPath}`,
      ok: response.ok,
      statusCode: response.status,
      startedAt,
      completedAt: new Date().toISOString(),
      response: payload ?? text,
    };
    writeEvidenceJson(filename, record);
    if (!response.ok || isApiFailure(payload)) {
      results.push({
        name,
        status: "failed",
        message: extractMessage(payload) || `HTTP ${response.status}`,
        evidence: filename,
      });
      return;
    }
    results.push({ name, status: "passed", evidence: filename });
  } catch (error) {
    const record = {
      name,
      method,
      url: `${baseUrl}${urlPath}`,
      ok: false,
      startedAt,
      completedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    };
    writeEvidenceJson(filename, record);
    results.push({
      name,
      status: "failed",
      message: record.error,
      evidence: filename,
    });
  } finally {
    clearTimeout(timer);
  }
}

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isApiFailure(payload) {
  if (!payload || typeof payload !== "object") return false;
  if ("success" in payload) return payload.success !== true;
  return payload.ok === false;
}

function extractMessage(payload) {
  if (!payload || typeof payload !== "object") return "";
  if (typeof payload.message === "string") return payload.message;
  if (typeof payload.error === "string") return payload.error;
  if (payload.response && typeof payload.response === "object") {
    return extractMessage(payload.response);
  }
  return "";
}

function writeSummary() {
  const lines = [
    "# Windows 微信联系人验收",
    "",
    `- 证据目录：${evidenceDir}`,
    `- API：${baseUrl}`,
    ...(simulatorRun
      ? [
          "- 模拟器：已启用",
          "- 说明：这是本机模拟器证据，只验证 random/all 合同、诊断和导出链路，不等同 Windows 真机通过。",
        ]
      : []),
    `- 真实同步：${realRun ? "已启用" : "未启用"}`,
    ...windowsReleaseEvidenceMarkdown(releaseBinding),
    `- 生成时间：${new Date().toISOString()}`,
    "",
    "| 步骤 | 结果 | 证据 |",
    "| --- | --- | --- |",
    ...results.map((item) => `| ${item.name} | ${item.status} | ${item.evidence || item.message || ""} |`),
    "",
    "## 复跑命令",
    "",
    "```bash",
    `node scripts/wechat-windows-contacts-acceptance.mjs${simulatorRun ? " --simulator" : ""}${realRun ? " --real" : ""} --base-url ${baseUrl}${hasWindowsReleaseEvidenceBinding(releaseBinding) ? ` --app-version ${releaseBinding.appVersion} --installer-sha256 ${releaseBinding.installerSha256}` : ""} --evidence-dir ${JSON.stringify(evidenceDir)}`,
    "```",
    "",
  ];
  fs.writeFileSync(path.join(evidenceDir, "summary.md"), lines.join("\n"));
}
