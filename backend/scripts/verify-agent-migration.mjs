#!/usr/bin/env node
/**
 * verify-agent-migration.mjs —— P0-4 迁移校验脚本（只读，安全）。
 * 校验《冻结清单》7.3 通过条件：
 * 1. 无主记录：agent_gateway_* 所有表不存在 tenant_id 为空/NULL 的行
 *    （sessions/tasks/tool_calls/approvals/usage_events/events 必须带租户）
 * 2. 幂等唯一：tool_calls (tenant_id, idempotency_key) 无重复
 * 3. usageId 唯一：usage_events.usage_id 无重复
 * 4. 事件唯一：(session_id, event_id) 无重复
 * 5. 外键完整性：task.session_id 存在、tool_call.task_id 存在、approval.task_id 存在
 * 退出码：0=全部通过；1=有失败项（打印明细）。
 *
 * 用法：node scripts/verify-agent-migration.mjs [--json]
 */
import pg from 'pg';
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

loadEnv({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env') });

const { Client } = pg;
const conn = process.env.DATABASE_URL;
if (!conn) {
  console.error('缺少 DATABASE_URL');
  process.exit(2);
}
const json = process.argv.includes('--json');

const client = new Client({ connectionString: conn });
await client.connect();

const TABLES_WITH_TENANT = [
  'agent_gateway_sessions',
  'agent_gateway_tasks',
  'agent_gateway_tool_calls',
  'agent_gateway_approvals',
  'agent_gateway_usage_events',
  'agent_gateway_events',
  'agent_gateway_artifacts',
  'agent_gateway_evidence',
  'agent_gateway_memory_outbox',
  'agent_gateway_device_leases',
];

const checks = [];
let fail = 0;

// 1) 无主记录
for (const t of TABLES_WITH_TENANT) {
  const { rows } = await client.query(
    `SELECT count(*)::int AS n FROM ${t} WHERE tenant_id IS NULL OR tenant_id = ''`
  );
  const n = rows[0].n;
  checks.push({ check: `${t}.tenant_id 无空值`, ok: n === 0, detail: `${n} 行无主` });
  if (n > 0) fail += 1;
}

// 2) 幂等唯一（按冻结清单：tenantId + idempotencyKey 唯一）
{
  const { rows } = await client.query(
    `SELECT count(*)::int AS n FROM (
       SELECT tenant_id, idempotency_key FROM agent_gateway_tool_calls
       WHERE idempotency_key IS NOT NULL
       GROUP BY tenant_id, idempotency_key HAVING count(*) > 1
     ) dup`
  );
  const n = rows[0].n;
  checks.push({ check: 'tool_calls (tenant_id, idempotency_key) 唯一', ok: n === 0, detail: `${n} 组重复` });
  if (n > 0) fail += 1;
}

// 3) usageId 唯一
{
  const { rows } = await client.query(
    `SELECT count(*)::int AS n FROM (
       SELECT usage_id FROM agent_gateway_usage_events
       WHERE usage_id IS NOT NULL GROUP BY usage_id HAVING count(*) > 1
     ) dup`
  );
  const n = rows[0].n;
  checks.push({ check: 'usage_events.usage_id 唯一', ok: n === 0, detail: `${n} 组重复` });
  if (n > 0) fail += 1;
}

// 4) 事件 (session_id, event_id) 唯一
{
  const { rows } = await client.query(
    `SELECT count(*)::int AS n FROM (
       SELECT session_id, event_id FROM agent_gateway_events
       GROUP BY session_id, event_id HAVING count(*) > 1
     ) dup`
  );
  const n = rows[0].n;
  checks.push({ check: 'events (session_id, event_id) 唯一', ok: n === 0, detail: `${n} 组重复` });
  if (n > 0) fail += 1;
}

// 5) 外键完整性
const FK_CHECKS = [
  ['agent_gateway_tasks.session_id', `SELECT count(*)::int AS n FROM agent_gateway_tasks t LEFT JOIN agent_gateway_sessions s ON s.id = t.session_id WHERE s.id IS NULL`],
  ['agent_gateway_tool_calls.task_id', `SELECT count(*)::int AS n FROM agent_gateway_tool_calls tc LEFT JOIN agent_gateway_tasks t ON t.id = tc.task_id WHERE t.id IS NULL`],
  ['agent_gateway_approvals.task_id', `SELECT count(*)::int AS n FROM agent_gateway_approvals a LEFT JOIN agent_gateway_tasks t ON t.id = a.task_id WHERE t.id IS NULL`],
  ['agent_gateway_events.session_id', `SELECT count(*)::int AS n FROM agent_gateway_events e LEFT JOIN agent_gateway_sessions s ON s.id = e.session_id WHERE s.id IS NULL`],
];
for (const [label, sql] of FK_CHECKS) {
  const { rows } = await client.query(sql);
  const n = rows[0].n;
  checks.push({ check: `FK ${label}`, ok: n === 0, detail: `${n} 行悬挂` });
  if (n > 0) fail += 1;
}

await client.end();

if (json) {
  console.log(JSON.stringify({ ok: fail === 0, fail, checks }, null, 2));
} else {
  for (const c of checks) {
    console.log(`${c.ok ? '✓' : '✗'} ${c.check} — ${c.detail}`);
  }
  console.log(`\n${fail === 0 ? '✅ 迁移校验全部通过' : `❌ ${fail} 项失败`}`);
}
process.exit(fail === 0 ? 0 : 1);
