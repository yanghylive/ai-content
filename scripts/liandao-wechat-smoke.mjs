#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { readReleaseEvidence } from "./lib/release-evidence.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseEvidence = readReleaseEvidence();
const args = parseArgs(process.argv.slice(2));

const files = {
  matrix: "docs/liandao-wechat-acceptance-matrix.md",
  fieldMap: "docs/liandao-wechat-field-map.md",
  backendPackage: "backend/package.json",
  frontendPackage: "frontend/package.json",
  backendTsconfig: "backend/tsconfig.json",
  frontendTsconfig: "frontend/tsconfig.json",
  controller: "backend/src/modules/local-engine/local-engine.controller.ts",
  service: "backend/src/modules/local-engine/local-engine.service.ts",
  frontendApi: "frontend/src/lib/api/local-engine.ts",
  interactionSkills: "frontend/src/lib/ops-workbench/interaction-skills.ts",
  workbenchPage: "frontend/src/app/(dashboard)/workbench/wechat/page.tsx",
  workbenchClient: "frontend/src/app/(dashboard)/workbench/wechat/wechat-workbench-client.tsx",
  contactAddScript: "vendor/skillhub/wechat-contact-add/wechat-contact-add.applescript",
  autoReplyScript: "vendor/skillhub/wechat-auto-reply/wechat-dm.applescript",
  momentsPublishScript: "vendor/skillhub/wechat-moments-publish/wechat-moments-publish.applescript",
  momentsPublishShell: "vendor/skillhub/wechat-moments-publish/wechat-moments-publish.sh",
  chatSyncScript: "vendor/skillhub/wechat-chat-sync/wechat-chat-sync.py",
  momentsAssetsSmoke: "scripts/wechat-moments-assets-smoke.mjs",
  momentsCalibrateScript: "scripts/wechat-moments-calibrate.mjs",
  windowsContactsAcceptance: "scripts/wechat-windows-contacts-acceptance.mjs",
  windowsNativeCommandsAcceptance: "scripts/wechat-windows-native-commands-acceptance.mjs",
  nativeCommandContractSmoke: "scripts/wechat-native-command-contract-smoke.mjs",
  groupsPage: "frontend/src/app/(dashboard)/workbench/wechat-groups/page.tsx",
  momentsPage: "frontend/src/app/(dashboard)/workbench/wechat-moments/page.tsx",
  agents: "AGENTS.md",
};

const requiredApiContracts = [
  { method: "Get", path: "health" },
  { method: "Get", path: "readiness" },
  { method: "Get", path: "desktop/status" },
  { method: "Get", path: "desktop/preflight" },
  { method: "Get", path: "wechat/session/status", frontend: "/local-engine/wechat/session/status" },
  { method: "Post", path: "wechat/session/confirm", frontend: "/local-engine/wechat/session/confirm" },
  { method: "Post", path: "wechat/session/align", frontend: "/local-engine/wechat/session/align" },
  { method: "Post", path: "wechat/session/takeover", frontend: "/local-engine/wechat/session/takeover" },
  { method: "Post", path: "wechat/session/stop", frontend: "/local-engine/wechat/session/stop" },
  { method: "Get", path: "wechat/contacts", frontend: "/local-engine/wechat/contacts" },
  { method: "Get", path: "wechat/contacts/readiness", frontend: "/local-engine/wechat/contacts/readiness" },
  { method: "Post", path: "wechat/contacts", frontend: "/local-engine/wechat/contacts" },
  { method: "Get", path: "wechat/contacts/export", frontend: "/local-engine/wechat/contacts/export" },
  {
    method: "Get",
    path: "wechat/contacts/diagnostics/export",
    frontend: "/local-engine/wechat/contacts/diagnostics/export",
  },
  { method: "Delete", path: "wechat/contacts", frontend: "/local-engine/wechat/contacts" },
  { method: "Delete", path: "wechat/contacts/:wxid", frontend: "/local-engine/wechat/contacts/" },
  { method: "Post", path: "wechat/contacts/sync", frontend: "/local-engine/wechat/contacts/sync" },
  { method: "Get", path: "wechat/chat-sessions", frontend: "/local-engine/wechat/chat-sessions" },
  { method: "Get", path: "wechat/chat-history", frontend: "/local-engine/wechat/chat-history" },
  { method: "Post", path: "wechat/chat-history/sync", frontend: "/local-engine/wechat/chat-history/sync" },
  { method: "Get", path: "wechat/tasks", frontend: "/local-engine/wechat/tasks" },
  { method: "Post", path: "wechat/tasks", frontend: "/local-engine/wechat/tasks" },
  { method: "Get", path: "wechat/records", frontend: "/local-engine/wechat/records" },
  { method: "Get", path: "groups/tasks", frontend: "/local-engine/groups/tasks" },
  { method: "Post", path: "groups/tasks", frontend: "/local-engine/groups/tasks" },
  { method: "Get", path: "groups/records", frontend: "/local-engine/groups/records" },
  { method: "Get", path: "groups/plans", frontend: "/local-engine/groups/plans" },
  { method: "Post", path: "groups/plans", frontend: "/local-engine/groups/plans" },
  { method: "Get", path: "groups/plans/:id/detail-list", frontend: "/local-engine/groups/plans/" },
  { method: "Post", path: "groups/plans/:id/pause", frontend: "/local-engine/groups/plans/" },
  { method: "Post", path: "groups/plans/:id/resume", frontend: "/local-engine/groups/plans/" },
  { method: "Post", path: "groups/plans/:id/resend", frontend: "/local-engine/groups/plans/" },
  { method: "Delete", path: "groups/plans/:id", frontend: "/local-engine/groups/plans/" },
  { method: "Post", path: "groups/plans/:id/remove", frontend: "/local-engine/groups/plans/" },
  { method: "Post", path: "moments/tasks", frontend: "/local-engine/moments/tasks" },
  { method: "Get", path: "moments/tasks", frontend: "/local-engine/moments/tasks" },
  { method: "Get", path: "moments/records", frontend: "/local-engine/moments/records" },
  { method: "Get", path: "customers/tasks", frontend: "/local-engine/customers/tasks" },
  { method: "Post", path: "customers/tasks", frontend: "/local-engine/customers/tasks" },
  { method: "Get", path: "customers/records", frontend: "/local-engine/customers/records" },
  { method: "Get", path: "records/export", frontend: "/local-engine/records/export" },
  { method: "Post", path: "tasks/:id/approve", frontend: "/local-engine/tasks/" },
  { method: "Post", path: "tasks/:id/skip", frontend: "/local-engine/tasks/" },
  { method: "Post", path: "tasks/:id/fail", frontend: "/local-engine/tasks/" },
  { method: "Post", path: "tasks/:id/pause", frontend: "/local-engine/tasks/" },
  { method: "Post", path: "tasks/:id/resume", frontend: "/local-engine/tasks/" },
  { method: "Post", path: "tasks/:id/continue", frontend: "/local-engine/tasks/" },
  { method: "Post", path: "tasks/:id/retry", frontend: "/local-engine/tasks/" },
  { method: "Get", path: "tasks/:id/diagnostics/export", frontend: "/local-engine/tasks/" },
  { method: "Get", path: "reply-rules", frontend: "/local-engine/reply-rules" },
  { method: "Post", path: "reply-rules", frontend: "/local-engine/reply-rules" },
  { method: "Post", path: "reply/generate", frontend: "/local-engine/reply/generate" },
];

