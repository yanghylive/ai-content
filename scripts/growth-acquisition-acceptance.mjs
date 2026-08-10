#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readReleaseEvidence } from './lib/release-evidence.mjs';

const require = createRequire(import.meta.url);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const releaseEvidence = readReleaseEvidence();

const frontendUrl = stripTrailingSlash(process.env.FRONTEND_URL || 'http://localhost:3010');
const apiBase = stripTrailingSlash(process.env.API_BASE || 'http://localhost:3011/api');
const timeoutMs = Number(process.env.GROWTH_ACCEPTANCE_TIMEOUT_MS || process.env.SMOKE_UI_TIMEOUT_MS || 30000);
const routeStabilityMs = Number(process.env.GROWTH_ACCEPTANCE_ROUTE_STABILITY_MS || 1200);
const listOnly = process.env.GROWTH_ACCEPTANCE_LIST_ONLY === '1' || process.argv.includes('--list');
const headless = process.env.GROWTH_ACCEPTANCE_HEADLESS !== '0';
const authCookieName = process.env.AUTH_COOKIE_NAME || 'ai_content_session';
const localAcceptanceLoginEnabled =
  process.env.GROWTH_ACCEPTANCE_LOCAL_LOGIN === '1' ||
  process.env.COMMERCIAL_LOCAL_ACCEPTANCE_LOGIN === '1' ||
  process.env.SMOKE_LOCAL_ACCEPTANCE_LOGIN === '1';
const databasePath = resolveSqliteDatabasePath();
const evidenceDir =
  process.env.GROWTH_ACCEPTANCE_EVIDENCE_DIR ||
  join(repoRoot, 'docs', `acceptance-evidence-${dateForFile()}`, `growth-acquisition-commercial-${timestampForFile()}`);
const screenshotsDir = join(evidenceDir, 'screenshots');

const pages = [
  {
    slug: 'overview',
    label: '获客总览',
    route: '/growth',
    title: '增长获客总览',
    requiredText: ['增长获客总览', '执行记录', '线索池', '风险账号'],
    expectedTables: ['执行记录'],
    minControls: 3,
    statusTokens: ['执行记录', '线索', '风险', '账号'],
    manualFocus: ['KPI 语义', '就绪状态条', '最新线索入口', '空状态 CTA'],
  },
  {
    slug: 'acquisition',
    label: '自动获客矩阵',
    route: '/growth/acquisition',
    title: '自动获客矩阵',
    requiredText: ['自动获客矩阵', '创建获客任务', '当前运行边界', '获客任务列表', '预览任务可创建'],
    expectedTables: ['获客任务'],
    minControls: 12,
    statusTokens: ['真实', '安全', '预检', '账号', '风控'],
    manualFocus: ['任务分组表单', '预览/真实执行边界', '账号不可用入口', '能力检查与处理方式'],
  },
  {
    slug: 'strategies',
    label: '获客策略',
    route: '/growth/strategies',
    title: '获客策略中心',
    requiredText: ['获客策略中心', '行业', '场景', '搜索策略', '健康度'],
    expectedTables: [],
    minControls: 4,
    statusTokens: ['复核', '复制', '套用', '删除'],
    manualFocus: ['策略搜索', '版本/复核感', '套用确认', '删除确认'],
  },
  {
    slug: 'leads',
    label: '线索池',
    route: '/growth/leads',
    title: '线索池',
    requiredText: ['线索池', '手动补充线索', '搜索线索', '展开补充线索'],
    expectedTables: ['线索池'],
    minControls: 8,
    statusTokens: ['批量', '跟进', '去重', '证据'],
    manualFocus: ['补充线索区域不挤压表格', '批量操作确认', '详情分区', '去重证据'],
  },
  {
    slug: 'account-health',
    label: '账号健康',
    route: '/growth/account-health',
    title: '账号健康中心',
    requiredText: ['账号健康中心', '账号风控台', '在线正常', '需人工处理'],
    expectedTables: ['账号健康'],
    minControls: 1,
    statusTokens: ['可执行', '冷却', '重新检测', '建议'],
    manualFocus: ['状态汇总', '风险严重度排序', '冷却/解除流', '修复动作入口'],
  },
  {
    slug: 'reports',
    label: '增长复盘',
    route: '/growth/reports',
    title: '增长复盘',
    requiredText: ['增长复盘', '增长趋势', '增长瓶颈诊断', '任务表现'],
    expectedTables: ['任务表现', '账号表现', '话术表现', '执行记录'],
    minControls: 3,
    statusTokens: ['导出', '瓶颈', '趋势', '异常'],
    manualFocus: ['漏斗/趋势解释', '瓶颈动作', '导出范围说明', '跳转定位'],
  },
  {
    slug: 'workflows',
    label: '增长工作流',
    route: '/growth/workflows',
    title: '增长工作流',
    requiredText: ['增长工作流', '创建商用增长 SOP', '工作流名称', '模板'],
    expectedTables: [],
    minControls: 4,
    statusTokens: ['备注', '完成', '回退', '模板'],
    manualFocus: ['模板选中态', '步骤状态', '备注保存', '完成/回退闭环'],
  },
];

