#!/usr/bin/env node
import process from "node:process";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const command = path.join(root, "vendor/skillhub/wechat-moments-publish/wechat-moments-publish.sh");

const args = process.argv.slice(2);
const run = args.includes("--run");
const filtered = args.filter((item) => item !== "--run");
const [content, ...assetPaths] = filtered;

if (!content || assetPaths.length === 0) {
  console.log("用法:");
  console.log("  node scripts/wechat-moments-calibrate.mjs \"校准文案\" /abs/a.jpg [/abs/b.jpg ...] [--run]");
  console.log("说明: 默认只校验素材规则并打印校准命令；加 --run 才打开微信朋友圈编辑器，不点击发表。");
  process.exitCode = 1;
  process.exit();
}

const assets = assetPaths.join("\n");
const validation = spawnSync(command, [content, "validate-only", assets], {
  cwd: root,
  encoding: "utf8",
});
const validationOutput = `${validation.stdout || ""}${validation.stderr || ""}`.trim();
if (validation.status !== 0) {
  console.log(validationOutput);
  process.exitCode = validation.status || 1;
  process.exit();
}

const calibrateArgs = [content, "approval-calibrate", assets];
if (!run) {
  console.log(validationOutput);
  console.log("校准命令:");
  console.log(`node scripts/wechat-moments-calibrate.mjs ${JSON.stringify(content)} ${assetPaths.map((item) => JSON.stringify(item)).join(" ")} --run`);
  process.exit();
}

const result = spawnSync(command, calibrateArgs, {
  cwd: root,
  encoding: "utf8",
  stdio: "inherit",
});
process.exitCode = result.status || 0;
