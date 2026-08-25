#!/usr/bin/env node
// 对比 schema.prisma 的 model（表/标量字段/唯一约束）与 ensureSqliteCoreTables 的建表/补字段/唯一索引，
// 输出 schema drift 报告。三类：缺失的表、缺失的列、缺失的唯一约束（含列集合不匹配）。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const backend = process.cwd();
const schemaPath = resolve(backend, 'prisma/schema.prisma');
const servicePath = resolve(backend, 'src/prisma/prisma.service.ts');

const schema = readFileSync(schemaPath, 'utf8');
const service = readFileSync(servicePath, 'utf8');

// —— 标量类型 + enum 名 ——
const SCALARS = new Set([
  'String', 'Int', 'Boolean', 'DateTime', 'Json', 'Decimal', 'Float', 'BigInt', 'Bytes',
]);
const enumNames = new Set();
{
  const enumRe = /^enum\s+(\w+)/gm;
  let m;
  while ((m = enumRe.exec(schema)) !== null) enumNames.add(m[1]);
}

// —— 1. 解析 schema.prisma ——
// schemaTables: tableName -> Set(columnName)
// schemaUniques: tableName -> [ [columnName, ...], ... ]  (来自 @@unique)
// schemaIndexes: tableName -> [ [columnName, ...], ... ]  (来自 @@index)
const schemaTables = new Map();
const schemaUniques = new Map();
const schemaIndexes = new Map();
const modelRe = /^model\s+(\w+)\s*\{([\s\S]*?)\n\}/gm;
let m;
while ((m = modelRe.exec(schema)) !== null) {
  const body = m[2];
  const tableMatch = body.match(/@@map\("(\w+)"\)/);
  const tableName = tableMatch ? tableMatch[1] : m[1].toLowerCase();

  if (!schemaTables.has(tableName)) schemaTables.set(tableName, new Set());
  const cols = schemaTables.get(tableName);
  const fieldToCol = new Map(); // fieldName -> columnName

  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;
    if (trimmed.startsWith('@@')) {
      // @@unique([...]) / @@index([...])
      const uniq = trimmed.match(/^@@unique\(\[([^\]]+)\]\)/);
      const idx = trimmed.match(/^@@index\(\[([^\]]+)\]\)/);
      const toCols = (list) =>
        list.split(',').map((f) => fieldToCol.get(f.trim()) || f.trim());
      if (uniq) {
        if (!schemaUniques.has(tableName)) schemaUniques.set(tableName, []);
        schemaUniques.get(tableName).push(toCols(uniq[1]));
      }
      if (idx) {
        if (!schemaIndexes.has(tableName)) schemaIndexes.set(tableName, []);
        schemaIndexes.get(tableName).push(toCols(idx[1]));
      }
      continue;
    }
    const fieldMatch = trimmed.match(/^(\w+)\s+(\w+)(\[\])?/);
    if (!fieldMatch) continue;
    const [, fieldName, fieldType] = fieldMatch;
    const mapMatch = trimmed.match(/@map\("(\w+)"\)/);
    const colName = mapMatch ? mapMatch[1] : fieldName;
    fieldToCol.set(fieldName, colName);
    // 仅标量 + enum 字段（relation 字段类型是 model 名，跳过）
    if (SCALARS.has(fieldType) || enumNames.has(fieldType)) cols.add(colName);
  }
}

