#!/usr/bin/env node

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const playwrightCandidates = [
  '../node_modules/playwright',
  '../../kaypal-ai/node_modules/playwright',
  '../../kaypal-ai-merge-main/node_modules/playwright',
  '../../reverse-dt-ai-helper/app-asar/node_modules/playwright',
];

let chromium;
let loadedFrom = '';
for (const candidate of playwrightCandidates) {
  try {
    ({ chromium } = require(candidate));
    loadedFrom = candidate;
    break;
  } catch {
    // Try the next local workspace dependency.
  }
}

if (!chromium) {
  console.error('Playwright is not available. Install playwright or keep kaypal-ai node_modules available.');
  process.exit(1);
}

const frontendUrl = stripTrailingSlash(process.env.FRONTEND_URL || 'http://localhost:3010');
const apiBase = stripTrailingSlash(process.env.API_BASE || 'http://localhost:3011/api');
const username = process.env.SMOKE_USERNAME || '';
const password = process.env.SMOKE_PASSWORD || '';
const timeoutMs = Number(process.env.SMOKE_UI_TIMEOUT_MS || 30000);
const skipApiFlow = process.env.SMOKE_SKIP_API_FLOW === '1';

const navigationChecks = [
  ['Login', '/login', ['登录']],
  ['Dashboard', '/', ['工作台', '发布中心', '互动中心', '本机控制']],
  ['Agent command console', '/agent-console', ['Agent 指令台', '待我确认']],
  ['Pending confirmations', '/confirmations', ['待我确认']],
  ['Publishing article', '/distribution?tab=article', ['发布中心', '图文发布']],
  ['Publishing logs', '/distribution?tab=logs', ['发布中心', '运行日志']],
  ['抖音评论', '/workbench/douyin-comments', ['抖音评论']],
  ['抖音私信', '/workbench/douyin-messages', ['抖音私信']],
  ['视频号评论', '/workbench/channel-comments', ['视频号评论']],
  ['视频号私信', '/workbench/channel-messages', ['视频号私信']],
  ['Local engine', '/local-engine?tab=engine', ['本地引擎', '本地服务状态']],
  ['Execution records', '/execution-records', ['执行记录']],
  ['Evidence artifacts', '/artifacts', ['证据产物']],
];

let browser;
let page;
let passCount = 0;
let warnCount = 0;
let failCount = 0;
const consoleErrors = [];

try {
  console.log('AI Content browser E2E smoke acceptance');
  console.log(`Frontend URL: ${frontendUrl}`);
  console.log(`API base: ${apiBase}`);
  console.log(`Playwright: ${loadedFrom}`);
  console.log('');

  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await login(page);
  await assertApiReachable(page);

  for (const [label, route, tokens] of navigationChecks) {
    await checkRoute(page, label, route, tokens);
  }

  if (!skipApiFlow) {
    await runApiFlow(page);
  } else {
    warn('skipping API flow; set SMOKE_SKIP_API_FLOW=0 to validate Agent, confirmation, publishing, interaction, and evidence APIs');
  }

  const unexpectedErrors = consoleErrors.filter(
    (message) => !/401|Unauthorized|\/auth\/me|ResizeObserver loop|net::ERR_TIMED_OUT/.test(message),
  );
  if (unexpectedErrors.length) {
    fail(`Console errors: ${unexpectedErrors.slice(0, 5).join(' | ')}`);
  }

  summary();
  process.exit(failCount > 0 ? 1 : 0);
} catch (error) {
  fail(`unexpected error: ${error.stack || error.message}`);
  summary();
  process.exit(1);
} finally {
  await browser?.close();
}

async function login(targetPage) {
  await targetPage.goto(`${frontendUrl}/login`, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  if (!username || !password) {
    warn('skipping UI login; set SMOKE_USERNAME and SMOKE_PASSWORD to verify credential login');
    return;
  }

  await targetPage.locator('input').nth(0).fill(username);
  await targetPage.locator('input').nth(1).fill(password);
  await targetPage.getByRole('button', { name: /登录系统|登录/ }).click();
  await targetPage.waitForFunction(() => !location.pathname.includes('/login'), null, { timeout: timeoutMs });
  pass(`Login succeeded: ${targetPage.url()}`);
}

async function assertApiReachable(targetPage) {
  const setup = await apiRequest(targetPage, 'GET', '/auth/setup-status');
  assert(setup, 'setup status returned data');
  pass('Backend API reachable');
}

async function checkRoute(targetPage, label, route, tokens) {
  const url = `${frontendUrl}${route}`;
  await targetPage.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  await targetPage.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => undefined);
  const body = await targetPage.locator('body').innerText({ timeout: timeoutMs });
  const missing = tokens.filter((token) => !body.includes(token));
  if (missing.length) {
    fail(`${label}: missing ${missing.join(' / ')} (${url})`);
    return;
  }
  if (route !== '/login' && targetPage.url().includes('/login')) {
    fail(`${label}: redirected to login (${targetPage.url()})`);
    return;
  }
  pass(`${label}: required text visible`);
}

