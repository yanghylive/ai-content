#!/usr/bin/env node
/**
 * 门禁：禁止「模型厂商直连」痕迹（计划 Stage 1D）
 *
 * 背景：生产链路必须全部经 KAYPAL 统一网关计费。任何直连模型厂商的
 * 地址 / 环境变量凭据，都会绕过计费与审计，属 P0 违规。
 *
 * 扫描范围（计划指定）：
 *   - backend/src                 源码
 *   - backend/dist-bundle-sqlite  桌面端真实出货 bundle（electron-builder extraResources）
 *
 * 判定规则：
 *   1) 我方代码/配置/OpenAPI 示例中出现厂商直连域名        → FAIL
 *   2) 我方代码真实读取厂商直连 Key 环境变量               → FAIL
 *      （即 process.env.XXX / readEnv('XXX') 形式的取值）
 *   3) 打包进来的第三方 SDK（openai npm 包）自身的内置默认值 → PASS（白名单）
 *      理由：我们始终显式传入 apiKey + baseURL（见 ai-client.service.ts
 *      new OpenAI({ apiKey: platform.apiKey, baseURL: safeBaseUrl })），
 *      显式参数优先于 SDK 的 env 回退，故 SDK 内置默认值不构成直连风险。
 *      该白名单只按「文件路径 + SDK 特征上下文」放行，不放行我方源码。
 *
 * 用法：node scripts/check-no-direct-provider.mjs
 * 退出码：0 通过 / 1 违规
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const backendRoot = resolve(import.meta.dirname, '..');
const repoRoot = resolve(backendRoot, '..');

/** 厂商直连域名（不含 kaypal.cn） */
const FORBIDDEN_HOSTS = [
  'api.deepseek.com',
  'api.openai.com',
  'dashscope.aliyuncs.com',
  'api.moonshot.cn',
  'api.anthropic.com',
  'generativelanguage.googleapis.com',
];

/** 厂商直连 Key 环境变量：只在「真实取值」时算违规 */
const FORBIDDEN_ENV_KEYS = [
  'DEEPSEEK_API_KEY',
  'OPENAI_API_KEY',
  'DASHSCOPE_API_KEY',
  'MOONSHOT_API_KEY',
  'ANTHROPIC_API_KEY',
];

/** 真实取值的形态：process.env.X / process.env['X'] / readEnv('X') / env.X */
function isRealEnvRead(line, key) {
  const patterns = [
    new RegExp(`process\\.env\\.${key}\\b`),
    new RegExp(`process\\.env\\[['"\`]${key}['"\`]\\]`),
    new RegExp(`readEnv\\(\\s*['"\`]${key}['"\`]`),
    new RegExp(`getEnv\\(\\s*['"\`]${key}['"\`]`),
    new RegExp(`configService\\.get\\(\\s*['"\`]${key}['"\`]`),
  ];
  return patterns.some((p) => p.test(line));
}

/**
 * 第三方 openai SDK 的内置默认值白名单。
 * 只放行同时满足：(a) 在打包产物 index.js 里，(b) 该行带 SDK 自身特征。
 */
const SDK_ALLOW_MARKERS = [
  'OPENAI_BASE_URL',
  'OPENAI_API_VERSION',
  'OPENAI_ADMIN_KEY',
  'OPENAI_ORG_ID',
  'OPENAI_PROJECT_ID',
  'OPENAI_WEBHOOK_SECRET',
  'AZURE_OPENAI_API_KEY',
  'azureADTokenProvider',
  'dangerouslyAllowBrowser',
  '@param',
  'OpenAIError',
  'this.baseURL',
  'this._provider',
  'providerRuntime',
];

function isVendoredSdkLine(line) {
  return SDK_ALLOW_MARKERS.some((m) => line.includes(m));
}

const SCAN_TARGETS = [
  { path: join(backendRoot, 'src'), kind: 'source' },
  { path: join(backendRoot, 'dist-bundle-sqlite'), kind: 'bundle' },
];

const SKIP_DIR = /(^|\/)(node_modules|\.git)(\/|$)/;
const SKIP_NAME = /\.(map|png|jpg|jpeg|ico|icns|woff2?|node|dylib|so|dll|sqlite)$/i;

function collectFiles(root) {
  const out = [];
  if (!existsSync(root)) return out;
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (SKIP_DIR.test(full)) continue;
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(full);
        continue;
      }
      if (SKIP_NAME.test(name)) continue;
      out.push(full);
    }
  };
  const st = statSync(root);
  if (st.isDirectory()) walk(root);
  else out.push(root);
  return out;
}

const violations = [];
let allowedSdkLines = 0;
let scannedFiles = 0;

for (const target of SCAN_TARGETS) {
  if (!existsSync(target.path)) {
    console.warn(
      `[check-no-direct-provider] 跳过不存在的目标: ${relative(repoRoot, target.path)}`,
    );
    continue;
  }
  for (const file of collectFiles(target.path)) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    scannedFiles += 1;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];

      for (const host of FORBIDDEN_HOSTS) {
        if (!line.includes(host)) continue;
        if (target.kind === 'bundle' && isVendoredSdkLine(line)) {
          allowedSdkLines += 1;
          continue;
        }
        violations.push({
          file: relative(repoRoot, file),
          line: i + 1,
          rule: `直连域名 ${host}`,
          snippet: line.trim().slice(0, 160),
        });
      }

      for (const key of FORBIDDEN_ENV_KEYS) {
        if (!line.includes(key)) continue;
        if (!isRealEnvRead(line, key)) continue; // 注释/文档提及不算
        if (target.kind === 'bundle' && isVendoredSdkLine(line)) {
          allowedSdkLines += 1;
          continue;
        }
        violations.push({
          file: relative(repoRoot, file),
          line: i + 1,
          rule: `直连 Key 读取 ${key}`,
          snippet: line.trim().slice(0, 160),
        });
      }
    }
  }
}

console.log(
  `[check-no-direct-provider] 扫描文件 ${scannedFiles} 个；放行第三方 SDK 内置默认值 ${allowedSdkLines} 处`,
);

if (violations.length > 0) {
  console.error(
    `\n[check-no-direct-provider] FAIL：发现 ${violations.length} 处厂商直连痕迹\n`,
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  [${v.rule}]`);
    console.error(`    ${v.snippet}`);
  }
  console.error(
    '\n生产链路必须全部经 KAYPAL 网关计费，请移除直连地址/凭据后重跑。\n',
  );
  process.exit(1);
}

console.log('[check-no-direct-provider] PASS：无厂商直连痕迹');
