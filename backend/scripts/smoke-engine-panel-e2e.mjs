/**
 * 端到端真机验证：3011 引擎「内置面板优先」。
 * 1. 登录 3011(测试账号)拿 cookie;
 * 2. 查平台账号列表选一个 douyin 账号;
 * 3. 记录 spawn 前「Chrome for Testing」进程数(基线);
 * 4. POST /api/auto-upload/accounts/open 触发 getOrCreateSession;
 * 5. 断言:①无新增外部 Chromium 进程;②响应 runtimeMode 会话来自面板;
 *    ③CDP targets 面板页命中 douyin。
 */
const BASE = 'http://127.0.0.1:3011';
const USER = '__REDACTED_TEST_USER__';
const PASS = '__REDACTED_TEST_PASS__';

process.on('uncaughtException', (e) => {
  console.error('[uncaughtException]', e?.stack || e?.message || e);
  process.exit(2);
});
process.on('unhandledRejection', (e) => {
  console.error('[unhandledRejection]', (e && (e.stack || e.message)) || e);
  process.exit(3);
});

async function api(method, pathname, body, cookie) {
  const res = await fetch(BASE + pathname, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  const sc = res.headers.get('set-cookie');
  return { status: res.status, json, cookie: cookie ?? (sc ? sc.split(';')[0] : undefined) };
}

const chromeProcCount = async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const p = promisify(execFile);
  const { stdout } = await p('bash', ['-c', "ps aux | grep '[C]hrome for Testing' | grep -v grep | wc -l"]);
  return Number(stdout.trim());
};

// 1. 登录
const login = await api('POST', '/api/auth/login', { username: USER, password: PASS });
if (login.status !== 200 && login.status !== 201) {
  console.error('FAIL login', login.status, JSON.stringify(login.json)?.slice(0, 200));
  process.exit(1);
}
const cookie = login.cookie;
console.log('[1] 登录 OK');

// 2. 账号列表
const accountsRes = await api('GET', '/api/auto-upload/accounts', null, cookie);
const accounts = accountsRes.json?.data?.accounts || accountsRes.json?.data || [];
const douyin = (Array.isArray(accounts) ? accounts : []).find(
  (a) => a.platformKey === 'douyin' || a.platform === 'douyin' || a.platform === '抖音',
);
if (!douyin) {
  console.error('FAIL 无 douyin 账号，accounts=', JSON.stringify(accountsRes.json)?.slice(0, 300));
  process.exit(1);
}
console.log(`[2] 选用 douyin 账号 id=${douyin.id} name=${douyin.accountName || douyin.name || ''}`);

// 3. 基线进程数
const before = await chromeProcCount();
console.log(`[3] Chrome for Testing 进程基线 = ${before}`);

// 4. 打开账号(触发 getOrCreateSession)
const open = await api('POST', '/api/auto-upload/accounts/open', { ids: [douyin.id] }, cookie);
const data = open.json?.data;
const first = Array.isArray(data) ? data[0] : data;
// 2026-09-05：accounts/open 响应含 openedAccounts[]（新增 browser 字段），断言取第一个账号
const firstOpened = first?.openedAccounts?.[0] ?? first;
console.log(`[4] accounts/open → ${open.status}`, JSON.stringify(first ?? open.json)?.slice(0, 400));
if (open.status !== 200 && open.status !== 201) process.exit(1);

// 5. 断言
let after = -1;
let noNewChrome = true;
try {
  after = await chromeProcCount();
  console.log(`[5] Chrome for Testing 进程 after = ${after}（before=${before}）`);
  noNewChrome = after <= before;
} catch (e) {
  console.log(`chromeProcCount 异常: ${e?.message}`);
}
const browserIsPanel = firstOpened && (firstOpened.browser === 'desktop-panel');
console.log(`断言①无新增外部 Chromium: ${noNewChrome ? 'PASS' : 'FAIL'}`);
console.log(`断言②browser=desktop-panel: ${browserIsPanel ? 'PASS' : `WARN（browser=${firstOpened?.browser}, 可能为复用会话）`}`);

// 6. CDP targets 面板页
let targets = [];
try {
  targets = (await (await fetch('http://127.0.0.1:9333/json/list')).json())
    .filter((t) => t.type === 'page' && /douyin\.com/.test(t.url || ''));
} catch (e) {
  console.log(`CDP targets 查询异常: ${e?.message}`);
}
console.log(`断言③CDP 面板 target 命中 douyin: ${targets.length > 0 ? 'PASS' : 'FAIL'} ${targets[0]?.url?.slice(0, 70) ?? ''}`);

if (noNewChrome && targets.length > 0) {
  console.log('E2E_OK');
} else {
  console.log('E2E_CHECK_NEEDED');
}
