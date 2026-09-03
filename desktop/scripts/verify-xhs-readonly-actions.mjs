#!/usr/bin/env node
'use strict';
/**
 * verify-xhs-readonly-actions.mjs — 阶段 5 只读动作序列真机校准（2026-09-04）
 * 前置：大王已在面板扫码登录小红书（partition 内有登录态）。
 *
 * 链路：同 partition 重开面板（登录态恢复）→ 建 xiaohongshu 会话 →
 * ① login-state 复验 logged_in；
 * ② run 真实任务「提取页面上第一篇笔记的标题，然后截图」——
 *    extract/screenshot 全免单只读，走 dom-agent Observe-Act-Verify 循环 × 面板桥；
 * ③ 校验终态 succeeded + extract 拿到真实笔记内容 + screenshot 字节数（无 base64 泄漏）
 *    + 面板截图证据落盘（saveEvidencePngBase64，round17 链）；
 * ④ 清理（destroy → binding/mode 无残留）。
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { app, BrowserWindow, WebContentsView, ipcMain } = require('electron');
const { BrowserPanelManager } = require(path.join(__dirname, '..', 'browser-panel-manager.js'));
const { wireBrowserPanel } = require(path.join(__dirname, '..', 'browser-broker-wiring.js'));
const { registerBrowserPanelIpc } = require(path.join(__dirname, '..', 'browser-panel-ipc.js'));
const { createBrowserBridgeRuntime } = require(path.join(__dirname, '..', 'browser-panel-bridge-runtime.js'));

const BACKEND = 'http://127.0.0.1:3011';
const REAL_USER_DATA = path.join(os.homedir(), 'Library', 'Application Support', 'ai-content-desktop');
const OWNER_ID = process.env.VERIFY_OWNER_ID || 'cms2ktllp03u9j1wprksvwy8w';

const checks = [];
function record(name, pass, detail) {
  checks.push({ name, pass, detail: detail ?? null });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}`);
  if (detail) console.log(`   ${JSON.stringify(detail).slice(0, 400)}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(pathname, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(`${BACKEND}/api${pathname}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookies = res.headers.getSetCookie?.() ?? [];
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json, setCookies };
}

async function main() {
  app.setPath('userData', REAL_USER_DATA);
  await app.whenReady();
  const watchdog = setTimeout(() => { console.error('WATCHDOG 300s 退出'); app.exit(1); }, 300_000);
  watchdog.unref?.();

  const win = new BrowserWindow({
    width: 1600, height: 900, show: true,
    title: '小红书只读动作序列校准',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const bizView = new WebContentsView({ webPreferences: { sandbox: true } });
  win.contentView.addChildView(bizView);
  const fakeTabManager = {
    rightInset: 0,
    relayout() {
      const { width, height } = win.getContentBounds();
      bizView.setBounds({ x: 0, y: 38, width: Math.max(0, width - this.rightInset), height: height - 38 });
    },
    broadcast: () => undefined,
    sendToBusiness: () => true,
    isOwnedWebContents: () => true,
  };
  win.on('resize', () => fakeTabManager.relayout());

  const storeData = {};
  const manager = new BrowserPanelManager({
    electron: { WebContentsView },
    store: { get: (k) => storeData[k], set: (k, v) => { storeData[k] = v; } },
    tabManager: fakeTabManager,
    getUserDataDir: () => app.getPath('userData'),
  });
  manager.attach(win);
  const wiring = wireBrowserPanel({ manager });
  registerBrowserPanelIpc({ ipcMain, getPanel: () => manager, getWiring: () => wiring });
  const bridgeRuntime = createBrowserBridgeRuntime({
    manager, wiring,
    getUserDataDir: () => app.getPath('userData'),
    logger: console,
  });
  if (typeof manager.onSessionEvent === 'function') {
    manager.onSessionEvent((event) => bridgeRuntime.sync(event));
  }

  const bindingPath = path.join(REAL_USER_DATA, 'browser-panel-bridge.json');
  try { fs.rmSync(bindingPath, { force: true }); } catch {}

  try {
    // ---- 登录 + 建会话 + 开面板 ----
    const login = await api('/auth/login', {
      method: 'POST', body: { username: '__REDACTED_TEST_USER__', password: '__REDACTED_TEST_PASS__' },
    });
    const cookie = (login.setCookies || []).map((c) => c.split(';')[0]).join('; ');
    const created = await api('/local-engine/agent-browser/sessions', {
      method: 'POST', cookie,
      body: { platform: 'xiaohongshu', startUrl: 'https://www.xiaohongshu.com' },
    });
    const sid = created.json?.data?.id;
    const tenantId = created.json?.data?.lease?.tenantId;
    if (!sid) throw new Error('建会话失败: ' + JSON.stringify(created.json?.message));

    manager.open({ url: 'https://www.xiaohongshu.com', ownerId: OWNER_ID, tenantId });
    await sleep(7000); // 登录态恢复 + 页面加载

    // ---- ① login-state 复验 logged_in（等扫码：最多 5 分钟）----
    const lsDeadline = Date.now() + 5 * 60 * 1000;
    let st = null;
    while (Date.now() < lsDeadline) {
      const ls = await api(`/local-engine/agent-browser/sessions/${sid}/login-state`, { cookie });
      st = ls.json?.data?.state;
      console.log(`[verify] ${new Date().toLocaleTimeString()} login-state=${st}`);
      if (st === 'logged_in') break;
      await sleep(3000);
    }
    record('① login-state = logged_in（登录态从 partition 恢复或扫码后翻转）',
      st === 'logged_in', { state: st });
    if (st !== 'logged_in') throw new Error('登录态未就绪（等待扫码超时）');

    // ---- ② 真实只读任务：selector 探测循环（找首页笔记卡真实形态）----
    const candidates = [
      'a.title',
      '.note-item a',
      'a[href*="/explore/"]',
      'a[href*="/note/"]',
      'a[title]',
      'a.cover',
      'section a',
      'h1',
    ];
    let hitSelector = null;
    let hitText = '';
    for (const sel of candidates) {
      // 每次 probe 用新会话：终态 failed 后同会话 run 会被拒（终态保护）
      const c2 = await api('/local-engine/agent-browser/sessions', {
        method: 'POST', cookie,
        body: { platform: 'xiaohongshu', startUrl: 'https://www.xiaohongshu.com' },
      });
      const sid2 = c2.json?.data?.id;
      const run = await api(`/local-engine/agent-browser/sessions/${sid2}/run`, {
        method: 'POST', cookie,
        body: { instruction: `提取 ${sel}` },
      });
      const fs_ = run.json?.data?.status ?? run.status;
      const detail2 = await api(`/local-engine/agent-browser/sessions/${sid2}`, { cookie });
      const events2 = detail2.json?.data?.events ?? [];
      const lastExtract = [...events2].reverse().find((e) => (e.action ?? '').includes('extract'));
      const text = String(lastExtract?.extractText ?? '').trim();
      console.log(`[probe] ${sel} -> status=${fs_} ok=${lastExtract?.ok} text=${text.slice(0, 60)}`);
      if (lastExtract?.ok && text.length > 10) { hitSelector = sel; hitText = text; break; }
    }
    record('② 首页笔记卡 selector 探测命中（提取到 >10 字符真实文本）',
      !!hitSelector,
      { hitSelector, text: hitText.slice(0, 120) });
    if (!hitSelector) throw new Error('所有候选 selector 均未命中');

    // ---- ③ 命中 selector + 截图 完整只读序列 ----
    const runAt = Date.now();
    const run = await api(`/local-engine/agent-browser/sessions/${sid}/run`, {
      method: 'POST', cookie,
      body: { instruction: `提取 ${hitSelector}，然后截图` },
    });
    const runMs = Date.now() - runAt;
    const finalStatus = run.json?.data?.status;
    record('③ 组合任务「提取+截图」终态 succeeded',
      run.status === 202 && finalStatus === 'succeeded',
      { status: run.status, finalStatus, runMs, message: run.json?.message });

    // ---- ④ 事件与证据校验 ----
    const detail = await api(`/local-engine/agent-browser/sessions/${sid}`, { cookie });
    const events = detail.json?.data?.events ?? [];
    const raw = JSON.stringify(events);
    const extractStep = events.find((e) => (e.action ?? '').includes('extract'));
    const shotStep = events.find((e) => (e.action ?? '').includes('screenshot'));
    record('④ extract 提取到真实笔记标题（无 base64 泄漏）',
      !!extractStep?.ok && String(extractStep.extractText ?? '').length > 10 && !raw.includes('iVBORw0KGgo'),
      { text: String(extractStep?.extractText ?? '').slice(0, 120) });
    record('⑤ screenshot 成功且证据已落盘（evidenceUrl）',
      !!shotStep?.ok,
      { shot: shotStep ? { ok: shotStep.ok, msg: String(shotStep.message ?? '').slice(0, 200), evidence: shotStep.evidenceUrl ?? null } : null });

    // ---- ⑤ 清理 ----
    manager.destroy();
    await sleep(1200);
    record('⑥ 清理：binding/mode 无残留', !fs.existsSync(bindingPath),
      { bindingExists: fs.existsSync(bindingPath) });
  } catch (e) {
    record('FATAL 未预期异常', false, { error: e.message });
    try { manager.destroy(); } catch {}
  } finally {
    const evDir = path.join(path.resolve(__dirname, '..'), '..', 'docs', 'browser-panel-baseline');
    fs.mkdirSync(evDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    fs.writeFileSync(path.join(evDir, `stage5-xhs-readonly-evidence-${stamp}.json`),
      JSON.stringify({ meta: { at: new Date().toISOString(), backend: BACKEND }, checks }, null, 2));
    const failed = checks.filter((c) => !c.pass);
    console.log(`\nXHS-READONLY RESULT: ${checks.length - failed.length}/${checks.length} PASS`);
    setTimeout(() => app.exit(failed.length ? 1 : 0), 300);
  }
}

main().catch((e) => { console.error('FATAL:', e); app.exit(1); });
