/* eslint-disable no-console */
/**
 * CI 守门脚本：演示舱隔离规范（合规边界确认书 v2 第五节）
 *
 * 用法：node scripts/ci/demo-guard-ci.mjs
 * 退出码：
 *   0 = 通过
 *   1 = 有违规
 *   2 = 参数错误
 *
 * 触发违规（v2 合规书第五节）：
 *   1. production 路径 import 了 demo
 *   2. release 构建时 ENABLE_DEMO=true（必须 false）
 *   3. demo 目录出现 KAYPAL_CREDENTIAL_MASTER_KEY 等敏感凭证字面量
 *   4. demo 目录出现真实账号/平台域名种子值（heuristic）
 *   5. demo 目录缺少根 DEMO_MODULES_DISCLAIMER.md 引用
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

// ─────────────────────────────────────────────────────────────
// 1. demo 路径识别（合规书第五节第 1 条）
// ─────────────────────────────────────────────────────────────

const DEMO_PATH_HINTS = [
  '/demo/',
  '/demo\\',
  '.demo.ts',
  '.demo.tsx',
  '.demo.js',
  '.demo.jsx',
  '.demo.mjs',
  '.demo.cjs',
];

// 演示舱允许存在的根目录
const PRODUCTION_DIRS = ['frontend/src', 'backend/src', 'desktop/src'];

// ─────────────────────────────────────────────────────────────
// 2. 敏感字面量（合规书第五节第 3 条）
// ─────────────────────────────────────────────────────────────

const SENSITIVE_LITERALS = [
  'KAYPAL_CREDENTIAL_MASTER_KEY',
  'credential-master-key',
  'master-key',
  'api.secret',
  'api_secret',
  'app_secret',
  'corpsecret',
  'client_secret',
  'wechat_token',
  'douyin_token',
  'bailian',
  'deepseek',
  'openai',
  'sk-',
  'Bearer ',
  'JWT_',
];

// 演示舱专用允许字面量（mock/fixture 标识）
const DEMO_ALLOWED_LITERALS = [
  'DEMO_MOCK',
  'demo_mock',
  'fixture_',
  'fake_',
  'mock_',
  'demo:',
  'demo-',
  'demo_',
];

// 真实平台域名（heuristic 第 4 条）——出现在 demo/ 中即视为真实账号种子
const REAL_PLATFORM_SEEDS = [
  'mp.weixin.qq.com',
  'weixin.qq.com',
  'api.weixin.qq.com',
  'api.wxwork.qq.com',
  'qyapi.weixin.qq.com',
  'open.douyin.com',
  'creator.douyin.com',
  'api.xiaohongshu.com',
  'live.douyin.com',
  'open.tiktok.com',
  'open.feishu.cn',
];

// ─────────────────────────────────────────────────────────────
// 3. 工具
// ─────────────────────────────────────────────────────────────

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue; // 锁文件 / 损坏 symlink 等
    }
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === '.next' || entry === 'dist' || entry.startsWith('.')) continue;
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

function isDemoPath(filePath) {
  const rel = relative(ROOT, filePath).split(sep).join('/');
  return DEMO_PATH_HINTS.some((hint) => rel.includes(hint.replace(/[/\\]/g, '/')));
}

function isProductionPath(filePath) {
  const rel = relative(ROOT, filePath).split(sep).join('/');
  return PRODUCTION_DIRS.some((d) => rel.startsWith(d));
}

function isDemoCodeFile(filePath) {
  return /\.(tsx?|jsx?|mjs|cjs)$/.test(filePath);
}

function readContent(filePath) {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// 4. 检查逻辑
// ─────────────────────────────────────────────────────────────

const violations = [];

function addViolation(type, file, detail) {
  violations.push({ type, file, detail });
}

// 检查 1：production → demo import
function checkProdImportsDemo() {
  const files = walk(join(ROOT, 'frontend')).concat(walk(join(ROOT, 'backend'))).concat(walk(join(ROOT, 'desktop')));
  for (const f of files) {
    if (!isDemoCodeFile(f)) continue;
    if (isDemoPath(f)) continue; // demo 自己 import demo 不违规
    if (!isProductionPath(f)) continue;
    const content = readContent(f);
    if (!content) continue;
    const importRegex = /from\s+['"]([^'"]+)['"]/g;
    let m;
    while ((m = importRegex.exec(content)) !== null) {
      const importPath = m[1];
      if (importPath.includes('/demo/') || importPath.includes('@/demo/') || importPath.includes('~/demo/')) {
        addViolation('prod_imports_demo', relative(ROOT, f), `production 文件导入 demo: from '${importPath}'`);
      }
    }
  }
}

// 检查 2：release 构建时 demo flag 必须 false（前端构建期 NEXT_PUBLIC_ENABLE_DEMO + 后端运行时 ENABLE_DEMO 双名覆盖）
function checkReleaseDemoFlag() {
  const isRelease = process.env.NODE_ENV === 'production' || process.env.CI_RELEASE === 'true';
  const frontendDemoEnabled = process.env.NEXT_PUBLIC_ENABLE_DEMO === 'true';
  const backendDemoEnabled = process.env.ENABLE_DEMO === 'true';
  if (isRelease && frontendDemoEnabled) {
    addViolation('release_demo_enabled', '(env)', `release 构建时 NEXT_PUBLIC_ENABLE_DEMO=true，合规书第五节第 2 条要求 release 必须 false`);
  }
  if (isRelease && backendDemoEnabled) {
    addViolation('release_demo_enabled', '(env)', `release 构建时 ENABLE_DEMO=true，合规书第五节第 2 条要求 release 必须 false`);
  }
}

// 检查 6（S9 新增，2026-08-18）：构建产物（frontend/out/）不得含 demo 路由
// 防止 webpack IgnorePlugin 失效（曾指向不存在目录）导致 out/demo/*.html 泄漏进发布包
function checkNoDemoInArtifacts() {
  if (process.env.NEXT_PUBLIC_ENABLE_DEMO === 'true') {
    return; // 本地演示构建放行
  }
  const outDemo = join(ROOT, 'frontend', 'out', 'demo');
  if (existsSync(outDemo)) {
    addViolation('demo_in_artifacts', 'frontend/out/demo/', `构建产物含 demo 路由（IgnorePlugin 未生效？）。demo 实现位于 src/app/demo/**，next.config.ts 的 IgnorePlugin resourceRegExp 必须匹配 src/app/demo/，否则 demo 页面会进发布包`);
  }
  // 兜底：扫描 out/ 下所有含 demo 的 html 入口
  const outDir = join(ROOT, 'frontend', 'out');
  if (existsSync(outDir)) {
    for (const f of walk(outDir)) {
      const rel = relative(ROOT, f).split(sep).join('/');
      if (/\bdemo\b/.test(rel) && /\.html$/.test(rel)) {
        addViolation('demo_in_artifacts', rel, '构建产物含 demo 页面入口');
      }
    }
  }
}

// 检查 3：demo 目录敏感凭证字面量
function checkSensitiveLiterals() {
  const demoRoots = [
    join(ROOT, 'frontend', 'src'),
    join(ROOT, 'backend', 'src'),
    join(ROOT, 'desktop', 'src'),
  ];
  for (const root of demoRoots) {
    const files = walk(root);
    for (const f of files) {
      if (!isDemoPath(f)) continue;
      if (!isDemoCodeFile(f)) continue;
      const content = readContent(f);
      if (!content) continue;
      for (const lit of SENSITIVE_LITERALS) {
        if (content.includes(lit)) {
          // 先排除允许字面量
          const isAllowed = DEMO_ALLOWED_LITERALS.some((a) => content.toLowerCase().includes(a));
          if (!isAllowed) {
            addViolation('disallowed_literal', relative(ROOT, f), `demo 文件含敏感字面量 '${lit}'，违反第五节第 3 条（必须用 mock 数据）`);
          }
        }
      }
    }
  }
}

// 检查 4：真实平台域名种子
function checkRealPlatformSeeds() {
  const demoRoots = [
    join(ROOT, 'frontend', 'src'),
    join(ROOT, 'backend', 'src'),
    join(ROOT, 'desktop', 'src'),
  ];
  for (const root of demoRoots) {
    const files = walk(root);
    for (const f of files) {
      if (!isDemoPath(f)) continue;
      if (!isDemoCodeFile(f)) continue;
      const content = readContent(f);
      if (!content) continue;
      for (const seed of REAL_PLATFORM_SEEDS) {
        if (content.includes(seed)) {
          // 允许在注释/disclaimer 中出现
          const lineCount = content.split('\n').length;
          const urlLines = content.split('\n').filter((l) => l.includes(seed));
          const nonCommentLines = urlLines.filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'));
          if (nonCommentLines.length > 0) {
            addViolation('real_account_seed', relative(ROOT, f), `demo 文件含真实平台域名 '${seed}'（非注释），违反第五节第 4 条（必须 mock 本地端点）`);
          }
        }
      }
    }
  }
}

// 检查 5：根 DEMO_MODULES_DISCLAIMER.md 必须存在
function checkDisclaimerFile() {
  const disclaimer = join(ROOT, 'DEMO_MODULES_DISCLAIMER.md');
  if (!existsSync(disclaimer)) {
    addViolation('missing_disclaimer', 'DEMO_MODULES_DISCLAIMER.md', '仓库根缺 DEMO_MODULES_DISCLAIMER.md，合规书第五节第 1 条要求');
  }
}

// ─────────────────────────────────────────────────────────────
// 5. 主程序
// ─────────────────────────────────────────────────────────────

function main() {
  console.log('──── demo-guard CI 守门 ────');
  console.log(`仓库根: ${ROOT}`);
  console.log();

  checkProdImportsDemo();
  checkReleaseDemoFlag();
  checkSensitiveLiterals();
  checkRealPlatformSeeds();
  checkDisclaimerFile();
  checkNoDemoInArtifacts();

  console.log(`检查完成，发现 ${violations.length} 项违规`);
  console.log();

  if (violations.length === 0) {
    console.log('✅ demo-guard 通过：演示舱隔离规范全部满足。');
    process.exit(0);
  }

  console.log('❌ demo-guard 失败：演示舱隔离规范有违规');
  console.log();
  for (const v of violations) {
    console.log(`  [${v.type}] ${v.file}`);
    console.log(`    ${v.detail}`);
  }
  console.log();
  console.log('参考：DEMO_MODULE_CONTRACT.md + 合规边界确认书 v2 第五节');
  process.exit(1);
}

main();
