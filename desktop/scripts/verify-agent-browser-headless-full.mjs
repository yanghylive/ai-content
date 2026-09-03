#!/usr/bin/env node
'use strict';
/**
 * verify-headless-full.mjs — headless 修复真机闭环复验
 * 1. CDP 驱动桌面端重开面板（修复面板桥旧身份 403）
 * 2. 重跑 agent-browser 会话（免确认动作：提取 + 截图）
 * 3. 断言：run succeeded + 引擎进程带 --headless=new
 */
import WebSocket from '/Users/yanghy/.workbuddy/binaries/node/workspace/node_modules/ws/index.js';
import { execFileSync } from 'node:child_process';

const CDP_HTTP = 'http://127.0.0.1:9333';
const BASE = 'http://127.0.0.1:3011';
const USER = '__REDACTED_TEST_USER__';
const PASS = '__REDACTED_TEST_PASS__';

let msgId = 0;
const pending = new Map();

function send(ws, method, params, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }
    }, 20000);
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

function chromeMainProcs() {
  const out = execFileSync('ps', ['ax', '-o', 'pid,command'], { encoding: 'utf8' });
  return out.split('\n')
    .filter((l) => l.includes('Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
    .filter((l) => !l.includes('--type='))
    .filter((l) => !l.includes('/bin/node')) // 排除 node sidecar（其参数里含 Chrome 路径字符串）
    .map((l) => l.trim());
}

async function api(method, path, body, cookie) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.get('set-cookie');
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json, cookie: sc ? sc.split(';')[0] : cookie };
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  | ' + detail : ''}`);
}

async function main() {
  // 登录
  const login = await api('POST', '/api/auth/login', { username: USER, password: PASS });
  const cookie = login.cookie;
  check('登录 3011', !!cookie, `status=${login.status}`);

  // CDP 找主窗口
  const targets = await (await fetch(CDP_HTTP + '/json/list')).json();
  const mainWin = targets.find((t) => t.type === 'page' && (t.url || '').includes('localhost:3010'));
  if (!mainWin) throw new Error('找不到桌面端主窗口');
  const ws = await connect(mainWin);
  send(ws, 'Runtime.enable').catch(() => {});

  // 重开面板（真关闭→重开，旋转 capability token，治「token 已过期/无效」403）
  const strip = targets.find((t) => t.type === 'page' && (t.url || '').includes('browser-control-strip.html'));
  if (strip) {
    const wsStrip = await connect(strip);
    send(wsStrip, 'Runtime.enable').catch(() => {});
    await evaluate(wsStrip, `window.browserControl.invoke('browser-panel:hide')`);
    console.log('[面板] 已隐藏（控制条 channel）');
    await new Promise((r) => setTimeout(r, 1500));
    wsStrip.close();
  }
  await evaluate(ws, `window.electronAPI.browserPanel.open({ startUrl: 'https://example.com' })`);
  console.log('[面板] 重开完成（新令牌已落盘）');
  await new Promise((r) => setTimeout(r, 2500));

  // 基线
  const before = chromeMainProcs();

  // 建会话 + run
  const created = await api('POST', '/api/local-engine/agent-browser/sessions', { startUrl: 'https://example.com' }, cookie);
  const sessionId = created.json?.data?.id;
  check('创建会话', !!sessionId, `id=${sessionId}`);

  let runStatus = 'no-response';
  try {
    const runRes = await api('POST', `/api/local-engine/agent-browser/sessions/${sessionId}/run`,
      { instruction: '提取 body，然后截图' }, cookie);
    runStatus = runRes.status;
  } catch (e) { console.log('[run] 连接中断（正常，以轮询为准）'); }
  console.log(`[run] http=${runStatus}`);

  // 轮询终态
  let final = null;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const g = await api('GET', `/api/local-engine/agent-browser/sessions/${sessionId}`, null, cookie);
    final = g.json?.data;
    if (final?.status && !['created', 'running'].includes(final.status)) break;
  }
  check('run 终态 succeeded/partial_success', ['succeeded', 'partial_success'].includes(final?.status),
    `status=${final?.status}`);

  // 步骤明细
  for (const e of (final?.events || [])) {
    if (e.type === 'step') console.log(`  step[${e.stepIndex}] ${e.action} ok=${e.ok} ${String(e.message || '').slice(0, 120)}`);
    if (e.type === 'done') console.log(`  done: ${String(e.message || '').slice(0, 160)}`);
  }

  // 引擎进程断言（只看主浏览器进程）
  const after = chromeMainProcs();
  const newProcs = after.filter((p) => !before.some((b) => p === b));
  const headlessProcs = newProcs.filter((p) => p.includes('--headless=new'));
  console.log(`[进程] 新增引擎主进程=${newProcs.length} 带--headless=new=${headlessProcs.length}`);
  check('新增引擎进程全部 --headless=new（不弹可见窗口）',
    newProcs.length === 0 || headlessProcs.length === newProcs.length,
    newProcs.map((p) => p.slice(0, 150)).join(' || '));

  ws.close();
  const pass = results.every((r) => r.ok);
  console.log(`\n==== ${pass ? 'ALL PASS' : 'HAS FAIL'} (${results.filter((r) => r.ok).length}/${results.length}) ====`);
  process.exit(pass ? 0 : 2);
}

main().catch((e) => { console.error('FATAL', e.message || e); process.exit(1); });
