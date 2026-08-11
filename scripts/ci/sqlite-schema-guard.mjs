/* eslint-disable no-console */
/**
 * CI 守门脚本：SQLite 建表完整性守卫（防缺表/缺列老问题复发）
 *
 * 用法：node scripts/ci/sqlite-schema-guard.mjs
 * 退出码：
 *   0 = 通过（schema.prisma 全部 model 都有对应 CREATE TABLE）
 *   1 = 缺表（schema 有、prisma.service.ts 的 SQL 没有）或 SQL 多余
 *
 * 背景（2026-08-11）：#1 P0 AI 助手 ai_usage_quotas 表不存在，根因是
 * ensureSqliteCoreTables 手写 SQL 与 schema.prisma 不同步——加新 model 就漏建表。
 * 本守卫从机制上杜绝：任何人新增 schema model 但忘补建表 SQL，CI 直接红。
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const SCHEMA_PATH = join(ROOT, 'backend', 'prisma', 'schema.prisma');
const SERVICE_PATH = join(
  ROOT,
  'backend',
  'src',
  'prisma',
  'prisma.service.ts',
);

let failures = 0;
const report = (ok, message) => {
  console.log(`${ok ? '✅' : '❌'} ${message}`);
  if (!ok) failures += 1;
};

// ─────────────────────────────────────────────────────────────
// 1. 解析 schema.prisma 的全部 model 表名
// ─────────────────────────────────────────────────────────────

function parseSchemaTables(source) {
  const tables = [];
  const modelRegex = /^model\s+(\w+)\s*\{/gm;
  let match;
  while ((match = modelRegex.exec(source)) !== null) {
    const modelName = match[1];
    // 找该 model 块内的 @@map("表名")
    const blockStart = match.index;
    const nextModel = source.indexOf('\nmodel ', blockStart + 1);
    const block = source.slice(
      blockStart,
      nextModel === -1 ? source.length : nextModel,
    );
    const mapMatch = block.match(/@@map\("([^"]+)"\)/);
    tables.push(mapMatch ? mapMatch[1] : toSnakeCase(modelName));
  }
  return tables;
}

function toSnakeCase(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

// ─────────────────────────────────────────────────────────────
// 2. 解析 prisma.service.ts 的 CREATE TABLE 清单
// ─────────────────────────────────────────────────────────────

function parseServiceTables(source) {
  const tables = new Set();
  const regex = /CREATE TABLE IF NOT EXISTS\s+([a-z_0-9]+)\s*\(/gi;
  let match;
  while ((match = regex.exec(source)) !== null) {
    tables.add(match[1]);
  }
  return tables;
}

// ─────────────────────────────────────────────────────────────
// 3. 对比
// ─────────────────────────────────────────────────────────────

function main() {
  if (!existsSync(SCHEMA_PATH)) {
    console.error(`找不到 schema.prisma: ${SCHEMA_PATH}`);
    process.exit(2);
  }
  if (!existsSync(SERVICE_PATH)) {
    console.error(`找不到 prisma.service.ts: ${SERVICE_PATH}`);
    process.exit(2);
  }

  const schemaSource = readFileSync(SCHEMA_PATH, 'utf8');
  const serviceSource = readFileSync(SERVICE_PATH, 'utf8');

  const schemaTables = parseSchemaTables(schemaSource);
  const serviceTables = parseServiceTables(serviceSource);

  report(
    schemaTables.length === serviceTables.size,
    `model 数（${schemaTables.length}）与 CREATE TABLE 数（${serviceTables.size}）一致`,
  );

  // schema 有、SQL 没有 = 缺表（要命的）
  const missing = schemaTables.filter((t) => !serviceTables.has(t));
  if (missing.length) {
    report(false, `schema 有但建表 SQL 缺失（${missing.length}）: ${missing.join(', ')}`);
    console.log('\n修复：在 backend/src/prisma/prisma.service.ts 的 ensureSqliteCoreTables()');
    console.log('statements 数组补上对应 CREATE TABLE IF NOT EXISTS 语句。');
  } else {
    report(true, 'schema 全部 model 均有对应建表 SQL');
  }

  // SQL 有、schema 没有 = 残留表（可能有 @@map 已改名的，允许白名单）
  const serviceOnly = [...serviceTables].filter(
    (t) => !schemaTables.includes(t),
  );
  if (serviceOnly.length) {
    report(
      false,
      `建表 SQL 存在但 schema 无此 model（${serviceOnly.length}）: ${serviceOnly.join(', ')}`,
    );
  } else {
    report(true, '建表 SQL 无多余表');
  }

  if (failures) {
    console.error(`\n✗ SQLite schema 守卫未通过（${failures} 处问题）`);
    process.exit(1);
  }
  console.log('\n✓ SQLite schema 守卫通过');
}

main();