const viewports = parseViewports(
  process.env.GROWTH_ACCEPTANCE_VIEWPORTS || '1440x1000:desktop,1365x900:laptop,768x1024:narrow',
);

const results = [];
const consoleErrors = [];
let passCount = 0;
let warnCount = 0;
let failCount = 0;
let blockedCount = 0;
let createdLocalSessionId = '';
let createdLocalSessionToken = '';

process.once('exit', cleanupLocalAcceptanceSession);

if (listOnly) {
  printChecklist();
  process.exit(0);
}

const { chromium, loadedFrom } = loadPlaywright();

let browser;

try {
  await mkdir(screenshotsDir, { recursive: true });
  browser = await chromium.launch({ headless });
  const context = await browser.newContext();
  createLocalAcceptanceSessionIfRequested();
  await installAuthCookies(context);

  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(`${message.location().url || 'console'} ${message.text()}`);
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  record('PASS', 'setup', `Playwright loaded from ${loadedFrom}`);
  record('PASS', 'setup', `Evidence directory: ${evidenceDir}`);
  await verifyAuthCookie(page);

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const pageCheck of pages) {
      await checkGrowthPage(page, pageCheck, viewport);
    }
  }

  const unexpectedErrors = consoleErrors.filter(
    (message) => !/401|Unauthorized|\/auth\/me|ResizeObserver loop|net::ERR_TIMED_OUT|Failed to load resource/i.test(message),
  );
  if (unexpectedErrors.length) {
    record('FAILED', 'browser-console', unexpectedErrors.slice(0, 8).join(' | '), '修复页面运行期错误后重新跑脚本。');
  } else {
    record('PASS', 'browser-console', 'No unexpected browser console errors captured.');
  }

  await writeReports();
  printSummary();
  process.exit(exitCode());
} catch (error) {
  record('FAILED', 'unexpected error', error.stack || error.message, '修复脚本异常、依赖或本地服务后重新执行。');
  await writeReports().catch(() => undefined);
  printSummary();
  process.exit(1);
} finally {
  await browser?.close();
  cleanupLocalAcceptanceSession();
}

