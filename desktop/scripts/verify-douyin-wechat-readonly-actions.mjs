#!/usr/bin/env node
'use strict';
/**
 * verify-douyin-wechat-readonly-actions.mjs — 阶段 5 只读动作序列真机校准（2026-09-04）
 * 平台：抖音（creator.douyin.com）+ 视频号（channels.weixin.qq.com/platform）
 *
 * 模式：真实桌面端 App（CDP 9333 驱动 open 面板）+ 3011 生产 API。
 *   - 与 verify-xhs-readonly-actions.mjs（独立 harness 自起 Electron）不同，
 *     本脚本走 verify-douyin-scan-login.mjs 的「真实 App + CDP」模式：
 *     partition 全程由 App 单进程持有，规避 4.23 铁律（跨进程并发持有互踩 Cookies）。
 *   - open 同 owner 复用面板视图（browser-panel-manager.js open()：同 ownerId 仅导航不重建），
 *     抖音→视频号顺序跑，登录态全程在 partition 内不丢。
 *
 * 链路（每平台）：
 *   ① 建 platform 会话（拿 lease.tenantId）；
 *   ② CDP 主窗口 open 面板（ownerId+tenantId+platform 透传，缺 tenantId = POLICY_DENIED 血泪 4.21/4.24）；
 *   ③ login-state 轮询至 logged_in（partition 已有登录态应秒翻）；
 *   ④ selector 探测（候选从具体到兜底，每候选新会话跑「提取 <sel>」，终态保护）；
 *   ⑤ 组合任务「提取 <命中>，然后截图」终态 succeeded（解析器句式铁律 4.23）；
 *   ⑥ 事件校验：extract 真实文本 + screenshot ok + evidenceUrl + 无 base64 泄漏；
 *   ⑦ 证据落盘 docs/browser-panel-baseline/stage5-<platform>-readonly-evidence-*.json。
 */
import WebSocket from '/Users/yanghy/.workbuddy/binaries/node/workspace/node_modules/ws/index.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CDP_HTTP = 'http://127.0.0.1:9333';
const BASE = 'http://127.0.0.1:3011';
const USER = '__REDACTED_TEST_USER__';
const PASS = '__REDACTED_TEST_PASS__';

const checks = [];
function record(name, pass, detail) {
  checks.push({ name, pass, detail: detail ?? null });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}`);
  if (detail) console.log(`   ${JSON.stringify(detail).slice(0, 400)}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TERMINAL = new Set(['succeeded', 'failed', 'needs-human', 'paused', 'cancelled']);

