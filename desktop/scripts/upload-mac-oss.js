#!/usr/bin/env node
/**
 * 发版辅助：上传 Mac 产物 + blockmap 到 OSS。
 * 主流程 upload-to-oss.js 已支持现有三平台 feed；本脚本仅作为 Mac 单平台补传兜底。
 *
 * 用法：node scripts/upload-mac-oss.js
 * 依赖：desktop/.env 有 OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET
 * 说明：大文件必须 multipartUpload（分片 50MB），put/putStream 会 60s 超时
 */
const OSS = require("ali-oss");
const fs = require("fs");
const path = require("path");
const { buildUploadPlan } = require("./release-feed-plan");

function loadDotEnv() {
  const envFile = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    if (!process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadDotEnv();

async function main() {
  const client = new OSS({
    accessKeyId: process.env.OSS_ACCESS_KEY_ID,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
    region: process.env.OSS_REGION || "oss-cn-hangzhou",
    bucket: process.env.OSS_BUCKET || "kaypal",
    timeout: "600s",
    retryMax: 3,
  });
  const updatePath = process.env.OSS_UPDATE_PATH || "updates/";
  const distDir = path.resolve(__dirname, "..", "dist");
  const plan = buildUploadPlan({ distDir, feedFiles: ["latest-mac.yml"] });
  if (!plan.feedFiles.includes("latest-mac.yml")) {
    throw new Error("missing latest-mac.yml");
  }
  if (plan.missing.length > 0) {
    throw new Error(`missing feed-referenced artifact(s): ${plan.missing.join(", ")}`);
  }

  for (const f of plan.files) {
    const local = path.join(distDir, f);
    if (!fs.existsSync(local)) {
      throw new Error(`missing local artifact: ${f}`);
    }
    const sizeMB = (fs.statSync(local).size / 1048576).toFixed(1);
    console.log(`上传 ${f} (${sizeMB}MB)...`);
    const result = await client.multipartUpload(`${updatePath}${f}`, local, {
      headers: { "Content-Type": f.endsWith(".yml") ? "application/octet-stream" : "application/octet-stream" },
      partSize: 50 * 1024 * 1024,
      parallel: 4,
    });
    if (result?.res?.status && result.res.status >= 400) throw new Error(`OSS status ${result.res.status}`);
    console.log(`  ✓ ${f}`);
  }
  console.log("\nMac 产物上传完成");
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
