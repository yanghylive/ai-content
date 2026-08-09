#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────
// 锁2 · 新版 UI 锚点检查（CI 兜底）
//
// 校验"新版身份证"是否在位。若哪天又因为任何原因跑成旧版
// （新 UI 丢失 / 被回退），本检查 exit 1，CI 当场红，拦住流出。
//
// 背景：2026-07-31 新版 Astryx UI 曾因 stash 忘 pop 被搁置、
//       线上跑旧版却无人察觉，直到人工发现。
// ──────────────────────────────────────────────────────────────
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const fe = join(root, "frontend");

const checks = [
  {
    name: "astryx.config.mjs 存在（Astryx 设计系统配置）",
    ok: existsSync(join(fe, "astryx.config.mjs")),
  },
  {
    name: "package.json 含 @astryxdesign/* 依赖",
    ok: (() => {
      try {
        const pkg = JSON.parse(readFileSync(join(fe, "package.json"), "utf8"));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        return Object.keys(deps).some((d) => d.startsWith("@astryxdesign/"));
      } catch {
        return false;
      }
    })(),
  },
  {
    name: "存在 *-v2 新版页面目录（如 workbench-v2 / xiaohongshu-v2）",
    ok: (() => {
      try {
        const dash = join(fe, "src", "app", "(dashboard)");
        return readdirSync(dash, { withFileTypes: true }).some(
          (e) => e.isDirectory() && e.name.endsWith("-v2"),
        );
      } catch {
        return false;
      }
    })(),
  },
];

for (const c of checks) console.log(`${c.ok ? "✅" : "❌"}  ${c.name}`);

const failed = checks.filter((c) => !c.ok);
if (failed.length > 0) {
  console.error(`\n❌ 新版 UI 锚点检查失败：${failed.length} 项"新版身份证"缺失。`);
  console.error("   极可能新版 UI 已丢失/被回退为旧版——请核查是否再次发生 stash 忘恢复、");
  console.error("   分支错乱或误回滚。恢复后再通过本门。");
  process.exit(1);
}

console.log("\n✅ 新版 UI 锚点检查通过：Astryx 新版身份证全部在位。");