async function runApiFlow(targetPage) {
  await checkControlEntrypoints(targetPage);
  await checkInteractionTask(targetPage);
  await checkAgentApproveFlow(targetPage);
  await checkAgentRejectFlow(targetPage);
  await checkAgentRevisionContinueFlow(targetPage);
  await checkPublishConfirmation(targetPage);
}

async function checkControlEntrypoints(targetPage) {
  const health = await apiRequest(targetPage, 'GET', '/local-engine/health');
  const runtime = await apiRequest(targetPage, 'GET', '/local-engine/runtime/status');
  const readiness = await apiRequest(targetPage, 'GET', '/local-engine/readiness');
  const browserStatus = await apiRequest(targetPage, 'GET', '/local-engine/browser/status');
  const executors = await apiRequest(targetPage, 'GET', '/local-engine/executors/status');
  const files = await apiRequest(targetPage, 'GET', '/local-engine/files/status');

  assert(health && Object.prototype.hasOwnProperty.call(health, 'online'), 'local-engine health has online flag');
  assert(runtime && Array.isArray(runtime.services), 'runtime status has services');
  assert(readiness && Object.prototype.hasOwnProperty.call(readiness, 'ready'), 'readiness has ready flag');
  assert(browserStatus && hasAnyFlag(browserStatus, ['ready', 'online', 'connected', 'available', 'engineOnline']), 'browser task entry has readiness flag');
  assert(executors && Array.isArray(executors.executors), 'desktop/browser executors entry is listed');
  assert(files && (hasAnyFlag(files, ['ready', 'available']) || Array.isArray(files.roots)), 'local file control entry has readiness data');
  pass(`Desktop/browser task entries reachable: runtime=${runtime.services.length}, executors=${executors.executors.length}`);
}

async function checkInteractionTask(targetPage) {
  const task = await apiRequest(targetPage, 'POST', '/local-engine/comments/tasks', {
    accountName: 'smoke-e2e-comment-account',
    targetName: 'smoke-e2e-target',
    sourceText: '全链路验收：只生成草稿，不触发真实发送。',
    replyText: '收到，我们先记录需求，稍后人工确认。',
    sendMode: 'draft-only',
  });
  assert(task?.id, 'interaction task created');
  await waitFor(async () => {
    const latest = await apiRequest(targetPage, 'GET', `/local-engine/tasks/${task.id}`);
    return latest?.status === 'completed' ? latest : null;
  }, 'interaction task completes');
  const exported = await apiRequest(targetPage, 'GET', `/local-engine/tasks/${task.id}/diagnostics/export`);
  const content = JSON.parse(exported.content || '{}');
  assert(exported.mimeType === 'application/json;charset=utf-8', 'interaction diagnostic export mime type');
  assert(content.task?.id === task.id, 'interaction diagnostic export includes task id');
  pass(`Interaction task and diagnostic export verified: ${task.id}`);
}

async function checkAgentApproveFlow(targetPage) {
  const session = await createDryRunAgent(targetPage, {
    title: 'smoke-agent-approve',
    instruction: '打开浏览器检查评论队列，只生成草稿，确认后继续。',
    source: 'agent-console',
    targetApp: '浏览器',
  });
  const confirmation = firstPendingConfirmation(session);
  const approved = await approveConfirmation(targetPage, confirmation, 'smoke approve');
  assert(approved.id === session.id, 'approved session id matches');
  const completed = await waitForSessionStatus(targetPage, session.id, ['completed', 'running']);
  assert(hasEvidence(completed), 'approved agent session has evidence');
  const exported = await exportAgentEvidence(targetPage, session.id);
  assert(exported.content.session.id === session.id, 'agent evidence export includes session id');
  pass(`Agent approve flow verified: ${session.id}`);
}

async function checkAgentRejectFlow(targetPage) {
  const session = await createDryRunAgent(targetPage, {
    title: 'smoke-agent-reject',
    instruction: '准备执行高风险发送动作，但这条验收会拒绝继续。',
    source: 'agent-console',
    targetApp: '浏览器',
  });
  const confirmation = firstPendingConfirmation(session);
  const rejected = await apiRequest(targetPage, 'POST', `/local-engine/confirmations/${confirmation.id}/reject`, {
    operator: 'smoke',
    note: 'smoke reject',
  });
  assert(rejected.status === 'cancelled', 'rejected agent session is cancelled');
  const confirmations = await apiRequest(targetPage, 'GET', `/local-engine/agent-sessions/${session.id}/confirmations?status=rejected`);
  assert(Array.isArray(confirmations) && confirmations.some((item) => item.id === confirmation.id), 'rejected confirmation is queryable');
  pass(`Agent reject flow verified: ${session.id}`);
}

