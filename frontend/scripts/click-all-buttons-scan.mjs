#!/usr/bin/env node
// 全站按钮点击扫描：遍历所有 dashboard 路由，枚举每个页面的按钮，安全按钮实际点击，收集报错。
// 危险按钮（删除/发布/外发/支付等）跳过不点，避免破坏数据或触发真实外发。
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '/Users/yanghy/Documents/New project/ai-content/backend/node_modules/playwright/index.mjs';

const FRONTEND = 'http://127.0.0.1:3010';
const DB = process.env.HOME + '/Library/Application Support/ai-content-desktop/kaypal-ai.sqlite';
const USER_ID = 'cmsmjmskh01xwi5opfmpmu30n';
const FRONTEND_ROOT = '/Users/yanghy/Documents/New project/ai-content/frontend';
const MAX_BUTTONS_PER_PAGE = 25;
const OUT_DIR = '/Users/yanghy/Documents/New project/ai-content/docs/acceptance-evidence-2026-08-18';

// —— 危险按钮黑名单（跳过不点，避免破坏数据/触发真实外发）——
const DANGEROUS = /删除|移除|清空|发布|外发|上传|支付|购买|下单|结算|退款|注销|退出登录|退出|解绑|重置|下架|停用|解散|踢出|拉黑|销毁|格式化|恢复出厂|批量删除|永久删除|关闭账号|取消订阅|合并客户|合并线索|解绑账号|断开连接|删除账号/i;

