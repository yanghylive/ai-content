import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";

const checks = [
  {
    label: "machine-readable contract",
    command: process.execPath,
    args: ["frontend/scripts/content-workspace-contract-guard.mjs"],
  },
  {
    label: "existing zero-loss workspace guard",
    command: npmExecutable,
    args: ["--prefix", "frontend", "run", "content-workspace:guard"],
  },
  {
    label: "workspace guard test suite",
    command: npmExecutable,
    args: ["--prefix", "frontend", "run", "content-workspace:guard:test"],
  },
];

for (const check of checks) {
  console.log(`\n[content-workspace] ${check.label}`);
  const result = spawnSync(check.command, check.args, {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(result.error.message);
    process.exitCode = 1;
    break;
  }
  if (result.status !== 0) {
    process.exitCode = result.status || 1;
    break;
  }
}

if (!process.exitCode) {
  console.log("\nContent workspace contract gate passed.");
}
