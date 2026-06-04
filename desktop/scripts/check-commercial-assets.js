const fs = require('fs');
const path = require('path');

// CI 模式下跳过（dist 在 build 流程后才生成）
if (process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true') {
  console.log('⊘ Skipping check-commercial-assets in CI');
  process.exit(0);
}

const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '..');
const sidecarsRoot = path.join(desktopRoot, 'sidecars');
const autoUploadRoot = path.join(sidecarsRoot, 'auto-upload');
const agentSRoot = path.join(sidecarsRoot, 'agent-s-executor');

const requiredPaths = [
  ['frontend static export', path.join(repoRoot, 'frontend', 'out', 'index.html')],
  ['backend bundle', path.join(repoRoot, 'backend', 'dist-bundle', 'index.js')],
  ['backend Prisma schema', path.join(repoRoot, 'backend', 'prisma', 'schema.prisma')],
  ['desktop backend env', path.join(desktopRoot, 'backend.env')],
  ['auto-upload service entry', path.join(autoUploadRoot, 'main.py')],
  ['auto-upload requirements', path.join(autoUploadRoot, 'requirements.txt')],
  ['auto-upload wheelhouse dir', path.join(desktopRoot, 'installer', 'wheelhouse', 'auto-upload')],
  ['Agent-S sidecar entry', path.join(agentSRoot, 'main.py')],
  ['Agent-S sidecar requirements', path.join(agentSRoot, 'requirements.txt')],
  ['Agent-S wheelhouse dir', path.join(desktopRoot, 'installer', 'wheelhouse', 'agent-s-executor')],
];

const missing = requiredPaths.filter(([, filePath]) => !fs.existsSync(filePath));
const forbiddenPaths = [
  ['auto-upload browser profiles', path.join(autoUploadRoot, 'browser-profiles')],
  ['auto-upload cookies', path.join(autoUploadRoot, 'cookiesFile')],
  ['auto-upload logs', path.join(autoUploadRoot, 'logs')],
  ['auto-upload user db', path.join(autoUploadRoot, 'db')],
  ['auto-upload venv', path.join(autoUploadRoot, '.venv')],
  ['Agent-S venv', path.join(agentSRoot, '.venv')],
  ['Agent-S temp data', path.join(agentSRoot, '.tmp')],
].filter(([, filePath]) => fs.existsSync(filePath));

if (missing.length > 0 || forbiddenPaths.length > 0) {
  console.error('Desktop commercial build blocked: required local assets are missing.');
  for (const [label, filePath] of missing) {
    console.error(`- ${label}: ${path.relative(repoRoot, filePath)}`);
  }
  if (forbiddenPaths.length > 0) {
    console.error('');
    console.error('Desktop commercial build blocked: user/dev data is present in bundled sidecars.');
    for (const [label, filePath] of forbiddenPaths) {
      console.error(`- ${label}: ${path.relative(repoRoot, filePath)}`);
    }
  }
  console.error('');
  console.error('The desktop package must be self-contained and cannot pull sidecars from a developer-machine path outside this repository.');
  process.exit(1);
}

console.log('Desktop commercial assets check passed.');
