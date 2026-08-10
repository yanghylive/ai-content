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
    join(
      evidenceRoot,
      `p5-production-readiness-gate-${timestampForFile()}`,
    ),
);
const strict = args.strict;

const rows = buildRows();
const summary = summarize(rows);
const report = {
  generatedAt: new Date().toISOString(),
  evidenceDate,
  evidenceRoot,
  strict,
  status: summary.productionBlocked ? "BLOCKED_FOR_PRODUCTION" : "PASS",
  summary,
  rows,
};

writeReport(report);
printSummary(report);

if (strict && summary.productionBlocked) {
  process.exitCode = 1;
}

function buildRows() {
  const p4 = latestDirectoryReport("p4-business-journey-", "report.json");
  const commercialCopy = latestJsonFile(
    /^commercial-copy-browser-scan-.+\.json$/,
    (json) => Number(json.routeCount || 0) >= 100,
  );
  const consoleQuality = latestJsonFile(
    /^console-quality-browser-scan-.+\.json$/,
    (json) => Number(json.routeCount || 0) >= 100,
  );
  const growthGate = latestDirectoryReport(
    "growth-commercial-live-gate-",
    "summary.json",
  );
  const externalOps = latestDirectoryReport(
    "commercial-external-ops-smoke-",
    "summary.json",
  );
  const productionConfigGate = latestDirectoryReport(
    "p6-production-config-gate-",
    "report.json",
  );
  const billingGate = latestDirectoryReport(
    "p7-billing-entitlement-gate-",
    "report.json",
  );
  const thirdPartyCrmGate = latestDirectoryReport(
    "p8-third-party-crm-sync-gate-",
    "report.json",
  );
  const externalPublishGate = latestDirectoryReport(
    "p9-external-publish-readback-gate-",
    "report.json",
  );
  const windowsGate = latestWindowsReleaseEvidence();

  return [
    contentJourneyRow(p4),
    crmLocalRow(p4),
    commercialCopyRow(commercialCopy),
    consoleQualityRow(consoleQuality),
    authCommercialIdentityRow(growthGate),
    backupRestoreOpsRow(externalOps, productionConfigGate),
    growthLiveRow(growthGate),
    externalPublishRow(externalPublishGate),
    windowsDesktopRow(windowsGate),
    thirdPartyCrmRow(p4, thirdPartyCrmGate),
    billingWebhookRow(billingGate),
  ];
}

function contentJourneyRow(p4) {
  const pass = Boolean(p4?.json?.pass);
  const counts = p4?.json?.statusCounts || {};
  return row({
    id: "content-optimization-business-journey",
    lane: "can-launch-base",
    title: "创作优化到发布准备业务闭环",
    status: pass ? "PASS" : "BLOCKER",
    releaseBlocking: !pass,
    evidence: p4?.filePath,
    detail: pass
      ? `P4 业务旅程通过；PASS=${counts.PASS || 0}，FAIL=${counts.FAIL || 0}，BLOCKED=${counts.BLOCKED || 0}。`
      : "未找到通过的 P4 业务旅程报告。",
    nextAction: pass
      ? "保持 p4-business-journey-smoke 作为回归门禁。"
      : "先运行 node scripts/p4-business-journey-smoke.mjs 并修复失败项。",
  });
}

function crmLocalRow(p4) {
  const output = `${p4?.json?.artifacts?.crmOutput || ""}`;
  const pass = Boolean(p4?.json?.pass) && /PASS=13/.test(output);
  return row({
    id: "crm-local-write-rollback",
    lane: "can-launch-base",
    title: "CRM 本地导入写入和回滚",
    status: pass ? "PASS" : "BLOCKER",
    releaseBlocking: !pass,
    evidence: p4?.json?.artifacts?.crmEvidenceDir || p4?.filePath,
    detail: pass
      ? "CRM Phase 1 写入、回滚、时间线、批次台账、审计记录均通过。"
      : "未确认 CRM 写入-回滚子验收通过。",
    nextAction: pass
      ? "继续限定为本地 CRM 写入；外部 CRM 同步另走真账号门禁。"
      : "运行 P4 或 scripts/crm-commercial-phase1-smoke.mjs --api-only --destructive --confirm-local-crm-write。",
  });
}

