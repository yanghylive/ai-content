/**
 * 端到端真机验证：3011 引擎「内置面板优先」。
 * 1. 登录 3011(测试账号)拿 cookie;
 * 2. 查平台账号列表选一个 douyin 账号;
 * 3. 记录 spawn 前「Chrome for Testing」进程数(基线);
 * 4. POST /api/auto-upload/accounts/open 触发 getOrCreateSession;
 * 5. 四条硬断言（任一 FAIL 即 exit 1，全部 PASS 才输出 E2E_OK）:
 *    ①无新增外部 Chromium 进程;
 *    ②响应 openedAccounts[0].browser === 'desktop-panel';
 *    ③CDP targets 面板页命中 douyin;
 *    ④台账绑定：面板桥 /panel-state 返回的 accountId === douyin.id 且 panelId 非空。
 *
 * 凭据走环境变量（2026-09-05 复核 P0：禁止硬编码登录凭据进 Git）:
 *   SMOKE_E2E_USER / SMOKE_E2E_PASS 必填，缺失直接 exit 2。
 */
const BASE = 'http://127.0.0.1:3011';
const USER = process.env.SMOKE_E2E_USER;
const PASS = process.env.SMOKE_E2E_PASS;
if (!USER || !PASS) {
  console.error('FAIL 缺少环境变量 SMOKE_E2E_USER / SMOKE_E2E_PASS（禁止硬编码凭据）');
  process.exit(2);
}

process.on('uncaughtException', (e) => {
  console.error('[uncaughtException]', e?.stack || e?.message || e);
  process.exit(2);
});
process.on('unhandledRejection', (e) => {
  console.error('[unhandledRejection]', (e && (e.stack || e.message)) || e);
  process.exit(3);
});

const fail = (msg) => {
  console.error('FAIL', msg);
  process.exit(1);
};

async function api(method, pathname, body, cookie, extraHeaders) {
  const res = await fetch(BASE + pathname, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(extraHeaders || {}) },
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
  fail('login ' + login.status + ' ' + JSON.stringify(login.json)?.slice(0, 200));
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
  fail('无 douyin 账号，accounts=' + JSON.stringify(accountsRes.json)?.slice(0, 300));
}
console.log(`[2] 选用 douyin 账号 id=${douyin.id} name=${douyin.accountName || douyin.name || ''}`);

// 3. 基线进程数
const before = await chromeProcCount();
console.log(`[3] Chrome for Testing 进程基线 = ${before}`);

// 4. 打开账号(触发 getOrCreateSession)
const open = await api('POST', '/api/auto-upload/accounts/open', { ids: [douyin.id] }, cookie);
const data = open.json?.data;
const first = Array.isArray(data) ? data[0] : data;
const firstOpened = first?.openedAccounts?.[0] ?? first;
console.log(`[4] accounts/open → ${open.status}`, JSON.stringify(first ?? open.json)?.slice(0, 400));
if (open.status !== 200 && open.status !== 201) fail('accounts/open ' + open.status);

// 5. 断言①无新增外部 Chromium（硬失败）
let after = -1;
let noNewChrome = false;
try {
  after = await chromeProcCount();
  console.log(`[5] Chrome for Testing 进程 after = ${after}（before=${before}）`);
  noNewChrome = after <= before;
} catch (e) {
  console.log(`chromeProcCount 异常: ${e?.message}`);
}
console.log(`断言①无新增外部 Chromium: ${noNewChrome ? 'PASS' : 'FAIL'}`);
if (!noNewChrome) fail(`断言① 新增了外部 Chromium 进程（before=${before} after=${after}）`);

// 断言②browser=desktop-panel（硬失败）
const browserIsPanel = firstOpened && firstOpened.browser === 'desktop-panel';
console.log(`断言②browser=desktop-panel: ${browserIsPanel ? 'PASS' : 'FAIL（browser=' + (firstOpened?.browser ?? 'undefined') + '）'}`);
if (!browserIsPanel) fail(`断言② openedAccounts[0].browser !== 'desktop-panel'`);

// 6. 断言③CDP targets 面板页命中 douyin（硬失败）
let targets = [];
try {
  targets = (await (await fetch('http://127.0.0.1:9333/json/list')).json())
    .filter((t) => t.type === 'page' && /douyin\.com/.test(t.url || ''));
} catch (e) {
  fail('CDP targets 查询异常: ' + e?.message);
}
console.log(`断言③CDP 面板 target 命中 douyin: ${targets.length > 0 ? 'PASS' : 'FAIL'} ${targets[0]?.url?.slice(0, 70) ?? ''}`);
if (targets.length === 0) fail('断言③ CDP 无 douyin 面板 target');

// 7. 断言④台账绑定（2026-09-05 复核 P1：面板页必须绑到选中的 accountId + panelId）
// 读桌面端面板桥配置拿端口/token，走桥协议三头查 /panel-state。
const { execFile: ef2 } = await import('node:child_process');
const { promisify: p2 } = await import('node:util');
const readBridgeCfg = async () => {
  const osmod = await import('node:os');
  const path = await import('node:path');
  const fs = await import('node:fs');
  const cfgPath = path.join(osmod.homedir(), 'Library', 'Application Support', 'ai-content-desktop', 'browser-panel-bridge.json');
  return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
};
let bridgeState = null;
try {
  const cfg = await readBridgeCfg();
  // 配置文件无 port 字段，端口在 endpoint（如 http://127.0.0.1:PORT）里
  const port = Number(new URL(cfg.endpoint).port) || 30133;
  const nonce = `smoke-${Date.now()}`;
  const ts = String(Date.now());
  const res = await fetch(`http://127.0.0.1:${port}/panel-state`, {
    method: 'POST',
    headers: {
      // 桥鉴权为 timing-safe 裸 token 直比（browser-agent-bridge-server.js:282）
      'x-kaypal-bridge-token': cfg.token || '',
      'x-kaypal-bridge-nonce': nonce,
      'x-kaypal-bridge-ts': ts,
      'Content-Type': 'application/json',
    },
    // /panel-state 校验 actor 归属（与 /execute 同强度），用引擎身份
    body: JSON.stringify({ actor: { ownerId: 'local-engine', tenantId: 'local-tenant' } }),
  });
  bridgeState = await res.json().catch(() => null);
  console.log(`[7] panel-state → ${res.status}`, JSON.stringify(bridgeState)?.slice(0, 300));
} catch (e) {
  fail('断言④ panel-state 查询异常: ' + e?.message);
}
const st = bridgeState?.data ?? bridgeState;
const boundAccountId = String(st?.accountId ?? '');
const boundPanelId = st?.panelId ?? '';
const bindingOk = boundAccountId === String(douyin.id) && !!boundPanelId;
console.log(
  `断言④台账绑定(accountId=${boundAccountId}, panelId=${boundPanelId ? '有' : '无'}): ${bindingOk ? 'PASS' : 'FAIL'}（期望 accountId=${douyin.id}）`,
);
if (!bindingOk) fail(`断言④ 面板台账绑定不符：accountId=${boundAccountId} panelId=${boundPanelId}`);

console.log('E2E_OK');
