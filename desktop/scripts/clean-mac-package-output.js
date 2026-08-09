#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const desktopRoot = path.resolve(__dirname, '..');
const pkg = require(path.join(desktopRoot, 'package.json'));
const distRoot = path.join(desktopRoot, 'dist');

const targets = [
  path.join(distRoot, 'mac-arm64'),
  path.join(distRoot, `${pkg.build.productName}-${pkg.version}-arm64-mac.zip`),
  path.join(distRoot, `${pkg.build.productName}-${pkg.version}-arm64-mac.zip.blockmap`),
];

for (const target of targets) {
  fs.rmSync(target, { recursive: true, force: true });
  console.log(`removed ${path.relative(desktopRoot, target)}`);
}
