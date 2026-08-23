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
const NODE_RUNTIME_VERSION = '20.20.2';
const runtimeCacheRoot = path.join(desktopRoot, '.runtime-cache', 'node');

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

  const suffix = {
    'mac-arm64': 'darwin-arm64',
    'win-x64': 'win-x64',
    'mac-x64': 'darwin-x64',
    'linux-x64': 'linux-x64',
  }[targetPlatform];
  if (suffix) {
    const name = `node-v${NODE_RUNTIME_VERSION}-${suffix}`;
    const workspaceSource = path.join(repoRoot, 'kaypal-ai', '.runtime', name);
    const cacheSource = path.join(runtimeCacheRoot, name);
    return fs.existsSync(workspaceSource) ? workspaceSource : cacheSource;
  }

  return null;
}

function currentNodeMatchesTarget() {
  if (targetPlatform === 'win-x64') return platform === 'win32' && arch === 'x64';
  if (targetPlatform === 'mac-arm64') return platform === 'darwin' && arch === 'arm64';
  if (targetPlatform === 'mac-x64') return platform === 'darwin' && arch === 'x64';
  if (targetPlatform === 'linux-x64') return platform === 'linux' && arch === 'x64';
  return false;
}

function downloadNodeRuntime(target) {
  const suffix = {
    'mac-arm64': 'darwin-arm64',
    'win-x64': 'win-x64',
    'mac-x64': 'darwin-x64',
    'linux-x64': 'linux-x64',
  }[target];
  if (!suffix) return null;
  const archiveName = `node-v${NODE_RUNTIME_VERSION}-${suffix}.${target === 'win-x64' ? 'zip' : 'tar.gz'}`;
  const archiveUrl = `https://nodejs.org/dist/v${NODE_RUNTIME_VERSION}/${archiveName}`;
  const archivePath = path.join(runtimeCacheRoot, archiveName);
  const extractedRoot = path.join(runtimeCacheRoot, `node-v${NODE_RUNTIME_VERSION}-${suffix}`);
  fs.mkdirSync(runtimeCacheRoot, { recursive: true });
  if (!fs.existsSync(extractedRoot)) {
    console.log(`Downloading Node.js ${NODE_RUNTIME_VERSION} runtime for ${target}: ${archiveUrl}`);
    execFileSync('curl', ['-fL', '--retry', '3', '-o', archivePath, archiveUrl], { stdio: 'inherit' });
    if (target === 'win-x64') {
      execFileSync('unzip', ['-q', '-o', archivePath, '-d', runtimeCacheRoot], { stdio: 'inherit' });
    } else {
      execFileSync('tar', ['-xzf', archivePath, '-C', runtimeCacheRoot], { stdio: 'inherit' });
    }
  }
  return fs.existsSync(extractedRoot) ? extractedRoot : null;
}

function copyCurrentNodeRuntime() {
  if (!currentNodeMatchesTarget()) {
    return false;
  }

  const version = execFileSync(process.execPath, ['--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10000,
  }).trim();
  if (!/^v20\./.test(version)) {
    return false;
  }

  fs.rmSync(runtimeRoot, { recursive: true, force: true });
  fs.mkdirSync(path.join(runtimeRoot, 'bin'), { recursive: true });
  const targetNode = path.join(runtimeRoot, 'bin', targetPlatform === 'win-x64' ? 'node.exe' : 'node');
  fs.copyFileSync(process.execPath, targetNode);
  if (targetPlatform !== 'win-x64') {
    fs.chmodSync(targetNode, 0o755);
  }

  fs.writeFileSync(
    path.join(runtimeRoot, 'README.md'),
    `Bundled Node.js runtime copied from the build runner.\nVersion: ${version}\nSource: ${process.execPath}\n`,
  );
  fs.writeFileSync(
    path.join(runtimeRoot, 'LICENSE'),
    'Node.js runtime license applies. This package bundles the Node.js executable used by the build runner.\n',
  );
  console.log(`Bundled Node runtime copied from current runner Node ${version}: ${targetNode}`);
  return true;
}

let sourceRuntime = resolveSourceRuntime();
const explicitSource = Boolean(process.env.KAYPAL_NODE_RUNTIME_SOURCE);
const isTargetWindows = targetPlatform === 'win-x64';

if (!sourceRuntime || !fs.existsSync(sourceRuntime)) {
  sourceRuntime = downloadNodeRuntime(targetPlatform);
  if (!sourceRuntime && (explicitSource || !copyCurrentNodeRuntime())) {
    fail(`Node runtime source is missing for ${targetPlatform}: ${sourceRuntime || '<not configured>'}`);
  }
}
if (sourceRuntime && fs.existsSync(sourceRuntime)) {
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
      env: { ...process.env, NODE_OPTIONS: '' },
    }).trim();
    console.log(`Bundled Node runtime: ${runtimeNode} (${version})`);
  }
} catch (error) {
  fail(`Bundled Node runtime is not executable: ${error.message}`);
}
