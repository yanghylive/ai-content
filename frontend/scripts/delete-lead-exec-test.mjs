#!/usr/bin/env node
// 删除线索「真执行」测试：造测试 lead → 浏览器里真点删除 → 确认 modal 点「确认删除」→ 验证库中删除 + 页面反馈。
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chromium } from '/Users/yanghy/Documents/New project/ai-content/backend/node_modules/playwright/index.mjs';

const FRONTEND = 'http://127.0.0.1:3010';
const DB = process.env.HOME + '/Library/Application Support/ai-content-desktop/kaypal-ai.sqlite';
const USER_ID = 'cmsmjmskh01xwi5opfmpmu30n';

function sqlite(stmts) {
  const r = spawnSync('sqlite3', [DB, stmts.join(';\n') + ';'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr || 'sqlite3 failed');
}
function q1(sqlText) {
  const r = spawnSync('sqlite3', [DB, sqlText], { encoding: 'utf8' });
  return (r.stdout || '').trim();
}

const token = randomBytes(32).toString('base64url');
const tokenHash = createHash('sha256').update(token).digest('hex');
const sid = `del_${randomBytes(8).toString('hex')}`;
const now = new Date();
const expiresAt = new Date(Date.now() + 24 * 3600 * 1000);
const metadata = {
  source: 'delete-exec-test', localOnly: true,
  kaypalSubscriptionPlan: 'ADVANCED', kaypalSubscriptionPeriodEnd: new Date(Date.now() + 30 * 86400 * 1000).toISOString(),
  kaypalRole: 'SUPER_ADMIN', kaypalPlatformRole: 'SUPER_ADMIN', kaypalPermissionNames: ['console_quality_scan'],
  kaypalMetadataSyncedAt: now.toISOString(),
};
sqlite([
  `INSERT INTO user_sessions (id,user_id,token_hash,expires_at,last_used_at,metadata,created_at,updated_at) VALUES ('${sid}','${USER_ID}','${tokenHash}','${expiresAt.toISOString()}','${now.toISOString()}','${JSON.stringify(metadata)}','${now.toISOString()}','${now.toISOString()}')`,
]);

const nickname = `删除测试-${Date.now()}`;
let pass = 0, fail = 0;
const ok = (l, d) => { pass++; console.log(`✅ PASS  ${l}  ${d}`); };
const bad = (l, d) => { fail++; console.log(`❌ FAIL  ${l}  ${d}`); };

const browser = await chromium.launch({ headless: true });
let leadId = '';
try {
  // 1. 造测试线索
  const createRes = await fetch(`${FRONTEND}/api/growth/leads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': `ai_content_session=${token}` },
    body: JSON.stringify({ sourceText: '删除链路测试线索', platform: 'douyin', nickname }),
  });
  const createBody = await createRes.json();
  leadId = createBody?.data?.id;
  if (createRes.ok && leadId) ok('造测试线索', `id=${leadId}`);
  else bad('造测试线索', `status=${createRes.status} ${JSON.stringify(createBody)}`);

  // 2. 打开 /growth/leads 线索池页面
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ name: 'ai_content_session', value: token, url: FRONTEND, httpOnly: true, sameSite: 'Lax' }]);
  const page = await context.newPage();
  const consoleErrs = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 130)); });

  await page.goto(`${FRONTEND}/growth/leads`, { waitUntil: 'networkidle', timeout: 25000 });
  await page.waitForTimeout(2000);
  ok('打开 /growth/leads 线索池', page.url());

  // 3. 找到测试线索的删除按钮（nickname 的最近卡片祖先里的 button[title="删除线索"]）
  const deleteBtn = page
    .getByText(nickname, { exact: true })
    .first()
    .locator('xpath=ancestor::*[.//button[@title="删除线索"]][1]//button[@title="删除线索"]');
  try {
    await deleteBtn.waitFor({ state: 'visible', timeout: 15000 });
    ok('线索列表渲染出测试线索 + 删除按钮', nickname);
  } catch {
    bad('线索列表渲染测试线索', '未找到 ' + nickname);
  }
  await deleteBtn.click({ timeout: 5000 });
  ok('点击删除按钮', '已点击');

  // 4. 确认 modal 出现 + 点「删除」确认
  await page.getByText(`删除线索「${nickname}」`, { exact: true }).waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  const confirmBtn = page.locator('[role="dialog"]').getByRole('button', { name: '删除', exact: true });
  await confirmBtn.click({ timeout: 5000 });
  ok('点击确认框「删除」', '已确认');

  // 5. 验证：列表刷新，测试线索从页面消失
  await page.waitForTimeout(1500);
  const nicknameCount = await page.getByText(nickname, { exact: true }).count();
  if (nicknameCount === 0) ok('列表刷新，线索从页面消失', `剩余 ${nicknameCount} 条`);
  else bad('列表刷新', `页面仍显示 ${nicknameCount} 条「${nickname}」`);

  // 6. 验证库中删除
  const remain = q1(`SELECT count(*) FROM leads WHERE id='${leadId}'`);
  if (remain === '0') ok('库中线索已删除', `leads 表剩余=${remain}`);
  else bad('库中线索删除', `leads 表仍剩 ${remain} 条`);

  if (consoleErrs.length) bad('浏览器 console 错误', consoleErrs.slice(0, 3).join(' | '));
  else ok('全程无 console 错误', '0 个');

  await context.close();
} catch (e) {
  bad('脚本异常', e.message);
} finally {
  // 兜底清理（若删除失败残留）
  if (leadId) sqlite([`DELETE FROM leads WHERE id='${leadId}'`, `DELETE FROM lead_signals WHERE lead_id='${leadId}'`, `DELETE FROM lead_score_snapshots WHERE lead_id='${leadId}'`]);
  sqlite([`DELETE FROM user_sessions WHERE id='${sid}'`]);
  await browser.close();
}

console.log(`\n════════ 结果 ════════\nPASS=${pass} FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
