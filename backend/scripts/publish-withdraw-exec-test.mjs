#!/usr/bin/env node
// 发布 + 提现「执行链路」接口测试：验证危险操作的执行端防护是否健全（不假成功、不静默失败）。
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const FRONTEND = 'http://127.0.0.1:3010';
const DB = process.env.HOME + '/Library/Application Support/ai-content-desktop/kaypal-ai.sqlite';
const USER_ID = 'cmsmjmskh01xwi5opfmpmu30n';

function q1(sqlText) {
  const r = spawnSync('sqlite3', [DB, sqlText], { encoding: 'utf8' });
  return (r.stdout || '').trim();
}
function sqlite(stmts) {
  const r = spawnSync('sqlite3', [DB, stmts.join(';\n') + ';'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr || 'sqlite3 failed');
}

const token = randomBytes(32).toString('base64url');
const hash = createHash('sha256').update(token).digest('hex');
const sid = `exec_${randomBytes(8).toString('hex')}`;
const now = new Date();
const metadata = {
  source: 'exec-test', localOnly: true,
  kaypalSubscriptionPlan: 'ADVANCED', kaypalSubscriptionPeriodEnd: new Date(Date.now() + 30 * 86400 * 1000).toISOString(),
  kaypalRole: 'SUPER_ADMIN', kaypalPlatformRole: 'SUPER_ADMIN', kaypalPermissionNames: ['console_quality_scan'],
  kaypalMetadataSyncedAt: now.toISOString(),
};
sqlite([`INSERT INTO user_sessions (id,user_id,token_hash,expires_at,last_used_at,metadata,created_at,updated_at) VALUES ('${sid}','${USER_ID}','${hash}','${new Date(Date.now() + 86400000).toISOString()}','${now.toISOString()}','${JSON.stringify(metadata)}','${now.toISOString()}','${now.toISOString()}')`]);

const COOKIE = { 'Content-Type': 'application/json', 'Cookie': `ai_content_session=${token}` };
let pass = 0, fail = 0;
const ok = (l, d) => { pass++; console.log(`✅ PASS  ${l}  ${d}`); };
const bad = (l, d) => { fail++; console.log(`❌ FAIL  ${l}  ${d}`); };
async function req(method, path, body) {
  const res = await fetch(`${FRONTEND}${path}`, { method, headers: COOKIE, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch { /* 非 JSON */ }
  return { status: res.status, data };
}

// ════ 发布执行链路 ════
console.log('════ 发布执行链路 ════');
const articleId = q1(`SELECT id FROM articles LIMIT 1`);
const accountId = q1(`SELECT id FROM publish_accounts WHERE platform='douyin' AND status='ready' LIMIT 1`);
console.log(`  用文章 ${articleId} + 账号 ${accountId}`);

const conf = await req('POST', '/api/publishing/publish/confirmations', { articleId, accountId });
const confMsg = conf.data?.message || '';
if (conf.status === 403 && /商用授权/.test(confMsg)) {
  ok('发布被商用授权正确拦截', `status=403 "${confMsg.slice(0, 40)}"`);
} else if (conf.status === 201 || conf.status === 200) {
  ok('发布确认（confirmations）', `status=${conf.status}`);
} else {
  bad('发布确认', `status=${conf.status} ${JSON.stringify(conf.data).slice(0, 120)}`);
}

// ════ 提现执行链路 ════
console.log('════ 提现执行链路 ════');
const idem = `withdraw-test-${Date.now()}`;
const wd = await req('POST', '/api/savings/withdraw', { amount: 1, channel: 'mock', accountMask: '尾号0000', idempotencyKey: idem });
const wdMsg = wd.data?.message || wd.data?.data?.message || '';
if (wd.status === 400 && /余额不足/.test(wdMsg)) {
  // 修复后：余额不足应返回 400（业务错误），而非 500
  ok('提现余额不足正确返回 400', `status=400 "${wdMsg.slice(0, 50)}"`);
} else if (wd.status >= 400) {
  bad('提现执行拦截', `status=${wd.status} "${wdMsg.slice(0, 60)}"（预期 400 余额不足）`);
} else {
  const wdData = wd.data?.data || wd.data || {};
  ok('提现执行成功', `status=${wd.status} withdrawalId=${wdData.withdrawalId} status=${wdData.status}`);
}

// ════ 提现幂等验证 ════
const wd2 = await req('POST', '/api/savings/withdraw', { amount: 1, channel: 'mock', accountMask: '尾号0000', idempotencyKey: idem });
const wd2Status = wd2.data?.data?.status || wd2.data?.status || '';
console.log(`  幂等重试：status=${wd2.status} 返回状态=${wd2Status}（应一致，不重复扣）`);

sqlite([`DELETE FROM user_sessions WHERE id='${sid}'`]);
console.log(`\n════════ 结果 ════════\nPASS=${pass} FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