const requiredFrontendCheckpoints = [
  "微信任务",
  "普通群发",
  "添加好友",
  "朋友圈批量发布",
  "朋友圈营销",
  "联系人管理",
  "会话历史",
  "同步联系人",
  "创建任务",
  "保存计划",
  "计划列表",
  "知晓风险，谨慎启用",
  "关联微信号",
  "计划时间",
  "每日上限",
  { label: "联系人同步 random/all 风险确认按钮", all: ["开始随机同步", "开始同步全部好友"] },
  {
    label: "联系人同步风险说明",
    all: ["随机同步", "全部好友同步", "同步期间不要切换微信账号或关闭微信"],
  },
];

const requiredTaskTypes = [
  "wechat-reply-draft",
  "wechat-group-broadcast",
  "wechat-contact-add",
  "wechat-moments-publish",
  "wechat-moments-marketing",
];

const requiredVendorEntrypoints = [
  "vendor/skillhub/wechat-auto-reply/wechat-dm.sh",
  "vendor/skillhub/wechat-live-auto-reply/wechat-live-auto-reply.sh",
  "vendor/skillhub/wechat-contact-sync/wechat-contact-sync.py",
  "vendor/skillhub/wechat-contact-add/wechat-contact-add.sh",
  "vendor/skillhub/wechat-chat-sync/wechat-chat-sync.py",
  "vendor/skillhub/wechat-moments-publish/wechat-moments-publish.sh",
  "vendor/skillhub/wechat-moments-marketing/wechat-moments-marketing.sh",
];

const requiredMatrixSections = [
  "联系人库",
  "会话与聊天历史",
  "群发计划",
  "加好友计划",
  "朋友圈发布",
  "朋友圈营销",
  "本地执行",
  "前端",
  "轻量自动验收",
  "12 天商用验收闭环",
  "真机验收矩阵",
];

const requiredMatrixFragments = [
  "联系人同步 random",
  "联系人同步 all",
  "群发",
  "加好友",
  "朋友圈发布",
  "朋友圈营销",
  "会话历史",
  "通过标准",
  "失败诊断",
  "证据文件",
  "Windows 10",
  "Windows 11",
  "Day 12",
];

const requiredWechatFieldContracts = [
  "wechat_plan_name",
  "wechat_plan_time",
  "wechat_plan_associated_wechat_id",
  "wechat_plan_kind",
  "wechat_mass_send_plan_type",
  "wechat_mass_send_chunked_sending",
  "wechat_mass_send_files",
  "wechat_mass_send_contents",
  "wechat_contact_add_verify_message",
  "wechat_contact_add_remark_strategy",
  "wechat_contact_add_remark_content",
  "wechat_contact_add_min_interval_seconds",
  "wechat_contact_add_max_interval_seconds",
  "wechat_moments_details",
  "wechat_moments_total_tasks",
  "wechat_moments_publish_interval_minutes",
  "wechat_moments_marketing_check_interval_minutes",
];

