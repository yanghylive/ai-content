#!/usr/bin/env node

import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
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
const username = process.env.SMOKE_USERNAME || process.env.ASSISTED_E2E_USERNAME || '';
const password = process.env.SMOKE_PASSWORD || process.env.ASSISTED_E2E_PASSWORD || '';
const autoMode = process.env.ASSISTED_E2E_AUTO === '1';
const headless = process.env.ASSISTED_E2E_HEADLESS === '1' || autoMode;
const timeoutMs = Number(process.env.ASSISTED_E2E_TIMEOUT_MS || 45000);
const accountId = process.env.ASSISTED_E2E_ACCOUNT_ID ? Number(process.env.ASSISTED_E2E_ACCOUNT_ID) : undefined;
const keepOpen = process.env.ASSISTED_E2E_KEEP_OPEN === '1' && !headless;

const rl = autoMode ? null : createInterface({ input, output });
let browser;
let page;
let passCount = 0;
let warnCount = 0;
let failCount = 0;
const manualSteps = [];
const consoleErrors = [];
const createdTaskIds = [];
const createdSessionIds = [];

try {
  console.log('AI Content assisted E2E acceptance');
  console.log(`Frontend URL: ${frontendUrl}`);
  console.log(`API base: ${apiBase}`);
  console.log(`Playwright: ${loadedFrom}`);
  console.log(`Mode: ${autoMode ? 'auto-safe' : 'assisted'}`);
  console.log('');

  browser = await chromium.launch({ headless });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await loginMainSystem();
  await checkRequiredRoutes();
  await platformLoginCheckpoint();
  await wechatDesktopCheckpoint();
  await runCommentAcceptance();
  await runMessageAcceptance();
  await runWechatDraftAcceptance();
  await runBatchTaskAcceptance();
  await runFileSelectionAcceptance();
  await runPublishingGuardAcceptance('article');
  await runPublishingGuardAcceptance('video');
  await runPublishingCenterGuardAcceptance();
  await runUnauthorizedGuardAcceptance();
  await runFailureRecoveryAcceptance();
  await runEvidenceExportAcceptance();

  const unexpectedErrors = consoleErrors.filter(
    (message) => !/401|Unauthorized|\/auth\/me|ResizeObserver loop|net::ERR_TIMED_OUT/.test(message),
  );
  if (unexpectedErrors.length) {
    warn(`Browser console has non-blocking errors: ${unexpectedErrors.slice(0, 3).join(' | ')}`);
  }

  printManualSteps();
  summary();
  if (failCount > 0) process.exit(1);
} catch (error) {
  fail(`unexpected error: ${error.stack || error.message}`);
  printManualSteps();
  summary();
  process.exit(1);
} finally {
  if (keepOpen) {
    await pause('验收浏览器将保持打开。检查完页面后按回车关闭。');
  }
  await rl?.close();
  await browser?.close();
}

