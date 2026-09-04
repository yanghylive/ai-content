#!/usr/bin/env node
'use strict';
/**
 * verify-wechat-channel-login-poll.mjs — 视频号登录轮询（精简版）
 * 不 open 面板（避免把 login.html 重置回 /platform 空壳），
 * 只登录 3011 → 建 wechat-channel 会话 → 轮询 login-state 3s×100（5 分钟）。
 * 大王在面板里点「微信快捷登录」→ logged_in 收口。
 */
const BASE = 'http://127.0.0.1:3011';
const USER = '__REDACTED_TEST_USER__';
const PASS = '__REDACTED_TEST_PASS__';

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

  const created = await api('POST', '/api/local-engine/agent-browser/sessions', {
    platform: 'wechat-channel',
    startUrl: 'https://channels.weixin.qq.com/platform',
  }, cookie);
  const sid = created.json?.data?.id;
  console.log(`${sid ? 'PASS' : 'FAIL'} 建 wechat-channel 会话 status=${created.status} id=${sid}`);
  if (!sid) process.exit(1);

  let last = '';
  for (let i = 0; i < 100; i++) {
    const g = await api('GET', `/api/local-engine/agent-browser/sessions/${sid}/login-state`, null, cookie);
    const d = g.json?.data;
    const line = `state=${d?.state || g.json?.message || '?'} url=${(d?.url || '').slice(0, 70)}`;
    if (line !== last) { console.log(`[${new Date().toISOString().slice(11, 19)}] ${line}`); last = line; }
    if (d?.state === 'logged_in') {
      console.log('\n==== ALL PASS: 视频号 logged_in（登录态已入 partition）====');
      process.exit(0);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.log('\n==== TIMEOUT 5 分钟未翻 logged_in ====');
  process.exit(2);
}

main().catch((e) => { console.error('FATAL', e.message || e); process.exit(1); });