async function checkGrowthPage(page, pageCheck, viewport) {
  const area = `${pageCheck.label} ${viewport.name}`;
  const url = `${frontendUrl}${pageCheck.route}`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  } catch (error) {
    if (!String(error?.message || '').includes('net::ERR_ABORTED')) {
      record('BLOCKED', area, `navigation failed: ${error.message}`, '确认前端 dev server 已启动且 FRONTEND_URL 正确。');
      return;
    }
  }

  await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => undefined);
  if (routeStabilityMs > 0) await page.waitForTimeout(routeStabilityMs);
  let body = await page.locator('body').innerText({ timeout: timeoutMs }).catch(() => '');
  if (!body.includes(pageCheck.title)) {
    await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs }).catch(() => undefined);
    if (routeStabilityMs > 0) await page.waitForTimeout(routeStabilityMs);
    body = await page.locator('body').innerText({ timeout: timeoutMs }).catch(() => '');
  }

  const screenshotPath = join(screenshotsDir, `${pageCheck.slug}-${viewport.name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch((error) => {
    record('WARN', area, `screenshot failed: ${error.message}`);
  });

  if (/\/login(?:[?#]|$)/.test(new URL(page.url()).pathname)) {
    record(
      'BLOCKED',
      area,
      `redirected to login (${page.url()})`,
      '提供 GROWTH_ACCEPTANCE_SESSION_TOKEN/GROWTH_ACCEPTANCE_COOKIE_HEADER。GROWTH_ACCEPTANCE_LOCAL_LOGIN 只适用于当前后端也连接同一个 SQLite 的场景；PostgreSQL 后端请使用真实浏览器 cookie。',
      screenshotPath,
    );
    return;
  }

  await page
    .waitForFunction((title) => document.body?.innerText.includes(title), pageCheck.title, { timeout: timeoutMs })
    .catch(() => undefined);

  body = await page.locator('body').innerText({ timeout: timeoutMs }).catch(() => '');
  const missingText = pageCheck.requiredText.filter((token) => !body.includes(token));
  if (missingText.length) {
    record('FAILED', area, `missing required text: ${missingText.join(' / ')}`, '确认页面标题、核心模块和空状态文案仍符合增长计划。', screenshotPath);
  } else {
    record('PASS', area, `required text visible: ${pageCheck.requiredText.join(' / ')}`, '', screenshotPath);
  }

  const dom = await inspectPageDom(page, pageCheck);
  const missingTables = pageCheck.expectedTables.filter((label) => !dom.tableLabels.some((value) => value.includes(label)));
  if (missingTables.length) {
    record('FAILED', area, `missing expected table(s): ${missingTables.join(' / ')}`, '表格页必须保留可承载真实数据规模的表格外壳。', screenshotPath);
  } else if (pageCheck.expectedTables.length) {
    record('PASS', area, `expected tables visible: ${pageCheck.expectedTables.join(' / ')}`);
  }

  if (dom.controlCount < pageCheck.minControls) {
    record('FAILED', area, `control count too low: ${dom.controlCount}, expected at least ${pageCheck.minControls}`, '检查筛选区、表单、主操作是否缺失或未渲染。', screenshotPath);
  } else {
    record('PASS', area, `interactive controls detected: ${dom.controlCount}`);
  }

  if (dom.bodyOverflowX > 8) {
    record(
      'FAILED',
      area,
      `body horizontal overflow ${dom.bodyOverflowX}px; offenders: ${dom.overflowOffenders.join(' | ') || '-'}`,
      '页面主体不能横向炸版；表格溢出应被局部容器承接。',
      screenshotPath,
    );
  } else {
    record('PASS', area, 'no body-level horizontal overflow');
  }

  if (dom.wrappedButtons.length) {
    record(
      'FAILED',
      area,
      `button text wraps or becomes too tall: ${dom.wrappedButtons.join(' | ')}`,
      '按钮文字必须一行显示，窄屏也不能挤成两行。',
      screenshotPath,
    );
  }

  if (dom.unlabeledInputs.length) {
    record(
      'WARN',
      area,
      `potential unlabeled controls: ${dom.unlabeledInputs.join(' | ')}`,
      '逐项确认表单 label、aria-label 或 placeholder 能让用户理解输入语义。',
      screenshotPath,
    );
  }

  const hasStatusLanguage = pageCheck.statusTokens.some((token) => body.includes(token));
  if (!hasStatusLanguage) {
    record(
      'WARN',
      area,
      `status/action language not found; expected one of: ${pageCheck.statusTokens.join(' / ')}`,
      '每页顶部或核心模块需要说明可执行性、风险、失败原因或下一步。',
      screenshotPath,
    );
  }
}

async function inspectPageDom(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const textOf = (element, limit = 80) => (element.innerText || element.textContent || element.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, limit);
    const nearestHeading = (element) => {
      let current = element.parentElement;
      while (current && current !== document.body) {
        const heading = current.querySelector('h1,h2,h3,[data-table-title]');
        if (heading && visible(heading)) return textOf(heading);
        current = current.parentElement;
      }
      return '';
    };
    const doc = document.documentElement;
    const bodyOverflowX = Math.max(doc.scrollWidth, document.body.scrollWidth) - window.innerWidth;
    const overflowOffenders = [...document.body.querySelectorAll('*')]
      .filter(visible)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        if (style.position === 'fixed') return false;
        return rect.left < -4 || rect.right > window.innerWidth + 4;
      })
      .slice(0, 8)
      .map((element) => `${element.tagName.toLowerCase()} ${textOf(element) || element.className || '-'}`);
    const tableLabels = [...document.querySelectorAll('table,[role="table"]')]
      .filter(visible)
      .map((element) =>
        [
          element.getAttribute('aria-label'),
          nearestHeading(element),
          [...element.querySelectorAll('th,[role="columnheader"]')]
            .map((header) => textOf(header, 24))
            .filter(Boolean)
            .join(' '),
          textOf(element),
        ]
          .filter(Boolean)
          .join(' '),
      )
      .filter(Boolean);
    const controls = [
      ...document.querySelectorAll('input,textarea,select,button,[role="button"],[role="combobox"],[aria-haspopup="listbox"]'),
    ].filter(visible);
    const wrappedButtons = [...document.querySelectorAll('button,[role="button"]')]
      .filter(visible)
      .filter((element) => {
        const text = textOf(element);
        if (!text) return false;
        if (text.length > 40) return false;
        if (element.closest('aside,nav,.growth-template-option,.dashboard-shell__account')) return false;
        if (element.closest('[data-shell-action],[data-growth-metric-card],[data-growth-funnel-cell]')) return false;
        if (element.getAttribute('aria-haspopup') === 'listbox') return false;
        if (element.closest('[aria-haspopup="listbox"],[data-slot="trigger"]')) return false;
        const rect = element.getBoundingClientRect();
        const lineCount = (element.innerText || '').trim().split(/\n+/).filter(Boolean).length;
        return lineCount > 1 || rect.height > 58;
      })
      .slice(0, 8)
      .map((element) => textOf(element));
    const unlabeledInputs = [...document.querySelectorAll('input,textarea,select,[role="combobox"]')]
      .filter(visible)
      .filter((element) => {
        const id = element.getAttribute('id');
        const hasExternalLabel = id && document.querySelector(`label[for="${CSS.escape(id)}"]`);
        return !hasExternalLabel && !element.getAttribute('aria-label') && !element.getAttribute('placeholder') && !element.closest('label');
      })
      .slice(0, 8)
      .map((element) => `${element.tagName.toLowerCase()} ${element.getAttribute('name') || element.getAttribute('type') || textOf(element) || '-'}`);
    return {
      bodyOverflowX,
      overflowOffenders,
      tableLabels,
      controlCount: controls.length,
      wrappedButtons,
      unlabeledInputs,
    };
  });
}

async function verifyAuthCookie(page) {
  const result = await page
    .goto(`${frontendUrl}/login`, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
    .then(() =>
      page.evaluate(async (baseUrl) => {
        try {
          const response = await fetch(`${baseUrl}/auth/me`, { credentials: 'include' });
          return { ok: response.ok, status: response.status, text: await response.text() };
        } catch (error) {
          return { ok: false, status: 0, text: error instanceof Error ? error.message : String(error) };
        }
      }, apiBase),
    )
    .catch((error) => ({ ok: false, status: 0, text: error.message }));

  if (result.ok) {
    record('PASS', 'auth', '/auth/me accepted the browser cookie.');
    return;
  }

  record(
    'WARN',
    'auth',
    `/auth/me did not accept the browser cookie: HTTP ${result.status} ${String(result.text || '').slice(0, 160)}`,
    '如果后续路由跳登录页，请提供当前后端认可的 session token/cookie；SQLite 临时登录不适用于 PostgreSQL 后端。',
  );
}

async function installAuthCookies(context) {
  const sourceCookies = loadAuthCookies();
  if (!sourceCookies.length) {
    record('WARN', 'auth', 'No auth cookie/session token provided; protected routes may redirect to login.');
    return;
  }
  const origins = cookieOrigins();
  const cookies = [];
  for (const origin of origins) {
    for (const cookie of sourceCookies) {
      cookies.push({
        url: origin,
        name: cookie.name,
        value: cookie.value,
        httpOnly: cookie.httpOnly ?? true,
        sameSite: 'Lax',
        ...(cookie.expires ? { expires: cookie.expires } : {}),
      });
    }
  }
  await context.addCookies(cookies);
  record('PASS', 'auth', `Loaded ${sourceCookies.length} auth cookie(s) into ${origins.length} origin(s).`);
}

function loadAuthCookies() {
  const cookies = [];
  const cookieHeader =
    process.env.GROWTH_ACCEPTANCE_COOKIE_HEADER ||
    process.env.COMMERCIAL_COOKIE_HEADER ||
    process.env.SMOKE_COOKIE_HEADER ||
    '';
  const cookieFile =
    process.env.GROWTH_ACCEPTANCE_COOKIE_FILE ||
    process.env.COMMERCIAL_COOKIE_FILE ||
    process.env.SMOKE_COOKIE_FILE ||
    '';
  const sessionToken =
    createdLocalSessionToken ||
    process.env.GROWTH_ACCEPTANCE_SESSION_TOKEN ||
    process.env.COMMERCIAL_SESSION_TOKEN ||
    process.env.SMOKE_SESSION_TOKEN ||
    '';

  if (sessionToken) cookies.push({ name: authCookieName, value: sessionToken, path: '/', httpOnly: true });

  if (cookieHeader) {
    for (const segment of cookieHeader.split(';')) {
      const index = segment.indexOf('=');
      if (index <= 0) continue;
      const name = segment.slice(0, index).trim();
      const value = segment.slice(index + 1).trim();
      if (name && value) cookies.push({ name, value, path: '/', httpOnly: true });
    }
  }

  if (cookieFile) {
    try {
      const content = readFileSync(cookieFile, 'utf8');
      for (const rawLine of content.split(/\r?\n/)) {
        let line = rawLine.trim();
        if (!line) continue;
        let httpOnly = false;
        if (line.startsWith('#HttpOnly_')) {
          line = line.replace(/^#HttpOnly_/, '');
          httpOnly = true;
        } else if (line.startsWith('#')) {
          continue;
        }
        const parts = line.split(/\t+/);
        if (parts.length < 7) continue;
        const [, , path, secure, expires, name, value] = parts;
        if (!name || !value) continue;
        cookies.push({
          name,
          value,
          path: path || '/',
          httpOnly,
          secure: secure === 'TRUE',
          expires: Number(expires) > 0 ? Number(expires) : undefined,
        });
      }
    } catch (error) {
      record('WARN', 'auth', `Could not read cookie file ${cookieFile}: ${error.message}`);
    }
  }

  return dedupeCookies(cookies);
}

function dedupeCookies(cookies) {
  const map = new Map();
  for (const cookie of cookies) {
    if (!cookie.name || !cookie.value) continue;
    map.set(`${cookie.name}\n${cookie.value}`, cookie);
  }
  return [...map.values()];
}

function cookieOrigins() {
  const origins = new Set();
  for (const raw of [frontendUrl, apiBase]) {
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      continue;
    }
    const hosts = new Set([parsed.hostname]);
    if (parsed.hostname === 'localhost') hosts.add('127.0.0.1');
    if (parsed.hostname === '127.0.0.1') hosts.add('localhost');
    for (const host of hosts) {
      const port = parsed.port ? `:${parsed.port}` : '';
      origins.add(`${parsed.protocol}//${host}${port}`);
    }
  }
  return [...origins];
}

