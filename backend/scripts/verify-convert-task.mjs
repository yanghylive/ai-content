#!/usr/bin/env node
// 端到端验证「转客户默认建待办」：造 lead → sync-crm → 查 crm_tasks 待办
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const FRONTEND = 'http://127.0.0.1:3011';
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
const hash = createHash('sha256').update(token).digest('hex');
const sid = `wbtest_${randomBytes(6).toString('hex')}`;
const now = new Date();
const meta = { source: 'wbtest', localOnly: true, kaypalSubscriptionPlan: 'ADVANCED', kaypalRole: 'SUPER_ADMIN', kaypalPlatformRole: 'SUPER_ADMIN', kaypalPermissionNames: ['console_quality_scan'] };
sqlite([`INSERT INTO user_sessions (id,user_id,token_hash,expires_at,last_used_at,metadata,created_at,updated_at) VALUES ('${sid}','${USER_ID}','${hash}','${new Date(Date.now() + 86400000).toISOString()}','${now.toISOString()}','${JSON.stringify(meta)}','${now.toISOString()}','${now.toISOString()}')`]);
const COOKIE = { 'Content-Type': 'application/json', 'Cookie': `ai_content_session=${token}` };

let leadId = '', customerId = '';
try {
  // 造 lead
  const leadRes = await fetch(`${FRONTEND}/api/growth/leads`, {
    method: 'POST', headers: COOKIE,
    body: JSON.stringify({ sourceText: '待办验证', platform: 'douyin', nickname: '待办测试-李四' }),
  });
  leadId = (await leadRes.json())?.data?.id;
  console.log('leadId =', leadId);

  // sync-crm 转客户
  const syncRes = await fetch(`${FRONTEND}/api/growth/leads/${leadId}/sync-crm`, { method: 'POST', headers: COOKIE });
  const syncBody = await syncRes.json();
  customerId = syncBody?.data?.customerId;
  console.log('customerId =', customerId);

  // 查默认待办
  const tasks = q1(`SELECT title || '|' || status || '|' || priority FROM crm_tasks WHERE customer_id='${customerId}' ORDER BY created_at DESC`);
  console.log('crm_tasks =', tasks || '(无)');
  const hasFollowUp = tasks.includes('跟进新客户');
  console.log(hasFollowUp ? '✅ 转客户默认建了「跟进新客户」待办' : '❌ 未发现跟进待办');
  process.exitCode = hasFollowUp ? 0 : 1;
} finally {
  // 清理
  sqlite([
    `DELETE FROM crm_tasks WHERE customer_id='${customerId}'`,
    `DELETE FROM leads WHERE id='${leadId}'`,
    `DELETE FROM crm_timeline_events WHERE customer_id='${customerId}'`,
    `DELETE FROM crm_opportunities WHERE primary_customer_id='${customerId}'`,
    `DELETE FROM crm_customers WHERE id='${customerId}'`,
    `DELETE FROM attribution_links WHERE from_id='${leadId}' OR to_id='${customerId}'`,
    `DELETE FROM domain_event_outbox WHERE aggregate_id='${leadId}'`,
    `DELETE FROM lead_signals WHERE lead_id='${leadId}'`,
    `DELETE FROM lead_score_snapshots WHERE lead_id='${leadId}'`,
    `DELETE FROM user_sessions WHERE id='${sid}'`,
  ]);
  console.log('已清理');
}