const taskTypesForRecordExport = [
  { type: "wechat-group-broadcast", item: "群发", label: "群发 records export" },
  { type: "wechat-contact-add", item: "加好友", label: "加好友 records export" },
  { type: "wechat-moments-publish", item: "朋友圈发布", label: "朋友圈发布 records export" },
  { type: "wechat-moments-marketing", item: "朋友圈营销", label: "朋友圈营销 records export" },
  { type: "wechat-reply-draft", item: "会话历史", label: "微信会话 records export" },
];

const liveConfig = {
  live: args.live || boolEnv("LIANDAO_SMOKE_LIVE"),
  strictLive: args.strictLive || boolEnv("LIANDAO_SMOKE_STRICT_LIVE"),
  realWechat: args.realWechat || boolEnv("LIANDAO_SMOKE_REAL_WECHAT"),
  noWrite: args.noWrite || boolEnv("LIANDAO_SMOKE_NO_WRITE"),
  baseUrl: trimTrailingSlash(args.baseUrl || process.env.LIANDAO_SMOKE_BASE_URL || "http://127.0.0.1:3011/api"),
  frontendUrl: trimTrailingSlash(args.frontendUrl || process.env.LIANDAO_SMOKE_FRONTEND_URL || "http://127.0.0.1:3010"),
  timeoutMs: positiveNumber(args.timeoutMs || process.env.LIANDAO_SMOKE_TIMEOUT_MS, 8000),
  randomSyncTimeoutMs: positiveNumber(args.randomSyncTimeoutMs || process.env.LIANDAO_SMOKE_RANDOM_SYNC_TIMEOUT_MS, 210000),
  allSyncTimeoutMs: positiveNumber(args.allSyncTimeoutMs || process.env.LIANDAO_SMOKE_ALL_SYNC_TIMEOUT_MS, 780000),
  cookie: args.cookie || process.env.LIANDAO_SMOKE_COOKIE || "",
  bearerToken: args.bearerToken || process.env.LIANDAO_SMOKE_BEARER_TOKEN || "",
  extraHeadersJson: args.headersJson || process.env.LIANDAO_SMOKE_HEADERS_JSON || "",
  chatSessionId: args.chatSessionId || process.env.LIANDAO_SMOKE_CHAT_SESSION_ID || "",
  taskIds: splitCsv(args.taskIds || process.env.LIANDAO_SMOKE_TASK_IDS || process.env.LIANDAO_SMOKE_DIAGNOSTIC_TASK_IDS || ""),
  evidenceDir:
    args.evidenceDir ||
    process.env.LIANDAO_SMOKE_EVIDENCE_DIR ||
    path.join(root, "docs", `acceptance-evidence-${new Date().toISOString().slice(0, 10)}`, "liandao-wechat-smoke"),
};

function readText(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function addResult(results, status, label, detail = "", options = {}) {
  results.push({
    status,
    label,
    detail,
    layer: options.layer || "static",
    item: options.item || "",
    evidence: options.evidence || "",
  });
}

function addStatic(results, ok, label, detail = "", options = {}) {
  addResult(results, ok ? "PASS" : "FAIL", label, detail, { ...options, layer: "static" });
}

function decoratorPattern(method, routePath) {
  const escaped = routePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`@${method}\\(\\s*['"\`]${escaped}['"\`]\\s*\\)`);
}

function packageHasDependency(packageJson, dependencyName) {
  return Boolean(packageJson.dependencies?.[dependencyName] || packageJson.devDependencies?.[dependencyName]);
}

function hasFrontendApiReference(frontendApi, contract) {
  if (!contract.frontend) return true;
  if (frontendApi.includes(contract.frontend)) return true;

  const businessRouteMatch = contract.frontend.match(/^\/local-engine\/(wechat|groups|moments|customers)\/(tasks|records)$/);
  if (!businessRouteMatch) return false;

  const [, route, collection] = businessRouteMatch;
  const hasRouteUnion = new RegExp(`\\|\\s*["']${route}["']`).test(frontendApi);
  const hasBusinessTemplate =
    collection === "tasks"
      ? frontendApi.includes("businessTasks(") &&
        frontendApi.includes("createBusinessTask(") &&
        frontendApi.includes("`/local-engine/${route}/tasks?")
      : frontendApi.includes("businessRecords(") &&
        frontendApi.includes("`/local-engine/${route}/records?");

  return hasRouteUnion && hasBusinessTemplate;
}

function checkpointPass(text, checkpoint) {
  if (typeof checkpoint === "string") return { ok: text.includes(checkpoint), label: checkpoint };
  if (checkpoint.all) return { ok: checkpoint.all.every((item) => text.includes(item)), label: checkpoint.label };
  if (checkpoint.any) return { ok: checkpoint.any.some((item) => text.includes(item)), label: checkpoint.label };
  return { ok: false, label: checkpoint.label || "unknown checkpoint" };
}

