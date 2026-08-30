const OSS = require("ali-oss");
const fs = require("fs");
const path = require("path");

function loadLocalDotEnv() {
  const envFile = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    if (!process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadLocalDotEnv();

const requiredEnv = ["OSS_ACCESS_KEY_ID", "OSS_ACCESS_KEY_SECRET"];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`Missing env var: ${key}`);
    console.error("Required: OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET");
    console.error("Optional: OSS_BUCKET (default kaypal), OSS_REGION (default oss-cn-hangzhou), OSS_UPDATE_PATH (default updates/)");
    process.exit(1);
  }
}

const config = {
  accessKeyId: process.env.OSS_ACCESS_KEY_ID,
  accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
  region: process.env.OSS_REGION || "oss-cn-hangzhou",
  bucket: process.env.OSS_BUCKET || "kaypal",
  secure: true,
  endpoint: process.env.OSS_ENDPOINT || undefined,
  timeout: 600000,
};

const updatePath = (process.env.OSS_UPDATE_PATH || "updates/").replace(/^\/+|\/+$/g, "");
const distDir = path.resolve(__dirname, "..", "dist");

const allowedExtensions = [
  ".exe", ".dmg", ".zip", ".AppImage", ".deb", ".snap", ".pkg", ".blockmap", ".yml", ".asc"
];

async function uploadFile(client, localPath, remoteKey) {
  const stat = fs.statSync(localPath);
  const headers = {
    "Cache-Control": "public, max-age=300, s-maxage=3600",
  };
  // 大文件（>50MB）必须 multipartUpload：put 对 300MB+ 文件会 TLS 读超时
  // （2026-08-14/2026-08-20 实测 ETIMEDOUT）。分片 10MB + parallel 3 + retryMax 5 稳定。
  if (stat.size > 50 * 1024 * 1024) {
    const result = await client.multipartUpload(remoteKey, localPath, {
      partSize: 10 * 1024 * 1024,
      parallel: 3,
      retryMax: 5,
      timeout: 600000,
      headers,
    });
    console.log(`  + ${remoteKey}  (${formatBytes(stat.size)}) [multipart]`);
    return result;
  }
  const result = await client.put(remoteKey, localPath, {
    timeout: 600000,
    headers,
  });
  console.log(`  + ${remoteKey}  (${formatBytes(stat.size)})`);
  return result;
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

async function main() {
  if (!fs.existsSync(distDir)) {
    console.error(`dist/ not found at ${distDir}`);
    console.error("Run 'npm run build' first, or use 'npm run release' to build + upload.");
    process.exit(1);
  }

  const client = new OSS(config);

  // 只上传各通道 latest*.yml 引用的产物 + yml 本身：
  // 避免把 dist/ 里历史版本包重复推到更新源（几百 MB × N）。
  // 2026-08-27：此前只读 latest.yml（Win），Mac 通道（latest-mac.yml 引用的 zip/blockmap）
  // 永远漏推 —— 1.1.96 商用发版时抓到，扩为三通道统一收集引用。
  // v1.1.102（复核 P1 整改）：electron-builder 的 latest.yml 不引用 blockmap（约定
  // 命名 <安装包>.blockmap），此前每次发版 blockmap 都漏传 → 远端 404 → 差分更新
  // 断链。这里对每个引用的安装包追加同名 .blockmap。
  const feedFiles = ["latest.yml", "latest-mac.yml", "latest-linux.yml"];
  let referenced = new Set(feedFiles);
  for (const ymlName of feedFiles) {
    const latestYml = path.join(distDir, ymlName);
    if (!fs.existsSync(latestYml)) continue;
    const text = fs.readFileSync(latestYml, "utf8");
    // url 值可含空格（文件名带空格），匹配到行尾
    for (const m of text.matchAll(/^\s*-\s+url:\s*(.+?)\s*$/gm)) {
      referenced.add(m[1].trim());
    }
    const pathMatch = text.match(/^path:\s*(.+?)\s*$/m);
    if (pathMatch) referenced.add(pathMatch[1].trim());
  }
  for (const f of [...referenced]) {
    if (/\.(exe|zip|dmg|AppImage|deb|snap|pkg)$/i.test(f)) {
      referenced.add(`${f}.blockmap`);
    }
  }

  const files = fs.readdirSync(distDir).filter((f) => {
    if (feedFiles.includes(f)) return true;
    if (!referenced.has(f)) return false;
    const ext = path.extname(f).toLowerCase();
    return allowedExtensions.includes(ext);
  });

  if (files.length === 0) {
    console.error("No uploadable artifacts in dist/. Did the build run?");
    process.exit(1);
  }

  console.log(`Uploading ${files.length} file(s) to oss://${config.bucket}/${updatePath}/`);
  console.log(`Region: ${config.region}`);

  for (const file of files) {
    const local = path.join(distDir, file);
    if (!fs.statSync(local).isFile()) continue;
    await uploadFile(client, local, `${updatePath}/${file}`);
  }

  const baseUrl = `https://${config.bucket}.${config.region}.aliyuncs.com/${updatePath}/`;
  console.log("");
  console.log("Done. Update feed URLs:");
  console.log(`  Windows  -> ${baseUrl}latest.yml`);
  console.log(`  macOS    -> ${baseUrl}latest-mac.yml`);
  console.log(`  Linux    -> ${baseUrl}latest-linux.yml`);
  console.log("");
  console.log(`Set on dev machines: AI_CONTENT_UPDATE_URL=${baseUrl}`);
}

main().catch((err) => {
  console.error("Upload failed:", err.message || err);
  if (err.code) console.error(`  code: ${err.code}`);
  process.exit(1);
});
