#!/usr/bin/env node
// 危险按钮点击扫描：专门点击删除/发布/外发/支付等危险按钮，验证「点击→弹确认框/跳转/API」链路是否报错。
// 安全保护：原生 confirm/alert 自动取消（不真正执行破坏操作）、自定义 modal ESC 关闭、跳转 goBack、退出登录后自动重登。
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '/Users/yanghy/Documents/New project/ai-content/backend/node_modules/playwright/index.mjs';

const FRONTEND = 'http://127.0.0.1:3010';
const DB = process.env.HOME + '/Library/Application Support/ai-content-desktop/kaypal-ai.sqlite';
const USER_ID = 'cmsmjmskh01xwi5opfmpmu30n';
const FRONTEND_ROOT = '/Users/yanghy/Documents/New project/ai-content/frontend';
const OUT_DIR = '/Users/yanghy/Documents/New project/ai-content/docs/acceptance-evidence-2026-08-18';

// 危险按钮分类（不含"上传"——那只是 headless 无法选文件，不是危险）
const DANGEROUS = {
  delete: /删除|移除|清空|批量删除|永久删除|标记删除|销毁|解散|踢出|拉黑/,
  publish: /发布|外发|推送/,
  payment: /支付|购买|下单|结算|退款|充值|提现/,
  account: /注销|退出登录|退出|解绑|断开连接|关闭账号|取消订阅|删除账号/,
  other: /重置|下架|停用|格式化|恢复出厂|合并客户|合并线索/,
};
function classify(text) {
  for (const [k, re] of Object.entries(DANGEROUS)) if (re.test(text)) return k;
  return null;
}

function sqlite(stmts) {
  const r = spawnSync('sqlite3', [DB, stmts.join(';\n') + ';'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr || 'sqlite3 failed');
}

function collectRoutes() {
  const dashboardRoot = path.join(FRONTEND_ROOT, 'src/app/(dashboard)');
  const files = [];
  (function walk(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.name === 'page.tsx') files.push(abs);
    }
  })(dashboardRoot);
  return files
    .map((f) => {
      const rel = path.relative(dashboardRoot, f).replaceAll(path.sep, '/');
      const route = rel.replace(/\/page\.tsx$/, '').replace(/^page\.tsx$/, '');
      return route ? `/${route}` : '/';
    })
    .sort();
}

// 插入 session，返回 token（供 cookie 使用）
function insertSession(prefix) {
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');
  const sid = `${prefix}_${randomBytes(8).toString('hex')}`;
  const now = new Date();
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000);
  const metadata = {
    source: 'dangerous-button-scan', localOnly: true,
    kaypalSubscriptionPlan: 'ADVANCED', kaypalSubscriptionPeriodEnd: new Date(Date.now() + 30 * 86400 * 1000).toISOString(),
    kaypalRole: 'SUPER_ADMIN', kaypalPlatformRole: 'SUPER_ADMIN', kaypalPermissionNames: ['console_quality_scan'],
    kaypalMetadataSyncedAt: now.toISOString(),
  };
  sqlite([
    `INSERT INTO user_sessions (id,user_id,token_hash,expires_at,last_used_at,metadata,created_at,updated_at) VALUES ('${sid}','${USER_ID}','${hash}','${expiresAt.toISOString()}','${now.toISOString()}','${JSON.stringify(metadata)}','${now.toISOString()}','${now.toISOString()}')`,
  ]);
  return { token, sid };
}

const IGNORABLE = /Download the React DevTools|HMR|Fast Refresh|ResizeObserver loop|favicon\.ico|was preloaded using link preload|AudioContext was not allowed|React DevTools|Source map/i;

const args = process.argv.slice(2);
const routesArg = args.indexOf('--routes');
const limitArg = args.indexOf('--limit');
let routes = collectRoutes();
if (routesArg >= 0 && args[routesArg + 1]) routes = routes.filter((r) => args[routesArg + 1].split(',').includes(r));
else if (limitArg >= 0 && args[limitArg + 1]) routes = routes.slice(0, Number(args[limitArg + 1]));
console.log(`共 ${routes.length} 个路由，开始危险按钮扫描…\n`);

let session = insertSession('dbtn');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addCookies([{ name: 'ai_content_session', value: session.token, url: FRONTEND, httpOnly: true, sameSite: 'Lax' }]);

const report = { routes: [] };
const stats = { delete: 0, publish: 0, payment: 0, account: 0, other: 0, clicked: 0, dialogCancelled: 0, navigated: 0, errors: 0 };

