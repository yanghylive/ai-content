#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const frontendUrl = stripTrailingSlash(process.env.FRONTEND_URL || 'http://localhost:3010');
const apiBase = stripTrailingSlash(process.env.API_BASE || 'http://localhost:3011/api');
const username = process.env.SMOKE_USERNAME || '';
const password = process.env.SMOKE_PASSWORD || '';
const timeoutMs = Number(process.env.SMOKE_UI_TIMEOUT_MS || 15000);
const listOnly = process.env.SMOKE_UI_LIST_ONLY === '1';
const timeoutSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
const tempDir = mkdtempSync(join(tmpdir(), 'ai-content-ui-smoke-'));
const cookieJar = join(tempDir, 'cookies.txt');

const checks = [
  {
    label: 'Login',
    route: '/login',
    mustSee: ['登录'],
  },
  {
    label: 'Dashboard navigation',
    route: '/',
    mustSee: ['工作台', '内容生产', '发布中心', '互动中心', '本地能力'],
  },
  {
    label: 'Agent command console',
    route: '/agent-console',
    mustSee: ['Agent 指令台'],
  },
  {
    label: 'Pending confirmations',
    route: '/confirmations',
    mustSee: ['待我确认'],
  },
  {
    label: 'Publishing center',
    route: '/distribution?tab=article',
    mustSee: ['发布中心', '图文发布'],
  },
  {
    label: 'Publishing logs',
    route: '/distribution?tab=logs',
    mustSee: ['发布中心', '运行日志'],
  },
  {
    label: '抖音评论',
    route: '/workbench/douyin-comments',
    mustSee: ['抖音评论'],
  },
  {
    label: '抖音私信',
    route: '/workbench/douyin-messages',
    mustSee: ['抖音私信'],
  },
  {
    label: '视频号评论',
    route: '/workbench/channel-comments',
    mustSee: ['视频号评论'],
  },
  {
    label: '视频号私信',
    route: '/workbench/channel-messages',
    mustSee: ['视频号私信'],
  },
  {
    label: 'Interaction rules',
    route: '/interaction/rules',
    mustSee: ['自动回复规则', '传统服务业'],
  },
  {
    label: 'Interaction records',
    route: '/interaction/records',
    mustSee: ['回复记录', '证据文件治理'],
  },
  {
    label: 'Local engine control',
    route: '/local-engine?tab=engine',
    mustSee: ['本地引擎', '本地服务状态'],
  },
  {
    label: 'Execution records',
    route: '/execution-records',
    mustSee: ['执行记录'],
  },
  {
    label: 'Evidence artifacts',
    route: '/artifacts',
    mustSee: ['证据产物'],
  },
];

let passCount = 0;
let warnCount = 0;
let failCount = 0;

main().catch((error) => {
  fail(`unexpected error: ${error.stack || error.message}`);
  summary();
  cleanup();
  process.exit(1);
});

process.on('exit', cleanup);

async function main() {
  console.log('AI Content UI smoke acceptance');
  console.log(`Frontend URL: ${frontendUrl}`);
  console.log(`API base: ${apiBase}`);
  console.log('');

  if (listOnly) {
    printChecklist();
    return;
  }

  const hasLoginCookie = await loginCookie();

  for (const check of checks) {
    await checkRoute(check, hasLoginCookie);
  }

  summary();
  if (failCount > 0) process.exit(1);
}

function printChecklist() {
  for (const [index, check] of checks.entries()) {
    console.log(`${index + 1}. ${frontendUrl}${check.route}`);
    console.log(`   Must see: ${check.mustSee.join(' / ')}`);
  }
  console.log('');
  console.log('Pass criteria: each route opens after login, no redirect loop, no blank page, and all listed text is visible.');
}

async function loginCookie() {
  if (!username || !password) {
    warn('skipping API login; set SMOKE_USERNAME and SMOKE_PASSWORD to forward the auth cookie to UI route checks');
    return false;
  }

  const response = request(`${apiBase}/auth/login`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) {
    fail(`API login failed: HTTP ${response.status}`);
    return false;
  }

  let user = username;
  try {
    const envelope = JSON.parse(response.body || '{}');
    const data = Object.prototype.hasOwnProperty.call(envelope, 'data') ? envelope.data : envelope;
    user = data?.user?.username || data?.user?.name || data?.user?.id || username;
  } catch {
    // Login already succeeded; keep the configured username for the log line.
  }

  pass(`API login succeeded for ${user}`);
  return true;
}

async function checkRoute(check, hasLoginCookie) {
  const url = `${frontendUrl}${check.route}`;
  let response;

  try {
    response = request(url, {
      headers: {
        accept: 'text/html',
      },
      useCookieJar: hasLoginCookie,
    });
  } catch (error) {
    fail(`${check.label}: request failed (${url}) ${error.message}`);
    return;
  }

  const finalUrl = response.url || url;
  const missing = check.mustSee.filter((token) => !response.body.includes(token));
  const redirectedToLogin = check.route !== '/login' && /\/login(?:[?#]|$)/.test(new URL(finalUrl).pathname);

  if (!response.ok) {
    fail(`${check.label}: HTTP ${response.status} (${url})`);
    return;
  }

  if (redirectedToLogin) {
    fail(`${check.label}: redirected to login (${finalUrl})`);
    return;
  }

  if (missing.length > 0) {
    fail(`${check.label}: missing text ${missing.join(' / ')} (${url})`);
    return;
  }

  pass(`${check.label}: HTTP ${response.status}, required text visible`);
}

function request(url, options = {}) {
  const marker = '\n__AI_CONTENT_UI_SMOKE_STATUS__:%{http_code}\n__AI_CONTENT_UI_SMOKE_URL__:%{url_effective}\n';
  const args = [
    '-k',
    '-sS',
    '-L',
    '--max-time',
    String(timeoutSeconds),
    '-w',
    marker,
    '-o',
    '-',
  ];

  for (const [key, value] of Object.entries(options.headers || {})) {
    args.push('-H', `${key}: ${value}`);
  }

  if (options.useCookieJar || options.method === 'POST') {
    args.push('-b', cookieJar, '-c', cookieJar);
  }

  if (options.method) args.push('-X', options.method);
  if (options.body) args.push('--data', options.body);
  args.push(url);

  const output = execFileSync('curl', args, {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  const statusMatch = output.match(/\n__AI_CONTENT_UI_SMOKE_STATUS__:(\d{3})\n/);
  const urlMatch = output.match(/\n__AI_CONTENT_UI_SMOKE_URL__:(.+)\n?$/);
  const body = output.replace(/\n__AI_CONTENT_UI_SMOKE_STATUS__:\d{3}\n__AI_CONTENT_UI_SMOKE_URL__:.+\n?$/s, '');
  const status = statusMatch ? Number(statusMatch[1]) : 0;
  return {
    body,
    status,
    ok: status >= 200 && status < 300,
    url: urlMatch ? urlMatch[1].trim() : url,
  };
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

function pass(message) {
  passCount += 1;
  console.log(`PASS ${message}`);
}

function warn(message) {
  warnCount += 1;
  console.log(`WARN ${message}`);
}

function fail(message) {
  failCount += 1;
  console.error(`FAIL ${message}`);
}

function summary() {
  console.log('');
  console.log(`Summary: PASS=${passCount} WARN=${warnCount} FAIL=${failCount}`);
}

function cleanup() {
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Temporary cookie cleanup is best-effort.
  }
}
