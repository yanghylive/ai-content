#!/usr/bin/env node
/**
 * postbuild-remove-demo.mjs —— 构建后从静态产物中物理删除 demo 路由（S9 修复，2026-08-18）
 *
 * 背景：webpack IgnorePlugin 只拦截 import 图，对 Next.js app router 的
 * 文件系统路由发现机制无效（已实测：IgnorePlugin 指向 src/app/demo/ 后
 * next build 仍导出 out/demo/*.html）。因此本脚本在构建完成后物理删除
 * out/demo/，并配合 scripts/ci/demo-guard-ci.mjs 检查 6 在 CI 兜底校验。
 *
 * 非 demo 构建（默认）删除；NEXT_PUBLIC_ENABLE_DEMO=true 的本地演示构建跳过。
 */
import { existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DEMO = join(__dirname, '..', 'out', 'demo');

const isDemoBuild = process.env.NEXT_PUBLIC_ENABLE_DEMO === 'true';
if (isDemoBuild) {
  console.log('[postbuild-remove-demo] 演示构建，跳过删除');
  process.exit(0);
}

if (existsSync(OUT_DEMO)) {
  rmSync(OUT_DEMO, { recursive: true, force: true });
  console.log(`[postbuild-remove-demo] ✅ 已从产物删除 demo 路由: ${OUT_DEMO}`);
} else {
  console.log('[postbuild-remove-demo] 产物中无 demo 路由（预期）');
}