// ---- CDP helpers（同 verify-douyin-scan-login.mjs）----
let msgId = 0;
const pending = new Map();
function send(ws, method, params) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('CDP timeout: ' + method)); } }, 15000);
  });
}
function connect(target) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      }
    });
  });
}
async function evaluate(ws, expr) {
  const r = await send(ws, 'Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('evaluate 失败: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result?.value;
}

// ---- 3011 API（瞬时网络错误重试：真机跑批时偶发 fetch failed 会打断整段校准）----
async function api(method, pathname, body, cookie, retries = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(BASE + pathname, {
        method,
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const sc = res.headers.get('set-cookie');
      const json = await res.json().catch(() => ({}));
      return { status: res.status, json, cookie: cookie ?? (sc ? sc.split(';')[0] : undefined) };
    } catch (e) {
      if (attempt > retries) throw e;
      console.log(`[retry] ${method} ${pathname} 第${attempt}次网络错误（${e.message}），2s 后重试`);
      await sleep(2000);
    }
  }
}

/** run 任务（202 异步）→ 轮询 detail 至终态，返回 {run, events, finalStatus} */
async function runTask(cookie, sid, instruction, timeoutMs = 120000) {
  const run = await api('POST', `/api/local-engine/agent-browser/sessions/${sid}/run`, { instruction }, cookie);
  if (run.status !== 202) return { run, events: [], finalStatus: null };
  const t0 = Date.now();
  let events = [], status = '';
  while (Date.now() - t0 < timeoutMs) {
    const d = await api('GET', `/api/local-engine/agent-browser/sessions/${sid}`, null, cookie);
    status = d.json?.data?.status ?? '';
    events = d.json?.data?.events ?? [];
    if (TERMINAL.has(status)) break;
    await sleep(2000);
  }
  return { run, events, finalStatus: status };
}

const lastEvent = (events, kw) => [...events].reverse().find((e) => (e.action ?? '').includes(kw));

/**
 * 单平台校准。返回 { hitSelector, hitText, sid }（供证据与断言）。
 * 失败抛错由外层捕获继续下一平台。
 */
async function calibratePlatform(wsMain, cookie, userId, cfg) {
  const { tag, platform, startUrl, candidates, scanWaitMs = 3 * 60 * 1000 } = cfg;
  console.log(`\n======== ${tag} ========`);

  // ① 建会话
  const created = await api('POST', '/api/local-engine/agent-browser/sessions', { platform, startUrl }, cookie);
  const sid = created.json?.data?.id;
  const tenantId = created.json?.data?.lease?.tenantId;
  record(`${tag}① 建 ${platform} 会话（lease.tenantId 透传）`, !!sid && !!tenantId,
    { status: created.status, sid, tenantId });
  if (!sid || !tenantId) throw new Error(`${tag} 建会话失败: ${JSON.stringify(created.json?.message)}`);

  // ② CDP open 面板（同 owner 复用视图，仅导航）
  const openRes = await evaluate(wsMain, `window.electronAPI.browserPanel.open({
    url: ${JSON.stringify(startUrl)},
    ownerId: ${JSON.stringify(userId)},
    tenantId: ${JSON.stringify(tenantId)},
    platform: ${JSON.stringify(platform)},
  })`);
  record(`${tag}② CDP open 面板（platform=${platform}）`,
    !!openRes && openRes.status !== 'error', { panelId: openRes?.panelId, status: openRes?.status });
  await sleep(8000); // 登录态恢复 + 页面加载

  // ③ login-state 轮询至 logged_in（partition 有登录态秒翻；无则等人工扫码）
  let st = '';
  const lsDeadline = Date.now() + scanWaitMs;
  while (Date.now() < lsDeadline) {
    const ls = await api('GET', `/api/local-engine/agent-browser/sessions/${sid}/login-state`, null, cookie);
    st = ls.json?.data?.state ?? ls.json?.message ?? '?';
    console.log(`[login-state] ${new Date().toISOString().slice(11, 19)} ${st}`);
    if (st === 'logged_in') break;
    await sleep(3000);
  }
  record(`${tag}③ login-state = logged_in`, st === 'logged_in', { state: st });
  if (st !== 'logged_in') throw new Error(`${tag} 登录态未就绪: ${st}`);

  // ④ selector 探测（每候选新会话：终态 failed 后同会话 run 被拒）
  let hitSelector = null, hitText = '';
  for (const sel of candidates) {
    const c2 = await api('POST', '/api/local-engine/agent-browser/sessions', { platform, startUrl }, cookie);
    const sid2 = c2.json?.data?.id;
    if (!sid2) continue;
    const { events, finalStatus } = await runTask(cookie, sid2, `提取 ${sel}`, 90000);
    const ex = lastEvent(events, 'extract');
    const text = String(ex?.extractText ?? '').trim();
    console.log(`[probe] ${sel} -> status=${finalStatus} ok=${ex?.ok} text=${text.slice(0, 60)}`);
    if (ex?.ok && text.length >= 4) { hitSelector = sel; hitText = text; break; }
  }
  record(`${tag}④ selector 探测命中（提取到真实页面文本 ≥4 字符）`,
    !!hitSelector, { hitSelector, text: hitText.slice(0, 120) });
  if (!hitSelector) throw new Error(`${tag} 所有候选 selector 均未命中`);

  // ⑤ 组合任务「提取 + 截图」（解析器句式铁律 4.23）
  const runAt = Date.now();
  const { run, events, finalStatus } = await runTask(cookie, sid, `提取 ${hitSelector}，然后截图`, 150000);
  const runMs = Date.now() - runAt;
  record(`${tag}⑤ 组合任务「提取+截图」终态 succeeded`,
    run.status === 202 && finalStatus === 'succeeded',
    { status: run.status, finalStatus, runMs });

  // ⑥ 事件校验
  const raw = JSON.stringify(events);
  const ex = lastEvent(events, 'extract');
  const shot = lastEvent(events, 'screenshot');
  record(`${tag}⑥a extract 真实文本 + 无 base64 泄漏`,
    !!ex?.ok && String(ex.extractText ?? '').length >= 4 && !raw.includes('iVBORw0KGgo'),
    { text: String(ex?.extractText ?? '').slice(0, 120) });
  record(`${tag}⑥b screenshot 成功（evidenceUrl 落盘）`,
    !!shot?.ok,
    { shot: shot ? { ok: shot.ok, msg: String(shot.message ?? '').slice(0, 160), evidence: shot.evidenceUrl ?? null } : null });

  return { sid, hitSelector, hitText, finalStatus, runMs };
}

async function main() {
  // 登录 3011
  const login = await api('POST', '/api/auth/login', { username: USER, password: PASS });
  const cookie = login.cookie;
  const userId = login.json?.data?.user?.id || login.json?.data?.id || '';
  if (!cookie || !userId) { console.error('FATAL 登录 3011 失败', JSON.stringify(login.json).slice(0, 200)); process.exit(1); }
  console.log('PASS 登录 3011  userId=' + userId);

  // CDP 连主窗口
  const targets = await (await fetch(CDP_HTTP + '/json/list')).json();
  const mainWin = targets.find((t) => t.type === 'page' && (t.url || '').includes('localhost:3010'));
  if (!mainWin) { console.error('FATAL 找不到桌面端主窗口（CDP 9333）'); process.exit(1); }
  const wsMain = await connect(mainWin);
  send(wsMain, 'Runtime.enable').catch(() => {});
  console.log('PASS CDP 连接主窗口', mainWin.url.slice(0, 60));

  const results = {};
  // ---- 抖音：创作者中心首页 ----
  try {
    results.douyin = await calibratePlatform(wsMain, cookie, userId, {
      tag: '抖音',
      platform: 'douyin',
      startUrl: 'https://creator.douyin.com/',
      scanWaitMs: 10 * 60 * 1000, // partition 登录态丢失时等人工扫码（10 分钟）
      candidates: [
        'a[href*="/creator-micro/content"]',
        'a[href*="/creator-micro"]',
        'a[href*="/video/"]',
        'div[class*="title"]',
        'a[title]',
        'h2',
        'h1',
        'a',
      ],
    });
  } catch (e) {
    record('抖音 FATAL 未预期异常', false, { error: String(e.message || e).slice(0, 300) });
  }

  // ---- 视频号：工作台首页 ----
  try {
    results.wechatChannel = await calibratePlatform(wsMain, cookie, userId, {
      tag: '视频号',
      platform: 'wechat-channel',
      startUrl: 'https://channels.weixin.qq.com/platform',
      candidates: [
        'a[href*="/platform/data"]',
        'div[class*="nav"] a',
        'a[href*="/platform"]',
        'div[class*="title"]',
        'h2',
        'h1',
        'a',
      ],
    });
  } catch (e) {
    record('视频号 FATAL 未预期异常', false, { error: String(e.message || e).slice(0, 300) });
  }

  try { wsMain.close(); } catch {}

  // ---- 证据落盘（两平台各一份，对齐 stage5 命名）----
  const evDir = path.join(path.resolve(__dirname, '..'), '..', 'docs', 'browser-panel-baseline');
  fs.mkdirSync(evDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  for (const [plat, data] of Object.entries(results)) {
    if (!data) continue;
    fs.writeFileSync(path.join(evDir, `stage5-${plat}-readonly-evidence-${stamp}.json`),
      JSON.stringify({ meta: { at: new Date().toISOString(), backend: BASE, mode: 'real-app-cdp' }, ...data }, null, 2));
  }
  const failed = checks.filter((c) => !c.pass);
  console.log(`\nDOUYIN+WECHAT-READONLY RESULT: ${checks.length - failed.length}/${checks.length} PASS`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error('FATAL:', e.message || e); process.exit(1); });