function createLocalAcceptanceSessionIfRequested() {
  if (!localAcceptanceLoginEnabled || createdLocalSessionToken) return;
  if (!databasePath) throw new Error('local acceptance login requires a SQLite database path');
  if (!existsSync(databasePath)) throw new Error(`SQLite database does not exist: ${databasePath}`);

  const userRows = sqliteJson(`
    select id, username, email
    from users
    where status = 'active'
    order by updated_at desc
    limit 1;
  `);
  const user = userRows[0];
  if (!user?.id) throw new Error('No active local user found for growth acceptance login');

  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  createdLocalSessionToken = randomBytes(32).toString('base64url');
  createdLocalSessionId = `growth_acceptance_${randomBytes(12).toString('hex')}`;
  const tokenHash = createHash('sha256').update(createdLocalSessionToken).digest('hex');
  const metadata = JSON.stringify({
    source: 'growth-acquisition-acceptance',
    localOnly: true,
    kaypalDesktopAccessToken: `local-growth-access-${randomBytes(8).toString('hex')}`,
    kaypalDesktopRefreshToken: `local-growth-refresh-${randomBytes(8).toString('hex')}`,
    kaypalDesktopTokenExpiresAt: expiresAt,
    kaypalDesktopDeviceId: `local-growth-device-${randomBytes(4).toString('hex')}`,
    kaypalSubscriptionPlan: 'ADVANCED',
    kaypalSubscriptionPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    kaypalRole: 'SUPER_ADMIN',
    kaypalPlatformRole: 'SUPER_ADMIN',
    kaypalPermissionNames: ['growth_acceptance'],
    kaypalMetadataSyncedAt: now,
  });

  sqliteExec(`
    insert into user_sessions (
      id,
      user_id,
      token_hash,
      expires_at,
      last_used_at,
      metadata,
      created_at,
      updated_at
    ) values (
      ${sqlQuote(createdLocalSessionId)},
      ${sqlQuote(user.id)},
      ${sqlQuote(tokenHash)},
      ${sqlQuote(expiresAt)},
      ${sqlQuote(now)},
      ${sqlQuote(metadata)},
      ${sqlQuote(now)},
      ${sqlQuote(now)}
    );
  `);
  record('PASS', 'auth', `Created local acceptance session for ${user.username || user.email || user.id}.`);
}