function runStaticChecks() {
  const results = [];

  for (const [key, relativePath] of Object.entries(files)) {
    addStatic(results, exists(relativePath), `required file: ${key}`, relativePath);
  }

  const controller = exists(files.controller) ? readText(files.controller) : "";
  const service = exists(files.service) ? readText(files.service) : "";
  const frontendApi = exists(files.frontendApi) ? readText(files.frontendApi) : "";
  const interactionSkills = exists(files.interactionSkills) ? readText(files.interactionSkills) : "";
  const client = exists(files.workbenchClient) ? readText(files.workbenchClient) : "";
  const matrix = exists(files.matrix) ? readText(files.matrix) : "";
  const agents = exists(files.agents) ? readText(files.agents) : "";
  const contactSyncScript = exists("vendor/skillhub/wechat-contact-sync/wechat-contact-sync.py")
    ? readText("vendor/skillhub/wechat-contact-sync/wechat-contact-sync.py")
    : "";
  const contactAddScript = exists(files.contactAddScript) ? readText(files.contactAddScript) : "";
  const autoReplyScript = exists(files.autoReplyScript) ? readText(files.autoReplyScript) : "";
  const momentsPublishScript = exists(files.momentsPublishScript) ? readText(files.momentsPublishScript) : "";
  const momentsPublishShell = exists(files.momentsPublishShell) ? readText(files.momentsPublishShell) : "";
  const chatSyncScript = exists(files.chatSyncScript) ? readText(files.chatSyncScript) : "";
  const momentsAssetsSmoke = exists(files.momentsAssetsSmoke) ? readText(files.momentsAssetsSmoke) : "";
  const momentsCalibrateScript = exists(files.momentsCalibrateScript) ? readText(files.momentsCalibrateScript) : "";
  const windowsContactsAcceptance = exists(files.windowsContactsAcceptance) ? readText(files.windowsContactsAcceptance) : "";
  const windowsNativeCommandsAcceptance = exists(files.windowsNativeCommandsAcceptance)
    ? readText(files.windowsNativeCommandsAcceptance)
    : "";
  const nativeCommandContractSmoke = exists(files.nativeCommandContractSmoke) ? readText(files.nativeCommandContractSmoke) : "";

  for (const contract of requiredApiContracts) {
    addStatic(
      results,
      decoratorPattern(contract.method, contract.path).test(controller),
      `backend API ${contract.method} /local-engine/${contract.path}`,
      files.controller,
    );
    if (contract.frontend) {
      addStatic(
        results,
        hasFrontendApiReference(frontendApi, contract),
        `frontend API reference ${contract.frontend}`,
        files.frontendApi,
      );
    }
  }

  for (const checkpoint of requiredFrontendCheckpoints) {
    const result = checkpointPass(client, checkpoint);
    addStatic(results, result.ok, `workbench checkpoint: ${result.label}`, files.workbenchClient);
  }

  for (const type of requiredTaskTypes) {
    addStatic(results, controller.includes(type), `backend accepts task type: ${type}`, files.controller);
    addStatic(results, frontendApi.includes(type), `frontend type includes: ${type}`, files.frontendApi);
    addStatic(results, client.includes(type), `workbench can create/filter: ${type}`, files.workbenchClient);
  }

  for (const routePage of [files.workbenchPage, files.groupsPage, files.momentsPage]) {
    addStatic(
      results,
      exists(routePage),
      `route page exists: /${routePage.replace(/^frontend\/src\/app\/\(dashboard\)\//, "").replace(/\/page\.tsx$/, "")}`,
      routePage,
    );
  }

  for (const vendorFile of requiredVendorEntrypoints) {
    addStatic(results, exists(vendorFile), `vendor executor entrypoint exists: ${vendorFile}`, vendorFile);
  }

  addStatic(
    results,
    contactSyncScript.includes("com.tencent.xinWeChat") && contactSyncScript.includes("validate_wechat_window"),
    "contact sync opens and validates desktop WeChat, not browser pages",
    "vendor/skillhub/wechat-contact-sync/wechat-contact-sync.py",
    { item: "联系人同步 random/all" },
  );
  addStatic(
    results,
    /抖音\|发布中心\|平台账号/.test(contactSyncScript) && contactSyncScript.includes("已拒绝同步通讯录"),
    "contact sync rejects Douyin/publishing-center OCR contamination",
    "vendor/skillhub/wechat-contact-sync/wechat-contact-sync.py",
    { item: "联系人同步 random/all" },
  );

  for (const section of requiredMatrixSections) {
    addStatic(results, matrix.includes(`## ${section}`), `matrix section exists: ${section}`, files.matrix);
  }

  for (const fragment of requiredMatrixFragments) {
    addStatic(results, matrix.includes(fragment), `matrix acceptance fragment: ${fragment}`, files.matrix);
  }

  for (const field of requiredWechatFieldContracts) {
    addStatic(results, interactionSkills.includes(field), `frontend emits WeChat contract field: ${field}`, files.interactionSkills);
    addStatic(results, service.includes(field), `backend normalizes WeChat contract field: ${field}`, files.service);
  }

  addStatic(
    results,
    client.includes("groupPlanType") && client.includes("groupChunkedSending") && client.includes("groupFilePaths"),
    "mass-send UI submits plan type, chunked sending, and files",
    files.workbenchClient,
    { item: "群发" },
  );
  addStatic(
    results,
    client.includes("contactRemarkStrategy") &&
      client.includes("contactMinIntervalSeconds") &&
      client.includes("contactMaxIntervalSeconds"),
    "contact-add UI submits remark strategy and execution interval",
    files.workbenchClient,
    { item: "加好友" },
  );
  addStatic(
    results,
    client.includes("momentsAdditionalComment") && client.includes("momentsPublishIntervalMinutes"),
    "moments publish UI submits additional comment and publish interval",
    files.workbenchClient,
    { item: "朋友圈发布" },
  );
  addStatic(
    results,
    client.includes("marketingCheckIntervalMinutes"),
    "moments marketing UI submits check interval",
    files.workbenchClient,
    { item: "朋友圈营销" },
  );
  addStatic(
    results,
    contactAddScript.includes("remarkStrategy") &&
      contactAddScript.includes("AI_CONTENT_WECHAT_CONTACT_REMARK_X") &&
      contactAddScript.includes("remarkContent"),
    "contact-add desktop script accepts and records remark fields",
    files.contactAddScript,
    { item: "加好友" },
  );
  addStatic(
    results,
    service.includes("readMomentsPublishDetails") &&
      service.includes("wechat-moments-publish") &&
      service.includes("additionalComment"),
    "moments publish executor runs structured detail records",
    files.service,
    { item: "朋友圈发布" },
  );
  addStatic(
    results,
    service.includes("wechat_mass_send_files") && service.includes("attachmentPaths"),
    "group broadcast executor passes attachment paths to desktop script",
    files.service,
    { item: "群发" },
  );
  addStatic(
    results,
    autoReplyScript.includes("pasteWechatAttachments") && autoReplyScript.includes("attachmentPaths"),
    "wechat auto-reply script can paste attachment files",
    files.autoReplyScript,
    { item: "群发" },
  );
  addStatic(
    results,
    momentsPublishScript.includes("assetPathsText") &&
      momentsPublishScript.includes("additionalComment") &&
      momentsPublishScript.includes("chooseMomentAssets") &&
      momentsPublishScript.includes("approval-calibrate"),
    "moments publish script accepts asset list and additional comment fields",
    files.momentsPublishScript,
    { item: "朋友圈发布" },
  );
  addStatic(
    results,
    momentsPublishShell.includes("IMAGE_COUNT") &&
      momentsPublishShell.includes("VIDEO_COUNT") &&
      momentsPublishShell.includes("validate-only") &&
      momentsPublishShell.includes("approval-calibrate") &&
      momentsPublishShell.includes("不能同时混选图片和视频"),
    "moments publish shell validates image/video count and mixed media rules",
    files.momentsPublishShell,
    { item: "朋友圈发布" },
  );
  addStatic(
    results,
    momentsAssetsSmoke.includes("validate-only") &&
      momentsAssetsSmoke.includes("10 images fail") &&
      momentsAssetsSmoke.includes("mixed image video fail"),
    "moments publish asset validation smoke covers image/video rule failures",
    files.momentsAssetsSmoke,
    { item: "朋友圈发布" },
  );
  addStatic(
    results,
    momentsCalibrateScript.includes("approval-calibrate") &&
      momentsCalibrateScript.includes("--run") &&
      momentsCalibrateScript.includes("validate-only"),
    "moments publish calibration helper validates first and requires --run for WeChat UI",
    files.momentsCalibrateScript,
    { item: "朋友圈发布" },
  );
  addStatic(
    results,
    windowsContactsAcceptance.includes("contacts/readiness") &&
      windowsContactsAcceptance.includes('mode: "random"') &&
      windowsContactsAcceptance.includes('mode: "all"') &&
      windowsContactsAcceptance.includes("WECHAT_ACCEPT_SIMULATOR") &&
      windowsContactsAcceptance.includes("contacts-diagnostics-export") &&
      windowsContactsAcceptance.includes("summary.md"),
    "Windows contacts acceptance script captures readiness, random/all sync, simulator, diagnostics, and summary evidence",
    files.windowsContactsAcceptance,
    { item: "联系人同步 random/all" },
  );
  addStatic(
    results,
    [
      "group-broadcast",
      "contact-add",
      "moments-publish",
      "moments-marketing",
      "chat-history",
    ].every((command) => nativeCommandContractSmoke.includes(command)) &&
      nativeCommandContractSmoke.includes("fake success is rejected") &&
      nativeCommandContractSmoke.includes("external runner success requires readback/evidence") &&
      (nativeCommandContractSmoke.includes("bundled runners reject non-Windows real execution") ||
        nativeCommandContractSmoke.includes("bundled runners are discoverable on Windows and dry-run safe")),
    "WeChat native command contract smoke covers 5 command runners and rejects fake success",
    files.nativeCommandContractSmoke,
    { item: "后端统一 runtime runner" },
  );
  addStatic(
    results,
    windowsNativeCommandsAcceptance.includes("wechat-native-command-contract-smoke") &&
      windowsNativeCommandsAcceptance.includes("wechat-native-bundled-runners-smoke") &&
      windowsNativeCommandsAcceptance.includes("wechat-native-external-runner-smoke") &&
      windowsNativeCommandsAcceptance.includes("contacts-native-runtime-real") &&
      windowsNativeCommandsAcceptance.includes("require-real-wechat") &&
      windowsNativeCommandsAcceptance.includes("summary.md"),
    "Windows native command acceptance writes evidence for runner contract, bundled/external runners, and real contacts runtime",
    files.windowsNativeCommandsAcceptance,
    { item: "Windows native runner 验收" },
  );
  addStatic(
    results,
    chatSyncScript.includes("VNRecognizeTextRequest") &&
      chatSyncScript.includes("macos-wechat-rpa-ocr") &&
      !chatSyncScript.includes("真实读取器尚未接入"),
    "chat-history script performs real macOS WeChat OCR instead of returning placeholder data",
    files.chatSyncScript,
    { item: "会话历史" },
  );

  addStatic(
    results,
    agents.includes("Agent-S is the primary executor") &&
      agents.includes("WeChat desktop tasks must not bypass Agent-S/local-controller"),
    "Agent-S/local-controller guardrail documented",
    files.agents,
  );
  addStatic(results, /syncWechatContacts|wechatContact/.test(service), "service includes contact sync/storage surface", files.service);
  addStatic(results, /syncWechatChatHistory|getWechatChatHistory|getWechatChatSessions/.test(service), "service includes chat history surface", files.service);
  addStatic(results, /pauseTask|resumeTask|continueTask|retryTask/.test(service), "service includes plan lifecycle controls", files.service);

  const backendPackage = exists(files.backendPackage) ? JSON.parse(readText(files.backendPackage)) : {};
  const frontendPackage = exists(files.frontendPackage) ? JSON.parse(readText(files.frontendPackage)) : {};
  addStatic(results, packageHasDependency(backendPackage, "typescript"), "backend typecheck command available: cd backend && npx tsc --noEmit", files.backendPackage);
  addStatic(results, packageHasDependency(frontendPackage, "typescript"), "frontend typecheck command available: cd frontend && npx tsc --noEmit", files.frontendPackage);
  addStatic(results, Boolean(backendPackage.scripts?.test), "backend unit test command available: cd backend && npm test", files.backendPackage);
  addStatic(results, Boolean(frontendPackage.scripts?.build), "frontend build command available: cd frontend && npm run build", files.frontendPackage);

  return results;
}

