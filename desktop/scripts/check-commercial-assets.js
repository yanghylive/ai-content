const fs = require('fs');
const path = require('path');

const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '..');
const autoUploadRoot = path.resolve(repoRoot, '..', '..', '..', 'auto-upload');

const requiredPaths = [
  ['frontend static export', path.join(repoRoot, 'frontend', 'out', 'index.html')],
  ['backend bundle', path.join(repoRoot, 'backend', 'dist-bundle', 'index.js')],
  ['backend Prisma schema', path.join(repoRoot, 'backend', 'prisma', 'schema.prisma')],
  ['desktop backend env', path.join(desktopRoot, 'backend.env')],
  ['auto-upload service entry', path.join(autoUploadRoot, 'main.py')],
  ['auto-upload requirements', path.join(autoUploadRoot, 'requirements.txt')],
];

const missing = requiredPaths.filter(([, filePath]) => !fs.existsSync(filePath));

if (missing.length > 0) {
  console.error('Desktop commercial build blocked: required local assets are missing.');
  for (const [label, filePath] of missing) {
    console.error(`- ${label}: ${path.relative(repoRoot, filePath)}`);
  }
  console.error('');
  console.error('The desktop package must be self-contained and cannot pull auto-upload from a developer-machine path outside this repository.');
  process.exit(1);
}

console.log('Desktop commercial assets check passed.');