function commercialCopyRow(scan) {
  const json = scan?.json || {};
  const pass =
    Number(json.routeCount || 0) >= 100 &&
    Number(json.failCount || 0) === 0 &&
    Number(json.consoleErrorCount || 0) === 0;
  return row({
    id: "frontend-commercial-copy-full-scan",
    lane: "can-launch-base",
    title: "全站用户侧商用文案与工程词泄露",
    status: pass ? "PASS" : "BLOCKER",
    releaseBlocking: !pass,
    evidence: scan?.filePath,
    detail: pass
      ? `全站扫描通过：routes=${json.routeCount}，fail=${json.failCount}，console=${json.consoleErrorCount}。`
      : "未找到通过的全站商用文案浏览器扫描。",
    nextAction: pass
      ? "保持 commercial-copy-browser-scan 作为发布前检查。"
      : "运行 COMMERCIAL_COPY_LOCAL_ACCEPTANCE_LOGIN=1 node frontend/scripts/commercial-copy-browser-scan.mjs。",
  });
}

function consoleQualityRow(scan) {
  const json = scan?.json || {};
  const pass =
    Number(json.routeCount || 0) >= 100 &&
    Number(json.failCount || 0) === 0 &&
    Number(json.consoleErrorCount || 0) === 0 &&
    Number(json.consoleWarningCount || 0) === 0 &&
    Number(json.requestFailureCount || 0) === 0;
  return row({
    id: "frontend-console-quality-full-scan",
    lane: "can-launch-base",
    title: "全站页面控制台与请求质量",
    status: pass ? "PASS" : "BLOCKER",
    releaseBlocking: !pass,
    evidence: scan?.filePath,
    detail: pass
      ? `控制台质量通过：routes=${json.routeCount}，errors=0，warnings=0，requestFailures=0。`
      : "未找到通过的全站控制台质量扫描。",
    nextAction: pass
      ? "保持 console-quality-browser-scan 作为 UI 质量回归。"
      : "运行 node frontend/scripts/console-quality-browser-scan.mjs 并修复错误。",
  });
}

function authCommercialIdentityRow(growthGate) {
  const checks = growthGate?.json?.checks || [];
  const auth = checks.find((item) => item.name === "auth-me");
  const commercial = checks.find((item) => item.name === "commercial-permission");
  const pass =
    auth?.status === "pass" &&
    commercial?.status === "pass" &&
    /commercialExecutionAllowed=true/.test(commercial.detail || "");
  return row({
    id: "commercial-auth-and-permission",
    lane: "can-launch-base",
    title: "商业账号身份与执行权限",
    status: pass ? "PASS" : "CONFIG_REQUIRED",
    releaseBlocking: !pass,
    evidence: growthGate?.filePath,
    detail: pass
      ? commercial.detail
      : "未确认商业账号、套餐和执行权限全部有效。",
    nextAction: pass
      ? "生产发布时继续使用真实商业账号重复该门禁。"
      : "使用未过期商业账号登录，确认 commercialExecutionAllowed=true 且 planMode=commercial。",
  });
}

