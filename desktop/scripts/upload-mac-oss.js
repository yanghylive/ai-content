#!/usr/bin/env node
/**
 * 发版辅助：上传 Mac 产物 + blockmap 到 OSS（upload:oss 只传 Windows，Mac 需手动补传）
 *
 * 用法：node scripts/upload-mac-oss.js
 * 依赖：desktop/.env 有 OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET
 * 说明：大文件必须 multipartUpload（分片 50MB），put/putStream 会 60s 超时
 */
const OSS = require("ali-oss");
const fs = require("fs");
const path = require("path");

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

  const macYmlPath = path.join(distDir, "latest-mac.yml");
  const text = fs.readFileSync(macYmlPath, "utf8");
  const files = new Set(["latest-mac.yml"]);
  for (const m of text.matchAll(/^\s*-\s+url:\s*(.+?)\s*$/gm)) files.add(m[1].trim());
  const pathMatch = text.match(/^path:\s*(.+?)\s*$/m);
  if (pathMatch) files.add(pathMatch[1].trim());
  // 补 blockmap
  for (const f of [...files]) {
    const bm = `${f}.blockmap`;
    if (fs.existsSync(path.join(distDir, bm))) files.add(bm);
  }

  for (const f of files) {
    const local = path.join(distDir, f);
    if (!fs.existsSync(local)) {
      console.error("缺失:", f);
      continue;
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
