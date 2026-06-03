const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const root = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));

const targets = (process.env.RELEASE_TARGETS || "mac,win,linux").split(",").map((s) => s.trim());
const publish = process.env.RELEASE_PUBLISH !== "false";

console.log(`Releasing v${pkg.version}`);
console.log(`  targets: ${targets.join(", ")}`);
console.log(`  publish: ${publish ? "yes (will upload to OSS)" : "no (build only)"}`);
console.log("");

const bin = process.platform === "win32" ? "electron-builder.cmd" : "electron-builder";
const electronBuilder = path.join(root, "node_modules", ".bin", bin);

const args = [...targets, "--publish", publish ? "never" : "never"];
args.push("--config.publish.provider=generic");

const envUrl = process.env.AI_CONTENT_UPDATE_URL;
if (envUrl) {
  args.push(`--config.publish.url=${envUrl}`);
  args.push(`--config.publish.channel=${process.env.RELEASE_CHANNEL || "latest"}`);
}

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
  { cwd: root, stdio: "inherit", env: process.env }
);

process.exit(uploadResult.status || 0);
