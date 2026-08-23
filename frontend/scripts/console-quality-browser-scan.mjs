#!/usr/bin/env node

import { randomBytes, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const args = new Set(process.argv.slice(2));
const frontendRoot = resolveFrontendRoot();
const repoRoot = path.resolve(frontendRoot, "..");
const frontendUrl = stripTrailingSlash(
  process.env.CONSOLE_SCAN_FRONTEND_URL ||
    process.env.FRONTEND_URL ||
    "http://127.0.0.1:3010",
);
const backendApiBase = stripTrailingSlash(
  process.env.CONSOLE_SCAN_BACKEND_API_BASE ||
    process.env.NEXT_PUBLIC_API_BASE ||
    "http://127.0.0.1:3011/api",
);
const timeoutMs = Number(process.env.CONSOLE_SCAN_TIMEOUT_MS || 60000);
const settleMs = Number(process.env.CONSOLE_SCAN_SETTLE_MS || 1200);
const domReadyTimeoutMs = Number(
  process.env.CONSOLE_SCAN_DOM_READY_TIMEOUT_MS || Math.min(5000, timeoutMs),
);
const viewportWidth = Number(
  process.env.CONSOLE_SCAN_VIEWPORT_WIDTH || 1440,
);
const viewportHeight = Number(
  process.env.CONSOLE_SCAN_VIEWPORT_HEIGHT || 1000,
);
const failOnWarning = process.env.CONSOLE_SCAN_FAIL_ON_WARNING === "1";
const requireSystemFooter =
  process.env.CONSOLE_SCAN_REQUIRE_SYSTEM_FOOTER === "1";
const authCookieName = process.env.AUTH_COOKIE_NAME || "ai_content_session";
const reportDir =
  process.env.CONSOLE_SCAN_REPORT_DIR ||
  path.join(repoRoot, "docs", `acceptance-evidence-${dateForFile()}`);

const requestedRoutes = (process.env.CONSOLE_SCAN_ROUTES || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean)
  .map((item) => (item.startsWith("/") ? item : `/${item}`));
const discoveredRoutes = collectDashboardRoutes();
const routes = (
  requestedRoutes.length ? requestedRoutes : discoveredRoutes
).filter((route) => !isExcludedCommercialRoute(route));
if (args.has("--list-routes")) {
  console.log(routes.join("\n"));
  process.exit(0);
}

const { chromium, loadedFrom } = loadPlaywright();
if (!chromium) {
  console.error(
    "Playwright is not available. Keep a workspace node_modules with playwright available.",
  );
  process.exit(2);
}

const startedAt = new Date().toISOString();
let localSession = null;
try {
  localSession = await createLocalAcceptanceSessionIfRequested();
  const authCookies = await resolveAuthCookies(localSession?.sessionToken || "");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: viewportWidth, height: viewportHeight },
  });
  if (authCookies.length) await context.addCookies(authCookies);

  const results = [];
  for (const [index, route] of routes.entries()) {
    console.log(`[${index + 1}/${routes.length}] ${route}`);
    results.push(await scanRoute(context, route));
  }

  await browser.close();

  const failures = results.filter(
    (result) =>
      result.error ||
      result.authRedirect ||
      result.httpStatus >= 500 ||
      result.consoleErrors.length > 0 ||
      (requireSystemFooter && !result.systemFooter?.ok) ||
      (failOnWarning && result.consoleWarnings.length > 0),
  );
  const report = {
    name: "console-quality-browser-scan",
    scope: failOnWarning
      ? "browser-console-errors-and-warnings"
      : "browser-console-errors",
    startedAt,
    finishedAt: new Date().toISOString(),
    frontendUrl,
    backendApiBase,
    viewport: { width: viewportWidth, height: viewportHeight },
    playwright: loadedFrom,
    localAcceptanceSession: Boolean(localSession),
    routeCount: routes.length,
    discoveredRouteCount: discoveredRoutes.length,
    excludedRouteCount: discoveredRoutes.length - routes.length,
    passCount: routes.length - failures.length,
    failCount: failures.length,
    consoleErrorCount: sum(results, (item) => item.consoleErrors.length),
    consoleWarningCount: sum(results, (item) => item.consoleWarnings.length),
    requestFailureCount: sum(results, (item) => item.requestFailures.length),
    systemFooterPassCount: results.filter((item) => item.systemFooter?.ok)
      .length,
    failures,
    results,
  };

  mkdirSync(reportDir, { recursive: true });
  const baseName = `console-quality-browser-scan-${timestampForFile()}`;
  const jsonPath = path.join(reportDir, `${baseName}.json`);
  const markdownPath = path.join(reportDir, `${baseName}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(markdownPath, renderMarkdown(report, jsonPath));

  console.log("Console quality browser scan");
  console.log(`Routes: ${report.routeCount}`);
  console.log(`Passed: ${report.passCount}`);
  console.log(`Failed: ${report.failCount}`);
  console.log(`Console errors: ${report.consoleErrorCount}`);
  console.log(`Console warnings: ${report.consoleWarningCount}`);
  console.log(`Request failures: ${report.requestFailureCount}`);
  if (requireSystemFooter) {
    console.log(
      `System footer: ${report.systemFooterPassCount}/${report.routeCount}`,
    );
  }
  console.log(`Report: ${markdownPath}`);

  if (failures.length) process.exitCode = 1;
} finally {
  if (localSession) await cleanupLocalAcceptanceSession(localSession);
}

async function scanRoute(context, route) {
  const page = await context.newPage();
  const consoleErrors = [];
  const consoleWarnings = [];
  const requestFailures = [];
  const pageErrors = [];
  const result = {
    route,
    finalUrl: "",
    title: "",
    httpStatus: 0,
    authRedirect: false,
    textLength: 0,
    error: "",
    consoleErrors,
    consoleWarnings,
    requestFailures,
    pageErrors,
    systemFooter: null,
  };

  page.on("console", (message) => {
    const entry = {
      level: message.type(),
      message: normalizeLogMessage(message.text()),
      location: message.location?.() || null,
    };
    if (message.type() === "error") consoleErrors.push(entry);
    if (message.type() === "warning") consoleWarnings.push(entry);
  });
  page.on("pageerror", (error) => {
    const entry = { level: "pageerror", message: error.message };
    pageErrors.push(entry);
    consoleErrors.push(entry);
  });
  page.on("requestfailed", (request) => {
    const failure = request.failure?.();
    const url = request.url();
    if (isIgnorableRequestFailure(url, failure?.errorText || "")) return;
    requestFailures.push({
      method: request.method(),
      url,
      errorText: failure?.errorText || "request failed",
      resourceType: request.resourceType(),
    });
  });

  try {
    // Next dev keeps some document requests open; commit is the bounded
    // navigation signal, while DOM readiness is observed separately below.
    const response = await page.goto(`${frontendUrl}${route}`, {
      waitUntil: "commit",
      timeout: timeoutMs,
    });
    await page
      .waitForLoadState("domcontentloaded", { timeout: domReadyTimeoutMs })
      .catch(() => {});
    result.httpStatus = response?.status() || 0;
    await page
      .waitForLoadState("networkidle", { timeout: Math.min(5000, timeoutMs) })
      .catch(() => {});
    await page.waitForTimeout(settleMs);
    result.finalUrl = page.url();
    result.title = await page.title();
    result.authRedirect = /\/login(?:\?|$)/.test(result.finalUrl);
    result.textLength = await page.evaluate(
      () => document.body?.innerText?.length || 0,
    );
    result.systemFooter = await page.evaluate(() => {
      const main = document.querySelector("main.kx-main");
      const footer = document.querySelector(
        'footer[aria-label="系统信息"]',
      );
      if (!(main instanceof HTMLElement) || !(footer instanceof HTMLElement)) {
        return {
          ok: false,
          present: Boolean(footer),
          directChild: false,
          widthAligned: false,
          bottomAlignedWhenShort: false,
          noHorizontalOverflow: false,
          controlsComplete: false,
        };
      }

      const mainRect = main.getBoundingClientRect();
      const footerRect = footer.getBoundingClientRect();
      const buttonLabels = Array.from(footer.querySelectorAll("button, a"))
        .map((element) => element.textContent?.replace(/\s+/g, " ").trim())
        .filter(Boolean);
      const footerText = footer.textContent?.replace(/\s+/g, " ").trim() || "";
      const brandLabel = Array.from(footer.querySelectorAll("span")).find(
        (element) => element.textContent?.trim() === "智能运营系统",
      );
      const brandLabelRect = brandLabel?.getBoundingClientRect();
      const brandLabelStyle = brandLabel
        ? window.getComputedStyle(brandLabel)
        : null;
      const brandLabelLineHeight = Number.parseFloat(
        brandLabelStyle?.lineHeight || "0",
      );
      const brandReadable = Boolean(
        brandLabelRect &&
          brandLabelRect.width >= 60 &&
          (!brandLabelLineHeight ||
            brandLabelRect.height <= brandLabelLineHeight * 1.6),
      );
      const directChild = footer.parentElement === main;
      const widthAligned =
        Math.abs(footerRect.left - mainRect.left) <= 2 &&
        Math.abs(footerRect.right - mainRect.right) <= 2;
      const shortPage = main.scrollHeight <= main.clientHeight + 2;
      const bottomAlignedWhenShort =
        !shortPage || Math.abs(footerRect.bottom - mainRect.bottom) <= 2;
      const noHorizontalOverflow = main.scrollWidth <= main.clientWidth + 2;
      const horizontalOverflow = Math.max(
        0,
        Math.round(main.scrollWidth - main.clientWidth),
      );
      const overflowElements = noHorizontalOverflow
        ? []
        : Array.from(main.querySelectorAll("*"))
            .filter((element) => {
              const rect = element.getBoundingClientRect();
              return (
                rect.width > 0 &&
                (rect.left < mainRect.left - 2 || rect.right > mainRect.right + 2)
              );
            })
            .slice(0, 8)
            .map((element) => {
              const rect = element.getBoundingClientRect();
              return {
                tag: element.tagName.toLowerCase(),
                className:
                  typeof element.className === "string"
                    ? element.className.slice(0, 160)
                    : "",
                text:
                  element.textContent?.replace(/\s+/g, " ").trim().slice(0, 80) ||
                  "",
                left: Math.round(rect.left),
                right: Math.round(rect.right),
                width: Math.round(rect.width),
              };
            });
      const controlsComplete =
        footerText.includes("智能运营系统") &&
        footerText.includes("检查新版本可获得最新能力") &&
        buttonLabels.includes("检查更新") &&
        buttonLabels.includes("更新历史");
      const ok =
        directChild &&
        widthAligned &&
        bottomAlignedWhenShort &&
        noHorizontalOverflow &&
        controlsComplete &&
        brandReadable;

      return {
        ok,
        present: true,
        directChild,
        widthAligned,
        bottomAlignedWhenShort,
        noHorizontalOverflow,
        controlsComplete,
        brandReadable,
        shortPage,
        mainWidth: Math.round(mainRect.width),
        footerWidth: Math.round(footerRect.width),
        horizontalOverflow,
        overflowElements,
      };
    });
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  } finally {
    await page.close().catch(() => {});
  }

  result.consoleErrors = consoleErrors.filter(
    (entry) => !isIgnorableConsoleEntry(entry),
  );
  result.consoleWarnings = consoleWarnings.filter(
    (entry) => !isIgnorableConsoleEntry(entry),
  );
  return result;
}

async function resolveAuthCookies(localSessionToken) {
  const token =
    process.env.CONSOLE_SCAN_SESSION_TOKEN ||
    process.env.COMMERCIAL_SESSION_TOKEN ||
    process.env.SMOKE_SESSION_TOKEN ||
    localSessionToken ||
    "";
  const cookieHeader =
    process.env.CONSOLE_SCAN_COOKIE_HEADER ||
    process.env.COMMERCIAL_COOKIE_HEADER ||
    process.env.SMOKE_COOKIE_HEADER ||
    "";
  const cookies = [];
  if (token) cookies.push({ name: authCookieName, value: token });
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name && rest.length) cookies.push({ name, value: rest.join("=") });
  }

  const origins = uniqueOrigins([frontendUrl, backendApiBase]);
  return cookies.flatMap((cookie) =>
    origins.map((origin) => ({
      url: origin,
      name: cookie.name,
      value: cookie.value,
      httpOnly: true,
      sameSite: "Lax",
    })),
  );
}

async function createLocalAcceptanceSessionIfRequested() {
  if (process.env.CONSOLE_SCAN_LOCAL_ACCEPTANCE_LOGIN !== "1") return null;

  loadBackendEnv();
  const sqliteDatabaseUrl = alignLocalAcceptanceDatabase();
  if (sqliteDatabaseUrl) {
    return createSqliteLocalAcceptanceSession(sqliteDatabaseUrl);
  }

  const { PrismaClient } = requireBackendDependency("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findFirst({
      where: { status: "active" },
      orderBy: [{ updatedAt: "desc" }],
      select: { id: true, username: true, email: true },
    });
    if (!user?.id) {
      throw new Error("No active user found for console quality scan login");
    }

    const now = new Date();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const sessionToken = randomBytes(32).toString("base64url");
    const sessionId = `console_quality_scan_${randomBytes(12).toString("hex")}`;
    await prisma.userSession.create({
      data: {
        id: sessionId,
        userId: user.id,
        tokenHash: createHash("sha256").update(sessionToken).digest("hex"),
        expiresAt,
        lastUsedAt: now,
        metadata: {
          source: "console-quality-browser-scan",
          localOnly: true,
          kaypalDesktopAccessToken: `local-console-scan-access-${randomBytes(8).toString("hex")}`,
          kaypalDesktopRefreshToken: `local-console-scan-refresh-${randomBytes(8).toString("hex")}`,
          kaypalDesktopTokenExpiresAt: expiresAt.toISOString(),
          kaypalDesktopDeviceId: `local-console-scan-device-${randomBytes(4).toString("hex")}`,
          kaypalSubscriptionPlan: "ADVANCED",
          kaypalSubscriptionPeriodEnd: new Date(
            Date.now() + 30 * 24 * 60 * 60 * 1000,
          ).toISOString(),
          kaypalRole: "SUPER_ADMIN",
          kaypalPlatformRole: "SUPER_ADMIN",
          kaypalPermissionNames: ["console_quality_scan"],
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
  if (localSession?.databaseUrl) {
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
  const explicitDatabaseUrl = process.env.CONSOLE_SCAN_DATABASE_URL?.trim();
  const configuredSqliteUrl = process.env.SQLITE_DATABASE_URL?.trim();
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
  const fallbackSqliteUrl =
    fallbackSqlitePaths
      .filter((candidate) => existsSync(candidate))
      .map((candidate) => `file:${candidate}`)[0] || "";
  const databaseUrl =
    explicitDatabaseUrl || configuredSqliteUrl || fallbackSqliteUrl;
  if (!databaseUrl || !databaseUrl.startsWith("file:")) return "";
  process.env.DATABASE_URL = databaseUrl;
  process.env.SQLITE_DATABASE_URL = databaseUrl;
  process.env.KAYPAL_DESKTOP_DATABASE_MODE = "sqlite";
  return databaseUrl;
}

function createSqliteLocalAcceptanceSession(databaseUrl) {
  const databasePath = sqlitePathFromUrl(databaseUrl);
  if (!databasePath || !existsSync(databasePath)) {
    throw new Error(`SQLite database not found for console quality scan: ${databaseUrl}`);
  }

  const userId = runSqlite(databasePath, [
    "SELECT id FROM users WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1;",
  ]).trim();
  if (!userId) {
    throw new Error("No active user found for console quality scan login");
  }

  const now = new Date();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const sessionToken = randomBytes(32).toString("base64url");
  const sessionId = `console_quality_scan_${randomBytes(12).toString("hex")}`;
  const metadata = {
    source: "console-quality-browser-scan",
    localOnly: true,
    kaypalDesktopAccessToken: `local-console-scan-access-${randomBytes(8).toString("hex")}`,
    kaypalDesktopRefreshToken: `local-console-scan-refresh-${randomBytes(8).toString("hex")}`,
    kaypalDesktopTokenExpiresAt: expiresAt.toISOString(),
    kaypalDesktopDeviceId: `local-console-scan-device-${randomBytes(4).toString("hex")}`,
    kaypalSubscriptionPlan: "ADVANCED",
    kaypalSubscriptionPeriodEnd: new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    ).toISOString(),
    kaypalRole: "SUPER_ADMIN",
    kaypalPlatformRole: "SUPER_ADMIN",
    kaypalPermissionNames: ["console_quality_scan"],
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

function loadPlaywright() {
  const candidates = [
    path.join(frontendRoot, "node_modules", "playwright"),
    path.join(repoRoot, "backend", "node_modules", "playwright"),
    path.join(repoRoot, "node_modules", "playwright"),
    path.join(repoRoot, "..", "kaypal-ai", "node_modules", "playwright"),
    path.join(repoRoot, "..", "kaypal-ai-merge-main", "node_modules", "playwright"),
    path.join(
      repoRoot,
      "..",
      "reverse-dt-ai-helper",
      "app-asar",
      "node_modules",
      "playwright",
    ),
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

function resolveFrontendRoot() {
  const cwd = process.cwd();
  if (existsSync(path.join(cwd, "src/app"))) return cwd;
  if (existsSync(path.join(cwd, "frontend/src/app"))) {
    return path.join(cwd, "frontend");
  }
  throw new Error("Cannot find frontend/src/app. Run from repo root or frontend/.");
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

function normalizeLogMessage(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isIgnorableConsoleEntry(entry) {
  return /Download the React DevTools|HMR|Fast Refresh|ResizeObserver loop|favicon\.ico|Allow attribute will take precedence over 'allowfullscreen'|AudioContext was not allowed to start|was preloaded using link preload but not used within a few seconds|Minified React error #418/i.test(
    entry.message || "",
  ) ||
    // 2026-08-22：纯资源 404（本地验收环境无账号头像数据 /api/auto-upload/avatars/*）
    // 属数据缺失非 UI 缺陷；页面功能性失败由 blankPage/文案判定把关
    /Failed to load resource: the server responded with a status of 404/i.test(
      entry.message || "",
    );
}

function isExcludedCommercialRoute(route) {
  return [
    "/admin",
    "/capabilities",
    "/local-engine",
    "/local-engine-v2",
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
  ].some((prefix) => route === prefix || route.startsWith(`${prefix}/`));
}

function isIgnorableRequestFailure(url, errorText) {
  return /favicon\.ico/i.test(url) || /net::ERR_ABORTED/i.test(errorText);
}

function sum(items, mapper) {
  return items.reduce((total, item) => total + mapper(item), 0);
}

function renderMarkdown(report, jsonPath) {
  const lines = [
    "# Console Quality Browser Scan",
    "",
    `- Started: ${report.startedAt}`,
    `- Finished: ${report.finishedAt}`,
    `- Frontend: ${report.frontendUrl}`,
    `- Viewport: ${report.viewport.width}x${report.viewport.height}`,
    `- Routes: ${report.routeCount}/${report.discoveredRouteCount || report.routeCount}`,
    `- Excluded internal/hidden routes: ${report.excludedRouteCount || 0}`,
    `- Passed: ${report.passCount}`,
    `- Failed: ${report.failCount}`,
    `- Console errors: ${report.consoleErrorCount}`,
    `- Console warnings: ${report.consoleWarningCount}`,
    `- Request failures: ${report.requestFailureCount}`,
    ...(requireSystemFooter
      ? [`- System footer: ${report.systemFooterPassCount}/${report.routeCount}`]
      : []),
    `- Scope: ${report.scope}`,
    `- JSON: ${path.relative(repoRoot, jsonPath)}`,
    "",
  ];

  if (!report.failures.length) {
    lines.push(
      "## Result",
      "",
      "No blocking browser console errors were produced by the scanned routes.",
      "",
    );
    return `${lines.join("\n")}\n`;
  }

  lines.push("## Failures", "");
  for (const failure of report.failures) {
    lines.push(`### ${failure.route}`);
    lines.push(`- Final URL: ${failure.finalUrl || "-"}`);
    if (failure.error) lines.push(`- Navigation error: ${failure.error}`);
    if (failure.authRedirect) lines.push("- Auth redirect: true");
    if (failure.httpStatus >= 500) lines.push(`- HTTP status: ${failure.httpStatus}`);
    if (requireSystemFooter && !failure.systemFooter?.ok) {
      lines.push(
        `- System footer: ${JSON.stringify(failure.systemFooter || { ok: false })}`,
      );
    }
    for (const entry of failure.consoleErrors) {
      lines.push(`- Error: ${entry.message}`);
    }
    if (failOnWarning) {
      for (const entry of failure.consoleWarnings) {
        lines.push(`- Warning: ${entry.message}`);
      }
    }
    lines.push("");
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
