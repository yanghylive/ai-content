#!/usr/bin/env node
/**
 * 替换干净度检测器：扫描指定目录，找出"旧符号"的所有残留引用点。
 * 用途：任何"替换旧实现"的改动，提交前跑一遍，保证零残留、不埋工程垃圾。
 *
 * 用法：
 *   node scripts/verify-clean-replace.mjs \
 *     --symbols captureAccountIdentityBestEffort,PLATFORM_IDENTITY_SELECTORS_OLD \
 *     --allow backend/src/modules/auto-upload/identity-capture.ts \
 *     --dirs backend/src,frontend/src
 *
 *   --symbols  逗号分隔的旧符号（函数名/常量名/接口名），必填
 *   --allow    逗号分隔的白名单文件路径（子串匹配，如新实现文件），可选
 *   --dirs     逗号分隔的扫描目录（默认 backend/src,frontend/src）
 *
 * 退出码：0=干净；1=发现残留（CI 可拦截）
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);

function argValue(name) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

const symbols = (argValue('symbols') || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const allowList = (argValue('allow') || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const dirs = (argValue('dirs') || 'backend/src,frontend/src')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (!symbols.length) {
  console.error('用法: node scripts/verify-clean-replace.mjs --symbols 旧符号1,旧符号2 [--allow 白名单文件] [--dirs 扫描目录]');
  process.exit(2);
}

const IGNORE_DIRS = new Set([
  'node_modules', 'dist', 'dist-bundle', 'dist-bundle-sqlite', 'build',
  '.next', 'out', '.git', '__pycache__', '.workbuddy',
]);

const symbolRegex = new RegExp(`\\b(${symbols.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'g');

const hits = [];

function isAllowed(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  return allowList.some((entry) => normalized.includes(entry.replace(/\\/g, '/')));
}

function walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) walk(full);
      continue;
    }
    if (!/\.(ts|tsx|js|mjs|cjs|json|md)$/.test(entry.name)) continue;
    if (isAllowed(full)) continue;
    let content;
    try {
      content = readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    symbolRegex.lastIndex = 0;
    let match;
    const lines = content.split('\n');
    while ((match = symbolRegex.exec(content)) !== null) {
      const lineNo = content.slice(0, match.index).split('\n').length;
      const lineText = lines[lineNo - 1]?.trim() || '';
      // 跳过纯注释/字符串文档中的历史性提及（"旧函数已下线"这类说明允许存在）
      if (/^\s*(\/\/|\*|#|<!--)/.test(lineText)) continue;
      hits.push({
        file: full.replace(process.cwd() + '/', ''),
        line: lineNo,
        text: lineText.slice(0, 120),
        symbol: match[0],
      });
    }
  }
}

dirs.forEach((dir) => {
  // 兼容从项目根或 backend/ 目录两种运行位置
  const abs = resolve(process.cwd(), dir);
  const candidates = [abs];
  if (!existsSync(abs)) {
    candidates.push(resolve(process.cwd(), 'backend', dir));
    candidates.push(resolve(process.cwd(), dir.replace(/^backend\//, '')));
  }
  const target = candidates.find((candidate) => existsSync(candidate));
  if (!target) {
    console.warn(`⚠️  扫描目录不存在，跳过: ${dir}`);
    return;
  }
  walk(target);
});

if (!hits.length) {
  console.log(`✅ 干净：符号 [${symbols.join(', ')}] 无残留引用（白名单除外）`);
  process.exit(0);
}

console.error(`❌ 发现 ${hits.length} 处残留引用，替换不彻底：`);
const bySymbol = new Map();
for (const hit of hits) {
  if (!bySymbol.has(hit.symbol)) bySymbol.set(hit.symbol, []);
  bySymbol.get(hit.symbol).push(hit);
}
for (const [symbol, list] of bySymbol) {
  console.error(`\n【${symbol}】`);
  for (const hit of list) {
    console.error(`  ${hit.file}:${hit.line}  ${hit.text}`);
  }
}
console.error('\n处理方式：删除/迁移引用后重跑本脚本；确属历史说明的可加入 --allow 白名单（仅限注释提及）。');
process.exit(1);
