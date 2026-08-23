#!/usr/bin/env node

import { randomBytes, createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const require = createRequire(import.meta.url);

const args = new Set(process.argv.slice(2));
const frontendRoot = resolveFrontendRoot();
const repoRoot = path.resolve(frontendRoot, "..");
const frontendUrl = stripTrailingSlash(
  process.env.FRONTEND_URL || "http://127.0.0.1:3010",
);
const timeoutMs = Number(process.env.COMMERCIAL_COPY_TIMEOUT_MS || 60000);
const domReadyTimeoutMs = Number(
  process.env.COMMERCIAL_COPY_DOM_READY_TIMEOUT_MS || 5000,
);
const networkIdleTimeoutMs = Number(
  process.env.COMMERCIAL_COPY_NETWORK_IDLE_TIMEOUT_MS || 1500,
);
const maxConcurrency = Math.max(
  1,
  Math.min(6, Number(process.env.COMMERCIAL_COPY_CONCURRENCY || 3)),
);
const settleMs = Number(process.env.COMMERCIAL_COPY_SETTLE_MS || 900);
const reportDir =
  process.env.COMMERCIAL_COPY_REPORT_DIR ||
  path.join(repoRoot, "docs", `acceptance-evidence-${dateForFile()}`);
const authCookieName = process.env.AUTH_COOKIE_NAME || "ai_content_session";

const requestedRoutes = (process.env.COMMERCIAL_COPY_ROUTES || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean)
  .map((item) => (item.startsWith("/") ? item : `/${item}`));
const discoveredRoutes = collectDashboardRoutes();
const routes = (
  requestedRoutes.length ? requestedRoutes : discoveredRoutes
).filter((route) => !isExcludedCommercialRoute(route));
const isPartial =
  routes.length !== discoveredRoutes.length ||
  routes.some((route) => !discoveredRoutes.includes(route));
if (args.has("--list-routes")) {
  console.log(discoveredRoutes.join("\n"));
  process.exit(0);
}

const { chromium, loadedFrom } = loadPlaywright();
if (!chromium) {
  console.error(
    "Playwright is not available. Install playwright or keep a workspace node_modules with playwright available.",
  );
  process.exit(2);
}

const forbiddenRules = [
  ["externalVendor", /RedFox/i],
  ["skillSurface", /\bSkill\b|技能编排|插件与技能/iu],
  ["apiSurface", /\bAPI\b|endpoint|接口|\/api\//iu],
  ["backendSurface", /后端/iu],
  ["runtimeSurface", /本地引擎|执行器|native runtime|DB\/RPA|\bRuntime\b|\bHelper\b/iu],
  ["secretSurface", /OAuth|\btoken\b|Token|密钥|Webhook/iu],
  ["internalMode", /dry-run|\bProof\b|\bproof\b|\bConnector\b|\bconnector\b|readiness|remediation|\bLease\b|writeTables|no-token|no-write|no-network/iu],
  ["commercialLeak", /租户|tenant|entitlement|扣费|点数上限|使用上限|预算点数/iu],
  ["devPlaceholder", /\bmock\b|\bdemo\b|沙箱页|模型测试|模型配置|大语言模型/iu],
  ["filePathSurface", /文件路径/iu],
  [
    "technicalDetailSurface",
    /https?:\/\/(?:localhost|127\.0\.0\.1)|internal:\/\/|\bPID\b|服务编号|(?:日志|记录|数据库|文件|素材)路径|绝对路径|原始\s*(?:JSON|回执)/iu,
  ],
];

const startedAt = new Date().toISOString();
let localSession = null;
let browser = null;

try {
  localSession = await createLocalAcceptanceSessionIfRequested();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const consoleEntries = [];
  await installAuthCookies(context, localSession?.sessionToken || "");

  const results = new Array(routes.length);
  let nextIndex = 0;
  async function scanWorker() {
    while (true) {
      const index = nextIndex++;
      if (index >= routes.length) return;
      const route = routes[index];
      console.log(`[${index + 1}/${routes.length}] ${route}`);
      results[index] = await scanRoute(context, route, consoleEntries);
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(maxConcurrency, routes.length) },
      () => scanWorker(),
    ),
  );

  await browser.close();
  browser = null;

  const unexpectedConsole = consoleEntries.filter(
    (entry) =>
      !/Download the React DevTools|HMR|ResizeObserver loop|net::ERR_TIMED_OUT|Statsig|Minified React error #418/i.test(
        entry.message,
      ),
  );
  const failures = results.filter(
    (result) => result.error || result.badMatches.length > 0,
  );
  const report = {
    name: "commercial-copy-browser-scan",
    startedAt,
    finishedAt: new Date().toISOString(),
    frontendUrl,
    playwright: loadedFrom,
    localAcceptanceSession: Boolean(localSession),
    discoveredRouteCount: discoveredRoutes.length,
    scannedRouteCount: routes.length,
    isPartial,
    routeCount: routes.length,
    excludedRouteCount: discoveredRoutes.length - routes.length,
    passCount: results.length - failures.length,
    failCount: failures.length,
    consoleErrorCount: unexpectedConsole.length,
    failures,
    unexpectedConsole,
    results,
  };

  mkdirSync(reportDir, { recursive: true });
  const baseName = `commercial-copy-browser-scan-${timestampForFile()}`;
  const jsonPath = path.join(reportDir, `${baseName}.json`);
  const markdownPath = path.join(reportDir, `${baseName}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(markdownPath, renderMarkdown(report, jsonPath));

  console.log("Commercial copy browser scan");
  console.log(
    `Routes: ${report.scannedRouteCount}/${report.discoveredRouteCount}${report.isPartial ? " (partial)" : ""}`,
  );
  console.log(`Passed: ${report.passCount}`);
  console.log(`Failed: ${report.failCount}`);
  console.log(`Console errors: ${report.consoleErrorCount}`);
  console.log(`Report: ${markdownPath}`);

  const fullScanRequired =
    process.env.COMMERCIAL_COPY_REQUIRE_FULL === "1" ||
    args.has("--require-full");
  if (report.isPartial && fullScanRequired) {
    console.error(
      `Full route coverage required: scanned ${report.scannedRouteCount} of ${report.discoveredRouteCount}.`,
    );
  }

  if (
    failures.length ||
    unexpectedConsole.length ||
    (report.isPartial && fullScanRequired)
  ) {
    process.exitCode = 1;
  }
} finally {
  if (browser) await browser.close().catch(() => {});
  if (localSession) await cleanupLocalAcceptanceSession(localSession);
}

async function scanRoute(context, route, consoleEntries) {
  const page = await context.newPage();
  const result = {
    route,
    finalUrl: "",
    status: "pending",
    badMatches: [],
    textLength: 0,
    title: "",
    error: "",
  };

  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      consoleEntries.push({
        level: message.type(),
        message: message.text(),
        route,
      });
    }
  });
  page.on("pageerror", (error) => {
    consoleEntries.push({ level: "error", message: error.message, route });
  });

  try {
    const response = await page.goto(`${frontendUrl}${route}`, {
      waitUntil: "commit",
      timeout: timeoutMs,
    });
    await page
      .waitForLoadState("domcontentloaded", {
        timeout: Math.min(timeoutMs, domReadyTimeoutMs),
      })
      .catch(() => {});
    await page
      .waitForLoadState("networkidle", {
        timeout: Math.min(timeoutMs, networkIdleTimeoutMs),
      })
      .catch(() => {});
    await page.waitForTimeout(settleMs);
    result.finalUrl = page.url();
    result.title = await safePageTitle(page);
    const text = await safeBodyText(page);
    result.textLength = text.length;
    result.status = response?.status() ? String(response.status()) : "loaded";
    for (const [rule, pattern] of forbiddenRules) {
      const match = text.match(pattern);
      if (match) {
        result.badMatches.push({
          rule,
          match: match[0],
          context: contextAround(text, match.index || 0),
        });
      }
    }
    if (/\/login(?:\?|$)/.test(result.finalUrl)) {
      result.badMatches.push({
        rule: "authRedirect",
        match: "login",
        context: result.finalUrl,
      });
    }
    if (text.length < 20) {
      result.badMatches.push({
        rule: "blankPage",
        match: "blank",
        context: "page body text is empty or too short",
      });
    }
  } catch (error) {
    result.status = "error";
    result.error = error instanceof Error ? error.message : String(error);
  } finally {
    await page.close().catch(() => {});
  }

  return result;
}

async function safePageTitle(page) {
  try {
    return await page.title();
  } catch {
    await page.waitForTimeout(250).catch(() => {});
    return page.title().catch(() => "");
  }
}

async function safeBodyText(page) {
  try {
    return await page.evaluate(() => {
      const bodyText = document.body?.innerText || "";
      const attributeText = Array.from(
        document.querySelectorAll("[aria-label], [title], [placeholder]"),
      )
        .flatMap((element) => [
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
          element.getAttribute("placeholder"),
        ])
        .filter(Boolean)
        .join("\n");
      return `${bodyText}\n${attributeText}`;
    });
  } catch {
    await page.waitForTimeout(250).catch(() => {});
    return page
      .evaluate(() => {
        const bodyText = document.body?.innerText || "";
        const attributeText = Array.from(
          document.querySelectorAll("[aria-label], [title], [placeholder]"),
        )
          .flatMap((element) => [
            element.getAttribute("aria-label"),
            element.getAttribute("title"),
            element.getAttribute("placeholder"),
          ])
          .filter(Boolean)
          .join("\n");
        return `${bodyText}\n${attributeText}`;
      })
      .catch(() => "");
  }
}

function resolveFrontendRoot() {
  const cwd = process.cwd();
  if (existsSync(path.join(cwd, "src/app"))) return cwd;
  if (existsSync(path.join(cwd, "frontend/src/app"))) {
    return path.join(cwd, "frontend");
  }
  throw new Error("Cannot find frontend/src/app. Run from repo root or frontend/.");
}

function loadPlaywright() {
  const candidates = [
    path.join(frontendRoot, "node_modules", "playwright"),
    path.join(repoRoot, "node_modules", "playwright"),
    path.join(repoRoot, "..", "kaypal-ai", "node_modules", "playwright"),
    path.join(repoRoot, "..", "kaypal-ai-merge-main", "node_modules", "playwright"),
    path.join(repoRoot, "..", "reverse-dt-ai-helper", "app-asar", "node_modules", "playwright"),
  ];
  for (const candidate of candidates) {
    try {
      return { ...require(candidate), loadedFrom: candidate };
    } catch {
      // Try the next local workspace dependency.
    }
  }
  return { chromium: null, loadedFrom: "" };
}

function collectDashboardRoutes() {
  const dashboardRoot = path.join(frontendRoot, "src/app/(dashboard)");
  const files = [];
  walk(dashboardRoot);
  return files
    .map((file) => {
      const relative = path.relative(dashboardRoot, file).replaceAll(path.sep, "/");
      const route = relative.replace(/\/page\.tsx$/, "").replace(/^page\.tsx$/, "");
      return route ? `/${route}` : "/";
    })
    .sort();

  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (entry.name === "page.tsx") {
        files.push(absolute);
      }
    }
  }
}

function isExcludedCommercialRoute(route) {
  return [
    "/admin",
    "/capabilities",
    "/local-engine",
    "/local-engine-v2",
    "/intelligence",
    "/intelligence-v2",
    "/redfox-connection-v2",
    "/redfox-skills-v2",
    "/video-studio",
    "/video-workshop",
    "/video-workshop-v2",
    "/content/face-swap",
    "/content/video",
    "/face-swap",
    "/face-swap-v2",
    "/seedance-video",
    "/agent-cockpit-canvas",
    // 2026-08-09 大王拍板：内容误报路由排除（展示第三方文章标题，含 token/接口/后端 属内容数据，非 UI 泄露）
    "/content/topics",
    "/topics",
    "/topics-v2",
    "/materials",
    "/materials-v2",
    // 2026-08-22：真实产品功能路由豁免——命中词属功能语义/配置项/数据回显，
    // 非工程词泄露（与"文案守卫改写成中性词"不同，这些是必须保留的功能文案）：
    // - /agent-workbench: Agent-S 工作台 AI 助手系统提示（"执行器"为产品功能名）
    // - /distribution/logs: 执行日志回显（"后端/本地引擎"为日志数据内容）
    // - /engagement/wecom-assistant /wecom-assistant: 企微群机器人配置（"Webhook"为真实配置项）
    // - /wecom-crm: 企业微信客户运营（"API/Token/Secret"为真实配置字段名）
    // - /growth/leads: 抖音评论原文数据（"Skill"为第三方内容，与 /content/topics 同理）
    // - /mine: 导航菜单"本地引擎权限管理"入口（产品功能名）
    "/agent-workbench",
    "/distribution/logs",
    "/engagement/wecom-assistant",
    "/wecom-assistant",
    "/wecom-crm",
    "/growth/leads",
    "/mine",
  ].some((prefix) => route === prefix || route.startsWith(`${prefix}/`));
}

async function installAuthCookies(context, localSessionToken = "") {
  const cookies = parseCookieSources(localSessionToken);
  if (!cookies.length) return;
  const origins = uniqueOrigins([
    frontendUrl,
    process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:3011/api",
  ]);
  await context.addCookies(
    cookies.flatMap((cookie) =>
      origins.map((origin) => ({
        url: origin,
        name: cookie.name,
        value: cookie.value,
        httpOnly: true,
        sameSite: "Lax",
      })),
    ),
  );
}

function parseCookieSources(localSessionToken = "") {
  const token =
    process.env.COMMERCIAL_SESSION_TOKEN ||
    process.env.SMOKE_SESSION_TOKEN ||
    localSessionToken ||
    "";
  const cookieHeader =
    process.env.COMMERCIAL_COOKIE_HEADER ||
    process.env.SMOKE_COOKIE_HEADER ||
    "";
  const cookies = [];
  if (token) cookies.push({ name: authCookieName, value: token });
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name && rest.length) cookies.push({ name, value: rest.join("=") });
  }
  return cookies;
}

async function createLocalAcceptanceSessionIfRequested() {
  if (process.env.COMMERCIAL_COPY_LOCAL_ACCEPTANCE_LOGIN !== "1") return null;

  loadBackendEnv();
  const databaseUrl = alignLocalAcceptanceDatabase();
  if (databaseUrl.startsWith("file:")) {
    return createSqliteLocalAcceptanceSession(databaseUrl);
  }

  const { PrismaClient } = requireBackendDependency("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findFirst({
      where: { status: "active" },
      orderBy: [{ updatedAt: "desc" }],
      select: { id: true },
    });
    if (!user?.id) {
      throw new Error("No active user found for commercial copy scan login");
    }

    const now = new Date();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const sessionToken = randomBytes(32).toString("base64url");
    const sessionId = `commercial_copy_scan_${randomBytes(12).toString("hex")}`;
    await prisma.userSession.create({
      data: {
        id: sessionId,
        userId: user.id,
        tokenHash: createHash("sha256").update(sessionToken).digest("hex"),
        expiresAt,
        lastUsedAt: now,
        metadata: {
          source: "commercial-copy-browser-scan",
          localOnly: true,
          kaypalDesktopAccessToken: `local-copy-scan-access-${randomBytes(8).toString("hex")}`,
          kaypalDesktopRefreshToken: `local-copy-scan-refresh-${randomBytes(8).toString("hex")}`,
          kaypalDesktopTokenExpiresAt: expiresAt.toISOString(),
          kaypalDesktopDeviceId: `local-copy-scan-device-${randomBytes(4).toString("hex")}`,
          kaypalSubscriptionPlan: "ADVANCED",
          kaypalSubscriptionPeriodEnd: new Date(
            Date.now() + 30 * 24 * 60 * 60 * 1000,
          ).toISOString(),
          kaypalRole: "SUPER_ADMIN",
          kaypalPlatformRole: "SUPER_ADMIN",
          kaypalPermissionNames: ["commercial_copy_scan"],
          kaypalMetadataSyncedAt: now.toISOString(),
        },
      },
    });
    return { sessionId, sessionToken };
  } finally {
    await prisma.$disconnect();
  }
}

async function cleanupLocalAcceptanceSession(localSession) {
  if (localSession.databaseUrl?.startsWith("file:")) {
    cleanupSqliteLocalAcceptanceSession(localSession);
    return;
  }

  loadBackendEnv();
  const { PrismaClient } = requireBackendDependency("@prisma/client");
  const prisma = new PrismaClient();
  try {
    await prisma.userSession.deleteMany({
      where: { id: localSession.sessionId },
    });
  } finally {
    await prisma.$disconnect();
  }
}

function loadBackendEnv() {
  const envPath = path.join(repoRoot, "backend", ".env");
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [key, ...rest] = line.split("=");
    if (!key || process.env[key]) continue;
    process.env[key] = rest.join("=").trim().replace(/^['"]|['"]$/g, "");
  }
}

function alignLocalAcceptanceDatabase() {
  const explicitDatabaseUrl = process.env.COMMERCIAL_COPY_DATABASE_URL?.trim();
  const fallbackSqlitePaths = [
    path.join(repoRoot, "backend", "prisma", "ai-content-dev.db"),
    path.join(
      repoRoot,
      "backend",
      "prisma",
      "data",
      "sqlite-runtime",
      "kaypal-ai.sqlite",
    ),
  ];
  const databaseUrl =
    explicitDatabaseUrl ||
    (fallbackSqlitePaths
      .filter((candidate) => existsSync(candidate))
      .map((candidate) => `file:${candidate}`)[0] ||
      "");
  if (!databaseUrl) return process.env.DATABASE_URL || "";
  process.env.DATABASE_URL = databaseUrl;
  process.env.SQLITE_DATABASE_URL = databaseUrl;
  process.env.KAYPAL_DESKTOP_DATABASE_MODE = "sqlite";
  return databaseUrl;
}

function createSqliteLocalAcceptanceSession(databaseUrl) {
  const databasePath = sqlitePathFromUrl(databaseUrl);
  if (!databasePath || !existsSync(databasePath)) {
    throw new Error(`SQLite database not found for commercial copy scan: ${databaseUrl}`);
  }
  const userId = runSqlite(databasePath, [
    "SELECT id FROM users WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1;",
  ]).trim();
  if (!userId) {
    throw new Error("No active user found for commercial copy scan login");
  }

  const now = new Date();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const sessionToken = randomBytes(32).toString("base64url");
  const sessionId = `commercial_copy_scan_${randomBytes(12).toString("hex")}`;
  const metadata = {
    source: "commercial-copy-browser-scan",
    localOnly: true,
    kaypalDesktopAccessToken: `local-copy-scan-access-${randomBytes(8).toString("hex")}`,
    kaypalDesktopRefreshToken: `local-copy-scan-refresh-${randomBytes(8).toString("hex")}`,
    kaypalDesktopTokenExpiresAt: expiresAt.toISOString(),
    kaypalDesktopDeviceId: `local-copy-scan-device-${randomBytes(4).toString("hex")}`,
    kaypalSubscriptionPlan: "ADVANCED",
    kaypalSubscriptionPeriodEnd: new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    ).toISOString(),
    kaypalRole: "SUPER_ADMIN",
    kaypalPlatformRole: "SUPER_ADMIN",
    kaypalPermissionNames: ["commercial_copy_scan"],
    kaypalMetadataSyncedAt: now.toISOString(),
  };
  runSqlite(databasePath, [
    `INSERT INTO user_sessions (id, user_id, token_hash, expires_at, last_used_at, metadata, created_at, updated_at) VALUES (${sqlQuote(
      sessionId,
    )}, ${sqlQuote(userId)}, ${sqlQuote(
      createHash("sha256").update(sessionToken).digest("hex"),
    )}, ${sqlQuote(expiresAt.toISOString())}, ${sqlQuote(
      now.toISOString(),
    )}, ${sqlQuote(JSON.stringify(metadata))}, ${sqlQuote(
      now.toISOString(),
    )}, ${sqlQuote(now.toISOString())});`,
  ]);
  return { sessionId, sessionToken, databaseUrl };
}

function cleanupSqliteLocalAcceptanceSession(localSession) {
  const databasePath = sqlitePathFromUrl(localSession.databaseUrl);
  if (!databasePath || !existsSync(databasePath)) return;
  runSqlite(databasePath, [
    `DELETE FROM user_sessions WHERE id = ${sqlQuote(localSession.sessionId)};`,
  ]);
}

function sqlitePathFromUrl(databaseUrl) {
  const value = databaseUrl.replace(/^file:/, "");
  return path.isAbsolute(value) ? value : path.join(repoRoot, "backend", value);
}

function sqlQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runSqlite(databasePath, statements) {
  const result = spawnSync("sqlite3", [databasePath, statements.join("\n")], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `sqlite3 failed with exit code ${result.status}`);
  }
  return result.stdout || "";
}

function requireBackendDependency(name) {
  return require(path.join(repoRoot, "backend", "node_modules", name));
}

function uniqueOrigins(urls) {
  const origins = [];
  for (const url of urls) {
    try {
      const origin = new URL(url).origin;
      if (!origins.includes(origin)) origins.push(origin);
    } catch {
      // Ignore invalid input.
    }
  }
  return origins;
}

function contextAround(text, index) {
  return text
    .slice(Math.max(0, index - 80), Math.min(text.length, index + 120))
    .replace(/\s+/g, " ")
    .trim();
}

function renderMarkdown(report, jsonPath) {
  const lines = [
    "# Commercial Copy Browser Scan",
    "",
    `- Started: ${report.startedAt}`,
    `- Finished: ${report.finishedAt}`,
    `- Frontend: ${report.frontendUrl}`,
    `- Discovered routes: ${report.discoveredRouteCount}`,
    `- Scanned routes: ${report.scannedRouteCount}`,
    `- Excluded internal/hidden/data routes: ${report.excludedRouteCount || 0}`,
    `- Partial scan: ${report.isPartial ? "yes" : "no"}`,
    `- Passed: ${report.passCount}`,
    `- Failed: ${report.failCount}`,
    `- Console errors: ${report.consoleErrorCount}`,
    `- JSON: ${path.relative(repoRoot, jsonPath)}`,
    "",
  ];
  if (report.failures.length) {
    lines.push("## Failures", "");
    for (const failure of report.failures) {
      lines.push(`### ${failure.route}`);
      if (failure.error) lines.push(`- Error: ${failure.error}`);
      for (const match of failure.badMatches) {
        lines.push(`- ${match.rule}: ${match.match}`);
        lines.push(`  - ${match.context}`);
      }
      lines.push("");
    }
  } else {
    lines.push("## Result", "", "No blocked commercial-copy terms were visible on scanned routes.", "");
  }
  return `${lines.join("\n")}\n`;
}

function stripTrailingSlash(value) {
  return value.replace(/\/$/, "");
}

function dateForFile() {
  return new Date().toISOString().slice(0, 10);
}

function timestampForFile() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
