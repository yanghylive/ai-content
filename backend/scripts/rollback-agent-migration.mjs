#!/usr/bin/env node
/**
 * rollback-agent-migration.mjs —— P0-4 迁移回滚脚本（默认 dry-run，--apply 生效）。
 * 目标：回滚 agent_gateway_* 到迁移前状态（清空数据，保留表结构——表结构回滚走 prisma migrate）。
 * 顺序按外键依赖从子到父：
 *   device_leases → memory_outbox → evidence → artifacts → approvals → tool_calls → usage_events → events → tasks → sessions
 * 安全性：
 * - 事务包裹（失败整体回滚）
 * - dry-run 只统计不落库
 * - 保留表结构（DROP TABLE 不在本脚本，避免误删生产结构）
 *
 * 用法：node scripts/rollback-agent-migration.mjs [--apply] [--json]
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

const TABLES = [
  'agent_gateway_device_leases',
  'agent_gateway_memory_outbox',
  'agent_gateway_evidence',
  'agent_gateway_artifacts',
  'agent_gateway_approvals',
  'agent_gateway_tool_calls',
  'agent_gateway_usage_events',
  'agent_gateway_events',
  'agent_gateway_tasks',
  'agent_gateway_sessions',
];

const client = new Client({ connectionString: conn });
await client.connect();

const report = { apply, tables: [] };

if (!apply) await client.query('BEGIN');
try {
  for (const t of TABLES) {
    const { rowCount } = await client.query(`DELETE FROM ${t}`);
    report.tables.push({ table: t, rows: rowCount ?? 0 });
    if (!json) console.log(`✗ ${t}: ${rowCount ?? 0} 行`);
  }
  if (!apply) await client.query('ROLLBACK');
  else await client.query('COMMIT');
} catch (e) {
  if (!apply) await client.query('ROLLBACK').catch(() => undefined);
  console.error('回滚失败:', e.message);
  process.exit(1);
}
await client.end();

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const total = report.tables.reduce((s, t) => s + t.rows, 0);
  console.log(`\n${apply ? '✅ 已生效' : '⚠️ dry-run（加 --apply 生效）'}：10 张表共 ${total} 行（表结构保留，结构回滚走 prisma migrate）`);
}
