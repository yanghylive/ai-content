#!/usr/bin/env node
/**
 * Copy the static export to the launchd-safe runtime directory.
 * The launchd server must not read the repository under ~/Documents because
 * macOS TCC can deny file reads even when the process itself is executable.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.resolve(process.env.FRONTEND_OUT_DIR || path.join(frontendRoot, "out"));
const destination = path.resolve(
  process.env.FRONTEND_RUNTIME_OUT ||
    path.join(os.homedir(), ".workbuddy", "ai-content-frontend", "out"),
);
const serverSource = path.join(frontendRoot, "scripts", "static-server.mjs");
const serverDestination = path.resolve(
  process.env.FRONTEND_RUNTIME_ROOT ||
    path.join(os.homedir(), ".workbuddy", "ai-content-frontend"),
  "static-server.mjs",
);

if (!(await fs.stat(source).catch(() => null))?.isDirectory()) {
  throw new Error(`frontend export directory does not exist: ${source}`);
}

await fs.mkdir(destination, { recursive: true });
await fs.cp(source, destination, { recursive: true, force: true });
await fs.copyFile(serverSource, serverDestination);
console.log(`[sync-runtime-out] ${source} -> ${destination}`);
