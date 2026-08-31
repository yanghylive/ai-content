#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const desktopRoot = path.resolve(__dirname, '..');
const outputPath = path.join(desktopRoot, 'runtime', 'generated', 'release-config.json');
const pkg = JSON.parse(fs.readFileSync(path.join(desktopRoot, 'package.json'), 'utf8'));

function isTaggedRelease(env = process.env) {
  return (
    env.GITHUB_REF_TYPE === 'tag' ||
    /^refs\/tags\/v[^/]+$/i.test(String(env.GITHUB_REF || '')) ||
    /^v\d/i.test(String(env.RELEASE_TAG || ''))
  );
}

function isCommercialRelease(argv = process.argv.slice(2), env = process.env) {
  return (
    argv.includes('--commercial') ||
    env.KAYPAL_COMMERCIAL_RELEASE === '1' ||
    isTaggedRelease(env)
  );
}

function requiredCommercialValue(label, value, commercial) {
  const normalized = String(value || '').trim();
  if (commercial && !normalized) {
    throw new Error(`${label} is required for a commercial or tagged release`);
  }
  return normalized;
}

function parseHttpsUrl(
  label,
  value,
  { production = false, trailingSlash = false, allowedHostSuffixes = [] } = {},
) {
  let parsed;
  try {
    parsed = new URL(String(value || '').trim());
  } catch {
    throw new Error(`${label} must be a valid HTTPS URL`);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`${label} must use HTTPS`);
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw new Error(`${label} must not contain credentials or a URL fragment`);
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    production &&
    (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname.endsWith('.local') ||
      hostname.includes('example.') ||
      /(^|[.-])(test(?:ing)?|stag(?:e|ing)|dev(?:elopment)?|qa|uat|sandbox|preview|preprod)\d*([.-]|$)/i.test(hostname)
    )
  ) {
    throw new Error(`${label} must point to a production host, received ${hostname}`);
  }
  if (
    production &&
    allowedHostSuffixes.length > 0 &&
    !allowedHostSuffixes.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`))
  ) {
    throw new Error(`${label} must use an approved host: ${allowedHostSuffixes.join(', ')}`);
  }

  const normalized = parsed.toString();
  return trailingSlash
    ? `${normalized.replace(/\/+$/, '')}/`
    : normalized.replace(/\/+$/, '');
}

function resolveConfig({
  argv = process.argv.slice(2),
  env = process.env,
  packageJson = pkg,
} = {}) {
  const commercial = isCommercialRelease(argv, env);
  const kaypalAuthBaseUrl = parseHttpsUrl(
    'KAYPAL_AUTH_BASE_URL',
    requiredCommercialValue(
      'KAYPAL_AUTH_BASE_URL',
      env.KAYPAL_AUTH_BASE_URL,
      commercial,
    ) || 'https://test.kaypal.cn',
    { production: commercial, allowedHostSuffixes: ['kaypal.cn'] },
  );
  const cloudApiEndpoint = parseHttpsUrl(
    'KAYPAL_CLOUD_API_ENDPOINT',
    requiredCommercialValue(
      'KAYPAL_CLOUD_API_ENDPOINT',
      env.KAYPAL_CLOUD_API_ENDPOINT || env.CLOUD_API_ENDPOINT,
      commercial,
    ) ||
      'https://enterprise-test.kaypal.cn/cloud-api',
    { production: commercial, allowedHostSuffixes: ['kaypal.cn'] },
  );
  const updateUrl = parseHttpsUrl(
    'AI_CONTENT_UPDATE_URL',
    env.AI_CONTENT_UPDATE_URL || packageJson?.build?.publish?.url,
    { production: commercial, trailingSlash: true },
  );

  // 2026-08-27：kaypal.cn 网关 app 凭据（KAYPAL_APP_CREDENTIALS_JSON 中
  // ai-content-desktop 条目）。生产凭据经 env 注入本生成物（gitignored），
  // main.js 启动时读取并注入后端 env；缺失时跳过（不阻塞非商用构建）。
  const kaypalGateway = {
    apiKey: (env.KAYPAL_GATEWAY_API_KEY || '').trim(),
    contextJwtSecret: (env.KAYPAL_CONTEXT_JWT_SECRET || '').trim(),
    appId: (env.KAYPAL_APP_ID || '').trim(),
    tenantId: (env.KAYPAL_TENANT_ID || '').trim(),
    billingUserId: (env.KAYPAL_BILLING_USER_ID || '').trim(),
    legacyApiKey: (env.KAYPAL_LEGACY_API_KEY || '').trim(),
  };
  const hasGateway = Object.values(kaypalGateway).some(Boolean);

  return {
    schemaVersion: 1,
    environment: commercial ? 'production' : 'testing',
    version: packageJson.version,
    kaypalAuthBaseUrl,
    cloudApiEndpoint,
    updateUrl,
    ...(hasGateway ? { kaypalGateway } : {}),
  };
}

function writeReleaseConfig(config, destination = outputPath) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const tempPath = `${destination}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tempPath, destination);
}