function backupRestoreOpsRow(externalOps, productionConfigGate) {
  if (productionConfigGate?.json) {
    const gate = productionConfigGate.json;
    const blockers = (gate.rows || []).filter((item) => item.releaseBlocking);
    const pass = gate.status === "PASS" && blockers.length === 0;
    return row({
      id: "backup-restore-alerting",
      lane: pass ? "can-launch-base" : "needs-production-config",
      title: "备份、恢复、对象存储与值班告警",
      status: pass ? "PASS" : "CONFIG_REQUIRED",
      releaseBlocking: !pass,
      evidence: productionConfigGate.filePath,
      detail: pass
        ? `P6 生产配置门禁通过：${gate.summary?.passCount || 0}/${gate.summary?.total || 0}。`
        : `P6 生产配置门禁阻断 ${blockers.length} 项：${blockers
            .map((item) => `${item.title}: ${item.detail || ""}`)
            .join(" ")}`,
      nextAction: pass
        ? "保持 P6 作为发布当天备份恢复和告警门禁。"
        : blockers.map((item) => item.nextAction).filter(Boolean).join("；") ||
          "先重跑 P6 并处理生产配置阻断项。",
    });
  }

  const checks = externalOps?.json?.checks || [];
  const blocked = checks.filter((item) => normalizeStatus(item.status) === "BLOCKED");
  const passChecks = checks.filter((item) => normalizeStatus(item.status) === "PASS");
  const hasBackupPass = passChecks.some((item) =>
    /backup|restore|oss/i.test(`${item.name} ${item.message}`),
  );
  return row({
    id: "backup-restore-alerting",
    lane: blocked.length ? "needs-production-config" : "can-launch-base",
    title: "备份、恢复、对象存储与值班告警",
    status: blocked.length ? "CONFIG_REQUIRED" : hasBackupPass ? "PASS" : "UNVERIFIED",
    releaseBlocking: blocked.length > 0 || !hasBackupPass,
    evidence: externalOps?.filePath,
    detail: externalOps
      ? `备份/恢复/OSS 检查通过 ${passChecks.length} 项；阻断 ${blocked.length} 项。${blocked
          .map((item) => `${item.name}: ${item.message || ""}`)
          .join(" ")}`
      : "未找到外部运营 smoke 证据。",
    nextAction: blocked.length
      ? blocked.map((item) => item.nextAction).filter(Boolean).join("；")
      : hasBackupPass
        ? "保持备份恢复 smoke；生产前再次跑真实恢复演练。"
        : "运行 node scripts/commercial-external-ops-smoke.mjs，并配置真实备份和告警。",
  });
}

function growthLiveRow(growthGate) {
  const json = growthGate?.json || {};
  const blockers = (json.checks || []).filter(
    (item) => normalizeStatus(item.status) === "BLOCKER",
  );
  const pass = json.status === "PASS" || (json.blockers === 0 && blockers.length === 0);
  return row({
    id: "growth-live-acquisition",
    lane: pass ? "can-launch-base" : "needs-real-account-acceptance",
    title: "增长获客真实账号与自动任务实跑",
    status: pass ? "PASS" : "REAL_ACCEPTANCE_REQUIRED",
    releaseBlocking: !pass,
    evidence: growthGate?.filePath,
    detail: pass
      ? "增长 live gate 已通过。"
      : `增长 live gate 当前阻断：${blockers
          .map((item) => `${item.name}: ${item.detail}`)
          .join(" | ")}`,
    nextAction: pass
      ? "生产前保留最近一次真账号实跑证据。"
      : "登录或重新授权至少一个真实平台账号，绑定 ready 自动任务，产生 growth_acquisition_runs 后重跑 growth-commercial-live-gate。",
  });
}

function externalPublishRow(externalPublishGate) {
  if (externalPublishGate?.json) {
    const gate = externalPublishGate.json;
    const blockers = (gate.rows || []).filter((item) => item.releaseBlocking);
    const pass = gate.status === "PASS" && blockers.length === 0;
    const hasRealAcceptanceBlocker = blockers.some(
      (item) => item.status === "REAL_ACCEPTANCE_REQUIRED",
    );
    return row({
      id: "external-platform-publish-readback",
      lane: pass
        ? "can-launch-base"
        : hasRealAcceptanceBlocker
          ? "needs-real-account-acceptance"
          : "needs-production-config",
      title: "抖音/小红书/微信等外部平台真实发布与回读",
      status: pass
        ? "PASS"
        : hasRealAcceptanceBlocker
          ? "REAL_ACCEPTANCE_REQUIRED"
          : "CONFIG_REQUIRED",
      releaseBlocking: !pass,
      evidence: externalPublishGate.filePath,
      detail: pass
        ? `P9 外部发布回读门禁通过：${gate.summary?.passCount || 0}/${gate.summary?.total || 0}。`
        : `P9 外部发布回读门禁阻断 ${blockers.length} 项：${blockers
            .map((item) => `${item.title}: ${item.detail || ""}`)
            .join(" ")}`,
      nextAction: pass
        ? "保持 P9 作为发布当天外部平台真实发布与回读门禁。"
        : blockers.map((item) => item.nextAction).filter(Boolean).join("；") ||
          "先重跑 P9 并处理外部发布回读阻断项。",
    });
  }

  return row({
    id: "external-platform-publish-readback",
    lane: "needs-real-account-acceptance",
    title: "抖音/小红书/微信等外部平台真实发布与回读",
    status: "REAL_ACCEPTANCE_REQUIRED",
    releaseBlocking: true,
    evidence: "",
    detail: "当前 P4 证明了发布准备，不证明外部平台真实发布、风控通过和发布结果回读。",
    nextAction: "用测试品牌账号执行至少一次真实发布、截图/链接回读、失败恢复和证据留存；不得用页面 smoke 代替。",
  });
}