async function loginMainSystem() {
  await page.goto(`${frontendUrl}/login`, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  if (!page.url().includes('/login')) {
    pass('Main system already logged in');
    return;
  }

  if (username && password) {
    await page.locator('input').nth(0).fill(username);
    await page.locator('input').nth(1).fill(password);
    await page.getByRole('button', { name: /登录系统|登录/ }).click();
    await page.waitForFunction(() => !location.pathname.includes('/login'), null, { timeout: timeoutMs });
    pass(`Main system login succeeded: ${page.url()}`);
    return;
  }

  manualSteps.push('主系统登录：在打开的登录页输入 Kaypal/AI Content 账号密码。');
  await pause('请先在浏览器里完成主系统登录，然后按回车继续。');
  await page.waitForFunction(() => !location.pathname.includes('/login'), null, { timeout: timeoutMs });
  pass(`Main system manual login detected: ${page.url()}`);
}

async function checkRequiredRoutes() {
  const routes = [
    ['Agent 指令台', '/agent-console', ['Agent 指令台']],
    ['待我确认', '/confirmations', ['待我确认']],
    ['抖音评论', '/workbench/douyin-comments', ['抖音评论']],
    ['抖音私信', '/workbench/douyin-messages', ['抖音私信']],
    ['视频号评论', '/workbench/channel-comments', ['视频号评论']],
    ['视频号私信', '/workbench/channel-messages', ['视频号私信']],
    ['图文发布', '/distribution?tab=article', ['图文发布']],
    ['视频发布', '/distribution?tab=video', ['视频发布']],
    ['证据产物', '/artifacts', ['证据']],
  ];

  for (const [label, route, tokens] of routes) {
    await page.goto(`${frontendUrl}${route}`, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => undefined);
    const text = await page.locator('body').innerText({ timeout: timeoutMs });
    const missing = tokens.filter((token) => !text.includes(token));
    if (page.url().includes('/login')) {
      fail(`${label}: redirected to login`);
    } else if (missing.length) {
      fail(`${label}: missing ${missing.join(' / ')}`);
    } else {
      pass(`${label}: route visible`);
    }
  }
}

async function platformLoginCheckpoint() {
  await page.goto(`${frontendUrl}/distribution?tab=accounts`, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => undefined);
  manualSteps.push('平台账号登录：在发布中心/平台账号里登录或刷新抖音、小红书、B站、视频号等本地账号。');
  const accounts = await safeApi('GET', `/auto-upload/accounts?validate=0`);
  if (Array.isArray(accounts) && accounts.length) {
    const ready = accounts.filter((item) => item.status === 1 || item.statusLabel === '正常' || item.statusLabel === '可用');
    pass(`Platform accounts visible: total=${accounts.length}, ready-ish=${ready.length}`);
    const health = await safeApi('GET', '/auto-upload/accounts/health?validate=0');
    if (health) {
      pass(`Platform account health reachable: ready=${health.readyAccounts}, expired=${health.expiredAccounts}, waitingTasks=${health.waitingTasks?.length || 0}`);
    }
  } else {
    warn('No platform accounts returned yet; assisted mode can continue after user adds/logs in accounts.');
  }

  if (!autoMode) {
    await pause('如果要验收真实平台登录态，请在“平台账号”页完成扫码/登录/刷新状态，然后按回车继续。');
  }
}

async function wechatDesktopCheckpoint() {
  await page.goto(`${frontendUrl}/workbench`, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => undefined);
  manualSteps.push('微信桌面登录：打开本机微信，登录账号，并把一个测试联系人或测试群窗口放在前台。');
  const status = await safeApi('GET', '/local-engine/wechat/session/status');
  if (status) {
    pass(`WeChat session status reachable: ${status.statusLabel || status.status || 'unknown'}`);
  } else {
    warn('WeChat session status not available; continue with guarded draft-only checks.');
  }

  if (!autoMode) {
    await pause('请确认本机微信已登录，测试会话窗口已打开。脚本不会点发送。完成后按回车继续。');
  }
}

async function runCommentAcceptance() {
  const task = await createInteractionTask('/local-engine/comments/tasks', {
    type: 'douyin-comment-reply',
    accountId,
    accountName: accountId ? `assisted-account-${accountId}` : 'assisted-safe-comment-account',
    platformName: '抖音',
    targetName: 'E2E 评论测试对象',
    sourceText: '请问今天还有名额吗？',
    replyText: '您好，有名额。您可以先私信我，我发您详细安排。',
    sendMode: 'approval-send',
  });
  await verifyTaskGuard(task.id, '评论回复');
}

async function runMessageAcceptance() {
  const task = await createInteractionTask('/local-engine/messages/tasks', {
    type: 'douyin-direct-message-reply',
    accountId,
    accountName: accountId ? `assisted-account-${accountId}` : 'assisted-safe-message-account',
    platformName: '抖音',
    targetName: 'E2E 私信测试对象',
    sourceText: '想了解一下价格和到店时间。',
    replyText: '您好，价格要看具体项目。我先给您发基础套餐，您看哪个方便。',
    sendMode: 'approval-send',
  });
  await verifyTaskGuard(task.id, '私信回复');
}

async function runWechatDraftAcceptance() {
  const task = await createInteractionTask('/local-engine/wechat/tasks', {
    type: 'wechat-reply-draft',
    accountName: '本机微信测试账号',
    platformName: '微信',
    targetName: 'E2E 微信测试联系人',
    sourceText: '帮我确认一下明天能不能预约。',
    replyText: '可以的，我先帮您预留。您把到店时间发我一下。',
    sendMode: 'approval-send',
  });
  await verifyTaskGuard(task.id, '微信草稿');

  if (!autoMode) {
    await pause('请在“待我确认/微信会话”页面核对微信草稿确认卡。不要点击真实发送。确认页面看到后按回车继续。');
  }
}

async function runBatchTaskAcceptance() {
  const task = await createInteractionTask('/local-engine/customers/tasks', {
    type: 'customer-follow-up',
    accountName: 'assisted-batch-internal-account',
    platformName: '内部跟进',
    targetName: 'E2E 批量客户A',
    sourceText: 'E2E 批量客户A询问预约。',
    replyText: '您好，我先为您登记，稍后人工确认。',
    sendMode: 'draft-only',
    batchTargets: [
      {
        targetName: 'E2E 批量客户A',
        sourceText: '今天还能预约吗？',
        replyText: '您好，今天可以先登记预约。',
      },
      {
        targetName: 'E2E 批量客户B',
        sourceText: '价格大概多少？',
        replyText: '您好，价格需要结合项目确认。',
      },
      {
        targetName: 'E2E 批量客户C',
        sourceText: '地址在哪里？',
        replyText: '您好，我稍后把地址整理给您。',
      },
    ],
  });
  const latest = await waitForTaskStatus(task.id, ['completed', 'failed', 'skipped', 'no_target', 'waiting_for_send_confirmation']);
  const total = latest.batchSummary?.total || latest.batchTargets?.length || 0;
  assert(total === 3, `batch task keeps 3 targets, got ${total}`);
  pass(`批量任务: status=${latest.status}, summary=${JSON.stringify(latest.batchSummary || {})}`);
}

async function runFileSelectionAcceptance() {
  const fileStatus = await apiRequest('GET', '/local-engine/files/status');
  const roots = Array.isArray(fileStatus.roots) ? fileStatus.roots : [];
  const required = ['auto-upload-materials', 'auto-upload-cookies', 'auto-upload-logs'];
  const missing = required.filter((key) => !roots.some((root) => root.key === key));
  assert(!missing.length, `file-selection roots missing: ${missing.join(', ')}`);
  manualSteps.push('桌面 file-selection：确认本机素材目录、账号 Cookie 目录、Runtime 日志目录可读；缺权限时严格 Gate 会 BLOCKED。');
  pass(`file-selection roots visible: ${required.join(', ')}`);
}

async function runPublishingGuardAcceptance(kind) {
  const isVideo = kind === 'video';
  const session = await apiRequest('POST', '/local-engine/agent-sessions', {
    title: `assisted-${kind}-publish-guard`,
    instruction: `${isVideo ? '视频发布' : '图文发布'}真实发布前必须停在待我确认；本验收不允许自动发布。`,
    source: 'publishing',
    executionScope: 'browser',
    targetApp: isVideo ? '视频发布' : '图文发布',
    dryRun: true,
    resumeAction: {
      kind: 'auto-upload-publish',
      label: `${isVideo ? '视频发布' : '图文发布'}安全确认`,
      payloads: [
        {
          type: isVideo ? 3 : 1,
          title: `assisted-${kind}-dry-run-title`,
          tags: ['assisted-e2e'],
          fileList: [isVideo ? '/tmp/assisted-e2e-video.mp4' : '/tmp/assisted-e2e-image.png'],
          accountList: ['/tmp/assisted-e2e-account.json'],
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
  createdSessionIds.push(session.id);
  const confirmation = firstPendingConfirmation(session);
  assert(confirmation, `${kind} publish confirmation exists`);
  const queue = await apiRequest('GET', '/local-engine/confirmations?status=pending');
  assert(Array.isArray(queue) && queue.some((item) => item.id === confirmation.id), `${kind} publish confirmation queryable`);
  pass(`${isVideo ? '视频发布' : '图文发布'}: guarded by pending confirmation, not approved`);
}

async function runPublishingCenterGuardAcceptance() {
  manualSteps.push('发布中心真实矩阵：准备一个测试平台账号和测试素材；严格 Gate 需要 COMMERCIAL_PUBLISH_ACCOUNT_FILE / COMMERCIAL_PUBLISH_MATERIAL_FILE 才会提交真实发布。');
  const accounts = await safeApi('GET', '/auto-upload/accounts?validate=0');
  const materials = await safeApi('GET', '/auto-upload/materials');
  const payload = buildPublishPayload(accounts, materials);
  const guarded = await safeApi('POST', '/auto-upload/publish', { payloads: [payload] });
  if (guarded) {
    fail('发布中心: direct publish returned success without risk confirmation');
  } else {
    pass('发布中心: direct publish requires risk confirmation or real preflight');
  }
}

async function runUnauthorizedGuardAcceptance() {
  const probes = [
    ['证据清理', '/local-engine/evidence/cleanup', { retentionDays: 0 }],
    ['远程接管', '/local-engine/wechat/session/takeover', { operator: 'assisted-e2e', reason: 'unauthorized probe' }],
  ];
  for (const [label, path, body] of probes) {
    const result = await safeApi('POST', path, body);
    if (result) {
      fail(`${label}: unauthorized probe returned success`);
    } else {
      pass(`${label}: unauthorized probe blocked`);
    }
  }
}

async function runFailureRecoveryAcceptance() {
  const failed = await createInteractionTask('/local-engine/comments/tasks', {
    type: 'douyin-comment-reply',
    accountName: 'assisted-failure-account',
    platformName: '抖音',
    targetName: 'E2E 失败恢复对象',
    sourceText: '这条任务用于失败恢复验收。',
    replyText: '这条回复不会真实发送。',
    sendMode: 'approval-send',
  });
  await waitForTaskStatus(failed.id, ['waiting_for_send_confirmation', 'completed', 'failed']);
  const failedTask = await apiRequest('POST', `/local-engine/tasks/${failed.id}/fail`, {
    reason: 'assisted E2E 人工制造失败，用于验证失败恢复。',
  });
  assert(failedTask.status === 'failed', 'task can be marked failed');
  const retry = await apiRequest('POST', `/local-engine/tasks/${failed.id}/retry`, {});
  assert(retry.id && retry.id !== failed.id, 'retry task created');
  createdTaskIds.push(retry.id);
  const retryState = await waitForTaskStatus(retry.id, [
    'running',
    'waiting_for_send_confirmation',
    'completed',
    'failed',
    'no_target',
  ]);
  pass(`失败恢复: failed=${failed.id}, retry=${retry.id}, retryStatus=${retryState.status}`);
}

async function runEvidenceExportAcceptance() {
  for (const taskId of createdTaskIds.slice(0, 6)) {
    const exported = await apiRequest('GET', `/local-engine/tasks/${taskId}/diagnostics/export`);
    assert(isJsonMime(exported.mimeType), `task ${taskId} diagnostics mime`);
    const content = JSON.parse(exported.content || '{}');
    assert(content.task?.id === taskId, `task ${taskId} diagnostics includes task`);
  }

  for (const sessionId of createdSessionIds.slice(0, 4)) {
    const exported = await apiRequest('GET', `/local-engine/agent-sessions/${sessionId}/evidence/export`);
    assert(isJsonMime(exported.mimeType), `session ${sessionId} evidence mime`);
    const content = JSON.parse(exported.content || '{}');
    assert(content.session?.id === sessionId, `session ${sessionId} evidence includes session`);
  }

  const records = await apiRequest('GET', '/local-engine/records/export?limit=100');
  assert(records.content && records.filename, 'records export returns content');
  pass(`证据导出: tasks=${createdTaskIds.length}, sessions=${createdSessionIds.length}, records=${records.filename}`);
}

async function createInteractionTask(path, body) {
  const task = await apiRequest('POST', path, body);
  assert(task?.id, `${path} returns task id`);
  createdTaskIds.push(task.id);
  pass(`Created ${task.typeLabel || task.type}: ${task.id}`);
  return task;
}

async function verifyTaskGuard(taskId, label) {
  const task = await waitForTaskStatus(taskId, [
    'waiting_for_send_confirmation',
    'completed',
    'failed',
    'no_target',
  ]);
  if (task.status === 'waiting_for_send_confirmation') {
    pass(`${label}: stopped at send confirmation`);
  } else if (task.status === 'completed' && task.sendMode === 'draft-only') {
    pass(`${label}: completed as draft-only`);
  } else if (task.status === 'completed') {
    fail(`${label}: completed without pending confirmation; commercial acceptance requires real execution evidence or an explicit draft-only/internal-record scope`);
  } else {
    warn(`${label}: ended as ${task.status}; inspect diagnostics for account/login/preflight issue`);
  }

  const exported = await apiRequest('GET', `/local-engine/tasks/${taskId}/diagnostics/export`);
  assert(isJsonMime(exported.mimeType), `${label} diagnostic export mime type`);
  pass(`${label}: diagnostic export ready`);
}

async function waitForTaskStatus(taskId, expectedStatuses, attempts = 30, delayMs = 500) {
  return waitFor(async () => {
    const task = await apiRequest('GET', `/local-engine/tasks/${taskId}`);
    return expectedStatuses.includes(task.status) ? task : null;
  }, `task ${taskId} reaches ${expectedStatuses.join('/')}`, attempts, delayMs);
}

async function waitFor(producer, label, attempts = 20, delayMs = 500) {
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

async function safeApi(method, path, body) {
  try {
    return await apiRequest(method, path, body);
  } catch (error) {
    warn(`${method} ${path} failed: ${error.message}`);
    return null;
  }
}

async function apiRequest(method, path, body) {
  return page.evaluate(
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

async function pause(message) {
  if (autoMode) return;
  console.log('');
  console.log(`ACTION ${message}`);
  await rl.question('按回车继续...');
  console.log('');
}

function firstPendingConfirmation(session) {
  return (session.confirmations || []).find((item) => item.status === 'pending');
}

function buildPublishPayload(accounts = [], materials = []) {
  const readyAccount = Array.isArray(accounts)
    ? accounts.find((account) => account.status === 1 || account.statusLabel === '正常' || account.statusLabel === '可用')
    : null;
  const material = Array.isArray(materials) ? materials.find((item) => item.filePath || item.filepath || item.path) : null;
  const filePath = material?.filePath || material?.filepath || material?.path || '/tmp/assisted-e2e-image.png';
  const isVideo = /\.(mp4|mov|m4v|avi|webm)$/i.test(filePath);
  return {
    type: readyAccount?.type || 3,
    contentKind: isVideo ? 'video' : 'article',
    title: `assisted-publish-guard-${Date.now()}`,
    tags: ['assisted-e2e'],
    fileList: [filePath],
    accountList: [readyAccount?.filePath || '/tmp/assisted-e2e-account.json'],
    enableTimer: 0,
    videosPerDay: 1,
    dailyTimes: ['10:00'],
    startDays: 0,
    timeJitterMinutes: 0,
    debugDryRun: true,
    debugDryRunHoldBrowser: true,
    category: 0,
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isJsonMime(value) {
  return typeof value === 'string' && value.toLowerCase().startsWith('application/json');
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

function printManualSteps() {
  if (!manualSteps.length) return;
  console.log('');
  console.log('Manual collaboration points:');
  for (const [index, step] of manualSteps.entries()) {
    console.log(`${index + 1}. ${step}`);
  }
}

function summary() {
  console.log('');
  console.log(`Summary: PASS=${passCount} WARN=${warnCount} FAIL=${failCount}`);
  if (createdTaskIds.length || createdSessionIds.length) {
    console.log(`Created tasks: ${createdTaskIds.join(', ') || '-'}`);
    console.log(`Created sessions: ${createdSessionIds.join(', ') || '-'}`);
  }
}
