#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '..', '..');
const runtimeRoot = path.join(desktopRoot, 'runtime', 'node');
const platform = process.platform;
const arch = process.arch;
const targetPlatform = process.env.BUILD_PLATFORM || (platform === 'win32' ? 'win-x64' : platform === 'darwin' && arch === 'arm64' ? 'mac-arm64' : platform === 'darwin' ? 'mac-x64' : 'linux-x64');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function copyDir(source, target) {
  const tmpTarget = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.rmSync(tmpTarget, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, tmpTarget, { recursive: true, dereference: true });
  fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(tmpTarget, target);
}

function resolveSourceRuntime() {
  const explicit = process.env.KAYPAL_NODE_RUNTIME_SOURCE;
  if (explicit) return path.resolve(explicit);

  if (targetPlatform === 'mac-arm64') {
    return path.join(repoRoot, 'kaypal-ai', '.runtime', 'node-v20.20.2-darwin-arm64');
  }

  if (targetPlatform === 'win-x64') {
    return path.join(repoRoot, 'kaypal-ai', '.runtime', 'node-v20.20.2-win-x64');
  }

  if (targetPlatform === 'mac-x64') {
    return path.join(repoRoot, 'kaypal-ai', '.runtime', 'node-v20.20.2-darwin-x64');
  }

  if (targetPlatform === 'linux-x64') {
    return path.join(repoRoot, 'kaypal-ai', '.runtime', 'node-v20.20.2-linux-x64');
  }

  return null;
}

const sourceRuntime = resolveSourceRuntime();
if (!sourceRuntime || !fs.existsSync(sourceRuntime)) {
  fail(`Node runtime source is missing for ${targetPlatform}: ${sourceRuntime || '<not configured>'}`);
}

const isTargetWindows = targetPlatform === 'win-x64';
const sourceNode = path.join(sourceRuntime, 'bin', isTargetWindows ? 'node.exe' : 'node');
const windowsRootNode = isTargetWindows ? path.join(sourceRuntime, 'node.exe') : null;
if (!fs.existsSync(sourceNode) && (!windowsRootNode || !fs.existsSync(windowsRootNode))) {
  fail(`Node executable is missing: ${sourceNode}`);
}

copyDir(sourceRuntime, runtimeRoot);

if (isTargetWindows) {
  const runtimeRootNode = path.join(runtimeRoot, 'node.exe');
  const runtimeBinNode = path.join(runtimeRoot, 'bin', 'node.exe');
  if (!fs.existsSync(runtimeBinNode) && fs.existsSync(runtimeRootNode)) {
    fs.mkdirSync(path.dirname(runtimeBinNode), { recursive: true });
    fs.copyFileSync(runtimeRootNode, runtimeBinNode);
  }
  if (fs.existsSync(runtimeRootNode)) {
    fs.rmSync(runtimeRootNode, { force: true });
  }
}

const runtimeNode = path.join(runtimeRoot, 'bin', isTargetWindows ? 'node.exe' : 'node');
try {
  if (isTargetWindows && platform !== 'win32') {
    console.log(`Bundled Node runtime: ${runtimeNode} (win-x64 prepared; executable check skipped on ${platform})`);
  } else {
    const version = execFileSync(runtimeNode, ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000,
    }).trim();
    console.log(`Bundled Node runtime: ${runtimeNode} (${version})`);
  }
} catch (error) {
  fail(`Bundled Node runtime is not executable: ${error.message}`);
}
