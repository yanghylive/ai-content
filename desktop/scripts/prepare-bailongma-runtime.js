#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '..');
const projectRoot = path.resolve(repoRoot, '..');
const sourceRoot = path.resolve(
  process.env.KAYPAL_BAILONGMA_SOURCE_ROOT || path.join(projectRoot, 'BaiLongma'),
);
const connectorRoot = path.join(repoRoot, 'extensions', 'bailongma-kaypal-voice-connector');
const outputRoot = path.join(desktopRoot, 'runtime', 'bailongma');

function fail(message) {
  console.error(`Prepare BaiLongma runtime failed: ${message}`);
  process.exit(1);
}

function assertPath(label, filePath) {
  if (!fs.existsSync(filePath)) {
    fail(`${label} is missing: ${filePath}`);
  }
}

function copyFile(relativePath, targetRelativePath = relativePath) {
  const from = path.join(sourceRoot, relativePath);
  const to = path.join(outputRoot, targetRelativePath);
  assertPath(relativePath, from);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function copyDir(relativePath, targetRelativePath = relativePath) {
  const from = path.join(sourceRoot, relativePath);
  const to = path.join(outputRoot, targetRelativePath);
  assertPath(relativePath, from);
  fs.cpSync(from, to, {
    recursive: true,
    filter: (src) => {
      const normalized = src.replace(/\\/g, '/');
      return !/__pycache__|\.pyc$|\.map$|\/data\//.test(normalized);
    },
  });
}

function copyConnectorFile(relativePath, targetRelativePath = relativePath) {
  const from = path.join(connectorRoot, relativePath);
  const to = path.join(outputRoot, 'connectors', 'kaypal-voice-connector', targetRelativePath);
  assertPath(`connector ${relativePath}`, from);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function dirSize(filePath) {
  if (!fs.existsSync(filePath)) return 0;
  const stat = fs.statSync(filePath);
  if (stat.isFile()) return stat.size;
  return fs
    .readdirSync(filePath)
    .reduce((total, entry) => total + dirSize(path.join(filePath, entry)), 0);
}

assertPath('BaiLongma source root', sourceRoot);
assertPath('BaiLongma package', path.join(sourceRoot, 'package.json'));
assertPath('KAYPAL voice connector build', path.join(connectorRoot, 'dist', 'index.js'));
assertPath('KAYPAL voice connector RPC build', path.join(connectorRoot, 'dist', 'rpc-server.js'));

fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(outputRoot, { recursive: true });

copyFile('package.json', 'source-package.json');
copyFile('brain-ui.html');
copyFile('index.html');
copyFile('focus-banner.html');
copyFile('systemPrompt.html');
copyFile('src/kaypal-voice-bridge.js');
copyFile('src/voice/manager.js');
copyFile('src/voice/cloud-asr.js');
copyFile('src/voice/tts-providers.js');
copyFile('images/bailongma-logo.png');
copyFile('music/startup-test.wav');
copyDir('src/voice/kws-model');

copyConnectorFile('package.json');
copyConnectorFile('README.md');
copyConnectorFile('dist/index.js');
copyConnectorFile('dist/index.d.ts');
copyConnectorFile('dist/rpc-server.js');
copyConnectorFile('dist/rpc-server.d.ts');

const sourcePackage = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'package.json'), 'utf8'));
const connectorPackage = JSON.parse(fs.readFileSync(path.join(connectorRoot, 'package.json'), 'utf8'));
const manifest = {
  schema: 'kaypal-bailongma-runtime/v1',
  moduleName: 'BaiLongma voice interaction module',
  hostProduct: 'KAYPAL AI 3010',
  hostRole: 'voice_interaction_option',
  embeddedIn3010: true,
  standaloneProduct: false,
  accountMode: 'kaypal-account-subscription-credits',
  defaultVoiceApiBaseUrl: 'http://127.0.0.1:3011/api/voice',
  source: {
    name: sourcePackage.name || 'bailongma',
    version: sourcePackage.version || 'unknown',
  },
  connector: {
    name: connectorPackage.name || '@kaypal/bailongma-voice-connector',
    version: connectorPackage.version || 'unknown',
    main: 'connectors/kaypal-voice-connector/dist/index.js',
    rpc: 'connectors/kaypal-voice-connector/dist/rpc-server.js',
  },
  localService: {
    host: 'electron-main',
    port: 3721,
    statusPath: '/kaypal-voice/status',
    authorizePath: '/kaypal-voice/authorize',
    readyRequires: ['local-service-listening', 'kaypal-authorization-valid'],
  },
  packagedAt: new Date().toISOString(),
  requiredEntrypoints: [
    'brain-ui.html',
    'src/kaypal-voice-bridge.js',
    'connectors/kaypal-voice-connector/dist/index.js',
    'connectors/kaypal-voice-connector/dist/rpc-server.js',
  ],
};

fs.writeFileSync(
  path.join(outputRoot, 'module-manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
fs.writeFileSync(
  path.join(outputRoot, 'README.md'),
  [
    '# BaiLongma voice module for KAYPAL AI 3010',
    '',
    'This runtime is packaged as an embedded 3010 voice interaction module.',
    'It is not a standalone customer-facing product in the KAYPAL installer.',
    '',
    'User-visible account, model, ASR, media and credit rules are provided by KAYPAL AI 3010.',
    '',
  ].join('\n'),
);

const sizeMB = (dirSize(outputRoot) / 1024 / 1024).toFixed(1);
console.log(`Prepared BaiLongma embedded runtime: ${outputRoot} (${sizeMB}MB)`);
