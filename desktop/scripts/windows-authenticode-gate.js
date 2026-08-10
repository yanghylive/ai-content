#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { verifyAuthenticodeSignature } = require('./windows-authenticode');

const desktopRoot = path.resolve(__dirname, '..');

function optionValue(argv, name) {
  const exactIndex = argv.indexOf(name);
  if (exactIndex >= 0) return argv[exactIndex + 1] || '';
  const prefixed = argv.find((arg) => arg.startsWith(`${name}=`));
  return prefixed ? prefixed.slice(name.length + 1) : '';
}

function latestInstallerPath() {
  const latestPath = path.join(desktopRoot, 'dist', 'latest.yml');
  if (!fs.existsSync(latestPath)) {
    throw new Error(`missing ${latestPath}; build the Windows installer first`);
  }
  const content = fs.readFileSync(latestPath, 'utf8');
  const match = content.match(/^\s*path:\s*([^\r\n#]+)\s*$/m);
  const artifact = match ? match[1].trim().replace(/^['"]|['"]$/g, '') : '';
  if (!artifact) throw new Error(`${latestPath} does not contain an installer path`);
  return path.join(desktopRoot, 'dist', artifact);
}

function resolveInstallerPath(argv = process.argv.slice(2), env = process.env) {
  const configured =
    optionValue(argv, '--file') ||
    env.WINDOWS_AUTHENTICODE_FILE ||
    '';
  return configured
    ? path.resolve(desktopRoot, configured)
    : latestInstallerPath();
}

function main() {
  let installerPath;
  try {
    installerPath = resolveInstallerPath();
  } catch (error) {
    console.error(`BLOCKER Windows installer Authenticode signature: ${error.message}`);
    process.exit(1);
  }

  const result = verifyAuthenticodeSignature(installerPath);
  const relativePath = path.relative(desktopRoot, installerPath) || installerPath;
  if (!result.ok) {
    console.error(`BLOCKER Windows installer Authenticode signature: ${result.detail} [${relativePath}]`);
    if (result.status === 'unsigned') {
      console.error('         next: sign the final installer with an Authenticode code-signing certificate, then rebuild the update metadata.');
    } else if (result.status === 'unverified') {
      console.error('         next: install osslsigncode on non-Windows builders or run this guard on Windows with PowerShell available.');
    }
    process.exit(1);
  }

  console.log(`PASS Windows installer Authenticode signature: ${result.detail} [${relativePath}]`);
}

if (require.main === module) main();

module.exports = {
  latestInstallerPath,
  resolveInstallerPath,
};
