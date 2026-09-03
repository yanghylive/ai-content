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

/**
 * 2026-09-04（round16 事故固化）：sync 前后产物验机。
 * 事故：多次 build/sync 交错时曾把构建中间态（Prisma client 已还原为 postgres /
 * playwright external 残缺）拷进生产 runtime → 3011 crash loop。
 * 两道闸：①拷贝前验 source 特征（坏产物直接 throw，不污染 runtime）；
 * ②rename 后验 destination 与 source 一致（字节级抽查关键文件）。
 */
const REQUIRED_BUNDLE_FILES = ["index.js", "schema.prisma", "schema.sqlite.prisma"];
const REQUIRED_RUNTIME_FEATURES = [
  // PrismaService 控制面白名单（本项目核心安全机制，丢=旧版代码）
  "TARGET_ONLY",
  // SQLite 引擎文件名映射（postgres-only client 构建时该映射缺位）
  "libquery_engine-darwin",
];
const MIN_BUNDLE_INDEX_BYTES = 10 * 1024 * 1024;

async function verifyBundleArtifact(bundleDir, label) {
  for (const name of REQUIRED_BUNDLE_FILES) {
    const stat = await fs.stat(path.join(bundleDir, name)).catch(() => null);
    if (!stat?.isFile()) {
      throw new Error(`[${label}] bundle 验机失败：缺少 ${name}（坏产物，拒绝进 runtime）`);
    }
  }
  const indexStat = await fs.stat(path.join(bundleDir, "index.js"));
  if (indexStat.size < MIN_BUNDLE_INDEX_BYTES) {
    throw new Error(
      `[${label}] bundle 验机失败：index.js 仅 ${indexStat.size} 字节（正常 >10MB），疑似残缺产物`,
    );
  }
  const indexSource = await fs.readFile(path.join(bundleDir, "index.js"), "utf8");
  for (const feature of REQUIRED_RUNTIME_FEATURES) {
    if (!indexSource.includes(feature)) {
      throw new Error(
        `[${label}] bundle 验机失败：index.js 缺关键特征 "${feature}"（Prisma client 版本错/旧代码），拒绝进 runtime`,
      );
    }
  }
  // schema.prisma 的 provider 必须是 sqlite（postgres 版 client 会拒收 file: URL → 启动即崩）
  const schema = await fs.readFile(path.join(bundleDir, "schema.prisma"), "utf8");
  if (!/provider\s*=\s*"sqlite"/.test(schema)) {
    throw new Error(
      `[${label}] bundle 验机失败：schema.prisma provider 不是 sqlite（构建中间态：client 已还原 postgres），拒绝进 runtime`,
    );
  }
  // dylib 引擎文件必须真实存在（client 按平台加载）
  const entries = await fs.readdir(bundleDir);
  if (!entries.some((name) => name.startsWith("libquery_engine-") || name.endsWith(".dylib.node") || name.endsWith(".dll.node"))) {
    throw new Error(`[${label}] bundle 验机失败：目录内无 query engine 引擎文件，拒绝进 runtime`);
  }
}

await verifyBundleArtifact(source, "sync-before");

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
  await verifyBundleArtifact(destination, "sync-after");
  await fs.rm(backup, { recursive: true, force: true });
} catch (error) {
  await fs.rm(staging, { recursive: true, force: true });
  const destinationExists = !!(await fs.stat(destination).catch(() => null));
  const backupExists = !!(await fs.stat(backup).catch(() => null));
  if (backupExists && (!destinationExists || String(error.message).startsWith("[sync-after]"))) {
    // rename 后验机失败（destination 已是坏产物）→ 用备份覆盖回滚；
    // rename 前失败且 destination 缺失 → 恢复备份。
    if (destinationExists) await fs.rm(destination, { recursive: true, force: true });
    await fs.rename(backup, destination);
    console.error(`[sync-runtime-bundle] 已从备份回滚 destination`);
  }
  throw error;
}
console.log(`[sync-runtime-bundle] ${source} -> ${destination}`);
console.log(`[sync-runtime-bundle] 产物验机通过（关键特征 + schema provider + engine 文件）`);
