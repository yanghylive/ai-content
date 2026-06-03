#!/usr/bin/env node
/**
 * Release size + 资源守门
 *
 * 用法:
 *   BUILD_PLATFORM=mac-arm64 node scripts/check-release-size.js
 *   BUILD_PLATFORM=mac-x64 node scripts/check-release-size.js
 *   BUILD_PLATFORM=win-x64 node scripts/check-release-size.js
 *
 * 检查:
 *   - .app / unpacked 目录总大小 < 500MB
 *   - DMG (mac) 或 exe (win) 存在且大小合理
 *   - 必要资源齐全 (main.py, requirements.txt, stealth.min.js, backend/index.js 等)
 *   - 不应存在的资源已排除 (.git, logs, videoFile, frontend/node_modules 等)
 *   - Prisma engine 只含本平台
 */
const fs = require('fs');
const path = require('path');

const LIMIT_MB = 500;

const PLATFORM_CONFIG = {
  'mac-arm64': {
    appDir: 'dist/mac-arm64',
    appName: 'KaypalAI内容创作平台.app',
    resourceBase: 'Contents/Resources',
    dmgDir: 'dist',
    requiredEngines: ['libquery_engine-darwin-arm64.dylib.node'],
    forbiddenEngines: [
      'query_engine-windows.dll.node',
      'libquery_engine-darwin.dylib.node',
    ],
  },
  'mac-x64': {
    appDir: 'dist/mac',
    appName: 'KaypalAI内容创作平台.app',
    resourceBase: 'Contents/Resources',
    dmgDir: 'dist',
    requiredEngines: ['libquery_engine-darwin.dylib.node'],
    forbiddenEngines: [
      'query_engine-windows.dll.node',
      'libquery_engine-darwin-arm64.dylib.node',
    ],
  },
  'win-x64': {
    appDir: 'dist/win-unpacked',
    appName: 'KaypalAI内容创作平台.exe',
    resourceBase: 'resources',
    dmgDir: 'dist',
    requiredEngines: ['query_engine-windows.dll.node'],
    forbiddenEngines: [
      'libquery_engine-darwin-arm64.dylib.node',
      'libquery_engine-darwin.dylib.node',
    ],
  },
};

let platform = process.env.BUILD_PLATFORM;
if (!platform) {
  const detected =
    process.platform === 'darwin' && process.arch === 'arm64'
      ? 'mac-arm64'
      : process.platform === 'darwin'
        ? 'mac-x64'
        : 'win-x64';
  platform = detected;
  console.warn(`⚠ BUILD_PLATFORM 未设置，自动检测为: ${platform}`);
}

const config = PLATFORM_CONFIG[platform];
if (!config) {
  console.error(`❌ 未知平台: ${platform}`);
  console.error(`   支持: ${Object.keys(PLATFORM_CONFIG).join(', ')}`);
  process.exit(1);
}

const SCRIPT_DIR = __dirname;
const DESKTOP_DIR = path.resolve(SCRIPT_DIR, '..');

function dirSize(p) {
  let total = 0;
  if (!fs.existsSync(p)) return 0;
  const stat = fs.statSync(p);
  if (stat.isFile() || stat.isSymbolicLink()) {
    return stat.size;
  }
  if (!stat.isDirectory()) return 0;
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        try {
          total += fs.statSync(full).size;
        } catch {}
      } else if (entry.isSymbolicLink()) {
        try {
          total += fs.statSync(full).size;
        } catch {}
      }
    }
  }
  walk(p);
  return total;
}

function fileSize(p) {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}

let failed = false;
function fail(msg) {
  console.error(`❌ ${msg}`);
  failed = true;
}
function ok(msg) {
  console.log(`✓ ${msg}`);
}

console.log(`=== Release Size Check [${platform}] ===\n`);

const appBase = path.join(DESKTOP_DIR, config.appDir);
const appPath = path.join(appBase, config.appName);

if (!fs.existsSync(appPath)) {
  fail(`${platform} 产物不存在: ${appPath}`);
  console.error('❌ Size check FAILED');
  process.exit(1);
}