function windowsDesktopRow(windowsGate) {
  const pass =
    windowsGate?.text &&
    !/BLOCKER|UNVERIFIED/i.test(windowsGate.text) &&
    /PASS|Result:\s*PASS|commercial release/i.test(windowsGate.text);
  return row({
    id: "windows-desktop-commercial-release",
    lane: pass ? "can-launch-base" : "needs-real-account-acceptance",
    title: "Windows 桌面包与微信真机能力",
    status: pass ? "PASS" : "REAL_ACCEPTANCE_REQUIRED",
    releaseBlocking: !pass,
    evidence: windowsGate?.filePath,
    detail: pass
      ? "发现 Windows 商业发布门禁通过证据。"
      : "未发现足够的 Windows 商业发布门禁和微信真机证据；模拟器/静态 smoke 不能代替。",
    nextAction: pass
      ? "随版本保留安装包 hash、latest.yml、真机微信命令证据。"
      : "在 Win10 真机跑 desktop/scripts/windows-commercial-release-gate.js --commercial-release，并补齐微信联系人/朋友圈/群发等真机证据。",
  });
}

function thirdPartyCrmRow(p4, thirdPartyCrmGate) {
  if (thirdPartyCrmGate?.json) {
    const gate = thirdPartyCrmGate.json;
    const blockers = (gate.rows || []).filter((item) => item.releaseBlocking);
    const pass = gate.status === "PASS" && blockers.length === 0;
    const hasRealAcceptanceBlocker = blockers.some(
      (item) => item.status === "REAL_ACCEPTANCE_REQUIRED",
    );
    return row({
      id: "third-party-crm-production-sync",
      lane: pass
        ? "can-launch-base"
        : hasRealAcceptanceBlocker
          ? "needs-real-account-acceptance"
          : "needs-production-config",
      title: "第三方 CRM 生产同步",
      status: pass
        ? "PASS"
        : hasRealAcceptanceBlocker
          ? "REAL_ACCEPTANCE_REQUIRED"
          : "CONFIG_REQUIRED",
      releaseBlocking: !pass,
      evidence: thirdPartyCrmGate.filePath,
      detail: pass
        ? `P8 第三方 CRM 同步门禁通过：${gate.summary?.passCount || 0}/${gate.summary?.total || 0}。`
        : `P8 第三方 CRM 同步门禁阻断 ${blockers.length} 项：${blockers
            .map((item) => `${item.title}: ${item.detail || ""}`)
            .join(" ")}`,
      nextAction: pass
        ? "保持 P8 作为发布当天第三方 CRM 同步门禁。"
        : blockers.map((item) => item.nextAction).filter(Boolean).join("；") ||
          "先重跑 P8 并处理第三方 CRM 同步阻断项。",
    });
  }

  const localPass = Boolean(p4?.json?.pass);
  return row({
    id: "third-party-crm-production-sync",
    lane: "needs-production-config",
    title: "第三方 CRM 生产同步",
    status: "CONFIG_REQUIRED",
    releaseBlocking: true,
    evidence: p4?.json?.artifacts?.crmEvidenceDir || p4?.filePath,
    detail: localPass
      ? "本地 CRM 写入回滚已通过；第三方 CRM 当前只证明连接方案和只读边界，不证明生产写入同步。"
      : "本地 CRM 闭环也未确认通过。",
    nextAction: "配置专属安全保护、真实 HubSpot/Salesforce 测试租户、字段白名单、可撤销授权和回滚方案后，再做外部 CRM 写入验收。",
  });
}