/**
 * 2026-08-28：生成打包用净化版 backend.env（runtime/generated/backend.env）。
 * 背景：desktop/backend.env 是开发态 env（含 KAYPAL_AI_PROXY_API_KEY=legacy 凭据、
 * KAYPAL_API_KEY=geo 开发 key、KAYPAL_BILLING_USER_ID 等），被 extraResources
 * 打进包后，NestJS envFilePath 文件值会覆盖 main.js 按 release-config 注入的
 * 进程变量——chat 因此拿着 legacy 凭据打网关 403「App credential does not match」。
 * 这里剥离「release-config 注入通道统一管理」的 KAYPAL_* 凭据键，其余键（OSS、
 * 推客、MEMORY 等）原样保留。source of truth = 注入通道。
 */
const GATEWAY_MANAGED_ENV_KEYS = [
  'KAYPAL_AI_PROXY_API_KEY',
  'KAYPAL_API_KEY',
  'KAYPAL_CONTEXT_JWT_SECRET',
  'KAYPAL_BILLING_USER_ID',
  'KAYPAL_TENANT_ID',
  'KAYPAL_APP_ID',
  'KAYPAL_LEGACY_API_KEY',
];

const sanitizedEnvOutputPath = path.join(desktopRoot, 'runtime', 'generated', 'backend.env');

function writeSanitizedBackendEnv(sourcePath = path.join(desktopRoot, 'backend.env')) {
  // 2026-08-31（CI run 33390502368 实证）：desktop/backend.env 是 gitignored 开发态
  // env，CI 干净环境不存在 → 本脚本从未在 CI 构建链执行过，包内缺 backend/.env，
  // check-full-installer-assets --phase=post 假红。缺失时回退 backend.env.example
  // （入库的占位模板；KAYPAL_* 网关托管键本就会被剥除，生产凭据由注入通道补齐）。
  if (!fs.existsSync(sourcePath)) {
    const examplePath = path.join(desktopRoot, 'backend.env.example');
    if (!fs.existsSync(examplePath)) {
      throw new Error(`backend env source missing: ${sourcePath} (and no ${examplePath})`);
    }
    console.log(
      `backend.env not found, falling back to backend.env.example (CI/clean environment): ${examplePath}`,
    );
    sourcePath = examplePath;
  }
  const lines = fs.readFileSync(sourcePath, 'utf8').split(/\r?\n/);
  const kept = lines.filter((line) => {
    const m = line.match(/^([A-Z_0-9]+)=/);
    return !(m && GATEWAY_MANAGED_ENV_KEYS.includes(m[1]));
  });
  fs.mkdirSync(path.dirname(sanitizedEnvOutputPath), { recursive: true });
  fs.writeFileSync(sanitizedEnvOutputPath, kept.join('\n'), { mode: 0o600 });
  return sanitizedEnvOutputPath;
}

function main() {
  try {
    const config = resolveConfig();
    writeReleaseConfig(config);
    const sanitizedEnv = writeSanitizedBackendEnv();
    console.log(`Sanitized backend env written: ${sanitizedEnv}`);
    console.log(
      `Prepared ${config.environment} release config for v${config.version}: ${outputPath}`,
    );
  } catch (error) {
    console.error(`Release config blocked: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  isCommercialRelease,
  isTaggedRelease,
  parseHttpsUrl,
  resolveConfig,
  writeReleaseConfig,
};