const appSize = dirSize(appPath);
const appSizeMB = (appSize / 1024 / 1024).toFixed(0);
console.log(`${config.appName}: ${appSizeMB}MB (limit ${LIMIT_MB}MB)`);
if (parseInt(appSizeMB) > LIMIT_MB) {
  fail(`${config.appName} 超过 ${LIMIT_MB}MB 限制 (${appSizeMB}MB)`);
} else {
  ok(`${config.appName} 在限制内`);
}

const resBase = platform === 'win-x64'
  ? path.join(path.dirname(appPath), config.resourceBase)
  : path.join(appPath, config.resourceBase);

console.log('\n--- 必要资源检查 ---');
const required = [
  'auto-upload/main.py',
  'auto-upload/requirements.txt',
  'auto-upload/utils/stealth.min.js',
  'auto-upload/utils/base_social_media.py',
  'auto-upload/platform_douyin_cdp.py',
  'auto-upload/platform_channel_cdp.py',
  'backend/index.js',
  'backend/prisma/schema.prisma',
];
for (const f of required) {
  const full = path.join(resBase, f);
  if (!fs.existsSync(full)) {
    fail(`缺失必要资源: ${f}`);
  } else {
    const sizeKB = (fileSize(full) / 1024).toFixed(1);
    ok(`${f} (${sizeKB}KB)`);
  }
}

console.log('\n--- 不应存在的资源（隐私/开发垃圾） ---');
const forbidden = [
  'auto-upload/.git',
  'auto-upload/logs',
  'auto-upload/videoFile',
  'auto-upload/frontend/node_modules',
  'auto-upload/tests',
  'auto-upload/docs',
  'auto-upload/cookiesFile',
  'auto-upload/avatars',
  'auto-upload/db',
  'auto-upload/.venv',
  'frontend/dev',
  'frontend/cache',
  'frontend/.next',
];
for (const f of forbidden) {
  const full = path.join(resBase, f);
  if (fs.existsSync(full)) {
    const sizeMB = (dirSize(full) / 1024 / 1024).toFixed(1);
    fail(`不该存在: ${f} (${sizeMB}MB)`);
  } else {
    ok(`已排除: ${f}`);
  }
}

console.log('\n--- Prisma engine 检查 ---');
const clientDir = path.join(resBase, 'backend/client');
for (const e of config.requiredEngines) {
  if (!fs.existsSync(path.join(clientDir, e))) {
    fail(`缺少必需 engine: ${e}`);
  } else {
    const sizeMB = (fileSize(path.join(clientDir, e)) / 1024 / 1024).toFixed(1);
    ok(`engine present: ${e} (${sizeMB}MB)`);
  }
}
for (const e of config.forbiddenEngines) {
  if (fs.existsSync(path.join(clientDir, e))) {
    const sizeMB = (fileSize(path.join(clientDir, e)) / 1024 / 1024).toFixed(1);
    fail(`不该出现 engine: ${e} (${sizeMB}MB)`);
  } else {
    ok(`engine absent: ${e}`);
  }
}

console.log('\n--- DMG / 安装包检查 (mac) ---');
if (platform.startsWith('mac-')) {
  const dmgPath = path.join(DESKTOP_DIR, config.dmgDir);
  const dmgPattern = platform === 'mac-arm64'
    ? /-arm64\.dmg$/
    : /^KaypalAI.*-1\.0\.0\.dmg$/;
  const dmgFiles = fs.existsSync(dmgPath)
    ? fs.readdirSync(dmgPath).filter((f) => f.endsWith('.dmg') && dmgPattern.test(f))
    : [];
  if (dmgFiles.length === 0) {
    fail(`未找到匹配 ${platform} 的 .dmg 文件 (pattern: ${dmgPattern})`);
  } else {
    for (const f of dmgFiles) {
      const full = path.join(dmgPath, f);
      const sizeMB = (fileSize(full) / 1024 / 1024).toFixed(0);
      console.log(`  ${f}: ${sizeMB}MB`);
    }
    ok(`找到 ${dmgFiles.length} 个 ${platform} DMG`);
  }
}

console.log('');
if (failed) {
  console.error('❌ Size check FAILED');
  process.exit(1);
} else {
  console.log('✅ All checks PASSED');
  process.exit(0);
}