async function runLiveChecks() {
  const results = [];

  if (!liveConfig.live && !liveConfig.realWechat) {
    addResult(
      results,
      "SKIP",
      "live API/page probes skipped",
      "设置 LIANDAO_SMOKE_LIVE=1 或传 --live 可检查本地 API、诊断导出和页面状态。",
      { layer: "live" },
    );
    return results;
  }

  await probeGet(results, "backend health API", "/local-engine/health", "基础设施");
  await probeGet(results, "backend readiness API", "/local-engine/readiness", "基础设施");
  await probeGet(results, "desktop status API", "/local-engine/desktop/status", "Windows 真机预检");
  await probeGet(results, "desktop preflight API", "/local-engine/desktop/preflight", "Windows 真机预检");
  await probeGet(results, "WeChat session status API", "/local-engine/wechat/session/status", "Windows 真机预检");

  await probeGet(results, "联系人库 API", "/local-engine/wechat/contacts", "联系人同步 random/all");
  await probeGet(results, "联系人同步自检 API", "/local-engine/wechat/contacts/readiness", "联系人同步 random/all");
  await probeGet(results, "联系人导出 API", "/local-engine/wechat/contacts/export", "联系人同步 random/all");
  await probeGet(results, "联系人同步诊断导出 API", "/local-engine/wechat/contacts/diagnostics/export", "联系人同步 random/all");

  const sessionsProbe = await probeGet(results, "会话列表 API", "/local-engine/wechat/chat-sessions", "会话历史");
  const sessionId = liveConfig.chatSessionId || firstSessionId(sessionsProbe?.json);
  if (sessionId) {
    await probeGet(
      results,
      "会话历史 API",
      `/local-engine/wechat/chat-history?sessionId=${encodeURIComponent(sessionId)}&limit=20`,
      "会话历史",
    );
  } else {
    addResult(
      results,
      "SKIP",
      "会话历史 API",
      "未提供 LIANDAO_SMOKE_CHAT_SESSION_ID，且会话列表没有可自动选取的 sessionId。",
      { layer: "live", item: "会话历史" },
    );
  }

  await probeGet(results, "群发任务列表 API", "/local-engine/groups/tasks?limit=20", "群发");
  await probeGet(results, "群发计划列表 API", "/local-engine/groups/plans?limit=20", "群发");
  await probeGet(results, "群发记录 API", "/local-engine/groups/records?limit=20", "群发");
  await probeGet(results, "加好友任务列表 API", "/local-engine/customers/tasks?limit=20", "加好友");
  await probeGet(results, "加好友记录 API", "/local-engine/customers/records?limit=20", "加好友");
  await probeGet(results, "朋友圈任务列表 API", "/local-engine/moments/tasks?limit=20", "朋友圈发布/朋友圈营销");
  await probeGet(results, "朋友圈记录 API", "/local-engine/moments/records?limit=20", "朋友圈发布/朋友圈营销");

  for (const exportProbe of taskTypesForRecordExport) {
    await probeGet(
      results,
      exportProbe.label,
      `/local-engine/records/export?limit=200&type=${encodeURIComponent(exportProbe.type)}`,
      exportProbe.item,
    );
  }

  if (liveConfig.taskIds.length) {
    for (const taskId of liveConfig.taskIds) {
      await probeGet(
        results,
        `任务诊断导出 API: ${taskId}`,
        `/local-engine/tasks/${encodeURIComponent(taskId)}/diagnostics/export`,
        "诊断导出",
      );
    }
  } else {
    addResult(
      results,
      "SKIP",
      "任务诊断导出 API",
      "未设置 LIANDAO_SMOKE_TASK_IDS；真机回归应把群发/加好友/朋友圈任务 id 传入后导出诊断。",
      { layer: "live", item: "诊断导出" },
    );
  }

  await probePage(results, "微信工作台页面", "/workbench/wechat", "前端页面");
  await probePage(results, "微信群发页面", "/workbench/wechat-groups", "前端页面");
  await probePage(results, "朋友圈页面", "/workbench/wechat-moments", "前端页面");

  if (liveConfig.realWechat) {
    await probePost(
      results,
      "联系人同步 random 真机执行",
      "/local-engine/wechat/contacts/sync",
      { mode: "random" },
      "联系人同步 random",
      liveConfig.randomSyncTimeoutMs,
    );
    await probePost(
      results,
      "联系人同步 all 真机执行",
      "/local-engine/wechat/contacts/sync",
      { mode: "all" },
      "联系人同步 all",
      liveConfig.allSyncTimeoutMs,
    );
  } else {
    addResult(
      results,
      "SKIP",
      "联系人同步 random/all 真机执行",
      "默认不接管真实微信；设置 LIANDAO_SMOKE_REAL_WECHAT=1 或传 --real-wechat 后才会执行 random/all 同步。",
      { layer: "live", item: "联系人同步 random/all" },
    );
  }

  return results;
}

