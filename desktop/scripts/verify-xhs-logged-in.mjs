#!/usr/bin/env node
'use strict';
/**
 * verify-xhs-logged-in.mjs — 阶段 5 收口验证（2026-09-04）
 * 大王已在面板扫码登录；本脚本用同一 userData + 同 ownerId 重开面板
 * （partition 一致 → 登录态从磁盘恢复），验证 login-state 翻转 logged_in。
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

  const win = new BrowserWindow({
    width: 1600, height: 900, show: true, // 真机显示：大王直接在屏幕上扫码
    title: '小红书登录验证（扫码后自动完成）',
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
    manager,
    wiring,
    getUserDataDir: () => app.getPath('userData'),
    logger: console,
  });
  if (typeof manager.onSessionEvent === 'function') {
    manager.onSessionEvent((event) => bridgeRuntime.sync(event));
  }

  const bindingPath = path.join(REAL_USER_DATA, 'browser-panel-bridge.json');
  try { fs.rmSync(bindingPath, { force: true }); } catch {}

  try {
    const login = await api('/auth/login', {
      method: 'POST',
      body: { username: '__REDACTED_TEST_USER__', password: '__REDACTED_TEST_PASS__' },
    });
    const cookie = (login.setCookies || []).map((c) => c.split(';')[0]).join('; ');
    if (!login.json?.success) throw new Error('登录失败');

    const created = await api('/local-engine/agent-browser/sessions', {
      method: 'POST', cookie,
      body: { platform: 'xiaohongshu', startUrl: 'https://www.xiaohongshu.com' },
    });
    const sid = created.json?.data?.id;
    const tenantId = created.json?.data?.lease?.tenantId;
    console.log(`[verify] session=${sid} tenant=${tenantId}`);

    manager.open({
      url: 'https://www.xiaohongshu.com',
      ownerId: OWNER_ID,
      tenantId,
    });
    await sleep(6000); // 等页面加载 + cookie 恢复

    // 轮询登录态：最多 5 分钟，logged_in 即收口
    const deadline = Date.now() + 5 * 60 * 1000;
    let last = null;
    while (Date.now() < deadline) {
      const ls = await api(`/local-engine/agent-browser/sessions/${sid}/login-state`, { cookie });
      last = ls;
      const st = ls.json?.data?.state;
      console.log(`[verify] ${new Date().toLocaleTimeString()} state=${st} url=${ls.json?.data?.url ?? ''}`);
      if (st === 'logged_in') {
        console.log('[verify] ✅ 已检测到 logged_in，登录态已入 partition，全链闭环');
        break;
      }
      await sleep(3000);
    }
    console.log('[verify] final=', JSON.stringify(last?.json?.data ?? last?.json?.message, null, 2));

    manager.destroy();
    await sleep(1000);
    console.log('[verify] cleanup done, bindingExists=', fs.existsSync(bindingPath));
    setTimeout(() => app.exit(0), 300);
  } catch (e) {
    console.error('[verify] FATAL:', e.message);
    try { manager.destroy(); } catch {}
    setTimeout(() => app.exit(1), 300);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
main().catch((e) => { console.error('[verify] FATAL:', e); app.exit(1); });