function cleanupLocalAcceptanceSession() {
  if (!createdLocalSessionId || !databasePath || !existsSync(databasePath)) return;
  const sessionId = createdLocalSessionId;
  createdLocalSessionId = '';
  createdLocalSessionToken = '';
  try {
    sqliteExec(`delete from user_sessions where id = ${sqlQuote(sessionId)};`);
  } catch (error) {
    console.warn(`WARN could not clean local growth acceptance session ${sessionId}: ${error.message}`);
  }
}

function resolveSqliteDatabasePath() {
  const explicitPath =
    process.env.GROWTH_ACCEPTANCE_DATABASE_PATH ||
    process.env.SMOKE_DATABASE_PATH ||
    process.env.COMMERCIAL_DATABASE_PATH ||
    '';
  if (explicitPath.trim()) return resolve(repoRoot, explicitPath.trim());
  const url =
    process.env.GROWTH_ACCEPTANCE_DATABASE_URL ||
    process.env.SMOKE_DATABASE_URL ||
    process.env.COMMERCIAL_DATABASE_URL ||
    process.env.SQLITE_DATABASE_URL ||
    process.env.DATABASE_URL ||
    '';
  const pathFromUrl = sqliteFileUrlToPath(url);
  if (pathFromUrl) return pathFromUrl;
  const candidates = [
    join(repoRoot, 'backend', 'prisma', 'ai-content-dev.db'),
    join(repoRoot, 'backend', 'prisma', 'data', 'sqlite-runtime', 'kaypal-ai.sqlite'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) || candidates[0];
}

function sqliteFileUrlToPath(value) {
  const text = String(value || '').trim();
  if (!text.startsWith('file:')) return '';
  try {
    const url = new URL(text);
    if (url.protocol === 'file:' && url.pathname) return decodeURIComponent(url.pathname);
  } catch {
    // Prisma also accepts file:./relative/path.
  }
  const rawPath = text.replace(/^file:/, '');
  if (!rawPath) return '';
  return rawPath.startsWith('/') ? rawPath : join(repoRoot, rawPath);
}

function sqliteJson(sql) {
  const output = sqliteRun(sql, ['-json']).trim();
  return output ? JSON.parse(output) : [];
}

function sqliteExec(sql) {
  sqliteRun(sql);
}

function sqliteRun(sql, extraArgs = []) {
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return execFileSync(
        'sqlite3',
        [...extraArgs, '-cmd', '.timeout 10000', databasePath, sql],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
    } catch (error) {
      lastError = error;
      const stderr = String(error?.stderr || error?.message || '');
      if (!/database is locked|SQLITE_BUSY/i.test(stderr)) {
        throw error;
      }
    }
  }
  throw lastError;
}

