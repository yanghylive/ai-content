/* eslint-disable no-console */
/**
 * 开发者本机演示模式启动检查
 *
 * 用法：npm run demo:check
 * 启动 demo 前自查；不阻塞、只提示。
 */

import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function ok(msg) { console.log(`  ✅ ${msg}`); }
function warn(msg) { console.log(`  ⚠️  ${msg}`); }
function fail(msg) { console.log(`  ❌ ${msg}`); }

console.log('\n──── Demo Mode 自检 ────');

// 1. env flag（前端构建期 NEXT_PUBLIC_ENABLE_DEMO + 后端运行时 ENABLE_DEMO）
const flag = process.env.ENABLE_DEMO;
const feFlag = process.env.NEXT_PUBLIC_ENABLE_DEMO;
const token = process.env.DEMO_OVERRIDE_TOKEN;
if ((flag === 'true' || feFlag === 'true') && token && token.length >= 16) {
  ok('演示 flag 已开启（ENABLE_DEMO / NEXT_PUBLIC_ENABLE_DEMO）且 DEMO_OVERRIDE_TOKEN 已设置（≥16 字符）');
} else {
  warn('演示模式未开启（默认）。若需开启，按 README 设 NEXT_PUBLIC_ENABLE_DEMO=true（前端构建期）+ ENABLE_DEMO=true（后端运行时）+ DEMO_OVERRIDE_TOKEN=<随机32位>');
}

// 2. NODE_ENV
if (process.env.NODE_ENV === 'production') {
  fail('NODE_ENV=production 时演示模式被强制关闭（合规：不暴露 demo 给生产）');
} else {
  ok(`NODE_ENV=${process.env.NODE_ENV || 'undefined'}（非生产）`);
}

// 3. disclaimer 文件
const disclaimer = join(ROOT, 'DEMO_MODULES_DISCLAIMER.md');
if (existsSync(disclaimer)) {
  ok('DEMO_MODULES_DISCLAIMER.md 存在');
} else {
  fail('DEMO_MODULES_DISCLAIMER.md 缺失（CI 守门会失败）');
}

// 4. CI 守门脚本
const ciGuard = join(ROOT, 'scripts/ci/demo-guard-ci.mjs');
if (existsSync(ciGuard)) {
  ok('CI 守门脚本 scripts/ci/demo-guard-ci.mjs 已就位');
} else {
  fail('CI 守门脚本缺');
}

// 5. 前端/后端门禁模块
const frontendGate = join(ROOT, 'frontend/src/lib/demo/isDemoModeEnabled.ts');
const backendGate = join(ROOT, 'backend/src/lib/demo/demo-mode.ts');
if (existsSync(frontendGate)) ok('前端门禁模块就位');
else fail('前端门禁模块缺');
if (existsSync(backendGate)) ok('后端门禁模块就位');
else fail('后端门禁模块缺');

console.log('─────────────────────────\n');
