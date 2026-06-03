const OSS = require("ali-oss");
const fs = require("fs");
const path = require("path");

const requiredEnv = ["OSS_ACCESS_KEY_ID", "OSS_ACCESS_KEY_SECRET", "OSS_BUCKET"];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`Missing env var: ${key}`);
    console.error("Required: OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET, OSS_BUCKET");
    console.error("Optional: OSS_REGION (default oss-cn-hangzhou), OSS_UPDATE_PATH (default updates/)");
    process.exit(1);
  }
}

const config = {
  accessKeyId: process.env.OSS_ACCESS_KEY_ID,
  accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
  region: process.env.OSS_REGION || "oss-cn-hangzhou",
  bucket: process.env.OSS_BUCKET,
  secure: true,
  endpoint: process.env.OSS_ENDPOINT || undefined,
};

const updatePath = (process.env.OSS_UPDATE_PATH || "updates/").replace(/^\/+|\/+$/g, "");
const distDir = path.resolve(__dirname, "..", "dist");

const allowedExtensions = [
  ".exe", ".dmg", ".zip", ".AppImage", ".deb", ".snap", ".pkg", ".blockmap", ".yml", ".asc"
];

async function uploadFile(client, localPath, remoteKey) {
  const result = await client.put(remoteKey, localPath, {
    headers: {
      "Cache-Control": "public, max-age=300, s-maxage=3600",
      "x-oss-object-acl": "public-read",
    },
  });
  const stat = fs.statSync(localPath);
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

  const files = fs.readdirSync(distDir).filter((f) => {
    const ext = path.extname(f).toLowerCase();
    return allowedExtensions.includes(ext) || f === "latest.yml";
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

  const baseUrl = `https://${config.bucket}.${config.region}.aliyuncs.com/${updatePath}`;
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
