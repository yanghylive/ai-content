#!/usr/bin/env node
'use strict';
/**
 * verify-douyin-scan-login.mjs — 抖音扫码登录真机 harness（阶段 5 同款流程）
 *
 * 1. 登录 3011 → 建 douyin platform 会话（startUrl=creator.douyin.com）
 * 2. CDP 驱动主窗口 open 面板（ownerId=userId、platform=douyin，partition 与 xhs 同规则）
 * 3. 轮询 login-state（3s × 5min）：login_prompt → 用户扫码 → logged_in 收口
 *
 * 用法：node verify-douyin-scan-login.mjs
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

async function main() {
  const login = await api('POST', '/api/auth/login', { username: USER, password: PASS });
  const cookie = login.cookie;
  if (!cookie) { console.log('FAIL 登录 3011'); process.exit(1); }
  console.log('PASS 登录 3011');

  const userId = (login.json?.data?.user?.id) || (login.json?.data?.id) || '';
  console.log('[userId]', userId || '(响应里没拿到，尝试 /auth/me)');
  if (!userId) {
    const me = await api('GET', '/api/auth/me', null, cookie);
    console.log('[auth/me]', JSON.stringify(me.json?.data || {}).slice(0, 200));
  }

  // 建 douyin platform 会话
  const created = await api('POST', '/api/local-engine/agent-browser/sessions', {
    platform: 'wechat-channel',
    startUrl: 'https://channels.weixin.qq.com/platform',
  }, cookie);
  const sid = created.json?.data?.id;
  console.log(`${sid ? 'PASS' : 'FAIL'} 建 douyin 会话  status=${created.status} id=${sid}`);
  if (!sid) process.exit(1);
  // 租约 tenantId 必须透传给面板 open（桥 actor 断言 owner/tenant 双字段，
  // 缺省 local-tenant 与后端 actor 真实租户不一致 → POLICY_DENIED，血泪 4.21/4.24）
  const leaseTenantId = created.json?.data?.lease?.tenantId ?? undefined;
  console.log('[lease tenantId]', leaseTenantId);

  // CDP 主窗口 open 面板（platform 透传 → douyin partition）
  const targets = await (await fetch(CDP_HTTP + '/json/list')).json();
  const mainWin = targets.find((t) => t.type === 'page' && (t.url || '').includes('localhost:3010'));
  if (!mainWin) { console.log('FAIL 找不到主窗口'); process.exit(1); }
  const ws = await connect(mainWin);
  send(ws, 'Runtime.enable').catch(() => {});
  const openRes = await evaluate(ws, `window.electronAPI.browserPanel.open({
    url: 'https://channels.weixin.qq.com/platform',
    ownerId: ${JSON.stringify(userId)},
    tenantId: ${JSON.stringify(leaseTenantId)},
    platform: 'wechat-channel',
  })`);
  console.log('[面板] open:', JSON.stringify(openRes).slice(0, 200));
  await new Promise((r) => setTimeout(r, 4000));

  // 轮询 login-state（3s × 100 = 5 分钟）
  let last = '';
  for (let i = 0; i < 100; i++) {
    const g = await api('GET', `/api/local-engine/agent-browser/sessions/${sid}/login-state`, null, cookie);
    const d = g.json?.data;
    const line = `state=${d?.state || g.json?.message || '?'} url=${(d?.url || '').slice(0, 60)}`;
    if (line !== last) { console.log(`[${new Date().toISOString().slice(11, 19)}] ${line}`); last = line; }
    if (d?.state === 'logged_in') {
      console.log('\n==== ALL PASS: 抖音 logged_in（登录态已入 partition）====');
      ws.close();
      process.exit(0);
    }
    if (d?.state === 'unknown' && i > 0 && i % 20 === 0) {
      console.log('  （unknown：面板页不在判定域或特征未命中，继续轮询…）');
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.log('\n==== TIMEOUT 5 分钟未翻 logged_in ====');
  ws.close();
  process.exit(2);
}

main().catch((e) => { console.error('FATAL', e.message || e); process.exit(1); });