async function probeGet(results, label, urlPath, item) {
  return probeHttp(results, "GET", label, urlPath, undefined, item, liveConfig.timeoutMs);
}

async function probePost(results, label, urlPath, body, item, timeoutMs) {
  return probeHttp(results, "POST", label, urlPath, body, item, timeoutMs);
}

async function probeHttp(results, method, label, urlPath, body, item, timeoutMs) {
  try {
    const response = await requestJson(method, joinUrl(liveConfig.baseUrl, urlPath), body, timeoutMs);
    const status = classifyStatus(response.status);
    addResult(results, status, label, summarizeHttp(response), {
      layer: "live",
      item,
      evidence: evidenceFromResponse(response.json),
    });
    return response;
  } catch (error) {
    addResult(results, "FAIL", label, error.message, { layer: "live", item });
    return null;
  }
}

function joinUrl(baseUrl, urlPath) {
  return new URL(String(urlPath || "").replace(/^\/+/, ""), `${baseUrl}/`).toString();
}

async function probePage(results, label, urlPath, item) {
  try {
    const response = await requestRaw("GET", new URL(urlPath, `${liveConfig.frontendUrl}/`).toString(), undefined, liveConfig.timeoutMs);
    const body = response.text || "";
    const isMissing = response.status === 404;
    const isServerError = response.status >= 500;
    const status = isMissing || isServerError ? "FAIL" : classifyStatus(response.status);
    addResult(results, status, label, summarizeHttp(response), { layer: "live", item });
    return response;
  } catch (error) {
    addResult(results, "FAIL", label, error.message, { layer: "live", item });
    return null;
  }
}