// —— 2. 解析 prisma.service.ts ——
const createTables = new Map();
// 2026-08-24 修复：旧正则 ([\s\S]*?)\) 在列定义含 REFERENCES t("id") 等内联括号时
// 提前截断，导致 rpa_evidence / mobile_devices 等 DDL 列解析不全（误报缺列）。
// 改为匹配到语句收尾的 `)\`,` 或 `);`（模板字符串里 DDL 的真实结尾）。
const createRe = /CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(([\s\S]*?)\)\s*[`,;]/g;
while ((m = createRe.exec(service)) !== null) {
  const tableName = m[1];
  const body = m[2];
  if (!createTables.has(tableName)) createTables.set(tableName, new Set());
  const cols = createTables.get(tableName);
  const colRe = /^\s*"?([a-zA-Z_][\w]*)"?\s+(?:TEXT|INTEGER|BOOLEAN|DATETIME|REAL|JSONB|FLOAT|BLOB|NUMERIC)\b/gm;
  let c;
  while ((c = colRe.exec(body)) !== null) cols.add(c[1]);
}

const alterColumns = new Map();
const alterRe = /\[\s*'([\w]+)'\s*,\s*'([\w]+)'\s*,/g;
while ((m = alterRe.exec(service)) !== null) {
  const tableName = m[1];
  const colName = m[2];
  if (!alterColumns.has(tableName)) alterColumns.set(tableName, new Set());
  alterColumns.get(tableName).add(colName);
}

// serviceUniques: tableName -> [ [colName, ...], ... ]  (来自 CREATE UNIQUE INDEX)
// serviceIndexes: tableName -> [ [colName, ...], ... ]  (来自 CREATE INDEX，排除 UNIQUE)
const serviceUniques = new Map();
const serviceIndexes = new Map();
const idxRe = /CREATE\s+(UNIQUE\s+)?INDEX\s+IF NOT EXISTS\s+(\w+)\s+ON\s+(\w+)\s*\(([^)]+)\)/g;
while ((m = idxRe.exec(service)) !== null) {
  const isUnique = !!m[1];
  const tableName = m[3];
  const cols = m[4]
    .split(',')
    .map((s) => s.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
  const target = isUnique ? serviceUniques : serviceIndexes;
  if (!target.has(tableName)) target.set(tableName, []);
  target.get(tableName).push(cols);
}

// 表内联 UNIQUE(col, ...) 约束（2026-08-24 补：CREATE TABLE 里的列级唯一
// 在 SQLite 同样生效，此前只认 CREATE UNIQUE INDEX 导致误报「缺失」）
const inlineUniqRe = /UNIQUE\s*\(([^)]+)\)/g;
{
  // 限定在 CREATE TABLE IF NOT EXISTS <table> ( ... ) 的表体里找
  const tableRe = /CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(([\s\S]*?)\n\s{6}\)/g;
  let tm;
  while ((tm = tableRe.exec(service)) !== null) {
    const tName = tm[1];
    let um;
    while ((um = inlineUniqRe.exec(tm[2])) !== null) {
      const cols = um[1]
        .split(',')
        .map((s) => s.trim().replace(/^"|"$/g, ''))
        .filter(Boolean);
      if (!serviceUniques.has(tName)) serviceUniques.set(tName, []);
      serviceUniques.get(tName).push(cols);
    }
  }
}

// —— 3. 对比 ——
const missingTables = [];
const missingColumns = [];
for (const [tableName, cols] of schemaTables) {
  const created = createTables.get(tableName);
  if (!created) {
    missingTables.push(tableName);
    continue;
  }
  const altered = alterColumns.get(tableName) || new Set();
  const all = new Set([...created, ...altered]);
  for (const col of cols) {
    if (!all.has(col)) missingColumns.push({ table: tableName, column: col });
  }
}

// 唯一约束对比：schema @@unique 的列集合，必须被 service 的某个 UNIQUE INDEX 列集合完全匹配
const missingUniques = [];
for (const [tableName, uniques] of schemaUniques) {
  const svc = serviceUniques.get(tableName) || [];
  for (const u of uniques) {
    const need = [...u].sort().join(',');
    const found = svc.some((cols) => [...cols].sort().join(',') === need);
    if (!found) {
      missingUniques.push({
        table: tableName,
        columns: u.join(', '),
        serviceHas: svc.map((c) => c.join(', ')),
      });
    }
  }
}

// 普通索引对比（warning 级，缺列只影响查询性能）
const missingIndexes = [];
for (const [tableName, indexes] of schemaIndexes) {
  const svc = serviceIndexes.get(tableName) || [];
  for (const ix of indexes) {
    const need = [...ix].sort().join(',');
    const found = svc.some((cols) => [...cols].sort().join(',') === need);
    if (!found) missingIndexes.push({ table: tableName, columns: ix.join(', ') });
  }
}

// 生成缺失索引的 CREATE INDEX SQL（--emit-index-sql 时输出到文件）
const indexSql = missingIndexes.map((ix) => {
  const cols = ix.columns.split(', ').map((c) => c.trim()).filter(Boolean);
  const name = `${ix.table}_${cols.join('_')}_idx`;
  return `CREATE INDEX IF NOT EXISTS ${name} ON ${ix.table}(${cols.join(', ')});`;
});
if (process.argv.includes('--emit-index-sql')) {
  const out = resolve(backend, 'scripts/missing-indexes.sql');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(out, indexSql.join('\n') + '\n');
  console.log(`已生成 ${indexSql.length} 条缺失索引 SQL → ${out}`);
}

console.log('=== schema drift 报告 ===');
console.log(`schema 表总数: ${schemaTables.size}, 建表语句表数: ${createTables.size}`);
console.log(`\n[缺失的表] (${missingTables.length} 个)`);
for (const t of missingTables) console.log('  -', t);
console.log(`\n[缺失的列] (${missingColumns.length} 个)`);
for (const c of missingColumns) console.log(`  - ${c.table}.${c.column}`);
console.log(`\n[缺失/不匹配的唯一约束] (${missingUniques.length} 个)  ← 会导致 upsert/归因链落库静默失败`);
for (const u of missingUniques) {
  console.log(`  - ${u.table} @@unique(${u.columns})`);
  console.log(`      service 现有唯一索引: ${u.serviceHas.length ? u.serviceHas.join(' | ') : '(无)'}`);
}
console.log(`\n[缺失的普通索引] (${missingIndexes.length} 个，仅性能影响)`);
for (const i of missingIndexes) console.log(`  - ${i.table} @@index(${i.columns})`);

const total = missingTables.length + missingColumns.length + missingUniques.length;
console.log(`\n=== 合计 drift: ${total} 项（唯一约束 ${missingUniques.length} 项最关键）===`);
process.exitCode = total > 0 ? 1 : 0;
