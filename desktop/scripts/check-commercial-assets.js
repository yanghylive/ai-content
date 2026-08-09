const fs = require('fs');
const path = require('path');
const {
  assertSourceReleaseGuards,
  createGuardContext,
} = require('./release-guards');

// CI 模式下跳过（dist 在 build 流程后才生成）
if (process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true') {
  console.log('⊘ Skipping check-commercial-assets in CI');
  process.exit(0);
}

const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '..');
const buildPlatform =
  process.env.BUILD_PLATFORM ||
  (process.platform === 'darwin' && process.arch === 'arm64'
    ? 'mac-arm64'
    : process.platform === 'darwin'
      ? 'mac-x64'
      : process.platform === 'win32'
        ? 'win-x64'
        : 'linux-x64');

function prismaEngineFileForPlatform(platform) {
  switch (platform) {
    case 'win-x64':
      return 'query_engine-windows.dll.node';
    case 'mac-arm64':
      return 'libquery_engine-darwin-arm64.dylib.node';
    case 'mac-x64':
      return 'libquery_engine-darwin.dylib.node';
    case 'linux-x64':
      return 'libquery_engine-debian-openssl-3.0.x.so.node';
    default:
      return null;
  }
}

const prismaEngineFile = prismaEngineFileForPlatform(buildPlatform);

const requiredPaths = [
  ['frontend static export', path.join(repoRoot, 'frontend', 'out', 'index.html')],
  ['backend SQLite bundle', path.join(repoRoot, 'backend', 'dist-bundle-sqlite', 'index.js')],
  ['backend Prisma schema', path.join(repoRoot, 'backend', 'prisma', 'schema.prisma')],
  ['backend SQLite Prisma schema', path.join(repoRoot, 'backend', 'prisma', 'schema.sqlite.prisma')],
  ...(prismaEngineFile
    ? [
        [
          'backend SQLite bundle Prisma query engine',
          path.join(repoRoot, 'backend', 'dist-bundle-sqlite', prismaEngineFile),
        ],
      ]
    : []),
  ['desktop backend env', path.join(desktopRoot, 'backend.env')],
  ['Playwright MCP CLI', path.join(repoRoot, 'backend', 'node_modules', '@playwright', 'mcp', 'cli.js')],
  ['Playwright MCP bundled dependencies', path.join(repoRoot, 'backend', 'node_modules', '@playwright', 'mcp', 'node_modules')],
  ['Playwright package', path.join(repoRoot, 'backend', 'node_modules', 'playwright', 'package.json')],
  ['Playwright Core package', path.join(repoRoot, 'backend', 'node_modules', 'playwright-core', 'package.json')],
  ['bundled Node runtime', path.join(desktopRoot, 'runtime', 'node', 'bin', buildPlatform === 'win-x64' ? 'node.exe' : 'node')],
  ['bundled Playwright browser root', path.join(desktopRoot, 'runtime', 'playwright-browsers')],
  ['WeChat native runtime', path.join(desktopRoot, 'runtime', 'wechat-native-runtime', 'kaypal-wechat-native-runtime.js')],
  ['WeChat database helper', path.join(desktopRoot, 'runtime', 'wechat-db-helper', 'wechat-db-helper.js')],
  ['AgentWaker role package', path.join(repoRoot, 'backend', 'agentwaker-roles')],
];

const missing = requiredPaths.filter(([, filePath]) => !fs.existsSync(filePath));

function fileContains(filePath, pattern) {
  if (!fs.existsSync(filePath)) return false;
  return pattern.test(fs.readFileSync(filePath, 'utf8'));
}

const packagePath = path.join(desktopRoot, 'package.json');
const forbiddenPackageRefs = fileContains(packagePath, /sidecars\/agent-s-executor|agent-s-executor|wheelhouse\/\*\*/);
const backendBundlePath = path.join(repoRoot, 'backend', 'dist-bundle-sqlite', 'index.js');
const guard = createGuardContext();
assertSourceReleaseGuards(
  guard,
  {
    desktopRoot,
    mainJs: path.join(desktopRoot, 'main.js'),
    backendEnv: path.join(desktopRoot, 'backend.env'),
    backendBundle: backendBundlePath,
    sqliteSeed: path.join(repoRoot, 'backend', 'prisma', 'dev.db'),
  },
  buildPlatform,
);

if (
  missing.length > 0 ||
  forbiddenPackageRefs ||
  guard.failures.length > 0
) {
  console.error('Desktop commercial build blocked: required assets are missing or release guards failed.');
  for (const [label, filePath] of missing) {
    console.error(`- ${label}: ${path.relative(repoRoot, filePath)}`);
  }
  if (forbiddenPackageRefs) {
    console.error('');
    console.error('Desktop commercial build blocked: desktop/package.json must not package Python Agent-S sidecar or wheelhouse.');
  }
  if (guard.failures.length > 0) {
    console.error('');
    console.error('Desktop commercial build blocked by one-click release guards:');
    for (const failure of guard.failures) {
      console.error(`- ${failure}`);
    }
  }
  console.error('');
  console.error('The desktop package must be self-contained with bundled Node, Playwright Chromium, and non-mock Agent-S.');
  process.exit(1);
}

console.log('Desktop commercial assets check passed.');
