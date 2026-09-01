#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.resolve(process.env.BACKEND_BUNDLE_SOURCE || path.join(backendRoot, "dist-bundle-sqlite"));
const destination = path.resolve(
  process.env.BACKEND_RUNTIME_ROOT ||
    path.join(os.homedir(), ".workbuddy", "ai-content-backend", "dist-bundle-sqlite"),
);

if (!(await fs.stat(source).catch(() => null))?.isDirectory()) {
  throw new Error(`SQLite backend bundle does not exist: ${source}`);
}

// Build the complete runtime bundle beside the live directory, then swap the
// directory name. A recursive cp into the live tree leaves stale files after
// a build removes a module and can expose a half-copied bundle to launchd.
const staging = `${destination}.staging-${process.pid}`;
const backup = `${destination}.previous-${process.pid}`;
await fs.rm(staging, { recursive: true, force: true });
await fs.rm(backup, { recursive: true, force: true });
await fs.mkdir(path.dirname(destination), { recursive: true });
await fs.cp(source, staging, { recursive: true, force: true });
// The SQLite bundle intentionally externalizes native/runtime-heavy packages.
// Copy only those packages beside the runtime bundle so launchd does not fall
// back to node_modules under ~/Documents.
const runtimeNodeModules = path.join(staging, "node_modules");
await fs.mkdir(runtimeNodeModules, { recursive: true });
for (const dependency of [
  "@playwright/mcp",
  "playwright",
  "playwright-core",
  "sharp",
  "detect-libc",
  "semver",
  "@img",
]) {
  const dependencySource = path.join(backendRoot, "node_modules", dependency);
  if (!(await fs.stat(dependencySource).catch(() => null))?.isDirectory()) {
    throw new Error(`external runtime dependency does not exist: ${dependencySource}`);
  }
  const dependencyDestination = path.join(runtimeNodeModules, dependency);
  await fs.rm(dependencyDestination, { recursive: true, force: true });
  await fs.cp(
    dependencySource,
    dependencyDestination,
    dependency === "@playwright/mcp"
      ? { recursive: true, force: true }
      : {
          recursive: true,
          force: true,
          filter: (candidate) => {
            const relative = path.relative(dependencySource, candidate);
            return !relative.startsWith(`node_modules${path.sep}`);
          },
        },
  );
}
const browserSource = path.resolve(backendRoot, "..", "desktop", "runtime", "playwright-browsers");
const browserDestination = path.resolve(destination, "..", "playwright-browsers");
if ((await fs.stat(browserSource).catch(() => null))?.isDirectory()) {
  // Chromium bundles contain framework symlinks; replace the runtime copy
  // wholesale so fs.cp never follows a stale link into its own source tree.
  await fs.rm(browserDestination, { recursive: true, force: true });
  await fs.cp(browserSource, browserDestination, { recursive: true, force: true });
}
const rolesSource = path.join(backendRoot, "agentwaker-roles");
const rolesDestination = path.resolve(destination, "..", "agentwaker-roles");
if (!(await fs.stat(rolesSource).catch(() => null))?.isDirectory()) {
  throw new Error(`AgentWaker role package does not exist: ${rolesSource}`);
}
await fs.rm(rolesDestination, { recursive: true, force: true });
await fs.cp(rolesSource, rolesDestination, { recursive: true, force: true });
try {
  if (await fs.stat(destination).catch(() => null)) await fs.rename(destination, backup);
  await fs.rename(staging, destination);
  await fs.rm(backup, { recursive: true, force: true });
} catch (error) {
  await fs.rm(staging, { recursive: true, force: true });
  if (!(await fs.stat(destination).catch(() => null)) && (await fs.stat(backup).catch(() => null))) {
    await fs.rename(backup, destination);
  }
  throw error;
}
console.log(`[sync-runtime-bundle] ${source} -> ${destination}`);