for (const [idx, route] of routes.entries()) {
  const page = await context.newPage();
  const pageResult = { route, buttons: [] };
  const consoleErrors = [];
  const pageErrors = [];

  // 原生 confirm/alert 自动取消（不真正执行破坏操作）
  page.on('dialog', (d) => { stats.dialogCancelled++; d.dismiss().catch(() => {}); });
  page.on('console', (m) => {
    if (m.type() === 'error' && !IGNORABLE.test(m.text())) {
      const loc = m.location() || {};
      consoleErrors.push(`${m.text().slice(0, 130)} @ ${loc.url || '?'}`);
    }
  });
  page.on('pageerror', (e) => pageErrors.push(e.message.slice(0, 150)));

  try {
    await page.goto(`${FRONTEND}${route}`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1500);
  } catch {
    await page.close();
    continue;
  }

  // 枚举危险按钮
  const buttons = await page.evaluate(() => {
    const els = [...document.querySelectorAll('button, [role="button"]')];
    return els
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
      .map((el) => (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' '))
      .filter((t) => t && t.length < 40)
      .slice(0, 60);
  });

  const baseUrl = page.url();
  let pageDangerous = 0;
  for (const text of buttons) {
    const kind = classify(text);
    if (!kind) continue; // 只点危险按钮
    stats[kind]++;
    pageDangerous++;
    const before = consoleErrors.length;
    let result = { text, kind, action: 'clicked' };

    try {
      const clickResult = await page.evaluate((t) => {
        const els = [...document.querySelectorAll('button, [role="button"]')];
        const el = els.find((e) => (e.innerText || e.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ') === t);
        if (!el) return 'not-found';
        if (el.disabled || el.getAttribute('aria-disabled') === 'true') return 'disabled';
        el.click();
        return 'clicked';
      }, text);

      if (clickResult === 'disabled') result.action = 'disabled';
      else if (clickResult === 'not-found') result.action = 'not-found';
      else {
        await page.waitForTimeout(400);
        if (page.url() !== baseUrl) {
          result.action = 'navigated';
          stats.navigated++;
          await page.goBack({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {});
          await page.waitForTimeout(300);
        } else {
          await page.keyboard.press('Escape').catch(() => {});
          await page.waitForTimeout(150);
        }
        // account 类（退出登录/解绑）可能使 session 失效 → 自动重登
        if (kind === 'account') {
          session = insertSession('dbtn');
          await context.addCookies([{ name: 'ai_content_session', value: session.token, url: FRONTEND, httpOnly: true, sameSite: 'Lax' }]);
        }
      }
    } catch (e) {
      result.action = 'click-failed';
      result.error = String(e.message).split('\n')[0].slice(0, 120);
    }
    const newErrors = consoleErrors.slice(before);
    if (newErrors.length) {
      result.error = (result.error ? result.error + ' | ' : '') + newErrors.join(' || ');
      result.action = 'error';
    }
    if (result.error) { stats.errors++; pageResult.buttons.push(result); }
    stats.clicked++;
  }
  if (pageErrors.length) pageResult.buttons.push({ text: '(pageerror)', kind: 'page', action: 'error', error: pageErrors.join(' || ') });

  if (pageResult.buttons.length) report.routes.push(pageResult);
  const errs = pageResult.buttons.filter((b) => b.error).length;
  console.log(`[${idx + 1}/${routes.length}] ${errs ? '❌' : '✅'} ${route} — 危险按钮 ${pageDangerous}，报错 ${errs}`);
  await page.close();
}

sqlite([`DELETE FROM user_sessions WHERE id LIKE 'dbtn_%'`]);
await browser.close();

// 汇总报告
const errRoutes = report.routes.filter((r) => r.buttons.some((b) => b.error));
const summary = {
  stats,
  errorRoutes: errRoutes.map((r) => ({ route: r.route, buttons: r.buttons.filter((b) => b.error) })),
};
const ts = new Date().toISOString().replace(/[:.]/g, '-');
writeFileSync(path.join(OUT_DIR, `dangerous-button-scan-${ts}.json`), JSON.stringify(summary, null, 2));
writeFileSync(
  path.join(OUT_DIR, `dangerous-button-scan-${ts}.md`),
  `# 危险按钮点击扫描报告\n\n- 点击危险按钮：${stats.clicked}\n- 分类：删除=${stats.delete} 发布=${stats.publish} 支付=${stats.payment} 账号=${stats.account} 其他=${stats.other}\n- 自动取消确认框：${stats.dialogCancelled}\n- 跳转：${stats.navigated}\n- 报错：${stats.errors}\n\n## 有报错的路由\n\n${
    errRoutes.length
      ? errRoutes.map((r) => `### ${r.route}\n\n${r.buttons.filter((b) => b.error).map((b) => `- 「${b.text}」(${b.kind})：${b.error}`).join('\n')}`).join('\n\n')
      : '（无）'
  }`,
);
console.log(`\n════════ 汇总 ════════`);
console.log(`点击 ${stats.clicked} | 删除 ${stats.delete} 发布 ${stats.publish} 支付 ${stats.payment} 账号 ${stats.account} 其他 ${stats.other}`);
console.log(`取消确认框 ${stats.dialogCancelled} | 跳转 ${stats.navigated} | 报错 ${stats.errors}`);
console.log(`有报错路由 ${errRoutes.length} 个，报告已写入 ${OUT_DIR}/dangerous-button-scan-${ts}.md`);
process.exit(0);
