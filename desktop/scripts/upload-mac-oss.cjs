/**
 * Mac 自动更新补传（upload:oss 只传 Windows，Mac 必须手动补传）
 * 分片 10MB + parallel 3 + retryMax 5（2026-08-14 实测稳定参数；
 * 50MB + parallel 4 会间歇性 read ETIMEDOUT）
 */
const path = require("path");
const OSS = require("ali-oss");

require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });

const client = new OSS({
  accessKeyId: process.env.OSS_ACCESS_KEY_ID,
  accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
  region: process.env.OSS_REGION || "oss-cn-hangzhou",
  bucket: process.env.OSS_BUCKET || "kaypal",
  secure: true,
  timeout: 600000,
});

const updatePath = (process.env.OSS_UPDATE_PATH || "updates/").replace(/^\/+|\/+$/g, "");
const distDir = path.resolve(__dirname, "..", "dist");
// 动态读 package.json 版本号，避免每次发版手改文件名
const pkgVersion = require(path.resolve(__dirname, "..", "package.json")).version;
const files = [
  `JIUZHANG AI 内容创作平台-${pkgVersion}-arm64-mac.zip`,
  `JIUZHANG AI 内容创作平台-${pkgVersion}-arm64-mac.zip.blockmap`,
  "latest-mac.yml",
];

(async () => {
  console.log(`Mac 补传 ${files.length} 个文件到 oss://${client.options.bucket}/${updatePath}/`);
  for (const f of files) {
    const local = path.join(distDir, f);
    const remote = `${updatePath}/${f}`;
    console.log(`  + ${f} ...`);
    const result = await client.multipartUpload(remote, local, {
      parallel: 3,
      partSize: 10 * 1024 * 1024,
      timeout: 600000,
      retryMax: 5,
    });
    console.log(`    ✓ ${f} (${(result.res.size || 0) / 1024 / 1024}MB)`);
  }
  console.log("Mac 补传完成");
})().catch((e) => { console.error("失败:", e.message); process.exit(1); });
