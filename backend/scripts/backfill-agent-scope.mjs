#!/usr/bin/env node
/**
 * backfill-agent-scope.mjs —— P0-4 迁移回填脚本（默认 dry-run，--apply 生效）。
 * 目标：清理开发/迁移期产生的 agent_gateway_* 脏数据，满足《冻结清单》7.3：
 * "回填后没有无主任务、无主审批、无主 usage；重复请求不会产生重复 ToolCall 或 UsageEvent"
 *
 * 处理项：
 * 1. agent_gateway_events 悬挂行（session 不在 agent_gateway_sessions）→ 按 session_id 前缀
 *    找 agent_gateway_tasks 里的 tenant；找不到 → 删除（无主事件不可恢复归属）
 * 2. agent_gateway_events 空 tenant → 同 session 下 tasks 的 tenant 回填
 * 3. 空 tenant 的 tool_calls/approvals/usage_events → 按 task/session 回填；仍无主 → 删除
 * 4. 孤儿 tasks（session 不存在）→ 删除
 *
 * 用法：node scripts/backfill-agent-scope.mjs [--apply] [--json]
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
const apply = process.argv.includes('--apply');
const json = process.argv.includes('--json');

const client = new Client({ connectionString: conn });
await client.connect();

const report = { apply, backfilled: 0, deleted: 0, details: [] };

// dry-run：开启事务，所有写操作执行后统一 ROLLBACK（统计准确且不落库）
if (!apply) {
  await client.query('BEGIN');
}

async function run(label, sql, params = []) {
  const { rowCount } = await client.query(sql, params);
  report.backfilled += rowCount ?? 0;
  report.details.push({ action: 'backfill', label, rows: rowCount ?? 0 });
  if (!json) console.log(`→ ${label}: ${rowCount ?? 0} 行`);
}

async function del(label, sql, params = []) {
  const { rowCount } = await client.query(sql, params);
  report.deleted += rowCount ?? 0;
  report.details.push({ action: 'delete', label, rows: rowCount ?? 0 });
  if (!json) console.log(`✗ ${label}: ${rowCount ?? 0} 行`);
}

// 1) 悬挂事件：先尝试按同 session 的 task 回填 tenant，无 tenant 可依 → 删除
{
  const { rows } = await client.query(
    `SELECT e.session_id, count(*)::int AS n
     FROM agent_gateway_events e
     LEFT JOIN agent_gateway_sessions s ON s.id = e.session_id
     WHERE s.id IS NULL
     GROUP BY e.session_id`
  );
  for (const r of rows) {
    // 该 session 下是否有 task 提供 tenant
    const { rows: tRows } = await client.query(
      `SELECT DISTINCT tenant_id FROM agent_gateway_tasks WHERE session_id = $1 AND tenant_id <> '' LIMIT 1`,
      [r.session_id]
    );
    if (tRows.length > 0) {
      await run(
        `event 悬挂回填 tenant (session=${r.session_id.slice(0, 18)}…)`,
        `UPDATE agent_gateway_events SET tenant_id = $1 WHERE session_id = $2 AND (tenant_id = '' OR tenant_id IS NULL)`,
        [tRows[0].tenant_id, r.session_id]
      );
    } else {
      await del(
        `event 悬挂删除 (session=${r.session_id.slice(0, 18)}…)`,
        `DELETE FROM agent_gateway_events WHERE session_id = $1`,
        [r.session_id]
      );
    }
  }
}

// 2) 事件空 tenant（session 存在时按 session 回填）
await run(
  'events 空 tenant 按 session 回填',
  `UPDATE agent_gateway_events e
   SET tenant_id = s.tenant_id
   FROM agent_gateway_sessions s
   WHERE s.id = e.session_id AND (e.tenant_id = '' OR e.tenant_id IS NULL)`
);

// 3) tool_calls/approvals/usage_events 空 tenant 按 task 回填
for (const t of ['agent_gateway_tool_calls', 'agent_gateway_approvals', 'agent_gateway_usage_events']) {
  await run(
    `${t} 空 tenant 按 task 回填`,
    `UPDATE ${t} x
     SET tenant_id = t.tenant_id
     FROM agent_gateway_tasks t
     WHERE t.id = x.task_id AND (x.tenant_id = '' OR x.tenant_id IS NULL)`
  );
}

// 4) 孤儿 task（session 不存在）→ 删除（连带其 tool_call/approval/usage 无主引用）
{
  const { rows } = await client.query(
    `SELECT t.id FROM agent_gateway_tasks t LEFT JOIN agent_gateway_sessions s ON s.id = t.session_id WHERE s.id IS NULL`
  );
  if (rows.length > 0) {
    const ids = rows.map((r) => r.id);
    for (const t of ['agent_gateway_tool_calls', 'agent_gateway_approvals', 'agent_gateway_usage_events']) {
      await del(
        `孤儿 task 连带 ${t}`,
        `DELETE FROM ${t} WHERE task_id = ANY($1::text[])`,
        [ids]
      );
    }
    await del(`孤儿 task 删除 (${ids.length} 个)`, `DELETE FROM agent_gateway_tasks WHERE id = ANY($1::text[])`, [ids]);
  }
}

// dry-run：回滚事务（不落库）；apply：提交
if (!apply) {
  await client.query('ROLLBACK');
} else {
  await client.query('COMMIT');
}
await client.end();

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(
    `\n${apply ? '✅ 已生效' : '⚠️ dry-run（加 --apply 生效）'}：回填 ${report.backfilled} 行，删除 ${report.deleted} 行`
  );
}
