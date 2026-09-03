#!/usr/bin/env node
'use strict';
/**
 * verify-agent-browser-headless.mjs — 验证 agent-browser 执行档强制 headless（2026-09-04 修复「调起系统浏览器」）
 *
 * 流程：
 *   1. 登录 3011 拿会话 cookie（测试账号）
 *   2. 记录 Chrome for Testing 进程基线
 *   3. 创建 general-web 会话（startUrl=example.com）+ run「提取 body，然后截图」（免确认动作）
 *   4. 断言：run succeeded；新出现的 Chrome for Testing 进程命令行带 --headless=new（无可见窗口）
 *
 * 用法：node verify-agent-browser-headless.mjs
 */
import { execFileSync } from 'node:child_process';

const BASE = 'http://127.0.0.1:3011';
const USER = '__REDACTED_TEST_USER__';
const PASS = '__REDACTED_TEST_PASS__';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  | ' + detail : ''}`);
}

function chromeProcs() {
  const out = execFileSync('ps', ['ax', '-o', 'pid,command'], { encoding: 'utf8' });
  return out
    .split('\n')
    .filter((l) => l.includes('Chrome for Testing') && l.includes('--type=') === false)
    .filter((l) => !l.includes('grep'))
    .map((l) => l.trim());
}

async function api(method, path, body, cookie) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  let cookieOut = cookie;
  if (setCookie) cookieOut = setCookie.split(';')[0];
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json, cookie: cookieOut };
}

async function main() {
  // 1. 登录
  const login = await api('POST', '/api/auth/login', { username: USER, password: PASS });
  const cookie = login.cookie;
  check('登录 3011', login.status === 200 && !!cookie, `status=${login.status}`);
  if (!cookie) process.exit(1);

  // 2. 基线
  const before = chromeProcs();
  console.log(`[基线] Chrome for Testing 主进程数: ${before.length}`);

  // 3. 创建会话
  const created = await api('POST', '/api/local-engine/agent-browser/sessions', {
    startUrl: 'https://example.com',
  }, cookie);
  check('创建 general-web 会话', created.status === 201 || created.status === 200,
    `status=${created.status} id=${created.json?.data?.id}`);
  const sessionId = created.json?.data?.id;
  if (!sessionId) process.exit(1);

  // 4. run（免确认动作序列：提取 + 截图）
  let runRes;
  try {
    runRes = await api('POST', `/api/local-engine/agent-browser/sessions/${sessionId}/run`,
      { instruction: '提取 body，然后截图' }, cookie);
  } catch (e) {
    runRes = { status: 0, json: null, cookie };
    console.log('[run] 网络异常（可能长连接），以轮询会话状态为准:', e.message);
  }
  console.log(`[run] status=${runRes.status}`);

  // 轮询会话状态（run 是异步循环）
  let final = null;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const g = await api('GET', `/api/local-engine/agent-browser/sessions/${sessionId}`, null, cookie);
    final = g.json?.data;
    const st = final?.status;
    if (st && !['created', 'running'].includes(st)) break;
  }
  check('run 终态', ['succeeded', 'partial_success'].includes(final?.status),
    `status=${final?.status} url=${final?.url} events=${(final?.events || []).length}`);

  // 5. 引擎进程断言
  const after = chromeProcs();
  const newProcs = after.filter((p) => !before.some((b) => p === b));
  console.log(`[进程] 新增 Chrome for Testing 主进程: ${newProcs.length}`);
  for (const p of newProcs) console.log('  ' + p.slice(0, 240));
  const headlessProcs = newProcs.filter((p) => p.includes('--headless=new'));
  check('新增引擎进程全部带 --headless=new（无可见窗口）',
    newProcs.length === 0 || headlessProcs.length === newProcs.length,
    `headless=${headlessProcs.length}/${newProcs.length}`);

  const pass = results.every((r) => r.ok);
  console.log(`\n==== ${pass ? 'ALL PASS' : 'HAS FAIL'} (${results.filter((r) => r.ok).length}/${results.length}) ====`);
  process.exit(pass ? 0 : 2);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