function sqlQuote(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

function loadPlaywright() {
  const candidates = [
    '../node_modules/playwright',
    '../frontend/node_modules/playwright',
    '../backend/node_modules/playwright',
    '../../kaypal-ai/node_modules/playwright',
    '../../kaypal-ai-merge-main/node_modules/playwright',
    '../../reverse-dt-ai-helper/app-asar/node_modules/playwright',
  ];
  for (const candidate of candidates) {
    try {
      const loaded = require(candidate);
      return { chromium: loaded.chromium, loadedFrom: candidate };
    } catch {
      // Try the next local workspace dependency.
    }
  }
  console.error('Playwright is not available. Install playwright or keep one of the known workspace node_modules directories available.');
  process.exit(1);
}

function parseViewports(value) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [size, rawName] = item.split(':');
      const [width, height] = size.split('x').map((part) => Number(part));
      if (!Number.isFinite(width) || !Number.isFinite(height)) {
        throw new Error(`Invalid viewport: ${item}`);
      }
      return { width, height, name: rawName || `${width}x${height}` };
    });
}

function record(status, area, detail, nextAction = '', artifact = '') {
  results.push({
    status,
    area,
    detail,
    nextAction,
    artifact: artifact ? artifact.replace(`${repoRoot}/`, '') : '',
    at: new Date().toISOString(),
  });
  if (status === 'PASS') passCount += 1;
  else if (status === 'WARN') warnCount += 1;
  else if (status === 'BLOCKED') blockedCount += 1;
  else failCount += 1;
  const line = `${status} ${area}: ${detail}`;
  if (status === 'FAILED') console.error(line);
  else console.log(line);
}