async function requestJson(method, url, body, timeoutMs) {
  const response = await requestRaw(method, url, body, timeoutMs);
  if (!response.text) return { ...response, json: null };
  try {
    return { ...response, json: JSON.parse(response.text) };
  } catch {
    return { ...response, json: null };
  }
}

async function requestRaw(method, url, body, timeoutMs) {
  if (typeof fetch !== "function") {
    throw new Error("当前 Node 版本缺少 fetch；请使用 Node 18+ 运行 smoke。");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const headers = buildHeaders(body);
  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    return {
      url,
      status: response.status,
      ok: response.ok,
      contentType: response.headers.get("content-type") || "",
      text,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function buildHeaders(body) {
  const headers = {
    accept: "application/json, text/html;q=0.9, */*;q=0.8",
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (liveConfig.cookie) headers.cookie = liveConfig.cookie;
  if (liveConfig.bearerToken) headers.authorization = `Bearer ${liveConfig.bearerToken}`;

  if (liveConfig.extraHeadersJson) {
    try {
      const extra = JSON.parse(liveConfig.extraHeadersJson);
      if (extra && typeof extra === "object" && !Array.isArray(extra)) {
        for (const [key, value] of Object.entries(extra)) {
          if (typeof value === "string") headers[key] = value;
        }
      }
    } catch {
      // Keep smoke runnable; malformed optional headers are reflected in blocked API results.
    }
  }

  return headers;
}

function classifyStatus(status) {
  if (status >= 200 && status < 400) return "PASS";
  if (status === 401 || status === 403) return "BLOCKED";
  return "FAIL";
}

function summarizeHttp(response) {
  const suffix = response.json
    ? summarizeJson(response.json)
    : response.text
      ? response.text.replace(/\s+/g, " ").slice(0, 180)
      : "";
  return `HTTP ${response.status}${suffix ? `: ${suffix}` : ""}`;
}

function summarizeJson(json) {
  if (!json || typeof json !== "object") return "";
  const parts = [];
  if (json.status) parts.push(`status=${json.status}`);
  if (json.exportStatus) parts.push(`exportStatus=${json.exportStatus}`);
  if (json.count !== undefined) parts.push(`count=${json.count}`);
  if (json.total !== undefined) parts.push(`total=${json.total}`);
  if (json.filename) parts.push(`filename=${json.filename}`);
  if (json.nextAction) parts.push(`nextAction=${String(json.nextAction).slice(0, 80)}`);
  if (json.message) parts.push(`message=${String(json.message).slice(0, 80)}`);
  if (json.reason) parts.push(`reason=${String(json.reason).slice(0, 80)}`);
  return parts.join(", ");
}

function evidenceFromResponse(json) {
  if (!json || typeof json !== "object") return "";
  return (
    json.filename ||
    json.screenshotPath ||
    json.evidencePath ||
    json.diagnostics?.screenshotPath ||
    json.resultSummary?.diagnosticsHref ||
    json.resultSummary?.evidenceHref ||
    ""
  );
}

function firstSessionId(json) {
  if (!json || typeof json !== "object") return "";
  const sessions = Array.isArray(json.sessions) ? json.sessions : [];
  const first = sessions.find((session) => session?.id || session?.sessionId || session?.wxid || session?.targetName);
  return first?.id || first?.sessionId || first?.wxid || first?.targetName || "";
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const withoutPrefix = arg.slice(2);
    const [rawKey, inlineValue] = withoutPrefix.split("=", 2);
    const key = rawKey.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    if (inlineValue !== undefined) {
      parsed[key] = inlineValue;
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      parsed[key] = next;
      index += 1;
      continue;
    }
    parsed[key] = true;
  }
  return parsed;
}

function boolEnv(name) {
  return /^(1|true|yes|on)$/i.test(process.env[name] || "");
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function summarizeResults(results) {
  const summary = { PASS: 0, FAIL: 0, BLOCKED: 0, SKIP: 0 };
  for (const result of results) summary[result.status] = (summary[result.status] || 0) + 1;
  return summary;
}

function printResults(results, evidencePath) {
  const summary = summarizeResults(results);
  console.log("炼刀微信体系 smoke 检查");
  console.log(`root: ${root}`);
  console.log(`host: ${os.platform()} ${os.release()} ${os.arch()}`);
  console.log(`static: on`);
  console.log(`live: ${liveConfig.live || liveConfig.realWechat ? "on" : "off"}`);
  console.log(`realWechat: ${liveConfig.realWechat ? "on" : "off"}`);
  console.log(`passed: ${summary.PASS || 0}`);
  console.log(`failed: ${summary.FAIL || 0}`);
  console.log(`blocked: ${summary.BLOCKED || 0}`);
  console.log(`skipped: ${summary.SKIP || 0}`);
  if (evidencePath) console.log(`evidence: ${evidencePath}`);

  const important = results.filter((result) => result.status !== "PASS");
  if (important.length) {
    console.log("\n待处理项:");
    for (const result of important) {
      console.log(`- [${result.status}] ${result.label} (${result.detail || result.item || result.layer})`);
    }
  } else {
    console.log("\nOK: 静态合同、页面检查点、执行器入口和验收矩阵均存在。");
  }
}

function writeEvidence(results) {
  if (liveConfig.noWrite) return "";
  const generatedAt = new Date().toISOString();
  const report = {
    generatedAt,
    ...(releaseEvidence || {}),
    root,
    host: {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
    },
    config: {
      live: liveConfig.live,
      realWechat: liveConfig.realWechat,
      strictLive: liveConfig.strictLive,
      baseUrl: liveConfig.baseUrl,
      frontendUrl: liveConfig.frontendUrl,
      hasCookie: Boolean(liveConfig.cookie),
      hasBearerToken: Boolean(liveConfig.bearerToken),
      taskIds: liveConfig.taskIds,
    },
    summary: summarizeResults(results),
    results,
  };
  fs.mkdirSync(liveConfig.evidenceDir, { recursive: true });
  const file = path.join(liveConfig.evidenceDir, `liandao-wechat-smoke-${generatedAt.replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return file;
}

async function main() {
  const results = runStaticChecks();
  results.push(...(await runLiveChecks()));
  const evidencePath = writeEvidence(results);
  printResults(results, evidencePath);

  const staticFailed = results.some((result) => result.layer === "static" && result.status === "FAIL");
  const liveFailed = results.some((result) => result.layer === "live" && result.status === "FAIL");
  const blockedInStrictLive = liveConfig.strictLive && results.some((result) => result.layer === "live" && result.status === "BLOCKED");

  if (staticFailed || liveFailed || blockedInStrictLive) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