function billingWebhookRow(billingGate) {
  if (billingGate?.json) {
    const gate = billingGate.json;
    const blockers = (gate.rows || []).filter((item) => item.releaseBlocking);
    const pass = gate.status === "PASS" && blockers.length === 0;
    return row({
      id: "billing-webhook-and-entitlement",
      lane: pass ? "can-launch-base" : "needs-production-config",
      title: "支付/订阅回调与权益一致性",
      status: pass ? "PASS" : "CONFIG_REQUIRED",
      releaseBlocking: !pass,
      evidence: billingGate.filePath,
      detail: pass
        ? `P7 支付权益门禁通过：${gate.summary?.passCount || 0}/${gate.summary?.total || 0}。`
        : `P7 支付权益门禁阻断 ${blockers.length} 项：${blockers
            .map((item) => `${item.title}: ${item.detail || ""}`)
            .join(" ")}`,
      nextAction: pass
        ? "保持 P7 作为发布当天支付、订阅、权益一致性门禁。"
        : blockers.map((item) => item.nextAction).filter(Boolean).join("；") ||
          "先重跑 P7 并处理支付权益阻断项。",
    });
  }

  const billingEvidence = findEvidenceFilesByPath(
    /billing|invoice|webhook|stripe|payment|entitlement/i,
  )[0] || "";
  return row({
    id: "billing-webhook-and-entitlement",
    lane: billingEvidence ? "can-launch-base" : "needs-production-config",
    title: "支付/订阅回调与权益一致性",
    status: billingEvidence ? "PASS" : "CONFIG_REQUIRED",
    releaseBlocking: !billingEvidence,
    evidence: billingEvidence,
    detail: billingEvidence
      ? "发现支付/订阅或权益相关证据文件。"
      : "未在本日证据中发现支付、订阅回调、权益变更的生产级验收证据。",
    nextAction: billingEvidence
      ? "生产发布前用真实支付测试模式重跑回调、幂等、退款/失效和权益同步。"
      : "补齐支付测试模式 webhook、发票/订阅审计、权益变更和过期拦截验收。",
  });
}

function row(input) {
  return {
    ...input,
    evidence: input.evidence ? relative(input.evidence) : "",
  };
}

function summarize(items) {
  const byStatus = {};
  const byLane = {};
  for (const item of items) {
    byStatus[item.status] = (byStatus[item.status] || 0) + 1;
    byLane[item.lane] = (byLane[item.lane] || 0) + 1;
  }
  const blockers = items.filter((item) => item.releaseBlocking);
  return {
    total: items.length,
    byStatus,
    byLane,
    releaseBlockingCount: blockers.length,
    productionBlocked: blockers.length > 0,
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

function latestJsonFile(pattern, predicate = () => true) {
  if (!existsSync(evidenceRoot)) return null;
  const files = readdirSync(evidenceRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => {
      const filePath = join(evidenceRoot, entry.name);
      const json = readJson(filePath);
      return json && predicate(json)
        ? {
            filePath,
            json,
            sortKey:
              Date.parse(json.finishedAt || json.generatedAt || json.startedAt || "") ||
              mtimeKey(filePath),
          }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.sortKey - a.sortKey);
  return files[0] || null;
}

function latestWindowsReleaseEvidence() {
  const candidates = findEvidenceFiles(/windows.*(commercial|release|gate)|commercial.*windows/i);
  const picked = candidates
    .map((filePath) => ({ filePath, text: readTextSafe(filePath), sortKey: mtimeKey(filePath) }))
    .filter((item) => item.text)
    .sort((a, b) => b.sortKey - a.sortKey)[0];
  return picked || null;
}

function findAnyEvidence(pattern) {
  return findEvidenceFiles(pattern)[0] || "";
}

function findEvidenceFilesByPath(pattern) {
  if (!existsSync(evidenceRoot)) return [];
  const matches = [];
  walk(evidenceRoot);
  return matches.sort((a, b) => mtimeKey(b) - mtimeKey(a));

  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith("p5-production-readiness-gate-")) {
          continue;
        }
        walk(absolute);
      } else if (/\.(md|json|txt)$/i.test(entry.name) && pattern.test(relative(absolute))) {
        matches.push(absolute);
      }
    }
  }
}