async function checkAgentRevisionContinueFlow(targetPage) {
  const session = await createDryRunAgent(targetPage, {
    title: 'smoke-agent-revision-continue',
    instruction: '先暂停确认，验收修改后继续。',
    source: 'agent-console',
    targetApp: '浏览器',
  });
  const confirmation = firstPendingConfirmation(session);
  await approveConfirmation(targetPage, confirmation, 'smoke revision approve');
  const continued = await apiRequest(targetPage, 'POST', `/local-engine/agent-sessions/${session.id}/continue`, {
    operator: 'smoke',
    instruction: '修改后继续：只保留草稿，不发送。',
  });
  assert(continued.events.some((event) => String(event.title).includes('补充指令')), 'revision continue records supplemental instruction');
  const completed = await waitForSessionStatus(targetPage, session.id, ['completed', 'running']);
  assert(completed.events.some((event) => String(event.message).includes('只保留草稿')), 'revision instruction persisted in event timeline');
  pass(`Agent revision continue flow verified: ${session.id}`);
}

async function checkPublishConfirmation(targetPage) {
  const session = await createDryRunAgent(targetPage, {
    title: 'smoke-publish-confirmation',
    instruction: '发布中心准备提交前必须进入待确认，不要自动发布。',
    source: 'publishing',
    targetApp: '发布中心',
    resumeAction: {
      kind: 'auto-upload-publish',
      label: 'smoke publish confirmation',
      payloads: [
        {
          type: 3,
          title: 'smoke-dry-run-title',
          tags: ['smoke'],
          fileList: ['/tmp/smoke-video.mp4'],
          accountList: ['/tmp/smoke-account.json'],
          enableTimer: 0,
          videosPerDay: 1,
          dailyTimes: ['10:00'],
          startDays: 0,
          timeJitterMinutes: 0,
          debugDryRun: true,
          debugDryRunHoldBrowser: true,
          category: 0,
        },
      ],
    },
  });
  const confirmation = firstPendingConfirmation(session);
  const queue = await apiRequest(targetPage, 'GET', '/local-engine/confirmations?status=pending');
  assert(queue.some((item) => item.id === confirmation.id), 'publish confirmation is in pending queue');
  assert(session.resumeAction?.kind === 'auto-upload-publish', 'publish resume action is preserved');
  pass(`Publish confirmation guard verified without approving upload runner: ${session.id}`);
}

async function createDryRunAgent(targetPage, input) {
  const session = await apiRequest(targetPage, 'POST', '/local-engine/agent-sessions', {
    executionScope: 'browser',
    dryRun: true,
    ...input,
  });
  assert(session?.id, 'agent session created');
  assert(session.status === 'waiting_for_confirmation', 'agent session waits for confirmation');
  assert(firstPendingConfirmation(session), 'agent session has pending confirmation');
  return session;
}

function firstPendingConfirmation(session) {
  return (session.confirmations || []).find((item) => item.status === 'pending');
}

async function approveConfirmation(targetPage, confirmation, note) {
  const confirmedChecks = Object.fromEntries((confirmation.requiredChecks || []).map((check) => [check.key, true]));
  return apiRequest(targetPage, 'POST', `/local-engine/confirmations/${confirmation.id}/approve`, {
    operator: 'smoke',
    note,
    confirmedChecks,
  });
}

async function waitForSessionStatus(targetPage, id, expectedStatuses) {
  return waitFor(async () => {
    const session = await apiRequest(targetPage, 'GET', `/local-engine/agent-sessions/${id}`);
    return expectedStatuses.includes(session.status) ? session : null;
  }, `session ${id} reaches ${expectedStatuses.join('/')}`);
}

async function exportAgentEvidence(targetPage, id) {
  const exported = await apiRequest(targetPage, 'GET', `/local-engine/agent-sessions/${id}/evidence/export`);
  const content = JSON.parse(exported.content || '{}');
  assert(isJsonMime(exported.mimeType), 'agent evidence export mime type');
  assert(Array.isArray(content.evidence) && content.evidence.length > 0, 'agent evidence export has evidence events');
  assert(Array.isArray(content.replay?.timeline) && content.replay.timeline.length > 0, 'agent evidence export has replay timeline');
  return { ...exported, content };
}

function hasEvidence(session) {
  return (session.events || []).some((event) => event.evidence);
}

async function waitFor(producer, label, attempts = 10, delayMs = 500) {
  let lastError;
  for (let index = 0; index < attempts; index += 1) {
    try {
      const value = await producer();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ''}`);
}

async function apiRequest(targetPage, method, path, body) {
  return targetPage.evaluate(
    async ({ apiBase: base, method: requestMethod, path: requestPath, body: requestBody }) => {
      const response = await fetch(`${base}${requestPath}`, {
        method: requestMethod,
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          ...(requestBody === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: requestBody === undefined ? undefined : JSON.stringify(requestBody),
      });
      const text = await response.text();
      let json = null;
      if (text) {
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
      }
      if (!response.ok || json?.success === false) {
        throw new Error(json?.message || `HTTP ${response.status} ${requestMethod} ${requestPath}`);
      }
      return Object.prototype.hasOwnProperty.call(json || {}, 'data') ? json.data : json;
    },
    { apiBase, method, path, body },
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function hasAnyFlag(value, keys) {
  return keys.some((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isJsonMime(value) {
  return typeof value === 'string' && value.toLowerCase().startsWith('application/json');
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

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}
