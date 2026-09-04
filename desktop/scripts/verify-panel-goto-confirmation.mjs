#!/usr/bin/env node
'use strict';
/**
 * verify-panel-goto-confirmation.mjs — 面板导航确认单闭环真机复验（v4）
 *
 * 闭环：run「打开 https://example.com」→ 面板模式导航签确认单 → partial_success
 * 「等待面板批准」→ CDP 在审批浮层真点最后一张「批准」→ 重试 run 携带
 * confirmationIds → 问桥放行 → 「面板导航已执行」→ succeeded。
 *
 * 用法：node verify-panel-goto-confirmation.mjs
 */
import WebSocket from '/Users/yanghy/.workbuddy/binaries/node/workspace/node_modules/ws/index.js';

const CDP_HTTP = 'http://127.0.0.1:9333';
const BASE = 'http://127.0.0.1:3011';
const USER = '__REDACTED_TEST_USER__';
const PASS = '__REDACTED_TEST_PASS__';

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

async function pollFinal(cookie, sid, maxSec = 60) {
  for (let i = 0; i < (maxSec * 1000) / 1500; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const g = await api('GET', `/api/local-engine/agent-browser/sessions/${sid}`, null, cookie);
    const d = g.json?.data;
    if (d?.status && !['created', 'running'].includes(d.status)) return d;
  }
  return null;
}

async function main() {
  const login = await api('POST', '/api/auth/login', { username: USER, password: PASS });
  const cookie = login.cookie;
  check('登录 3011', !!cookie, `status=${login.status}`);

  // 0. 前置：CDP 驱动主窗口 open 面板（manager.open 自动补开 agent mode，
  //    重写 mode 文件带新 pid——旧 pid 进程死亡时 backend fail-closed 判 off）
  const pageTargets = await (await fetch(CDP_HTTP + '/json/list')).json();
  const mainWin = pageTargets.find((t) => t.type === 'page' && (t.url || '').includes('localhost:3010'));
  if (!mainWin) { check('找到桌面端主窗口', false); process.exit(2); }
  const wsMain = await connect(mainWin);
  send(wsMain, 'Runtime.enable').catch(() => {});
  await evaluate(wsMain, `window.electronAPI.browserPanel.open({ url: 'https://example.com' })`);
  console.log('[面板] open 完成（agent mode 自动补写，mode 文件带新 pid）');
  await new Promise((r) => setTimeout(r, 2500));
  wsMain.close();

  // 1. 建会话 + run goto（面板模式导航必签确认单）
  const created = await api('POST', '/api/local-engine/agent-browser/sessions', { startUrl: 'https://example.com' }, cookie);
  const sid = created.json?.data?.id;
  check('创建会话', !!sid, `id=${sid}`);
  try {
    await api('POST', `/api/local-engine/agent-browser/sessions/${sid}/run`,
      { instruction: '打开 https://example.com' }, cookie);
  } catch { /* 长请求代理断开，以轮询为准 */ }

  // 2. 轮询到 partial_success（等待面板批准）
  let first = await pollFinal(cookie, sid, 45);
  const confirmId = (first?.events || []).filter((e) => e.type === 'step' && e.confirmationId).pop()?.confirmationId;
  check('首跑落 partial_success（等待面板批准）',
    first?.status === 'partial_success' && /等待面板批准/.test(first?.events?.find((e) => e.type === 'done')?.message || ''),
    `status=${first?.status} confirmId=${confirmId}`);
  check('确认单已签发', !!confirmId, String(confirmId));
  if (!confirmId) process.exit(2);

  // 3. CDP 在审批浮层点最后一张「批准」
  const targets = await (await fetch(CDP_HTTP + '/json/list')).json();
  const overlay = targets.find((t) => t.type === 'page' && (t.url || '').includes('browser-approval-overlay.html'));
  if (!overlay) { check('找到审批浮层', false); process.exit(2); }
  const ws = await connect(overlay);
  send(ws, 'Runtime.enable').catch(() => {});
  const clickRes = await evaluate(ws, `(async () => {
    const buttons = [...document.querySelectorAll('button.ok')];
    if (!buttons.length) return { ok: false, reason: '无批准按钮（cards=' + document.querySelectorAll('.card').length + ')' };
    buttons[buttons.length - 1].click(); // 最后一张 = 最新单
    return { ok: true, clicked: buttons.length };
  })()`);
  check('审批浮层真点「批准」（最后一张）', clickRes?.ok === true, JSON.stringify(clickRes));

  // 4. 等批准落桥（浮层卡片消失 = 主进程已处理）
  let gone = false;
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 800));
    const st = await evaluate(ws, `document.querySelectorAll('.card').length`);
    if (st === 0) { gone = true; break; }
  }
  check('待批卡片清空（批准已落桥）', gone);
  ws.close();

  // 5. 重试 run 携带 confirmationIds → 应问桥放行并真实执行
  try {
    await api('POST', `/api/local-engine/agent-browser/sessions/${sid}/run`,
      { confirmationIds: [confirmId] }, cookie);
  } catch { /* 以轮询为准 */ }
  const second = await pollFinal(cookie, sid, 60);
  const navStep = (second?.events || []).filter((e) => e.type === 'step' && /面板导航已执行/.test(e.message || '')).pop();
  check('重试终态 succeeded', second?.status === 'succeeded', `status=${second?.status}`);
  check('面板导航真实执行（webContents 证据）', !!navStep,
    String(navStep?.message || '').slice(0, 140));

  const pass = results.every((r) => r.ok);
  console.log(`\n==== ${pass ? 'ALL PASS' : 'HAS FAIL'} (${results.filter((r) => r.ok).length}/${results.length}) ====`);
  process.exit(pass ? 0 : 2);
}

main().catch((e) => { console.error('FATAL', e.message || e); process.exit(1); });