function findEvidenceFiles(pattern) {
  if (!existsSync(evidenceRoot)) return [];
  const matches = [];
  walk(evidenceRoot);
  return matches.sort((a, b) => mtimeKey(b) - mtimeKey(a));

  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith("p5-production-readiness-gate-")) {
          continue;
        }
        walk(absolute);
      } else if (/\.(md|json|txt)$/i.test(entry.name)) {
        const rel = relative(absolute);
        if (pattern.test(rel) || pattern.test(readTextSafe(absolute).slice(0, 4000))) {
          matches.push(absolute);
        }
      }
    }
  }
}

function writeReport(data) {
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(join(reportDir, "report.json"), `${JSON.stringify(data, null, 2)}\n`);
  writeFileSync(join(reportDir, "report.md"), renderMarkdown(data));
}

function renderMarkdown(data) {
  const lines = [
    "# P5 Production Readiness Gate",
    "",
    `- Generated: ${data.generatedAt}`,
    `- Evidence root: ${relative(data.evidenceRoot)}`,
    `- Status: **${data.status}**`,
    `- Release blocking items: ${data.summary.releaseBlockingCount}`,
    "",
    "## Summary",
    "",
    `- 可上线基础: ${data.summary.byLane["can-launch-base"] || 0}`,
    `- 需生产配置: ${data.summary.byLane["needs-production-config"] || 0}`,
    `- 必须真机/真账号验收: ${data.summary.byLane["needs-real-account-acceptance"] || 0}`,
    "",
    "## Matrix",
    "",
    "| Status | Lane | Gate | Detail | Evidence | Next action |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const item of data.rows) {
    lines.push(
      `| ${escapeCell(item.status)} | ${escapeCell(laneLabel(item.lane))} | ${escapeCell(item.title)} | ${escapeCell(item.detail)} | ${escapeCell(item.evidence)} | ${escapeCell(item.nextAction)} |`,
    );
  }
  lines.push("");
  if (data.summary.productionBlocked) {
    lines.push(
      "## Release Decision",
      "",
      "当前只能认定为“本地商用闭环通过”。正式生产发布仍被阻断，必须先处理 `CONFIG_REQUIRED` 与 `REAL_ACCEPTANCE_REQUIRED` 项。",
      "",
    );
  } else {
    lines.push("## Release Decision", "", "当前矩阵未发现生产发布阻断项。", "");
  }
  return `${lines.join("\n")}\n`;
}

function printSummary(data) {
  console.log("P5 production readiness gate");
  console.log(`Status: ${data.status}`);
  console.log(`Rows: ${data.summary.total}`);
  console.log(`Release blockers: ${data.summary.releaseBlockingCount}`);
  for (const item of data.rows) {
    console.log(`[${item.status}] ${item.title} (${laneLabel(item.lane)})`);
  }
  console.log(`Report: ${join(reportDir, "report.md")}`);
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
  node scripts/p5-production-readiness-gate.mjs
  node scripts/p5-production-readiness-gate.mjs --strict

Options:
  --strict             Exit 1 when production release blockers exist.
  --date YYYY-MM-DD    Evidence date folder to inspect.
  --evidence-root DIR  Evidence root override.
  --report-dir DIR     Output report directory override.
`);
      process.exit(0);
    }
  }
  return parsed;
}

function readJson(filePath) {
  if (!filePath || !existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function readTextSafe(filePath) {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function mtimeKey(filePath) {
  try {
    return existsSync(filePath) ? statSync(filePath).mtimeMs : 0;
  } catch {
    return 0;
  }
}

function normalizeStatus(value) {
  return String(value || "").toUpperCase();
}

function relative(filePath) {
  return filePath ? filePath.replace(`${repoRoot}/`, "") : "";
}

function laneLabel(lane) {
  return {
    "can-launch-base": "可上线基础",
    "needs-production-config": "需生产配置",
    "needs-real-account-acceptance": "必须真机/真账号验收",
  }[lane] || lane;
}

function escapeCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

function timestampForFile() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
