const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const root = path.resolve(__dirname, "..");
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

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));
const configuredUpdateUrl = process.env.AI_CONTENT_UPDATE_URL || pkg?.build?.publish?.url || "";

const targets = (process.env.RELEASE_TARGETS || "mac,win,linux").split(",").map((s) => s.trim());
const publish = process.env.RELEASE_PUBLISH !== "false";
const targetArgs = targets.map((target) => {
  if (target.startsWith("-")) return target;
  if (target === "mac" || target === "macos") return "--mac";
  if (target === "win" || target === "windows") return "--win";
  if (target === "linux") return "--linux";
  throw new Error(`Unknown release target: ${target}`);
});

console.log(`Releasing v${pkg.version}`);
console.log(`  targets: ${targets.join(", ")}`);
console.log(`  publish: ${publish ? "yes (will upload to OSS)" : "no (build only)"}`);
console.log(`  update feed: ${configuredUpdateUrl || "(not configured)"}`);
console.log("");

const guardResult = spawnSync(process.execPath, [path.join(__dirname, "check-update-feed.js")], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    AI_CONTENT_UPDATE_URL: configuredUpdateUrl,
  },
});
if (guardResult.status !== 0) {
  process.exit(guardResult.status || 1);
}

const bin = process.platform === "win32" ? "electron-builder.cmd" : "electron-builder";
const electronBuilder = path.join(root, "node_modules", ".bin", bin);

const args = [...targetArgs, "--publish", publish ? "never" : "never"];
args.push("--config.publish.provider=generic");
args.push(`--config.publish.url=${configuredUpdateUrl}`);
args.push(`--config.publish.channel=${process.env.RELEASE_CHANNEL || "latest"}`);

console.log(`Running: ${bin} ${args.join(" ")}`);
const buildResult = spawnSync(electronBuilder, args, { cwd: root, stdio: "inherit" });

if (buildResult.status !== 0) {
  console.error("Build failed");
  process.exit(buildResult.status || 1);
}

if (!publish) {
  console.log("");
  console.log("Build complete (publish disabled). Artifacts in dist/");
  process.exit(0);
}

console.log("");
console.log("Build complete. Uploading to OSS...");
const uploadResult = spawnSync(
  process.execPath,
  [path.join(__dirname, "upload-to-oss.js")],
  {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      AI_CONTENT_UPDATE_URL: configuredUpdateUrl,
    },
  }
);

process.exit(uploadResult.status || 0);