async function writeReports() {
  await mkdir(evidenceDir, { recursive: true });
  const summary = {
    generatedAt: new Date().toISOString(),
    ...(releaseEvidence || {}),
    frontendUrl,
    apiBase,
    viewports,
    summary: {
      pass: passCount,
      warn: warnCount,
      blocked: blockedCount,
      failed: failCount,
      exitCode: exitCode(),
    },
    results,
  };
  await writeFile(join(evidenceDir, 'report.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  await writeFile(join(evidenceDir, 'report.md'), markdownReport(summary), 'utf8');
  console.log('');
  console.log(`Report: ${join(evidenceDir, 'report.md')}`);
}

function markdownReport(summary) {
  const lines = [
    '# 增长获客 7 页商用验收结果',
    '',
    `- 生成时间：${summary.generatedAt}`,
    `- 前端地址：${frontendUrl}`,
    `- API 地址：${apiBase}`,
    `- 视口：${viewports.map((item) => `${item.name} ${item.width}x${item.height}`).join(' / ')}`,
    `- 汇总：PASS=${passCount} WARN=${warnCount} BLOCKED=${blockedCount} FAILED=${failCount}`,
    '',
    '## 结果明细',
    '',
    '| 状态 | 范围 | 说明 | 下一步 | 证据 |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const item of results) {
    lines.push(`| ${item.status} | ${escapeMd(item.area)} | ${escapeMd(item.detail)} | ${escapeMd(item.nextAction || '-')} | ${escapeMd(item.artifact || '-')} |`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function printChecklist() {
  console.log('Growth acquisition commercial acceptance checklist');
  console.log(`Frontend URL: ${frontendUrl}`);
  console.log('');
  for (const [index, page] of pages.entries()) {
    console.log(`${index + 1}. ${page.label} ${frontendUrl}${page.route}`);
    console.log(`   Required text: ${page.requiredText.join(' / ')}`);
    console.log(`   Tables: ${page.expectedTables.join(' / ') || '-'}`);
    console.log(`   Manual focus: ${page.manualFocus.join(' / ')}`);
  }
  console.log('');
  console.log('Browser run: GROWTH_ACCEPTANCE_LOCAL_LOGIN=1 node scripts/growth-acquisition-acceptance.mjs');
  console.log('Cookie run: GROWTH_ACCEPTANCE_SESSION_TOKEN=... node scripts/growth-acquisition-acceptance.mjs');
}

function printSummary() {
  console.log('');
  console.log(`Summary: PASS=${passCount} WARN=${warnCount} BLOCKED=${blockedCount} FAILED=${failCount}`);
}

function exitCode() {
  return failCount > 0 || blockedCount > 0 ? 1 : 0;
}

function stripTrailingSlash(value) {
  return String(value).replace(/\/+$/, '');
}

function dateForFile() {
  return new Date().toISOString().slice(0, 10);
}

function timestampForFile() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
}

function escapeMd(value) {
  return String(value).replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}
