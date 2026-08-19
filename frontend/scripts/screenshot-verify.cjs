// 页面截图验证：带登录态访问今天改过的页面，截图看实际渲染效果
const { randomBytes, createHash } = require('crypto');
const { spawnSync } = require('child_process');
const { homedir } = require('os');
const { join } = require('path');
const { existsSync, writeFileSync } = require('fs');

const playwright = require('/Users/yanghy/Documents/New project/kaypal-ai/node_modules/playwright');
const dbPath = join(homedir(), 'Library/Application Support/ai-content-desktop/kaypal-ai.sqlite');

function sqlite(stmts) {
  const r = spawnSync('sqlite3', [dbPath, stmts.join('\n')], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout || '';
}
function quote(s) { return `'${String(s).replaceAll("'", "''")}'`; }

// 创建 localOnly session
const userId = sqlite(["SELECT id FROM users WHERE status='active' ORDER BY updated_at DESC LIMIT 1;"]).trim();
const token = randomBytes(32).toString('base64url');
const hash = createHash('sha256').update(token).digest('hex');
const sid = 'screenshot_verify_' + Date.now();
const now = new Date().toISOString();
const exp = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
const meta = JSON.stringify({ source: 'screenshot-verify', localOnly: true, kaypalRole: 'SUPER_ADMIN', kaypalPlatformRole: 'SUPER_ADMIN' });
sqlite([`INSERT INTO user_sessions (id, user_id, token_hash, expires_at, last_used_at, metadata, created_at, updated_at) VALUES (${quote(sid)}, ${quote(userId)}, ${quote(hash)}, ${quote(exp)}, ${quote(now)}, ${quote(meta)}, ${quote(now)}, ${quote(now)});`]);
console.log('session created');

const FRONTEND = 'http://127.0.0.1:3010';
const OUT = '/Users/yanghy/Documents/New project/ai-content/docs/acceptance-evidence-2026-08-18/screenshots';
const pages = [
  { url: '/today', name: 'today.png', wait: 3000 },
  { url: '/growth/reports', name: 'growth-reports.png', wait: 3000 },
  { url: '/message', name: 'message.png', wait: 3000 },
  { url: '/distribution', name: 'distribution.png', wait: 3000 },
  { url: '/apps/auto-acquisition', name: 'auto-acquisition.png', wait: 3000 },
];

(async () => {
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([
    { url: FRONTEND, name: 'ai_content_session', value: token, httpOnly: true, sameSite: 'Lax' },
    { url: 'http://127.0.0.1:3011', name: 'ai_content_session', value: token, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  for (const p of pages) {
    try {
      await page.goto(FRONTEND + p.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(p.wait);
      await page.screenshot({ path: join(OUT, p.name), fullPage: false });
      const textLen = await page.evaluate(() => (document.body?.innerText || '').length);
      console.log(`✅ ${p.url} → ${p.name} (textLength=${textLen})`);
    } catch (e) {
      console.log(`❌ ${p.url} → ERROR: ${e.message.slice(0, 100)}`);
    }
  }

  if (errors.length) console.log('page errors:', errors.slice(0, 5));
  await browser.close();

  // 清理 session
  sqlite([`DELETE FROM user_sessions WHERE id = ${quote(sid)};`]);
  console.log('done, session cleaned');
})();
