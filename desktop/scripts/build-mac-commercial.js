#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const desktopRoot = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(desktopRoot, 'package.json'), 'utf8'));
const commercialEnv = {
  ...process.env,
  BUILD_PLATFORM: 'mac-arm64',
  KAYPAL_COMMERCIAL_RELEASE: '1',
};

function run(command, args, extraEnv = {}) {
  console.log(`\n> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: desktopRoot,
    stdio: 'inherit',
    env: { ...commercialEnv, ...extraEnv },
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

function npm(script) {
  run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', script]);
}

if (process.platform !== 'darwin') {
  console.error('Commercial macOS releases must be built on macOS.');
  process.exit(1);
}

run(process.execPath, [path.join('scripts', 'prepare-release-config.js'), '--commercial']);
run(process.execPath, [path.join('scripts', 'mac-commercial-release-gate.js'), '--phase=pre']);

npm('clean:mac-package-output');
npm('prepare:node-runtime');
npm('prepare:media-tools');
npm('prepare:playwright-browsers');
npm('prepare:bailongma-runtime');
npm('check:commercial-assets');
run(process.execPath, [path.join('scripts', 'check-full-installer-assets.js'), '--phase=pre']);

const config = JSON.parse(
  fs.readFileSync(path.join(desktopRoot, 'runtime', 'generated', 'release-config.json'), 'utf8'),
);
const builder = path.join(
  desktopRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder',
);
run(builder, [
  '--mac',
  '--arm64',
  'dmg',
  'zip',
  '--publish',
  'never',
  '--config.mac.notarize=true',
  '--config.publish.provider=generic',
  `--config.publish.url=${config.updateUrl}`,
]);

run(process.execPath, [path.join('scripts', 'check-full-installer-assets.js'), '--phase=post']);
run(process.execPath, [path.join('scripts', 'mac-commercial-release-gate.js'), '--phase=post']);
run(process.execPath, [path.join('scripts', 'check-release-size.js')]);
run(process.execPath, [path.join('scripts', 'verify-mac-release.js')]);

if (process.env.RELEASE_PUBLISH === 'true') {
  const latestPath = path.join(desktopRoot, 'dist', 'latest-mac.yml');
  const latest = fs.readFileSync(latestPath, 'utf8');
  const zipName = latest.match(/^path:\s*([^\r\n#]+)/m)?.[1]?.trim();
  const uploadFiles = ['latest-mac.yml'];
  if (zipName) uploadFiles.push(zipName, `${zipName}.blockmap`);
  for (const file of fs.readdirSync(path.join(desktopRoot, 'dist'))) {
    if (file.includes(pkg.version) && /\.dmg(?:\.blockmap)?$/i.test(file)) uploadFiles.push(file);
  }
  run(process.execPath, [path.join('scripts', 'upload-to-oss.js')], {
    OSS_UPLOAD_FILES: Array.from(new Set(uploadFiles)).join(','),
  });
  run(process.execPath, [path.join('scripts', 'verify-mac-release.js'), '--remote']);
}

console.log(`\nCommercial macOS release completed: v${pkg.version}`);
