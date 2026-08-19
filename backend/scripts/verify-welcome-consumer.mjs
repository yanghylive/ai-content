#!/usr/bin/env node
// 端到端验证 Outbox「欢迎语消费者」：转 CRM → 等 relay 消费 → 检查欢迎语待办时间线
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
    body: JSON.stringify({ sourceText: '欢迎语消费者验证', platform: 'douyin', nickname: '欢迎语测试-张三' }),
  });
  leadId = (await leadRes.json())?.data?.id;
  console.log('leadId =', leadId);

  // sync-crm
  const syncRes = await fetch(`${FRONTEND}/api/growth/leads/${leadId}/sync-crm`, { method: 'POST', headers: COOKIE });
  customerId = (await syncRes.json())?.data?.customerId;
  console.log('customerId =', customerId);

  // 查 outbox 事件
  const outbox = q1(`SELECT type || '/' || status FROM domain_event_outbox WHERE aggregate_id='${leadId}' ORDER BY created_at DESC LIMIT 1`);
  console.log('outbox 事件 =', outbox || '(无)');

  // 等 relay 消费（@Cron 每 30s）
  console.log('等 35 秒让 relay 消费…');
  await new Promise((r) => setTimeout(r, 35000));

  // 查欢迎语待办时间线
  const timeline = q1(`SELECT event_type FROM crm_timeline_events WHERE customer_id='${customerId}' ORDER BY created_at DESC`);
  console.log('时间线 event_type =', timeline.split('\n').join(', ') || '(无)');
  const hasWelcome = timeline.includes('welcome_message_pending');
  console.log(hasWelcome ? '✅ 欢迎语消费者生效（welcome_message_pending 时间线已追加）' : '❌ 欢迎语待办时间线未出现');

  // 查 outbox 消费状态
  const outboxAfter = q1(`SELECT type || '/' || status FROM domain_event_outbox WHERE aggregate_id='${leadId}' ORDER BY created_at DESC LIMIT 1`);
  console.log('outbox 事件（消费后）=', outboxAfter || '(无)');
} finally {
  // 清理
  sqlite([
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
}
