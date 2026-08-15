/**
 * Windows blockmap 补传（upload:oss 只传 exe + latest.yml，blockmap 需手动补传）
 * blockmap 是几百 KB 的小文件，直接用 put（multipartUpload 的分片参数对小文件无意义）
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

(async () => {
  const pkgVersion = require(path.resolve(__dirname, "..", "package.json")).version;
  const f = `JIUZHANG AI 内容创作平台 Setup ${pkgVersion}.exe.blockmap`;
  const local = path.join(__dirname, "..", "dist", f);
  await client.put(`updates/${f}`, local);
  console.log("Win blockmap 已上传:", f);
})().catch((e) => { console.error("失败:", e.message); process.exit(1); });
