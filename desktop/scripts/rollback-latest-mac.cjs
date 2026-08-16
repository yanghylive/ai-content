const path = require("path");
const OSS = require("ali-oss");
require("dotenv").config({ path: path.resolve("/Users/yanghy/Documents/New project/ai-content/desktop/.env") });
const client = new OSS({
  accessKeyId: process.env.OSS_ACCESS_KEY_ID,
  accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
  region: process.env.OSS_REGION || "oss-cn-hangzhou",
  bucket: process.env.OSS_BUCKET || "kaypal",
  secure: true, timeout: 600000,
});
const yml = `version: 1.1.80
files:
  - url: JIUZHANG AI 内容创作平台-1.1.80-arm64-mac.zip
    sha512: RuK7GOJS2Ax9O/8KXYfp12jM/UCK35FzTYaHz/VyECJn7l0ZxiAms6Mi6Hi0V0UfWeEhFvnbewBLzCC2CvGK7g==
    size: 578141923
path: JIUZHANG AI 内容创作平台-1.1.80-arm64-mac.zip
sha512: RuK7GOJS2Ax9O/8KXYfp12jM/UCK35FzTYaHz/VyECJn7l0ZxiAms6Mi6Hi0V0UfWeEhFvnbewBLzCC2CvGK7g==
releaseDate: '2026-08-12T16:56:00.000Z'
`;
(async () => {
  await client.put("updates/latest-mac.yml", Buffer.from(yml, "utf8"));
  console.log("latest-mac.yml 已回滚到 1.1.80");
})().catch((e) => { console.error("失败:", e.message); process.exit(1); });
