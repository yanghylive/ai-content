#!/usr/bin/env node
/**
 * 门禁：校验共享 Prisma client（node_modules/.prisma/client）面向 postgresql。
 *
 * 背景（假绿风险）：
 * backend 有两份 schema —— prisma/schema.prisma（postgresql，服务端主库）与
 * prisma/schema.sqlite.prisma（sqlite，桌面端 dist-bundle-sqlite）。两者的
 * generator 都没有指定 output，都生成到同一个默认目录 node_modules/.prisma/client。
 *
 * 后果：跑过 `npm run build:bundle:sqlite`（或手工 `prisma generate --schema
 * prisma/schema.sqlite.prisma`）之后，共享 client 变成 sqlite 版。此时执行
 * `npm run build`（nest build，服务端 Postgres 语义）**依然编译通过**——两份
 * schema 的 model 定义一致，tsc 完全看不出差别——直到运行时才连不上 Postgres。
 * 这是最典型的「编译绿、线上炸」。
 *
 * 本脚本作为 prebuild 钩子，在 nest build 之前拦住这种状态。
 *
 * 退出码：
 *   0 = client 面向 postgresql，或 client 尚未生成（放行，交给 build 自身报错）
 *   1 = client 面向非 postgresql（如 sqlite），必须先 `npx prisma generate`
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const backendRoot = process.cwd();
const clientSchemaPath = join(backendRoot, 'node_modules', '.prisma', 'client', 'schema.prisma');
const EXPECTED_PROVIDER = 'postgresql';

function readDatasourceProvider(schemaText) {
  // 只取 datasource 块内的 provider，避免误命中 generator 的 prisma-client-js
  const match = schemaText.match(/datasource\s+\w+\s*\{[^}]*?provider\s*=\s*"([a-z]+)"/s);
  return match ? match[1] : null;
}

if (!existsSync(clientSchemaPath)) {
  // 干净环境（刚 npm install，尚未 generate）不阻断：build 本身会报缺 client
  console.warn(
    '[check-prisma-client-provider] 共享 Prisma client 尚未生成，跳过校验。' +
      '若 build 报缺 @prisma/client，请先执行 `npx prisma generate`。',
  );
  process.exit(0);
}

const provider = readDatasourceProvider(readFileSync(clientSchemaPath, 'utf8'));

if (provider === EXPECTED_PROVIDER) {
  console.log(`[check-prisma-client-provider] OK：共享 Prisma client provider = ${provider}`);
  process.exit(0);
}

console.error('[check-prisma-client-provider] 门禁失败：共享 Prisma client 面向错误的数据库。');
console.error(`  期望 provider : ${EXPECTED_PROVIDER}`);
console.error(`  实际 provider : ${provider ?? '（无法解析）'}`);
console.error(`  client schema : ${clientSchemaPath}`);
console.error('');
console.error('  原因：本机跑过 SQLite bundle 构建（或手工 generate 了 schema.sqlite.prisma），');
console.error('        共享 client 停留在 sqlite 态。继续 build 会编译通过但运行时连不上 Postgres。');
console.error('  修复：npx prisma generate   # 用 prisma/schema.prisma 还原');
process.exit(1);
