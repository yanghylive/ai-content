#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const desktopRoot = path.resolve(__dirname, '..');

function walkDir(root, visit) {
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    visit(entryPath, entry);
    if (entry.isDirectory()) {
      walkDir(entryPath, visit);
    }
  }
}

function assertNoAbsoluteSymlinks(root) {
  const absoluteSymlinks = [];
  walkDir(root, (entryPath, entry) => {
    if (!entry.isSymbolicLink()) return;
    const target = fs.readlinkSync(entryPath);
    if (path.isAbsolute(target)) {
      absoluteSymlinks.push(`${entryPath} -> ${target}`);
    }
  });

  if (absoluteSymlinks.length > 0) {
    throw new Error(`Packaged runtime contains absolute symlinks:\n${absoluteSymlinks.join('\n')}`);
  }
}

function prepareMacPackagedResources(appPath) {
  const resourcesPath = path.join(appPath, 'Contents', 'Resources');
  const backendPath = path.join(resourcesPath, 'backend');
  const runtimeDataPath = path.join(backendPath, 'data');
  const prismaEngineName = process.arch === 'arm64'
    ? 'libquery_engine-darwin-arm64.dylib.node'
    : 'libquery_engine-darwin.dylib.node';
  const prismaEngineSource = path.join(backendPath, 'client', prismaEngineName);
  const prismaEngineRootCopy = path.join(backendPath, prismaEngineName);

  if (fs.existsSync(runtimeDataPath)) {
    fs.rmSync(runtimeDataPath, { recursive: true, force: true });
    console.warn(`Removed packaged runtime data: ${runtimeDataPath}`);
  }

  if (!fs.existsSync(prismaEngineSource)) {
    throw new Error(`Packaged Prisma engine is missing: ${prismaEngineSource}`);
  }

  fs.copyFileSync(prismaEngineSource, prismaEngineRootCopy);
  console.log(`Prepared Prisma engine root copy: ${prismaEngineRootCopy}`);

  const playwrightBrowsersPath = path.join(resourcesPath, 'playwright-browsers');
  assertNoAbsoluteSymlinks(playwrightBrowsersPath);
}

function signMacApp(appPath) {
  if (process.platform !== 'darwin') {
    console.log('Skipping mac app signing: not running on macOS.');
    return;
  }

  if (!fs.existsSync(appPath)) {
    throw new Error(`Mac app not found: ${appPath}`);
  }

  prepareMacPackagedResources(appPath);

  const sign = spawnSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
    stdio: 'inherit',
  });
  if (sign.status !== 0) {
    throw new Error(`codesign failed with exit code ${sign.status || 1}`);
  }

  const verify = spawnSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], {
    stdio: 'inherit',
  });
  if (verify.status !== 0) {
    throw new Error(`codesign verify failed with exit code ${verify.status || 1}`);
  }

  console.log(`Mac app ad-hoc signed: ${appPath}`);
}

module.exports = async function afterPack(context) {
  if (!context?.electronPlatformName?.includes('darwin')) return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  signMacApp(appPath);
};

if (require.main === module) {
  try {
    const appPath = process.env.MAC_APP_PATH || path.join(desktopRoot, 'dist', 'mac-arm64', 'JIUZHANG AI 内容创作平台.app');
    signMacApp(appPath);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
