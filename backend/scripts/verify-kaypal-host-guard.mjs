#!/usr/bin/env node
/**
 * 运行时守卫验证（Stage 1A）
 *
 * 目的：证明「kaypal host 白名单」在**真正编译出来的产物**上生效，
 * 而不是只在 ts-jest 里绿。tsc/jest 全绿但产物行为不对的情况真实存在
 * （见 Stage 3A 的 Prisma client 污染案例：编译绿、运行炸）。
 *
 * 用法：
 *   node scripts/verify-kaypal-host-guard.mjs                  # 默认查 dist
 *   node scripts/verify-kaypal-host-guard.mjs dist-bundle-sqlite/index.js
 *
 * 退出码：0 全部符合预期 / 1 有偏差 / 2 产物不存在
 */

import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';

const backendRoot = resolve(import.meta.dirname, '..');
const argTarget = process.argv[2];
const target = argTarget
  ? resolve(backendRoot, argTarget)
  : join(backendRoot, 'dist/modules/ai-models/kaypal-provider.resolver.js');

if (!existsSync(target)) {
  console.error(
    `[verify-kaypal-host-guard] 产物不存在: ${target}\n先跑 npm run build（或 build:bundle:sqlite）再验证。`,
  );
  process.exit(2);
}

const mod = await import(pathToFileURL(target).href);
const Resolver = mod.KaypalProviderResolver;
if (!Resolver || typeof Resolver.assertAllowedUrl !== 'function') {
  console.error(
    '[verify-kaypal-host-guard] 产物里找不到 KaypalProviderResolver.assertAllowedUrl —— 守卫没被打进产物！',
  );
  process.exit(1);
}

/** [地址, 是否应放行, 说明] */
const CASES = [
  ['https://kaypal.cn/api/ai', true, '根域'],
  ['https://enterprise.kaypal.cn', true, '子域'],
  ['https://aicontent.vip.kaypal.cn', true, '多级子域'],
  ['https://kaypal.cn:8443/api/ai', true, '带端口'],
  ['https://kaypal.cn.evil.com/v1', false, '后缀伪装（子串匹配会被绕过）'],
  ['https://evil.com/v1?x=kaypal.cn', false, '查询串伪装'],
  ['https://evil.com/kaypal.cn/v1', false, '路径伪装'],
  ['https://kaypal.cn@evil.com/v1', false, '用户名伪装'],
  ['https://notkaypal.cn/v1', false, '前缀伪装'],
  ['https://kaypal.com/v1', false, '换 TLD'],
  ['', false, '空地址'],
  ['not a url', false, '非 URL'],
];

let bad = 0;
for (const [url, shouldPass, note] of CASES) {
  let passed = true;
  try {
    Resolver.assertAllowedUrl(url);
  } catch {
    passed = false;
  }
  const ok = passed === shouldPass;
  if (!ok) bad += 1;
  const tag = ok ? 'OK  ' : 'BAD ';
  const expect = shouldPass ? '应放行' : '应拒绝';
  const actual = passed ? '放行' : '拒绝';
  console.log(`${tag}${expect} → 实际${actual}  ${JSON.stringify(url)}  (${note})`);
}

console.log(
  `\n[verify-kaypal-host-guard] 产物: ${target}\n用例 ${CASES.length} 条，偏差 ${bad} 条`,
);
process.exit(bad === 0 ? 0 : 1);
