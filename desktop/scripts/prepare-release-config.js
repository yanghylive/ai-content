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

function main() {
  try {
    const config = resolveConfig();
    writeReleaseConfig(config);
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
