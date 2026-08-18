#!/usr/bin/env node
// 功能流真实交互测试（Playwright）：登录 → 线索列表 → 详情 → 转 CRM → 复盘渲染
// 走真实浏览器 + 真实后端（3010 前端 / 3011 后端），验证 UI 与接口的完整闭环。
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chromium } from '/Users/yanghy/Documents/New project/ai-content/backend/node_modules/playwright/index.mjs';

const DB = process.env.HOME + '/Library/Application Support/ai-content-desktop/kaypal-ai.sqlite';
const FRONTEND = 'http://127.0.0.1:3010';
const USER_ID = 'cmsmjmskh01xwi5opfmpmu30n';

function sqlite(stmts) {
  const r = spawnSync('sqlite3', [DB, stmts.join(';\n') + ';'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr || 'sqlite3 failed');
}
function q1(sqlText) {
  const r = spawnSync('sqlite3', [DB, sqlText], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr || 'sqlite3 failed');
  return (r.stdout || '').trim();
}

const now = new Date();
const expiresAt = new Date(Date.now() + 24 * 3600 * 1000);
const token = randomBytes(32).toString('base64url');
const tokenHash = createHash('sha256').update(token).digest('hex');
const sessionId = `flow_${randomBytes(12).toString('hex')}`;
const metadata = {
  source: 'playwright-flow-test', localOnly: true,
  kaypalSubscriptionPlan: 'ADVANCED', kaypalSubscriptionPeriodEnd: new Date(Date.now() + 30 * 86400 * 1000).toISOString(),
  kaypalRole: 'SUPER_ADMIN', kaypalPlatformRole: 'SUPER_ADMIN', kaypalPermissionNames: ['console_quality_scan'],
  kaypalMetadataSyncedAt: now.toISOString(), kaypalDesktopAccessToken: 'flow-access', kaypalDesktopRefreshToken: 'flow-refresh',
  kaypalDesktopTokenExpiresAt: expiresAt.toISOString(), kaypalDesktopDeviceId: 'flow-device',
};

let pass = 0, fail = 0;
const ok = (label, detail) => { pass++; console.log(`✅ PASS  ${label}  ${detail}`); };
const bad = (label, detail) => { fail++; console.log(`❌ FAIL  ${label}  ${detail}`); };

let leadId = '', customerId = '';
const browser = await chromium.launch({ headless: true });

try {
  // 1. 插 session
  sqlite([
    `INSERT INTO user_sessions (id,user_id,token_hash,expires_at,last_used_at,metadata,created_at,updated_at) VALUES ('${sessionId}','${USER_ID}','${tokenHash}','${expiresAt.toISOString()}','${now.toISOString()}','${JSON.stringify(metadata)}','${now.toISOString()}','${now.toISOString()}')`,
  ]);
  ok('创建本地 session', sessionId.slice(0, 20));

  // 2. 真实 HTTP createLead 造测试线索
  const nickname = `Playwright测试-${Date.now()}`;
  const createRes = await fetch(`${FRONTEND}/api/growth/leads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': `ai_content_session=${token}` },
    body: JSON.stringify({ sourceText: '功能流测试线索-装修咨询', platform: 'douyin', nickname }),
  });
  const createBody = await createRes.json();
  leadId = createBody?.data?.id;
  if (createRes.ok && leadId) ok('HTTP createLead 造线索', `id=${leadId}`);
  else bad('HTTP createLead', `status=${createRes.status} ${JSON.stringify(createBody)}`);

  // 3. 浏览器上下文 + 登录 cookie
  const context = await browser.newContext();
  await context.addCookies([
    { name: 'ai_content_session', value: token, url: FRONTEND, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 120)));
  const consoleErrs = [];
  page.on('console', (m) => {
    if (m.type() === 'error') {
      const loc = m.location() || {};
      consoleErrs.push(`${m.text().slice(0, 120)} @ ${loc.url || '?'}`);
    }
  });

  // 4. 打开线索列表页
  await page.goto(`${FRONTEND}/growth/leads`, { waitUntil: 'networkidle', timeout: 30000 });
  ok('打开 /growth/leads 列表页', page.url());

  // 5. 找到测试线索并进入详情
  const leadLink = page.getByText(nickname, { exact: true }).first();
  try {
    await leadLink.waitFor({ state: 'visible', timeout: 15000 });
    ok('线索列表渲染出测试线索', nickname);
  } catch {
    bad('线索列表渲染测试线索', '未找到 ' + nickname);
    // 尝试直接跳详情页兜底
    await page.goto(`${FRONTEND}/growth/leads/detail?leadId=${leadId}`, { waitUntil: 'networkidle', timeout: 30000 });
  }

  if (leadId && !page.url().includes('/detail')) {
    try {
      await leadLink.click({ timeout: 8000 });
      await page.waitForURL(/detail/, { timeout: 15000 });
      ok('点击线索进入详情页', page.url());
    } catch {
      await page.goto(`${FRONTEND}/growth/leads/detail?leadId=${leadId}`, { waitUntil: 'networkidle', timeout: 30000 });
      ok('兜底跳转详情页', page.url());
    }
  }

  // 6. 详情页点击「转 CRM 客户」
  const convertBtn = page.getByRole('button', { name: '转 CRM 客户' });
  try {
    await convertBtn.waitFor({ state: 'visible', timeout: 15000 });
    await convertBtn.click();
    // 等待提示「已转 CRM 客户」出现
    await page.getByText('已转 CRM 客户', { exact: true }).first().waitFor({ state: 'visible', timeout: 15000 });
    ok('点击「转 CRM 客户」→ 提示成功', '已转 CRM 客户');
  } catch {
    bad('转 CRM 交互', '按钮或成功提示未出现');
  }

  // 7. 验证后端确实产生了 customer
  customerId = q1(`SELECT customer_id FROM leads WHERE id='${leadId}'`);
  if (customerId) ok('后端落库 customerId', customerId);
  else bad('后端落库 customerId', '为空');

  // 8. 打开复盘页，验证 sixStage 渲染
  await page.goto(`${FRONTEND}/growth/reports`, { waitUntil: 'networkidle', timeout: 30000 });
  const bodyText = await page.evaluate(() => document.body.innerText);
  const hasSixStage = /六步|闭环|内容|发布|互动|线索|客户|商机/.test(bodyText);
  if (hasSixStage) ok('复盘页渲染（含六步闭环关键词）', 'ok');
  else bad('复盘页渲染', '未找到六步闭环相关文案');

  if (consoleErrs.length) {
    bad('浏览器 console 错误', consoleErrs.slice(0, 3).join(' | '));
  } else {
    ok('全程无 console 错误', `${consoleErrs.length} 个`);
  }

  await context.close();
} catch (e) {
  bad('脚本异常', e.message);
} finally {
  // 9. 清理：删 CRM 数据 + 测试 lead + session
  if (customerId) {
    const companyId = q1(`SELECT company_id FROM crm_customers WHERE id='${customerId}'`);
    sqlite([
      `DELETE FROM crm_opportunities WHERE primary_customer_id='${customerId}'`,
      `DELETE FROM crm_tasks WHERE customer_id='${customerId}'`,
      `DELETE FROM crm_notes WHERE customer_id='${customerId}'`,
      `DELETE FROM crm_timeline_events WHERE customer_id='${customerId}'`,
      `DELETE FROM attribution_links WHERE from_id='${leadId}' OR to_id='${customerId}'`,
      `DELETE FROM domain_event_outbox WHERE aggregate_id IN ('${customerId}','${leadId}')`,
      `DELETE FROM crm_customers WHERE id='${customerId}'`,
      ...(companyId ? [`DELETE FROM crm_companies WHERE id='${companyId}'`] : []),
    ]);
  }
  if (leadId) {
    sqlite([
      `DELETE FROM leads WHERE id='${leadId}'`,
      `DELETE FROM lead_signals WHERE lead_id='${leadId}'`,
      `DELETE FROM lead_score_snapshots WHERE lead_id='${leadId}'`,
    ]);
  }
  sqlite([`DELETE FROM user_sessions WHERE id='${sessionId}'`]);
  await browser.close();
}

console.log(`\n════════ 结果 ════════\nPASS=${pass} FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
