#!/usr/bin/env node
/**
 * 生成 auto-upload 资源白名单 manifest
 *
 * 用法:
 *   node scripts/resolve-auto-upload-manifest.js
 *   AUTO_UPLOAD_PATH=/path/to/auto-upload node scripts/resolve-auto-upload-manifest.js
 *
 * 输出:
 *   scripts/auto-upload-manifest.json - 白名单文件列表
 *   stdout - 白名单大小统计
 */
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const HOME = process.env.HOME || require('os').homedir();
const DEFAULT_PATH = path.join(HOME, 'auto-upload');
const AUTO_UPLOAD_PATH = process.env.AUTO_UPLOAD_PATH || DEFAULT_PATH;
const MANIFEST_OUTPUT = path.join(__dirname, 'auto-upload-manifest.json');

if (!fs.existsSync(AUTO_UPLOAD_PATH)) {
  console.error(`❌ auto-upload 目录不存在: ${AUTO_UPLOAD_PATH}`);
  console.error(`   设置环境变量 AUTO_UPLOAD_PATH=<path> 指定正确位置`);
  process.exit(1);
}

const REQUIRED_FILES = [
  'main.py',
  'requirements.txt',
  'conf.py',
  'conf.example.py',
  'cdp_runtime.py',
  'platform_douyin_cdp.py',
  'platform_channel_cdp.py',
];

const INCLUDE_DIRS = ['uploader', 'utils', 'myUtils', 'packaging'];

const EXCLUDE_NAMES = new Set([
  '__pycache__',
  '.git',
  '.venv',
  'node_modules',
  '.next',
  'dist',
  'build',
  '.DS_Store',
]);

const EXCLUDE_SUFFIXES = ['.pyc', '.pyo'];

const whitelist = new Set(REQUIRED_FILES);

function walk(dir, base) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDE_NAMES.has(entry.name)) continue;
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.name.endsWith('.pyc') || entry.name.endsWith('.pyo')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, rel);
    } else if (entry.isFile()) {
      whitelist.add(rel);
    }
  }
}

for (const d of INCLUDE_DIRS) {
  const full = path.join(AUTO_UPLOAD_PATH, d);
  if (fs.existsSync(full)) {
    walk(full, d);
  } else {
    console.warn(`⚠ 目录不存在，跳过: ${d}`);
  }
}

const requiredMissing = REQUIRED_FILES.filter((f) => !whitelist.has(f));
const requiredExist = REQUIRED_FILES.filter((f) =>
  fs.existsSync(path.join(AUTO_UPLOAD_PATH, f))
);
const requiredMissingOnDisk = REQUIRED_FILES.filter(
  (f) => !fs.existsSync(path.join(AUTO_UPLOAD_PATH, f))
);

if (requiredMissingOnDisk.length > 0) {
  console.warn(`⚠ 以下必需文件在源目录不存在（白名单里仍保留）:`);
  for (const f of requiredMissingOnDisk) console.warn(`   - ${f}`);
}

const sorted = [...whitelist].sort();
fs.writeFileSync(MANIFEST_OUTPUT, JSON.stringify(sorted, null, 2));

let totalSize = 0;
let foundCount = 0;
let missingCount = 0;
for (const f of sorted) {
  const full = path.join(AUTO_UPLOAD_PATH, f);
  try {
    totalSize += fs.statSync(full).size;
    foundCount++;
  } catch {
    missingCount++;
  }
}

console.log(`✓ Generated manifest: ${MANIFEST_OUTPUT}`);
console.log(`  Files: ${sorted.length} (${foundCount} on disk, ${missingCount} missing)`);
console.log(`  Total size: ${(totalSize / 1024).toFixed(1)}KB (${(totalSize / 1024 / 1024).toFixed(2)}MB)`);

if (totalSize > 50 * 1024 * 1024) {
  console.warn(`⚠ 白名单超过 50MB，可能漏了排除规则`);
}

process.exit(0);
