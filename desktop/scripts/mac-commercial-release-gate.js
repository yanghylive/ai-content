#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const desktopRoot = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(desktopRoot, 'package.json'), 'utf8'));
const phaseArg = process.argv.find((arg) => arg.startsWith('--phase='));
const phase = phaseArg ? phaseArg.split('=')[1] : 'source';
const failures = [];

function fail(message) {
  failures.push(message);
}

function readText(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

function run(command, args) {
  return spawnSync(command, args, { encoding: 'utf8' });
}

function isProductionHttps(value) {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    return (
      parsed.protocol === 'https:' &&
      !parsed.username &&
      !parsed.password &&
      !parsed.hash &&
      host !== 'localhost' &&
      host !== '127.0.0.1' &&
      host !== '::1' &&
      !host.endsWith('.local') &&
      !host.includes('example.') &&
      !/(^|[.-])(test(?:ing)?|stag(?:e|ing)|dev(?:elopment)?|qa|uat|sandbox|preview|preprod)\d*([.-]|$)/i.test(host)
    );
  } catch {
    return false;
  }
}

function isApprovedKaypalHost(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === 'kaypal.cn' || host.endsWith('.kaypal.cn');
  } catch {
    return false;
  }
}

function loadReleaseConfig() {
  const configPath = path.join(desktopRoot, 'runtime', 'generated', 'release-config.json');
  if (!fs.existsSync(configPath)) {
    fail(`missing generated release config: ${configPath}`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    fail(`invalid generated release config: ${error.message}`);
    return null;
  }
}

function checkSourcePolicy() {
  const main = readText(path.join(desktopRoot, 'main.js'));
  const signer = readText(path.join(desktopRoot, 'scripts', 'sign-mac-app.js'));
  const commercialBuilder = readText(
    path.join(desktopRoot, 'scripts', 'build-mac-commercial.js'),
  );
  const entitlements = readText(path.join(desktopRoot, 'build', 'entitlements.mac.plist'));
  const inheritedEntitlements = readText(
    path.join(desktopRoot, 'build', 'entitlements.mac.inherit.plist'),
  );

  if (pkg.build?.mac?.hardenedRuntime !== true) fail('mac.hardenedRuntime must be true');
  if (pkg.build?.mac?.entitlements !== 'build/entitlements.mac.plist') {
    fail('mac.entitlements must use build/entitlements.mac.plist');
  }
  if (pkg.build?.mac?.entitlementsInherit !== 'build/entitlements.mac.inherit.plist') {
    fail('mac.entitlementsInherit must use build/entitlements.mac.inherit.plist');
  }
  if (!/com\.apple\.security\.automation\.apple-events/.test(entitlements)) {
    fail('main app entitlements must allow user-approved Apple Events automation');
  }
  if (!/com\.apple\.security\.cs\.allow-jit/.test(inheritedEntitlements)) {
    fail('inherited Electron entitlements must allow JIT');
  }
  if (/com\.apple\.security\.get-task-allow/.test(entitlements + inheritedEntitlements)) {
    fail('commercial entitlements must not contain get-task-allow');
  }
  if (!/KAYPAL_COMMERCIAL_RELEASE/.test(signer) || !/delegated to electron-builder/.test(signer)) {
    fail('afterPack hook must delegate commercial signing to electron-builder');
  }
  if (!/release-config\.json/.test(main) || !/crypto\.randomBytes\(32\)/.test(main)) {
    fail('desktop main must load release config and generate runtime secrets per launch');
  }
  const releaseConfigResource = (pkg.build?.extraResources || []).find(
    (item) => item?.to === 'release-config.json',
  );
  if (releaseConfigResource?.from !== 'runtime/generated/release-config.json') {
    fail('desktop package must embed runtime/generated/release-config.json');
  }
  if (
    !/--config\.mac\.notarize=true/.test(commercialBuilder) ||
    !/mac-commercial-release-gate\.js/.test(commercialBuilder)
  ) {
    fail('commercial mac builder must enable notarization and run the release gate');
  }
  if (
    !/BUILD_PLATFORM:\s*'mac-arm64'/.test(commercialBuilder) ||
    !/['"]--arm64['"]/.test(commercialBuilder)
  ) {
    fail('commercial mac builder must force the mac-arm64 target and --arm64 artifact');
  }
}

function checkCredentialsAndProductionConfig() {
  if (process.platform !== 'darwin') fail('commercial macOS release must run on macOS');

  const config = loadReleaseConfig();
  if (config) {
    if (config.environment !== 'production') fail('release config environment must be production');
    if (config.version !== pkg.version) fail(`release config version ${config.version} != ${pkg.version}`);
    for (const [key, value] of [
      ['kaypalAuthBaseUrl', config.kaypalAuthBaseUrl],
      ['cloudApiEndpoint', config.cloudApiEndpoint],
      ['updateUrl', config.updateUrl],
    ]) {
      if (!isProductionHttps(value)) fail(`${key} must be a production HTTPS URL`);
      if (
        (key === 'kaypalAuthBaseUrl' || key === 'cloudApiEndpoint') &&
        !isApprovedKaypalHost(value)
      ) {
        fail(`${key} must use kaypal.cn or one of its subdomains`);
      }
    }
  }

  const identities = run('security', ['find-identity', '-v', '-p', 'codesigning']);
  const hasInstalledDeveloperId = /Developer ID Application:/.test(
    `${identities.stdout || ''}\n${identities.stderr || ''}`,
  );
  if (!hasInstalledDeveloperId && !process.env.CSC_LINK) {
    fail('missing Developer ID Application identity or CSC_LINK');
  }

  const apiCredentials =
    process.env.APPLE_API_KEY &&
    process.env.APPLE_API_KEY_ID &&
    process.env.APPLE_API_ISSUER;
  const appleIdCredentials =
    process.env.APPLE_ID &&
    process.env.APPLE_APP_SPECIFIC_PASSWORD &&
    process.env.APPLE_TEAM_ID;
  const keychainCredentials = process.env.APPLE_KEYCHAIN_PROFILE;
  if (!apiCredentials && !appleIdCredentials && !keychainCredentials) {
    fail('missing Apple notarization credentials');
  }
}

function checkPackagedRelease() {
  const buildPlatform = process.env.BUILD_PLATFORM || 'mac-arm64';
  const appPath = path.join(
    desktopRoot,
    'dist',
    buildPlatform === 'mac-arm64' ? 'mac-arm64' : 'mac',
    'JIUZHANG AI内容创作平台.app',
  );
  if (!fs.existsSync(appPath)) {
    fail(`missing packaged app: ${appPath}`);
    return;
  }

  const verify = run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);
  if (verify.status !== 0) fail('codesign strict verification failed');

  const details = run('codesign', ['-dv', '--verbose=4', appPath]);
  const detailText = `${details.stdout || ''}\n${details.stderr || ''}`;
  if (!/Authority=Developer ID Application:/.test(detailText)) {
    fail('app is not signed with Developer ID Application');
  }
  if (/Signature=adhoc/.test(detailText) || /TeamIdentifier=not set/.test(detailText)) {
    fail('app still has an ad-hoc signature');
  }

  const assess = run('spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath]);
  if (assess.status !== 0) fail('Gatekeeper assessment failed');

  const staple = run('xcrun', ['stapler', 'validate', appPath]);
  if (staple.status !== 0) fail('notarization ticket is not stapled to the app');

  const resourcesPath = path.join(appPath, 'Contents', 'Resources');
  const packagedConfigPath = path.join(resourcesPath, 'release-config.json');
  const packagedConfig = readText(packagedConfigPath);
  if (!/"environment"\s*:\s*"production"/.test(packagedConfig)) {
    fail('packaged release config is not production');
  }
  if (/(enterprise-test|test\.kaypal|localhost|127\.0\.0\.1)/i.test(packagedConfig)) {
    fail('packaged release config contains a test or local endpoint');
  }

  const backendEnv = readText(path.join(resourcesPath, 'backend', '.env'));
  if (/^KAYPAL_AUTH_BASE_URL=/m.test(backendEnv)) {
    fail('packaged backend env hard-codes the account service endpoint');
  }
  if (/^KAYPAL_(RUNTIME_SHARED_SECRET|AGENT_S_TOKEN)=/m.test(backendEnv)) {
    fail('packaged backend env contains a static runtime secret');
  }
}

checkSourcePolicy();
if (phase === 'pre' || phase === 'post') checkCredentialsAndProductionConfig();
if (phase === 'post') checkPackagedRelease();

if (failures.length > 0) {
  console.error(`macOS commercial release gate failed (${phase}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`macOS commercial release gate passed (${phase}).`);