function sqlite(stmts) {
  const r = spawnSync('sqlite3', [DB, stmts.join(';\n') + ';'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr || 'sqlite3 failed');
}

// —— 收集路由 ——
function collectRoutes() {
  const dashboardRoot = path.join(FRONTEND_ROOT, 'src/app/(dashboard)');
  const files = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.name === 'page.tsx') files.push(abs);
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

// —— session ——
const token = randomBytes(32).toString('base64url');
const tokenHash = createHash('sha256').update(token).digest('hex');
const sessionId = `btnscan_${randomBytes(12).toString('hex')}`;
const now = new Date();
const expiresAt = new Date(Date.now() + 24 * 3600 * 1000);
const metadata = {
  source: 'button-click-scan', localOnly: true,
  kaypalSubscriptionPlan: 'ADVANCED', kaypalSubscriptionPeriodEnd: new Date(Date.now() + 30 * 86400 * 1000).toISOString(),
  kaypalRole: 'SUPER_ADMIN', kaypalPlatformRole: 'SUPER_ADMIN', kaypalPermissionNames: ['console_quality_scan'],
  kaypalMetadataSyncedAt: now.toISOString(),
};

const IGNORABLE = /Download the React DevTools|HMR|Fast Refresh|ResizeObserver loop|favicon\.ico|was preloaded using link preload|Minified React error #418|Allow attribute will take precedence|AudioContext was not allowed|React DevTools|Source map/i;

const args = process.argv.slice(2);
const limitArg = args.indexOf('--limit');
const routesArg = args.indexOf('--routes');
let routes = collectRoutes();
if (routesArg >= 0 && args[routesArg + 1]) {
  routes = routes.filter((r) => args[routesArg + 1].split(',').includes(r));
} else if (limitArg >= 0 && args[limitArg + 1]) {
  routes = routes.slice(0, Number(args[limitArg + 1]));
}
console.log(`共 ${routes.length} 个 dashboard 路由，开始按钮点击扫描…\n`);

sqlite([
  `INSERT INTO user_sessions (id,user_id,token_hash,expires_at,last_used_at,metadata,created_at,updated_at) VALUES ('${sessionId}','${USER_ID}','${tokenHash}','${expiresAt.toISOString()}','${now.toISOString()}','${JSON.stringify(metadata)}','${now.toISOString()}','${now.toISOString()}')`,
]);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addCookies([{ name: 'ai_content_session', value: token, url: FRONTEND, httpOnly: true, sameSite: 'Lax' }]);

const report = { routes: [] };
let totalClicked = 0, totalSkipped = 0, totalErrors = 0;

for (const [idx, route] of routes.entries()) {
  const page = await context.newPage();
  const pageResult = { route, buttons: [], errors: [] };
  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', (m) => {
    if (m.type() === 'error' && !IGNORABLE.test(m.text())) {
      const loc = m.location() || {};
      consoleErrors.push(`${m.text().slice(0, 140)} @ ${loc.url || '?'}`);
    }
  });
  page.on('pageerror', (e) => pageErrors.push(e.message.slice(0, 160)));

  let opened = true;
  try {
    await page.goto(`${FRONTEND}${route}`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1500);
  } catch {
    opened = false;
    pageResult.errors.push('页面打开超时/失败');
  }

  if (opened) {
    // 枚举按钮（button 或 role=button，规范化空白以便后续按文字匹配）
    let buttons = [];
    try {
      buttons = await page.evaluate((limit) => {
        const els = [...document.querySelectorAll('button, [role="button"]')];
        return els
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          })
          .map((el) => (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim().replace(/\s+/g, ' '))
          .filter((t) => t && t.length < 40)
          .slice(0, limit);
      }, MAX_BUTTONS_PER_PAGE);
    } catch { /* 忽略 */ }

    const baseUrl = page.url();
    for (const text of buttons) {
      const isDangerous = DANGEROUS.test(text);
      const before = consoleErrors.length;
      if (isDangerous) {
        totalSkipped++;
        pageResult.buttons.push({ text, action: 'skipped-dangerous' });
        continue;
      }

      let action = 'clicked-ok';
      let error = '';
      try {
        // DOM 层 find + click（按规范化文字匹配，避免 getByRole name 对多行/badge 按钮匹配失败）
        const clickResult = await page.evaluate((t) => {
          const els = [...document.querySelectorAll('button, [role="button"]')];
          const el = els.find((e) => (e.innerText || e.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ') === t);
          if (!el) return 'not-found';
          if (el.disabled || el.getAttribute('aria-disabled') === 'true') return 'disabled';
          el.click();
          return 'clicked';
        }, text);
        if (clickResult === 'not-found') { action = 'not-found'; }
        else if (clickResult === 'disabled') { action = 'disabled'; }
        else {
          await page.waitForTimeout(350);
          if (page.url() !== baseUrl) {
            action = 'navigated';
            await page.goBack({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {});
            await page.waitForTimeout(300);
          } else {
            await page.keyboard.press('Escape').catch(() => {});
            await page.waitForTimeout(150);
          }
        }
      } catch (e) {
        action = 'click-failed';
        error = String(e.message).split('\n')[0].slice(0, 120);
      }
      const newErrors = consoleErrors.slice(before);
      if (newErrors.length) {
        error = (error ? error + ' | ' : '') + newErrors.join(' || ');
        action = 'error';
      }
      if (error) pageResult.errors.push({ text, error });
      pageResult.buttons.push({ text, action, error: error || undefined });
      totalClicked++;
      if (error) totalErrors++;
    }
    if (pageErrors.length) pageResult.errors.push({ text: '(pageerror)', error: pageErrors.join(' || ') });
  }

  report.routes.push(pageResult);
  const errCount = pageResult.errors.length;
  if (errCount > 0) console.log(`[${idx + 1}/${routes.length}] ❌ ${route} — ${pageResult.buttons.length} 按钮，${errCount} 报错`);
  else console.log(`[${idx + 1}/${routes.length}] ✅ ${route} — ${pageResult.buttons.length} 按钮`);
  await page.close();
}

sqlite([`DELETE FROM user_sessions WHERE id='${sessionId}'`]);
await browser.close();

// —— 汇总报告 ——
const routesWithErrors = report.routes.filter((r) => r.errors.length > 0);
const summary = {
  totalRoutes: routes.length,
  totalClicked,
  totalSkipped,
  totalErrors,
  routesWithErrors: routesWithErrors.map((r) => ({ route: r.route, errors: r.errors })),
};
const ts = new Date().toISOString().replace(/[:.]/g, '-');
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(path.join(OUT_DIR, `button-click-scan-${ts}.json`), JSON.stringify(summary, null, 2));
writeFileSync(
  path.join(OUT_DIR, `button-click-scan-${ts}.md`),
  `# 全站按钮点击扫描报告\n\n- 总路由：${routes.length}\n- 实际点击按钮：${totalClicked}\n- 跳过危险按钮：${totalSkipped}\n- 报错按钮数：${totalErrors}\n\n## 有报错的路由\n\n${
    routesWithErrors.length
      ? routesWithErrors
          .map((r) => `### ${r.route}\n\n${r.errors.map((e) => `- 按钮「${e.text}」：${e.error}`).join('\n')}`)
          .join('\n\n')
      : '（无）'
  }`,
);

console.log(`\n════════ 汇总 ════════`);
console.log(`总路由 ${routes.length} | 点击 ${totalClicked} | 跳过危险 ${totalSkipped} | 报错 ${totalErrors}`);
console.log(`有报错的路由 ${routesWithErrors.length} 个，报告已写入 ${OUT_DIR}/button-click-scan-${ts}.md`);
process.exit(0);
