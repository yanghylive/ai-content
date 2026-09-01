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
 *   - .app / unpacked 目录总大小在当前内置 Chromium 架构限制内
 *   - mac zip 或 win exe 存在且大小合理
 *   - 必要资源齐全 (backend/index.js、Prisma engine、前端静态资源等)
 *   - 不应存在的资源已排除 (.git, logs, videoFile, frontend/node_modules 等)
 *   - Prisma engine 只含本平台
 */
const fs = require('fs');
const path = require('path');
const {
  assertPackagedReleaseGuards,
  createGuardContext,
  nodeRuntimePathForPlatform,
} = require('./release-guards');

// 2026-09-01 更新：当前一键包还内置 Octop venv + Chromium（约 1.14GB），
// mac-arm64 .app 实测约 1646MB；1600MB 已低于必需资源的实际基线。保留
// 约 150MB 增长余量，同时继续用 700MB 压缩包上限阻止异常膨胀。
const DEFAULT_APP_LIMIT_MB = 1800;
const DEFAULT_ARCHIVE_LIMIT_MB = 700;

const PLATFORM_CONFIG = {
  'mac-arm64': {
    appDir: 'dist/mac-arm64',
    appName: 'JIUZHANG AI 内容创作平台.app',
    resourceBase: 'Contents/Resources',
    dmgDir: 'dist',
    archivePattern: /-arm64-mac\.zip$/,
    requiredSharpPackages: ['@img/sharp-darwin-arm64', '@img/sharp-libvips-darwin-arm64'],
    requiredEngines: ['libquery_engine-darwin-arm64.dylib.node'],
    forbiddenEngines: [
      'query_engine-windows.dll.node',
      'libquery_engine-darwin.dylib.node',
    ],
  },
  'mac-x64': {
    appDir: 'dist/mac',
    appName: 'JIUZHANG AI 内容创作平台.app',
    resourceBase: 'Contents/Resources',
    dmgDir: 'dist',
    archivePattern: /-mac\.zip$/,
    requiredSharpPackages: ['@img/sharp-darwin-x64', '@img/sharp-libvips-darwin-x64'],
    requiredEngines: ['libquery_engine-darwin.dylib.node'],
    forbiddenEngines: [
      'query_engine-windows.dll.node',
      'libquery_engine-darwin-arm64.dylib.node',
    ],
  },
  'win-x64': {
    appDir: 'dist/win-unpacked',
    appName: 'JIUZHANG AI 内容创作平台.exe',
    resourceBase: 'resources',
    dmgDir: 'dist',
    archivePattern: /\.exe$/,
    requiredSharpPackages: ['@img/sharp-win32-x64', '@img/sharp-libvips-win32-x64'],
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
  const stat = fs.lstatSync(p);
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
          total += fs.lstatSync(full).size;
        } catch {}
      } else if (entry.isSymbolicLink()) {
        try {
          total += fs.lstatSync(full).size;
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

function fileContainsMarkers(filePath, markers) {
  if (!fs.existsSync(filePath)) return false;
  const content = fs.readFileSync(filePath);
  return markers.every((marker) => content.includes(Buffer.from(marker)));
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
const appLimitMB = Number(process.env.RELEASE_APP_LIMIT_MB || DEFAULT_APP_LIMIT_MB);
const archiveLimitMB = Number(process.env.RELEASE_ARCHIVE_LIMIT_MB || DEFAULT_ARCHIVE_LIMIT_MB);
console.log(`${config.appName}: ${appSizeMB}MB (limit ${appLimitMB}MB)`);
if (parseInt(appSizeMB) > appLimitMB) {
  fail(`${config.appName} 超过 ${appLimitMB}MB 限制 (${appSizeMB}MB)`);
} else {
  ok(`${config.appName} 在限制内`);
}

const resBase = platform === 'win-x64'
  ? path.join(path.dirname(appPath), config.resourceBase)
  : path.join(appPath, config.resourceBase);

console.log('\n--- 必要资源检查 ---');
const required = [
  'backend/index.js',
  'backend/package.json',
  'backend/prisma/schema.prisma',
  'backend/prisma/seed.db',
  'backend/node_modules/sharp/package.json',
  path.relative(resBase, nodeRuntimePathForPlatform(resBase, platform)),
  'backend/node_modules/@playwright/mcp/cli.js',
  'backend/node_modules/playwright/package.json',
  'backend/node_modules/playwright-core/package.json',
  'playwright-browsers',
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
const sqliteSeedPath = path.join(resBase, 'backend/prisma/seed.db');
if (!fileContainsMarkers(sqliteSeedPath, ['schedule_configs', 'kaypal_user_id', 'commercial_execution_allowed', 'plan_mode', 'user_sessions'])) {
  fail('SQLite seed 库缺少 Kaypal 登录所需 schema 字段');
} else {
  ok('SQLite seed schema markers present');
}

const packagedGuard = createGuardContext();
assertPackagedReleaseGuards(packagedGuard, resBase, platform);
if (!packagedGuard.ok()) {
  for (const failure of packagedGuard.failures) {
    fail(failure);
  }
}

for (const packageName of config.requiredSharpPackages || []) {
  const full = path.join(resBase, 'backend', 'node_modules', ...packageName.split('/'), 'package.json');
  if (!fs.existsSync(full)) {
    fail(`缺失 sharp 原生依赖: ${packageName}`);
  } else {
    ok(`sharp native present: ${packageName}`);
  }
}

console.log('\n--- 不应存在的资源（隐私/开发垃圾） ---');
const forbidden = [
  'auto-upload',
  'agent-s-executor',
  'installer/wheelhouse',
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
  const clientEnginePath = path.join(clientDir, e);
  if (!fs.existsSync(clientEnginePath)) {
    fail(`缺少必需 client engine: ${e}`);
  } else {
    const sizeMB = (fileSize(clientEnginePath) / 1024 / 1024).toFixed(1);
    ok(`client engine present: ${e} (${sizeMB}MB)`);
  }

  const runtimeEnginePath = path.join(resBase, 'backend', e);
  if (!fs.existsSync(runtimeEnginePath)) {
    fail(`缺少运行时 engine 拷贝: ${e}`);
  } else {
    const sizeMB = (fileSize(runtimeEnginePath) / 1024 / 1024).toFixed(1);
    ok(`runtime engine present: ${e} (${sizeMB}MB)`);
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

console.log('\n--- 分发包检查 ---');
if (platform.startsWith('mac-')) {
  const archivePath = path.join(DESKTOP_DIR, config.dmgDir);
  const archiveFiles = fs.existsSync(archivePath)
    ? fs.readdirSync(archivePath).filter((f) => config.archivePattern.test(f))
    : [];
  if (archiveFiles.length === 0) {
    fail(`未找到匹配 ${platform} 的 zip 分发包 (pattern: ${config.archivePattern})`);
  } else {
    const appMtimeMs = fs.statSync(appPath).mtimeMs;
    for (const f of archiveFiles) {
      const full = path.join(archivePath, f);
      const sizeMB = (fileSize(full) / 1024 / 1024).toFixed(0);
      const archiveMtimeMs = fs.statSync(full).mtimeMs;
      console.log(`  ${f}: ${sizeMB}MB`);
      // 历史遗留分发包（早于当前 app）：非本次构建产物，只列不查，避免误报阻断
      if (archiveMtimeMs + 1000 < appMtimeMs) {
        console.log(`    (历史分发包，非本次构建产物，跳过大小检查)`);
        continue;
      }
      if (Number(sizeMB) > archiveLimitMB) {
        fail(`zip 分发包超过 ${archiveLimitMB}MB 限制: ${f} (${sizeMB}MB)`);
      }
    }
    ok(`找到 ${archiveFiles.length} 个 ${platform} zip 分发包（其中本次构建 ${archiveFiles.filter((f) => fs.statSync(path.join(archivePath, f)).mtimeMs + 1000 >= appMtimeMs).length} 个）`);
  }
  const freshDmgFiles = fs.existsSync(archivePath)
    ? fs.readdirSync(archivePath).filter((f) => /-arm64\.dmg$|\.dmg$/.test(f)).filter((f) => {
        const full = path.join(archivePath, f);
        return fs.statSync(full).mtimeMs + 1000 >= fs.statSync(appPath).mtimeMs;
      })
    : [];
  if (freshDmgFiles.length === 0) {
    console.log('  未找到本次构建生成的 DMG；如发布渠道要求 DMG，需要单独修复 hdiutil。');
  }
} else {
  const sizeMB = (fileSize(appPath) / 1024 / 1024).toFixed(0);
  console.log(`  ${config.appName}: ${sizeMB}MB`);
  if (Number(sizeMB) > archiveLimitMB) {
    fail(`Windows 安装包超过 ${archiveLimitMB}MB 限制 (${sizeMB}MB)`);
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
