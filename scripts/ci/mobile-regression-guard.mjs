/* eslint-disable no-console */
/**
 * CI 守门脚本：真机回归守卫（覆盖 2026-08-11 真机回归踩到的 4 类问题）
 *
 * 用法：node scripts/ci/mobile-regression-guard.mjs
 * 环境变量：
 *   REGRESSION_FRONTEND_URL  前端地址（默认 http://127.0.0.1:3010）
 *   REGRESSION_API_BASE      后端 API 地址（默认 http://127.0.0.1:3011/api）
 *   REGRESSION_KEEP_SERVERS  1 = 结束后不关服务（调试用）
 *
 * 覆盖问题：
 *   R1 建表完整性：空库启动后 schema.prisma 全部 model 都有对应表（#1 P0 ai_usage_quotas 缺失）
 *   R2 权限放开：member 角色可创建获客任务（不 403）——大王决策 2026-08-11 全功能开放
 *   R3 BigInt 序列化：/comment-acquisition/leads 返回 200 不 500（TypeError: Do not know how to serialize a BigInt）
 *   R4 关键路由无 404：/engagement/wechat、/auto-acquisition/create 等可访问（路由 404 老问题）
 *
 * 退出码：0 = 通过；1 = 任一检查失败；2 = 环境错误
 */

import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const FRONTEND_URL = process.env.REGRESSION_FRONTEND_URL || 'http://127.0.0.1:3010';
let API_BASE = process.env.REGRESSION_API_BASE || 'http://127.0.0.1:3011/api';
const KEEP = process.env.REGRESSION_KEEP_SERVERS === '1';
const SELF_HOST =
  process.env.REGRESSION_SELF_HOST === '1' ||
  !process.env.REGRESSION_API_BASE; // 默认自起服务（CI/本地都自包含）

let failures = 0;
const report = (ok, message, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${message}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(url, timeoutMs = 45000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // retry
    }
    await sleep(1000);
  }
  return false;
}

// ─────────────────────────────────────────────────────────────
// 自起服务：临时 SQLite 库 + 独立后端实例
// ─────────────────────────────────────────────────────────────

