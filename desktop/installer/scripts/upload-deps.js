const OSS = require("ali-oss");
const fs = require("fs");
const path = require("path");

const requiredEnv = ["OSS_ACCESS_KEY_ID", "OSS_ACCESS_KEY_SECRET", "OSS_BUCKET"];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`Missing env var: ${key}`);
    process.exit(1);
  }
}

const deps = [
  {
    name: "node",
    file: process.env.NODE_INSTALLER || "/Users/yanghy/Downloads/node-v20.18.0-x64.exe",
    expectSize: 31457280,
  },
  {
    name: "python",
    file: process.env.PYTHON_INSTALLER || "/Users/yanghy/Downloads/python-3.11.9-amd64.exe",
    expectSize: 26214400,
  },
  {
    name: "postgres",
    file: process.env.PG_INSTALLER || "/Users/yanghy/Downloads/postgresql-16.4-1-windows-x64.exe",
    expectSize: 314572800,
  },
  {
    name: "redis",
    file: process.env.REDIS_INSTALLER || "/Users/yanghy/Downloads/Redis-7.4.1-Windows-x64.msi",
    expectSize: 5242880,
  },
  {
    name: "chrome",
    file: process.env.CHROME_INSTALLER || "/Users/yanghy/Downloads/ChromeStandaloneSetup64.exe",
    expectSize: 104857600,
  },
];

const config = {
  accessKeyId: process.env.OSS_ACCESS_KEY_ID,
  accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
  region: process.env.OSS_REGION || "oss-cn-hangzhou",
  bucket: process.env.OSS_BUCKET,
  secure: true,
};

const updatePath = "deps/";
const client = new OSS(config);

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

async function main() {
  console.log(`Uploading ${deps.length} dep installer(s) to oss://${config.bucket}/${updatePath}\n`);

  for (const dep of deps) {
    if (!fs.existsSync(dep.file)) {
      console.error(`  ✗ ${dep.name}: 找不到本地文件 ${dep.file}`);
      console.error(`    设环境变量 ${dep.name.toUpperCase()}_INSTALLER=/path/to/installer 改路径`);
      continue;
    }

    const stat = fs.statSync(dep.file);
    const filename = path.basename(dep.file);
    const remoteKey = `${updatePath}${filename}`;

    console.log(`  + ${dep.name}`);
    console.log(`    本地: ${dep.file} (${formatBytes(stat.size)})`);

    if (stat.size < 1024 * 1024) {
      console.error(`    ✗ 文件太小 (<1MB),可能不对`);
      continue;
    }

    await client.put(remoteKey, dep.file, {
      headers: { "Cache-Control": "public, max-age=86400" },
    });
    console.log(`    远端: https://${config.bucket}.${config.region}.aliyuncs.com/${remoteKey}`);
    console.log(`    ✓ 上传 ${formatBytes(stat.size)}\n`);
  }

  const manifest = path.resolve(__dirname, "..", "deps-manifest.json");
  if (fs.existsSync(manifest)) {
    await client.put(`${updatePath}manifest.json`, manifest, {
      headers: { "Cache-Control": "public, max-age=300" },
    });
    console.log(`  + manifest`);
    console.log(`    远端: https://${config.bucket}.${config.region}.aliyuncs.com/${updatePath}manifest.json`);
    console.log(`    ✓ 上传完成\n`);
  }

  console.log("全部完成。Windows 安装器下次启动会从 OSS 拉这些 dep。");
}

main().catch((err) => {
  console.error("上传失败:", err.message);
  process.exit(1);
});
