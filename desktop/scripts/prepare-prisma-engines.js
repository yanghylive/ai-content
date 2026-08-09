#!/usr/bin/env node
/**
 * 按目标平台修改 Prisma schema binaryTargets
 *
 * 用法:
 *   BUILD_PLATFORM=mac-arm64 node scripts/prepare-prisma-engines.js set
 *   BUILD_PLATFORM=mac-arm64 node scripts/prepare-prisma-engines.js restore
 *
 * 子命令:
 *   set      - 备份原 schema，修改为平台配置
 *   restore  - 从备份还原 schema
 *   prune    - 删除非目标平台 Prisma engine，避免打进错误平台二进制
 *   status   - 查看当前状态
 *
 * 设计:
 *   - 不再依赖 exit 钩子（prisma generate 跨进程跑，exit 钩子会失效）
 *   - 备份在 .prisma-engine-backup 文件
 *   - 调用方需要成对调用 set/restore
 */
const fs = require('fs');
const path = require('path');

const PLATFORM_TARGETS = {
  'mac-arm64': ['darwin-arm64'],
  'mac-x64':   ['darwin'],
  'win-x64':   ['windows'],
  'linux-x64': ['debian-openssl-3.0.x'],
};

const SCRIPT_DIR = __dirname;
const DESKTOP_DIR = path.resolve(SCRIPT_DIR, '..');
const REPO_ROOT = path.resolve(DESKTOP_DIR, '..');
const SCHEMA_PATH = path.join(REPO_ROOT, 'backend/prisma/schema.prisma');
const BACKUP_PATH = SCHEMA_PATH + '.engine-backup';
const PRISMA_CLIENT_DIR = path.join(REPO_ROOT, 'backend/node_modules/.prisma/client');
const ENGINE_PATTERNS = [
  /^query_engine-windows\.dll\.node$/,
  /^libquery_engine-darwin-arm64\.dylib\.node$/,
  /^libquery_engine-darwin\.dylib\.node$/,
  /^libquery_engine-debian-openssl-.*\.so\.node$/,
  /^libquery_engine-linux.*\.so\.node$/,
];

function detectPlatform() {
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'mac-arm64';
  if (process.platform === 'darwin') return 'mac-x64';
  if (process.platform === 'win32') return 'win-x64';
  return 'linux-x64';
}

const cmd = process.argv[2] || 'set';
const platform = process.env.BUILD_PLATFORM || detectPlatform();

if (cmd === 'status') {
  console.log(`Schema: ${SCHEMA_PATH}`);
  console.log(`Backup: ${BACKUP_PATH} ${fs.existsSync(BACKUP_PATH) ? 'exists' : 'absent'}`);
  if (fs.existsSync(SCHEMA_PATH)) {
    const m = fs.readFileSync(SCHEMA_PATH, 'utf8').match(/binaryTargets\s*=\s*\[([^\]]+)\]/);
    console.log(`Current binaryTargets: ${m ? m[1].trim() : 'not found'}`);
  }
  process.exit(0);
}

if (!PLATFORM_TARGETS[platform]) {
  console.error(`❌ 未知 BUILD_PLATFORM: ${platform}`);
  console.error(`   支持: ${Object.keys(PLATFORM_TARGETS).join(', ')}`);
  process.exit(1);
}

const targets = PLATFORM_TARGETS[platform];

if (cmd === 'prune') {
  if (!fs.existsSync(PRISMA_CLIENT_DIR)) {
    console.error(`❌ Prisma client 目录不存在: ${PRISMA_CLIENT_DIR}`);
    process.exit(1);
  }

  const keep = new Set(targets.map((target) => engineFileForTarget(target)).filter(Boolean));
  if (keep.size === 0) {
    console.error(`❌ 没有可保留的 engine 映射: ${targets.join(', ')}`);
    process.exit(1);
  }

  const removed = [];
  for (const entry of fs.readdirSync(PRISMA_CLIENT_DIR)) {
    if (!ENGINE_PATTERNS.some((pattern) => pattern.test(entry))) continue;
    if (keep.has(entry)) continue;
    fs.rmSync(path.join(PRISMA_CLIENT_DIR, entry), { force: true });
    removed.push(entry);
  }

  for (const entry of keep) {
    if (!fs.existsSync(path.join(PRISMA_CLIENT_DIR, entry))) {
      console.error(`❌ 目标 engine 缺失: ${entry}`);
      process.exit(1);
    }
  }

  console.log(`✓ Prisma engine prune 完成: keep=${Array.from(keep).join(', ')} removed=${removed.join(', ') || '<none>'}`);
  process.exit(0);
}

if (cmd === 'set') {
  if (!fs.existsSync(SCHEMA_PATH)) {
    console.error(`❌ Schema 不存在: ${SCHEMA_PATH}`);
    process.exit(1);
  }

  if (!fs.existsSync(BACKUP_PATH)) {
    fs.copyFileSync(SCHEMA_PATH, BACKUP_PATH);
    console.log(`✓ 已备份原 schema 到 .engine-backup`);
  } else {
    console.log(`⚠ 备份已存在，跳过备份步骤`);
  }

  const original = fs.readFileSync(BACKUP_PATH, 'utf8');
  const binaryTargetsLine = `  binaryTargets = [${targets.map((t) => `"${t}"`).join(', ')}]`;
  let updated;
  if (/binaryTargets\s*=\s*\[[^\]]+\]/.test(original)) {
    updated = original.replace(
      /\s*binaryTargets\s*=\s*\[[^\]]+\]/,
      `\n${binaryTargetsLine}`
    );
  } else {
    updated = original.replace(
      /(generator\s+client\s*\{[\s\S]*?provider\s*=\s*"prisma-client-js"[^\n]*\n)/,
      `$1${binaryTargetsLine}\n`
    );
  }

  if (!/binaryTargets\s*=\s*\[[^\]]+\]/.test(updated)) {
    console.error('❌ 写入 binaryTargets 失败，请检查 generator client 块。');
    process.exit(1);
  }

  fs.writeFileSync(SCHEMA_PATH, updated);
  console.log(`✓ Schema binaryTargets 已更新: [${targets.join(', ')}]`);
  console.log(`  (调用 'restore' 子命令还原)`);
  process.exit(0);
}

if (cmd === 'restore') {
  if (!fs.existsSync(BACKUP_PATH)) {
    console.log(`⊘ 没有备份文件，无需还原`);
    process.exit(0);
  }
  const backup = fs.readFileSync(BACKUP_PATH, 'utf8');
  fs.writeFileSync(SCHEMA_PATH, backup);
  fs.unlinkSync(BACKUP_PATH);
  console.log(`✓ Schema 已从备份还原`);
  process.exit(0);
}

console.error(`❌ 未知子命令: ${cmd}`);
console.error(`   支持: set | restore | prune | status`);
process.exit(1);

function engineFileForTarget(target) {
  switch (target) {
    case 'windows':
      return 'query_engine-windows.dll.node';
    case 'darwin-arm64':
      return 'libquery_engine-darwin-arm64.dylib.node';
    case 'darwin':
      return 'libquery_engine-darwin.dylib.node';
    case 'debian-openssl-3.0.x':
      return 'libquery_engine-debian-openssl-3.0.x.so.node';
    default:
      return '';
  }
}