async function startSelfHosted() {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const tmpDbDir = mkdtempSync(join(tmpdir(), 'regression-guard-'));
  const dbPath = join(tmpDbDir, 'guard.sqlite');
  const dbUrl = `file:${dbPath}`;

  const backendRoot = join(ROOT, 'backend');
  const nodeBin = process.execPath;
  const cryptoModule = await import('node:crypto');
  const masterKey =
    process.env.KAYPAL_CREDENTIAL_MASTER_KEY ||
    // CI 无真实 master key：生成合法 32 字节 base64（bundle 只校验格式）
    cryptoModule.randomBytes(32).toString('base64');
  const child = spawn(
    nodeBin,
    ['dist-bundle-sqlite/index.js'],
    {
      cwd: backendRoot,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: '3199',
        DATABASE_URL: dbUrl,
        SQLITE_DATABASE_URL: dbUrl,
        // 关键：不要设 KAYPAL_DESKTOP_DATABASE_MODE=sqlite！
        // main.ts 的 normalizeDesktopSqliteEnv 会强制把库覆盖成
        // KAYPAL_DESKTOP_USER_DATA_DIR/kaypal-ai.sqlite，导致临时库白建。
        // bundle provider 本身是 sqlite，直接传绝对 DATABASE_URL 即可。
        KAYPAL_AUTH_BASE_URL: 'https://kaypal.cn',
        AUTH_COOKIE_NAME: 'ai_content_session',
        AUTH_SESSION_DAYS: '14',
        AUTH_COOKIE_SECURE: 'false',
        PUBLIC_ORIGIN: 'http://127.0.0.1:3199',
        HTTP_PROXY: '',
        HTTPS_PROXY: '',
        http_proxy: '',
        https_proxy: '',
        NODE_OPTIONS: '',
        KAYPAL_CREDENTIAL_MASTER_KEY: masterKey,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let bootLog = '';
  child.stdout.on('data', (d) => {
    bootLog += d.toString();
    if (bootLog.length > 4000) bootLog = bootLog.slice(-2000);
  });
  child.stderr.on('data', (d) => {
    bootLog += d.toString();
    if (bootLog.length > 4000) bootLog = bootLog.slice(-2000);
  });

  const apiBase = `http://127.0.0.1:3199/api`;
  const ready = await waitFor(`${apiBase}/auth/setup-status`, 60000);
  if (!ready) {
    console.error('后端启动失败，日志:\n', bootLog.slice(-1500));
    child.kill();
    process.exit(2);
  }

  return {
    child,
    apiBase,
    prismaEnv: {
      DATABASE_URL: dbUrl,
      SQLITE_DATABASE_URL: dbUrl,
    },
    frontendUrl: FRONTEND_URL,
  };
}

// ─────────────────────────────────────────────────────────────
// R1: 建表完整性（用 node:sqlite 直接查 sqlite_master）
// ─────────────────────────────────────────────────────────────

async function checkSchemaTables(sqliteDbPath) {
  const { DatabaseSync } = await import('node:sqlite');
  const schemaPath = join(ROOT, 'backend', 'prisma', 'schema.prisma');
  const schemaSource = readFileSync(schemaPath, 'utf8');

  // 解析全部表名
  const tables = [];
  const modelRegex = /^model\s+(\w+)\s*\{/gm;
  let match;
  while ((match = modelRegex.exec(schemaSource)) !== null) {
    const blockStart = match.index;
    const nextModel = schemaSource.indexOf('\nmodel ', blockStart + 1);
    const block = schemaSource.slice(
      blockStart,
      nextModel === -1 ? schemaSource.length : nextModel,
    );
    const mapMatch = block.match(/@@map\("([^"]+)"\)/);
    tables.push(
      mapMatch
        ? mapMatch[1]
        : match[1]
            .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
            .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
            .toLowerCase(),
    );
  }

  // 查实际表
  const db = new DatabaseSync(sqliteDbPath);
  const actual = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%'",
    )
    .all();
  db.close();
  const actualNames = new Set(actual.map((r) => r.name));

  const missing = tables.filter((t) => !actualNames.has(t));
  report(
    missing.length === 0,
    `R1 建表完整性：${tables.length} 张表全部存在`,
    missing.length ? `缺失: ${missing.slice(0, 5).join(', ')}` : '',
  );
}

// ─────────────────────────────────────────────────────────────
// R2: 权限放开（member 创建获客不 403）
// 用 node:sqlite 直插测试数据，绕开 PrismaClient provider 限制
// ─────────────────────────────────────────────────────────────

async function checkPermissionOpen(sqliteDbPath, apiBase) {
  const { DatabaseSync } = await import('node:sqlite');
  const crypto = await import('node:crypto');
  const db = new DatabaseSync(sqliteDbPath);

  const userId = 'guard-member-1';
  const sessionToken = crypto.randomBytes(32).toString('base64url');
  const now = new Date().toISOString();

  try {
    db.exec('BEGIN');
    db.prepare(
      `INSERT INTO users (id, username, email, password_hash, name, status, role, plan_mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', 'member', 'trial', ?, ?)`,
    ).run(userId, 'guard_member_1', 'guard-member-1@kaypal.local', 'x', '守卫成员', now, now);
    db.prepare(
      `INSERT INTO tenants (id, name, slug, status, owner_user_id, created_at, updated_at)
       VALUES ('guard-tenant-1', '守卫组织', 'guard-tenant-1', 'active', ?, ?, ?)`,
    ).run(userId, now, now);
    db.prepare(
      `INSERT INTO tenant_members (id, tenant_id, user_id, role, status, joined_at, created_at, updated_at)
       VALUES ('guard-tm-1', 'guard-tenant-1', ?, 'member', 'active', ?, ?, ?)`,
    ).run(userId, now, now, now);
    db.prepare(
      `INSERT INTO user_sessions (id, user_id, token_hash, expires_at, last_used_at, metadata, created_at, updated_at)
       VALUES ('guard-session-1', ?, ?, ?, ?, '{}', ?, ?)`,
    ).run(
      userId,
      crypto.createHash('sha256').update(sessionToken).digest('hex'),
      new Date(Date.now() + 86400000).toISOString(),
      now,
      now,
      now,
    );
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    db.close();
    report(false, `R2 权限放开：无法写入测试数据 — ${String(e.message).slice(0, 80)}`);
    return;
  }
  db.close();

  const res = await fetch(`${apiBase}/growth/acquisition/configs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `ai_content_session=${sessionToken}`,
      // 明确组织，避免多租户 409（TENANT_SELECTION_REQUIRED）
      'x-tenant-id': 'guard-tenant-1',
    },
    body: JSON.stringify({
      taskName: 'guard-permission-check',
      platform: 'douyin',
      accountId: 'guard-account-1',
      sourceInputs: ['守卫词'],
      includeKeywords: ['守卫'],
      commentTemplates: ['你好'],
      dailyLimit: 5,
      perTargetLimit: 1,
      scheduleEnabled: false,
      beginTime: '',
      riskMode: 'confirm-first',
      status: 'enabled',
    }),
  });

  const body = await res.text();
  const ok =
    res.status === 201 ||
    // 允许"账号不属于本组织"（数据隔离），但不允许 403 权限拦截
    (res.status === 400 && body.includes('平台账号'));
  report(
    ok,
    `R2 权限放开：member 创建获客 → HTTP ${res.status}（非 403）`,
    res.status === 403 ? '仍被权限拦截！' : '',
  );

  // 清理
  const db2 = new DatabaseSync(sqliteDbPath);
  db2.prepare('DELETE FROM user_sessions WHERE id = ?').run('guard-session-1');
  db2.prepare('DELETE FROM tenant_members WHERE id = ?').run('guard-tm-1');
  db2.prepare('DELETE FROM tenants WHERE id = ?').run('guard-tenant-1');
  db2.prepare('DELETE FROM users WHERE id = ?').run(userId);
  db2.prepare("DELETE FROM growth_acquisition_configs WHERE task_name = 'guard-permission-check'").run();
  db2.close();
}

// ─────────────────────────────────────────────────────────────
// R3: BigInt 序列化（comment-acquisition/leads 不 500）
// ─────────────────────────────────────────────────────────────

async function checkBigIntSerialization(sqliteDbPath, apiBase) {
  const { DatabaseSync } = await import('node:sqlite');
  const crypto = await import('node:crypto');
  const db = new DatabaseSync(sqliteDbPath);

  const userId = 'guard-admin-1';
  const sessionToken = crypto.randomBytes(32).toString('base64url');
  const now = new Date().toISOString();

  // 建 admin 用户 + session + 一条含 INTEGER 列的 lead
  try {
    db.exec('BEGIN');
    db.prepare(
      `INSERT INTO users (id, username, email, password_hash, name, status, role, plan_mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', 'admin', 'trial', ?, ?)`,
    ).run(userId, 'guard_admin_1', 'guard-admin-1@kaypal.local', 'x', '守卫管理员', now, now);
    db.prepare(
      `INSERT INTO user_sessions (id, user_id, token_hash, expires_at, last_used_at, metadata, created_at, updated_at)
       VALUES ('guard-session-2', ?, ?, ?, ?, '{}', ?, ?)`,
    ).run(
      userId,
      crypto.createHash('sha256').update(sessionToken).digest('hex'),
      new Date(Date.now() + 86400000).toISOString(),
      now,
      now,
      now,
    );
    db.prepare(
      `INSERT OR IGNORE INTO leads
        (id, user_id, platform, source_type, source_account_id, source_text, dedupe_key, score)
       VALUES ('guard-lead-1', ?, 'douyin', 'comment', 'guard-acct', '守卫评论', 'lead:guard-lead-1', 42)`,
    ).run(userId);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    db.close();
    report(
      false,
      `R3 BigInt 序列化：无法写入测试数据 — ${String(e.message).slice(0, 80)}`,
    );
    return;
  }
  db.close();

  const res = await fetch(`${apiBase}/comment-acquisition/leads?platform=douyin&limit=5`, {
    headers: { Cookie: `ai_content_session=${sessionToken}` },
  });
  report(
    res.status === 200,
    `R3 BigInt 序列化：/comment-acquisition/leads → HTTP ${res.status}`,
    res.status !== 200 ? 'JSON 序列化仍可能崩溃' : '',
  );

  // 清理
  const db2 = new DatabaseSync(sqliteDbPath);
  db2.prepare("DELETE FROM leads WHERE id = 'guard-lead-1'").run();
  db2.prepare('DELETE FROM user_sessions WHERE id = ?').run('guard-session-2');
  db2.prepare('DELETE FROM users WHERE id = ?').run(userId);
  db2.close();
}

// ─────────────────────────────────────────────────────────────
// R4: 关键路由无 404（浏览器扫描）
// ─────────────────────────────────────────────────────────────

async function checkRoutes(frontendUrl) {
  let chromium;
  try {
    // playwright 装在 backend/node_modules
    const backendRequire = createRequire(join(ROOT, 'backend', 'package.json'));
    ({ chromium } = backendRequire('playwright'));
  } catch {
    report(false, 'R4 路由检查：找不到 playwright（backend node_modules 需安装）');
    return;
  }

  const criticalRoutes = [
    '/message.html',
    '/engagement/wechat.html',
    '/engagement/comment-acquisition.html',
    '/auto-acquisition/create.html',
    '/growth.html',
    '/tasks/confirmations.html',
  ];

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  let failedRoutes = [];

  for (const route of criticalRoutes) {
    const page = await ctx.newPage();
    const notFound = [];
    page.on('response', (r) => {
      if (r.status() === 404 && !r.url().includes('/_next/')) {
        notFound.push(r.url().split('3010')[1] || r.url());
      }
    });
    try {
      await page.goto(`${frontendUrl}${route}`, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });
      await page.waitForTimeout(2000);
      const finalUrl = page.url();
      if (notFound.length) {
        failedRoutes.push(`${route}(404: ${notFound[0]})`);
      }
    } catch (e) {
      failedRoutes.push(`${route}(加载失败)`);
    }
    await page.close();
  }
  await browser.close();

  report(
    failedRoutes.length === 0,
    `R4 关键路由静态页无 404（${criticalRoutes.length} 个路由）`,
    failedRoutes.join(', '),
  );
}

// ─────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────

async function main() {
  console.log('=== 真机回归守卫 ===');
  console.log(`前端: ${FRONTEND_URL}`);
  console.log(`API: ${API_BASE}`);
  console.log(`模式: ${SELF_HOST ? '自起独立后端（临时 SQLite 库）' : '连接现有服务'}`);

  let selfHosted = null;
  if (SELF_HOST) {
    selfHosted = await startSelfHosted();
    API_BASE = selfHosted.apiBase;
    console.log(`已自起后端: ${API_BASE}`);
  }

  if (selfHosted) {
    const dbPath = selfHosted.prismaEnv.DATABASE_URL.replace('file:', '');
    await checkSchemaTables(dbPath);
    await checkPermissionOpen(dbPath, API_BASE);
    await checkBigIntSerialization(dbPath, API_BASE);
  } else {
    report(false, 'R1-R3 需自起模式（临时库）运行，请勿用 REGRESSION_API_BASE 连接模式');
  }

  await checkRoutes(FRONTEND_URL);

  if (selfHosted && !KEEP) {
    selfHosted.child.kill();
    console.log('已停止自起后端');
  }

  if (failures) {
    console.error(`\n✗ 真机回归守卫未通过（${failures} 处问题）`);
    process.exit(1);
  }
  console.log('\n✓ 真机回归守卫全部通过');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(2);
});
